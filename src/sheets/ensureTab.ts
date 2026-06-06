/**
 * Garantiza que una pestaña exista con las cabeceras dadas, SIN ser destructivo.
 *
 * - Si la pestaña no existe, la crea con las cabeceras.
 * - Si existe pero no tiene fila de cabecera, la establece.
 * - Si existe con cabeceras, NO las toca (no borra ni reordena datos).
 *
 * Se usa para crear paneles auxiliares (08_Validacion_Medios,
 * 09_Medios_Especiales) sin alterar las pestañas operativas existentes.
 */
import type { GoogleSpreadsheetWorksheet } from 'google-spreadsheet';
import { getSpreadsheet } from './client.js';
import { logger } from '../utils/logger.js';

export async function ensureTab(
  title: string,
  headers: string[],
): Promise<GoogleSpreadsheetWorksheet> {
  const doc = await getSpreadsheet();
  const existente = doc.sheetsByTitle[title];

  if (existente) {
    // Asegura la fila de cabecera sin tocar datos existentes.
    try {
      await existente.loadHeaderRow();
      if (existente.headerValues.length === 0) {
        await existente.setHeaderRow(headers);
      }
    } catch {
      // loadHeaderRow lanza si no hay cabeceras: las creamos.
      await existente.setHeaderRow(headers);
    }
    return existente;
  }

  logger.info({ title }, 'Creando pestaña auxiliar (no existía)');
  const sheet = await doc.addSheet({ title, headerValues: headers });
  return sheet;
}
