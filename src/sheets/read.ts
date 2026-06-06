/**
 * Lectura genérica de filas de una pestaña de Google Sheets.
 *
 * Mapea POR NOMBRE DE CABECERA (normalizado), no por posición: las columnas
 * pueden reordenarse en la Sheet sin romper el sistema. Devuelve cada fila
 * como un Record con claves normalizadas (minúsculas, sin acentos, '_').
 */
import { getTab } from './client.js';
import { normalizeHeader } from '../utils/parse.js';

export type RawRow = Record<string, string | undefined>;

/** Lee todas las filas de una pestaña como registros con cabeceras normalizadas. */
export async function readTabRows(title: string): Promise<RawRow[]> {
  const sheet = await getTab(title);
  await sheet.loadHeaderRow();
  const rows = await sheet.getRows();

  const headers = sheet.headerValues.map((h) => ({
    raw: h,
    norm: normalizeHeader(h),
  }));

  return rows.map((row) => {
    const record: RawRow = {};
    for (const { raw, norm } of headers) {
      const value = row.get(raw);
      record[norm] = value === undefined || value === null ? undefined : String(value);
    }
    return record;
  });
}
