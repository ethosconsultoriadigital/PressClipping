/**
 * Escritura (append) de filas en una pestaña de Google Sheets.
 *
 * Recibe registros con claves NORMALIZADas (normalizeHeader) y los mapea a las
 * cabeceras reales de la pestaña. Las claves sin cabecera correspondiente se
 * ignoran (no rompen). Es la base de la exportación operativa de la Fase 5.
 */
import type { GoogleSpreadsheetWorksheet } from 'google-spreadsheet';
import { getTab, getOutputTab, getOutputSpreadsheet, withSheetsRetry } from './client.js';
import { normalizeHeader } from '../utils/parse.js';

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
