/**
 * Cliente de Google Sheets (panel de control).
 *
 * Autentica con una cuenta de servicio (JWT) y expone helpers para abrir el
 * documento y obtener pestañas por título. La Sheet debe estar compartida con
 * el email de la cuenta de servicio como "Editor".
 */
import { GoogleSpreadsheet } from 'google-spreadsheet';
import type { GoogleSpreadsheetWorksheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { requireSheetsEnv } from '../config/env.js';

/** Nombres canónicos de las pestañas del panel. */
export const SHEET_TABS = {
  README: '00_README',
  MEDIOS: '01_Medios',
  KEYWORDS: '02_Keywords',
  CLIENTES: '03_Clientes',
  CONFIGURACION: '04_Configuracion',
  LOGS: '05_Logs',
  RESULTADOS: '06_Resultados',
  DICCIONARIOS: '07_Diccionarios',
} as const;

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

let cached: GoogleSpreadsheet | null = null;

/** Abre (y cachea) el documento de Google Sheets, ya autenticado. */
export async function getSpreadsheet(): Promise<GoogleSpreadsheet> {
  if (cached) return cached;

  const { email, privateKey, sheetId } = requireSheetsEnv();
  const jwt = new JWT({
    email,
    key: privateKey,
    scopes: SCOPES,
  });

  const doc = new GoogleSpreadsheet(sheetId, jwt);
  await doc.loadInfo();
  cached = doc;
  return doc;
}

/** Obtiene una pestaña por título; lanza un error claro si no existe. */
export async function getTab(
  title: string,
): Promise<GoogleSpreadsheetWorksheet> {
  const doc = await getSpreadsheet();
  const sheet = doc.sheetsByTitle[title];
  if (!sheet) {
    const disponibles = Object.keys(doc.sheetsByTitle).join(', ');
    throw new Error(
      `No se encontró la pestaña "${title}". Pestañas disponibles: ${disponibles}.`,
    );
  }
  return sheet;
}

/**
 * Verifica la conexión cargando el documento y reportando sus pestañas.
 * Devuelve un resumen útil para el script de prueba de conexión.
 */
export async function checkSheetsConnection(): Promise<{
  ok: boolean;
  detail: string;
}> {
  try {
    const doc = await getSpreadsheet();
    const titulos = Object.keys(doc.sheetsByTitle);
    const esperadas = Object.values(SHEET_TABS);
    const faltantes = esperadas.filter((t) => !titulos.includes(t));

    const base = `Documento: "${doc.title}". Pestañas: ${titulos.length}.`;
    if (faltantes.length > 0) {
      return {
        ok: true,
        detail: `${base} Aviso: faltan pestañas esperadas: ${faltantes.join(', ')}.`,
      };
    }
    return { ok: true, detail: `${base} Todas las pestañas esperadas presentes.` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      detail:
        `No se pudo abrir la Sheet: ${msg}. ` +
        '¿Compartiste el documento con el email de la cuenta de servicio?',
    };
  }
}
