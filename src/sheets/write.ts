/**
 * Escritura (append) de filas en una pestaña de Google Sheets.
 *
 * Recibe registros con claves NORMALIZADas (normalizeHeader) y los mapea a las
 * cabeceras reales de la pestaña. Las claves sin cabecera correspondiente se
 * ignoran (no rompen). Es la base de la exportación operativa de la Fase 5.
 */
import type { GoogleSpreadsheetWorksheet } from 'google-spreadsheet';
import { getTab, getOutputTab } from './client.js';
import { normalizeHeader } from '../utils/parse.js';

export type OutRow = Record<string, string | number | boolean | null | undefined>;

/** Escribe filas en una pestaña ya resuelta, alineando por nombre de cabecera. */
async function appendToSheet(
  sheet: GoogleSpreadsheetWorksheet,
  rows: OutRow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  await sheet.loadHeaderRow();

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

  await sheet.addRows(mapped);
  return mapped.length;
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
