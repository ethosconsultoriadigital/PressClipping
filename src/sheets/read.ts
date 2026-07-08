/**
 * Lectura genérica de filas de una pestaña de Google Sheets.
 *
 * Mapea POR NOMBRE DE CABECERA (normalizado), no por posición: las columnas
 * pueden reordenarse en la Sheet sin romper el sistema. Devuelve cada fila
 * como un Record con claves normalizadas (minúsculas, sin acentos, '_').
 */
import type { GoogleSpreadsheetWorksheet } from 'google-spreadsheet';
import { getTab, getOutputTab } from './client.js';
import { normalizeHeader } from '../utils/parse.js';

export type RawRow = Record<string, string | undefined>;

/** Mapea las filas de una worksheet a registros con cabeceras normalizadas. */
async function mapSheetRows(sheet: GoogleSpreadsheetWorksheet): Promise<RawRow[]> {
  await sheet.loadHeaderRow();
  const rows = await sheet.getRows();
  const headers = sheet.headerValues.map((h) => ({ raw: h, norm: normalizeHeader(h) }));
  return rows.map((row) => {
    const record: RawRow = {};
    for (const { raw, norm } of headers) {
      const value = row.get(raw);
      record[norm] = value === undefined || value === null ? undefined : String(value);
    }
    return record;
  });
}

/** Lee todas las filas de una pestaña del PANEL DE CONTROL (cabeceras normalizadas). */
export async function readTabRows(title: string): Promise<RawRow[]> {
  return mapSheetRows(await getTab(title));
}

/**
 * Lee todas las filas de una pestaña de la Sheet de SALIDA (05/07/08/10, etc.)
 * como registros con cabeceras normalizadas. SOLO LECTURA. Si la pestaña no
 * existe, devuelve [].
 */
export async function readOutputTabRows(title: string): Promise<RawRow[]> {
  try {
    return await mapSheetRows(await getOutputTab(title));
  } catch {
    return [];
  }
}
