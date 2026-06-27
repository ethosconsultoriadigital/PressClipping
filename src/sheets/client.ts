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
import { requireSheetsEnv, requireOutputSheetsEnv } from '../config/env.js';

/** Nombres canónicos de las pestañas del panel de control / configuración. */
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

/** Nombres canónicos de las pestañas de la base operativa de captura (salida). */
export const OUTPUT_TABS = {
  NOTICIAS_RAW: '01_Noticias_Raw',
  MENCIONES: '02_Menciones',
  XML_EXPORT: '03_XML_Export',
  LOGS: '04_Logs',
  COMPARATIVO: '05_Comparativo_PressClipping',
  RESUMEN_DIARIO: '06_Resumen_Diario',
  METRICAS_LIVE: '07_Metricas_Live',
  COBERTURA_MEDIOS: '08_Cobertura_Medios',
  MEDIOS_PRESSCLIPPING: '09_Medios_PressClipping',
} as const;

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

let cachedControl: GoogleSpreadsheet | null = null;
let cachedOutput: GoogleSpreadsheet | null = null;

/** Abre y autentica un documento por su id (sin caché). */
async function openDoc(
  email: string,
  privateKey: string,
  sheetId: string,
): Promise<GoogleSpreadsheet> {
  const jwt = new JWT({ email, key: privateKey, scopes: SCOPES });
  const doc = new GoogleSpreadsheet(sheetId, jwt);
  await doc.loadInfo();
  return doc;
}

/** Abre (y cachea) el documento del PANEL DE CONTROL (lectura de configuración). */
export async function getSpreadsheet(): Promise<GoogleSpreadsheet> {
  if (cachedControl) return cachedControl;
  const { email, privateKey, sheetId } = requireSheetsEnv();
  cachedControl = await openDoc(email, privateKey, sheetId);
  return cachedControl;
}

/**
 * Abre (y cachea) el documento de SALIDA (escritura de resultados).
 * Usa GOOGLE_OUTPUT_SHEET_ID o, si no existe, GOOGLE_SHEET_ID (fallback).
 */
export async function getOutputSpreadsheet(): Promise<GoogleSpreadsheet> {
  if (cachedOutput) return cachedOutput;
  const { email, privateKey, sheetId } = requireOutputSheetsEnv();
  cachedOutput = await openDoc(email, privateKey, sheetId);
  return cachedOutput;
}

function resolveTab(
  doc: GoogleSpreadsheet,
  title: string,
): GoogleSpreadsheetWorksheet {
  const sheet = doc.sheetsByTitle[title];
  if (!sheet) {
    const disponibles = Object.keys(doc.sheetsByTitle).join(', ');
    throw new Error(
      `No se encontró la pestaña "${title}". Pestañas disponibles: ${disponibles}.`,
    );
  }
  return sheet;
}

/** Obtiene una pestaña del panel de control por título. */
export async function getTab(
  title: string,
): Promise<GoogleSpreadsheetWorksheet> {
  return resolveTab(await getSpreadsheet(), title);
}

/** Obtiene una pestaña de la Sheet de salida por título. */
export async function getOutputTab(
  title: string,
): Promise<GoogleSpreadsheetWorksheet> {
  return resolveTab(await getOutputSpreadsheet(), title);
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
