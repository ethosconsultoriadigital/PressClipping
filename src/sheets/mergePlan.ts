/**
 * Planificación PURA de un merge por clave sobre una pestaña de Google Sheets.
 *
 * Separa la lógica determinista (qué columnas agregar, qué celdas actualizar,
 * qué claves no existen) del acceso de red a Sheets. Así el merge es testeable
 * sin tocar la API. El writer real (`mergeOutputRowsByKey`) usa este plan.
 *
 * Reglas de seguridad que el plan garantiza:
 *  - NUNCA elimina ni reordena columnas existentes: solo agrega al final las
 *    columnas nuevas que aún no existen (comparando por cabecera normalizada).
 *  - NUNCA toca la columna clave.
 *  - Solo produce ediciones para claves que YA existen en la hoja (las demás se
 *    reportan como `claves_no_encontradas`, nunca se insertan filas).
 */
import { normalizeHeader } from '../utils/parse.js';

export type MergeValue = string | number | boolean | null | undefined;
export type MergeUpdate = Record<string, MergeValue>;

/** Edición concreta de una celda (columna) para una fila identificada por clave. */
export interface EdicionCelda {
  col_index: number;
  header: string;
  value: string;
}

/** Conjunto de ediciones para una fila existente identificada por su clave. */
export interface FilaEdicion {
  clave: string;
  celdas: EdicionCelda[];
}

export interface MergePlan {
  key_header_real: string;
  headers_despues: string[];
  columnas_agregadas: string[];
  ediciones: FilaEdicion[];
  claves_no_encontradas: string[];
}

function formatMergeValue(value: MergeValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value);
}

/**
 * Construye el plan de merge.
 *
 * @param headersActuales  cabeceras reales actuales de la hoja (en orden).
 * @param keyColumn        nombre lógico de la columna clave (p.ej. "medio_id").
 * @param updates          filas de actualización; cada una debe traer keyColumn.
 * @param clavesExistentes valores de la columna clave que YA están en la hoja.
 * @param nuevasColumnasSugeridas columnas nuevas a asegurar aunque falten en updates.
 */
export function planMergeByKey(
  headersActuales: string[],
  keyColumn: string,
  updates: MergeUpdate[],
  clavesExistentes: string[],
  nuevasColumnasSugeridas: string[] = [],
): MergePlan {
  const keyNorm = normalizeHeader(keyColumn);
  const keyHeaderReal = headersActuales.find((h) => normalizeHeader(h) === keyNorm);
  if (!keyHeaderReal) {
    throw new Error(`La hoja no tiene la columna clave "${keyColumn}".`);
  }

  const presentes = new Set(headersActuales.map(normalizeHeader));

  // Candidatas: sugeridas + todas las claves usadas en updates. Nunca la clave.
  const candidatas: string[] = [];
  const vistas = new Set<string>();
  const considerar = (col: string): void => {
    const n = normalizeHeader(col);
    if (n === keyNorm || presentes.has(n) || vistas.has(n)) return;
    vistas.add(n);
    candidatas.push(col);
  };
  for (const col of nuevasColumnasSugeridas) considerar(col);
  for (const u of updates) for (const col of Object.keys(u)) considerar(col);

  const columnasAgregadas = candidatas;
  const headersDespues = [...headersActuales, ...columnasAgregadas];
  const colIndexByNorm = new Map<string, number>();
  headersDespues.forEach((h, i) => colIndexByNorm.set(normalizeHeader(h), i));

  const existentesSet = new Set(clavesExistentes.map((k) => k.trim()));
  const ediciones: FilaEdicion[] = [];
  const clavesNoEncontradas: string[] = [];

  for (const u of updates) {
    const clave = formatMergeValue(u[keyColumn]).trim();
    if (!clave) continue;
    if (!existentesSet.has(clave)) {
      clavesNoEncontradas.push(clave);
      continue;
    }
    const celdas: EdicionCelda[] = [];
    for (const [col, value] of Object.entries(u)) {
      const n = normalizeHeader(col);
      if (n === keyNorm) continue;
      const idx = colIndexByNorm.get(n);
      if (idx === undefined) continue;
      celdas.push({ col_index: idx, header: headersDespues[idx]!, value: formatMergeValue(value) });
    }
    if (celdas.length > 0) ediciones.push({ clave, celdas });
  }

  return {
    key_header_real: keyHeaderReal,
    headers_despues: headersDespues,
    columnas_agregadas: columnasAgregadas,
    ediciones,
    claves_no_encontradas: clavesNoEncontradas,
  };
}
