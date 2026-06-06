/**
 * Escritura (append) de filas en una pestaña de Google Sheets.
 *
 * Recibe registros con claves NORMALIZADas (normalizeHeader) y los mapea a las
 * cabeceras reales de la pestaña. Las claves sin cabecera correspondiente se
 * ignoran (no rompen). Es la base de la exportación operativa de la Fase 5.
 */
import { getTab } from './client.js';
import { normalizeHeader } from '../utils/parse.js';

export type OutRow = Record<string, string | number | boolean | null | undefined>;

/**
 * Agrega filas al final de una pestaña, alineando por nombre de cabecera.
 * Devuelve cuántas filas se escribieron.
 */
export async function appendRows(title: string, rows: OutRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const sheet = await getTab(title);
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

function formatValue(value: OutRow[string]): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value);
}
