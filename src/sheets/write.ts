/**
 * Escritura (append) de filas en una pestaña de Google Sheets.
 *
 * Recibe registros con claves NORMALIZADas (normalizeHeader) y los mapea a las
 * cabeceras reales de la pestaña. Las claves sin cabecera correspondiente se
 * ignoran (no rompen). Es la base de la exportación operativa de la Fase 5.
 */
import type { GoogleSpreadsheetWorksheet } from 'google-spreadsheet';
import { getTab, getOutputTab, getOutputSpreadsheet, getTabById, withSheetsRetry } from './client.js';
import { normalizeHeader } from '../utils/parse.js';
import { planMergeByKey, type MergeUpdate } from './mergePlan.js';
import { planEnsureTabHeaders } from './tabPlan.js';

export type OutRow = Record<string, string | number | boolean | null | undefined>;

/** Escribe filas en una pestaña ya resuelta, alineando por nombre de cabecera. */
async function appendToSheet(
  sheet: GoogleSpreadsheetWorksheet,
  rows: OutRow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  await withSheetsRetry(() => sheet.loadHeaderRow(), `loadHeaderRow ${sheet.title}`);

  // Mapa cabecera-normalizada → cabecera-real de la pestaña.
  const normToRaw = new Map<string, string>();
  for (const raw of sheet.headerValues) {
    normToRaw.set(normalizeHeader(raw), raw);
  }

  const mapped = rows.map((row) => {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(row)) {
      const rawHeader = normToRaw.get(normalizeHeader(key));
      if (!rawHeader) continue; // la pestaña no tiene esa columna
      out[rawHeader] = formatValue(value);
    }
    return out;
  });

  await withSheetsRetry(() => sheet.addRows(mapped), `addRows ${sheet.title}`);
  return mapped.length;
}

/**
 * Limpia SOLO el rango de datos `a1DataRange` (p.ej. "A2:S") de una pestaña de
 * salida en UNA sola llamada atómica (`values:clear`), conservando la cabecera
 * A1 y sin tocar columnas fuera del rango. Reemplaza el borrado fila-por-fila,
 * que consumía cuota de escritura y podía dejar la hoja truncada si fallaba a
 * mitad (429). Con reintentos/backoff.
 */
export async function clearOutputDataRange(
  title: string,
  a1DataRange: string,
): Promise<void> {
  const sheet = await getOutputTab(title); // lanza si la pestaña no existe
  await withSheetsRetry(() => sheet.clear(a1DataRange), `clear ${title}!${a1DataRange}`);
}

/**
 * Agrega filas al final de una pestaña de un SPREADSHEET EXTERNO arbitrario,
 * alineando por nombre de cabecera. El spreadsheet debe estar compartido con
 * el email de la cuenta de servicio como Editor. Devuelve cuántas filas se
 * escribieron.
 */
export async function appendRowsById(
  spreadsheetId: string,
  tabTitle: string,
  rows: OutRow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  return appendToSheet(await getTabById(spreadsheetId, tabTitle), rows);
}

/**
 * Agrega filas al final de una pestaña del PANEL DE CONTROL, alineando por
 * nombre de cabecera. Devuelve cuántas filas se escribieron.
 */
export async function appendRows(title: string, rows: OutRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  return appendToSheet(await getTab(title), rows);
}

/**
 * Agrega filas al final de una pestaña de la SHEET DE SALIDA (base operativa
 * de captura). Devuelve cuántas filas se escribieron.
 */
export async function appendOutputRows(title: string, rows: OutRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  return appendToSheet(await getOutputTab(title), rows);
}

function formatValue(value: OutRow[string]): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value);
}

/** Resumen del resultado de un merge por clave sobre una pestaña de salida. */
export interface MergeByKeyResumen {
  filas_antes: number;
  filas_despues: number;
  readback_filas: number;
  headers_antes: string[];
  headers_despues: string[];
  columnas_agregadas: string[];
  filas_actualizadas: number;
  claves_no_encontradas: string[];
  mismatch: boolean;
}

/**
 * MERGE seguro por clave sobre una pestaña de la Sheet de SALIDA ya existente.
 *
 * Actualiza SOLO las celdas de las filas cuya clave (`keyColumn`) coincide con
 * las `updates`, sin insertar filas, sin borrar filas ni reordenar columnas.
 * Agrega al final las columnas nuevas que aún no existan (por cabecera
 * normalizada). Hace readback obligatorio y reporta `mismatch` si el número de
 * filas cambió. Si la pestaña no existe, lanza (no crea nada).
 *
 * Diseñado para actualizar `08_Cobertura_Medios` con resultados por medio/lote
 * sin romper las filas de auditoría existentes.
 */
export async function mergeOutputRowsByKey(
  title: string,
  keyColumn: string,
  updates: MergeUpdate[],
  nuevasColumnasSugeridas: string[] = [],
): Promise<MergeByKeyResumen> {
  const sheet = await getOutputTab(title); // lanza si la pestaña no existe
  await withSheetsRetry(() => sheet.loadHeaderRow(), `loadHeaderRow ${title}`);
  const headersAntes = [...sheet.headerValues];

  let rows = await withSheetsRetry(() => sheet.getRows(), `getRows ${title}`);
  const filasAntes = rows.length;

  const keyHeaderRealPre = headersAntes.find(
    (h) => normalizeHeader(h) === normalizeHeader(keyColumn),
  );
  if (!keyHeaderRealPre) {
    throw new Error(`La pestaña ${title} no tiene la columna clave "${keyColumn}".`);
  }
  const clavesExistentes = rows.map((r) => String(r.get(keyHeaderRealPre) ?? '').trim());

  const plan = planMergeByKey(headersAntes, keyColumn, updates, clavesExistentes, nuevasColumnasSugeridas);

  // 1. Agregar columnas nuevas (solo si faltan): redimensionar si hace falta y
  //    reescribir la fila de cabecera con las columnas existentes + nuevas.
  if (plan.columnas_agregadas.length > 0) {
    if (sheet.columnCount < plan.headers_despues.length) {
      await withSheetsRetry(
        () => sheet.resize({ rowCount: sheet.rowCount, columnCount: plan.headers_despues.length }),
        `resize ${title}`,
      );
    }
    await withSheetsRetry(() => sheet.setHeaderRow(plan.headers_despues), `setHeaderRow ${title}`);
    rows = await withSheetsRetry(() => sheet.getRows(), `getRows(reload) ${title}`);
  }

  // 2. Mapear clave → fila (número de fila real en la hoja) tras el reload.
  const rowByKey = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const k = String(r.get(plan.key_header_real) ?? '').trim();
    if (k) rowByKey.set(k, r);
  }

  // 3. Aplicar ediciones por celda en un solo saveUpdatedCells (mínima cuota).
  const rowNumbers: number[] = [];
  for (const ed of plan.ediciones) {
    const r = rowByKey.get(ed.clave);
    if (r) rowNumbers.push(r.rowNumber);
  }
  if (rowNumbers.length > 0) {
    const minRow = Math.min(...rowNumbers);
    const maxRow = Math.max(...rowNumbers);
    await withSheetsRetry(
      () =>
        sheet.loadCells({
          startRowIndex: minRow - 1,
          endRowIndex: maxRow,
          startColumnIndex: 0,
          endColumnIndex: plan.headers_despues.length,
        }),
      `loadCells ${title}`,
    );
    for (const ed of plan.ediciones) {
      const r = rowByKey.get(ed.clave);
      if (!r) continue;
      for (const celda of ed.celdas) {
        const cell = sheet.getCell(r.rowNumber - 1, celda.col_index);
        cell.value = celda.value;
      }
    }
    await withSheetsRetry(() => sheet.saveUpdatedCells(), `saveUpdatedCells ${title}`);
  }

  // 4. Readback obligatorio.
  const rb = await withSheetsRetry(() => sheet.getRows(), `getRows(readback) ${title}`);
  const readbackFilas = rb.length;

  return {
    filas_antes: filasAntes,
    filas_despues: readbackFilas,
    readback_filas: readbackFilas,
    headers_antes: headersAntes,
    headers_despues: plan.headers_despues,
    columnas_agregadas: plan.columnas_agregadas,
    filas_actualizadas: plan.ediciones.length,
    claves_no_encontradas: plan.claves_no_encontradas,
    mismatch: readbackFilas !== filasAntes,
  };
}

/** Resultado de asegurar columnas en una pestaña de salida. */
export interface EnsureHeadersResumen {
  headers_antes: string[];
  headers_despues: string[];
  columnas_agregadas: string[];
}

/**
 * Asegura que una pestaña de salida EXISTENTE contenga TODAS las `headers`
 * requeridas, agregando al FINAL solo las que faltan (por cabecera normalizada).
 * NO borra, NO reordena ni cambia las existentes. Si la pestaña no existe, la
 * crea con `headers`. Pensada para migrar `10_Alertas_Sombra` a columnas nuevas
 * de observabilidad sin romper filas históricas.
 */
export async function ensureOutputHeaders(
  title: string,
  headers: string[],
): Promise<EnsureHeadersResumen> {
  const doc = await getOutputSpreadsheet();
  let sheet = doc.sheetsByTitle[title];
  if (!sheet) {
    sheet = await withSheetsRetry(() => doc.addSheet({ title, headerValues: headers }), `addSheet ${title}`);
    return { headers_antes: [], headers_despues: [...headers], columnas_agregadas: [...headers] };
  }
  await withSheetsRetry(() => sheet!.loadHeaderRow(), `loadHeaderRow ${title}`).catch(() => undefined);
  const headersAntes = sheet.headerValues && sheet.headerValues.length > 0 ? [...sheet.headerValues] : [];
  if (headersAntes.length === 0) {
    await withSheetsRetry(() => sheet!.setHeaderRow(headers), `setHeaderRow ${title}`);
    return { headers_antes: [], headers_despues: [...headers], columnas_agregadas: [...headers] };
  }
  const existentesNorm = new Set(headersAntes.map((h) => normalizeHeader(h)));
  const faltantes = headers.filter((h) => !existentesNorm.has(normalizeHeader(h)));
  if (faltantes.length === 0) {
    return { headers_antes: headersAntes, headers_despues: headersAntes, columnas_agregadas: [] };
  }
  const headersDespues = [...headersAntes, ...faltantes];
  if (sheet.columnCount < headersDespues.length) {
    await withSheetsRetry(
      () => sheet!.resize({ rowCount: sheet!.rowCount, columnCount: headersDespues.length }),
      `resize ${title}`,
    );
  }
  await withSheetsRetry(() => sheet!.setHeaderRow(headersDespues), `setHeaderRow ${title}`);
  return { headers_antes: headersAntes, headers_despues: headersDespues, columnas_agregadas: faltantes };
}

/**
 * Append histórico ACUMULATIVO a una pestaña de la Sheet de salida.
 *
 * A diferencia de `appendOutputRows`, si la pestaña no existe la crea con los
 * `headers` indicados; y si existe pero está vacía, fija la fila de cabecera.
 * Pensada para `07_Metricas_Live` (nunca se usa replace-window: solo crece).
 * Devuelve cuántas filas se escribieron.
 */
export async function appendHistoryRow(
  title: string,
  headers: string[],
  row: OutRow,
): Promise<number> {
  const doc = await getOutputSpreadsheet();
  let sheet = doc.sheetsByTitle[title];
  if (!sheet) {
    sheet = await withSheetsRetry(
      () => doc.addSheet({ title, headerValues: headers }),
      `addSheet ${title}`,
    );
  } else {
    await withSheetsRetry(() => sheet!.loadHeaderRow(), `loadHeaderRow ${title}`).catch(
      () => undefined,
    );
    if (!sheet.headerValues || sheet.headerValues.length === 0) {
      await withSheetsRetry(() => sheet!.setHeaderRow(headers), `setHeaderRow ${title}`);
    }
  }
  return appendToSheet(sheet, [row]);
}

/**
 * Append histórico ACUMULATIVO de VARIAS filas a una pestaña de la Sheet de
 * salida. Si la pestaña no existe la crea con `headers`; si existe vacía, fija
 * la cabecera. NUNCA limpia ni hace replace-window. Pensada para pestañas de
 * solo-append como `10_Alertas_Sombra`. Devuelve cuántas filas se escribieron.
 */
export async function appendHistoryRows(
  title: string,
  headers: string[],
  rows: OutRow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const doc = await getOutputSpreadsheet();
  let sheet = doc.sheetsByTitle[title];
  if (!sheet) {
    sheet = await withSheetsRetry(
      () => doc.addSheet({ title, headerValues: headers }),
      `addSheet ${title}`,
    );
  } else {
    await withSheetsRetry(() => sheet!.loadHeaderRow(), `loadHeaderRow ${title}`).catch(
      () => undefined,
    );
    if (!sheet.headerValues || sheet.headerValues.length === 0) {
      await withSheetsRetry(() => sheet!.setHeaderRow(headers), `setHeaderRow ${title}`);
    }
  }
  return appendToSheet(sheet, rows);
}

/**
 * Lee la fila de cabecera de una pestaña de forma tolerante: si la pestaña está
 * vacía (recién creada / sin header), `loadHeaderRow()` lanza y el getter
 * `headerValues` también lanza — en ese caso devolvemos [] en vez de propagar.
 */
async function safeHeaderValues(
  sheet: GoogleSpreadsheetWorksheet,
  title: string,
): Promise<string[]> {
  try {
    await withSheetsRetry(() => sheet.loadHeaderRow(), `loadHeaderRow ${title}`);
  } catch {
    return [];
  }
  try {
    return sheet.headerValues && sheet.headerValues.length > 0 ? [...sheet.headerValues] : [];
  } catch {
    return [];
  }
}

/** Resultado de asegurar pestaña + headers, con readback real post-escritura. */
export interface EnsureTabResumen {
  accion: 'crear_tab' | 'fijar_headers_vacios' | 'agregar_columnas' | 'sin_cambios';
  headers_antes: string[];
  headers_despues: string[];
  columnas_agregadas: string[];
  /** Headers releídos de la API DESPUÉS de escribir (no la variable local). */
  readback_headers: string[];
  /** true si readback_headers no coincide exactamente con headers_despues planeados. */
  mismatch: boolean;
  /** Filas de datos preexistentes (solo si la pestaña ya existía con headers). */
  filas_preexistentes: number;
}

/**
 * Asegura que una pestaña de la Sheet de SALIDA exista con las `headers`
 * requeridas, creándola si hace falta. Con readback OBLIGATORIO: tras
 * cualquier escritura, vuelve a leer la fila de cabecera desde la API (no
 * confía en la variable local) y reporta `mismatch` si no coincide con lo
 * planeado. NUNCA borra filas existentes ni pestañas fuera de `title`.
 *
 * A diferencia de `ensureOutputHeaders` (que devuelve el plan sin re-leer),
 * esta función SIEMPRE relee `sheet.loadHeaderRow()` después de escribir,
 * pensada para altas de pestañas operativas nuevas donde el readback es un
 * requisito de seguridad explícito (p. ej. `11_Operacion_Sin_PressClipping`).
 */
export async function ensureSheetTabAndHeaders(
  title: string,
  headers: string[],
): Promise<EnsureTabResumen> {
  const doc = await getOutputSpreadsheet();
  let sheet = doc.sheetsByTitle[title];
  const tabExiste = Boolean(sheet);

  let headersActuales: string[] = [];
  let filasPreexistentes = 0;
  if (sheet) {
    headersActuales = await safeHeaderValues(sheet, title);
    if (headersActuales.length > 0) {
      const rows = await withSheetsRetry(() => sheet!.getRows(), `getRows ${title}`);
      filasPreexistentes = rows.length;
    }
  }

  const plan = planEnsureTabHeaders(tabExiste, headersActuales, headers);

  if (plan.accion === 'crear_tab') {
    sheet = await withSheetsRetry(() => doc.addSheet({ title, headerValues: headers }), `addSheet ${title}`);
  } else if (plan.accion === 'fijar_headers_vacios' || plan.accion === 'agregar_columnas') {
    if (sheet!.columnCount < plan.headers_despues.length) {
      await withSheetsRetry(
        () => sheet!.resize({ rowCount: sheet!.rowCount, columnCount: plan.headers_despues.length }),
        `resize ${title}`,
      );
    }
    await withSheetsRetry(() => sheet!.setHeaderRow(plan.headers_despues), `setHeaderRow ${title}`);
  }
  // 'sin_cambios': no se escribe nada.

  // Readback OBLIGATORIO: releer la cabecera desde la API, no confiar en la local.
  const readbackHeaders = await safeHeaderValues(sheet!, title);
  const mismatch = JSON.stringify(readbackHeaders) !== JSON.stringify(plan.headers_despues);

  return {
    accion: plan.accion,
    headers_antes: headersActuales,
    headers_despues: plan.headers_despues,
    columnas_agregadas: plan.columnas_agregadas,
    readback_headers: readbackHeaders,
    mismatch,
    filas_preexistentes: filasPreexistentes,
  };
}

/**
 * REEMPLAZA los datos de una pestaña de salida YA EXISTENTE: borra las filas de
 * datos (conserva la cabecera A1) y escribe `rows`. Si la pestaña no existe,
 * lanza un error claro y NO crea nada (para no inventar pestañas). Devuelve
 * cuántas filas se escribieron.
 */
export async function replaceOutputRows(title: string, rows: OutRow[]): Promise<number> {
  const sheet = await getOutputTab(title); // lanza si la pestaña no existe
  await withSheetsRetry(() => sheet.loadHeaderRow(), `loadHeaderRow ${title}`);
  const headers = [...sheet.headerValues];
  // Limpieza en bloque (1-2 llamadas) en vez de borrar fila por fila, que para
  // cientos de filas excede la cuota de escritura de Google (429).
  await withSheetsRetry(() => sheet.clear(), `clear ${title}`);
  await withSheetsRetry(() => sheet.setHeaderRow(headers), `setHeaderRow ${title}`);
  return appendToSheet(sheet, rows);
}
