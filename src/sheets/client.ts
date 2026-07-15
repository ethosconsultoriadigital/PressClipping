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
import { logger } from '../utils/logger.js';

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
const cachedById = new Map<string, GoogleSpreadsheet>();

/**
 * ¿El error de Google Sheets/googleapis es transitorio y conviene reintentar?
 * Cubre tanto fallos de transporte (CI: "Premature close" / ECONNRESET) como
 * límites de cuota (429 / rateLimitExceeded) y errores de backend (503).
 * Los errores de credenciales/permisos NO entran aquí (no se reintentan).
 */
const PATRONES_REINTENTABLES = [
  'premature close',
  'econnreset',
  'socket hang up',
  'etimedout',
  'eai_again',
  'network socket disconnected',
  'invalid response body',
  '429',
  'quota exceeded',
  'ratelimitexceeded',
  'userratelimitexceeded',
  '503',
  'backenderror',
] as const;

export function esErrorSheetsReintetnable(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return PATRONES_REINTENTABLES.some((p) => msg.includes(p));
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Esperas de backoff (ms) entre reintentos. Máximo 4 intentos. */
export const SHEETS_BACKOFF_MS = [2000, 5000, 10000, 20000] as const;

/**
 * Ejecuta una operación de Google Sheets con reintentos y backoff exponencial
 * (2s, 5s, 10s, 20s) + jitter ante 429/5xx/transporte. Máximo 4 intentos.
 * Loguea cada reintento. Si agota intentos o el error no es reintentable,
 * relanza el último error.
 */
export async function withSheetsRetry<T>(
  op: () => Promise<T>,
  etiqueta = 'sheets-op',
): Promise<T> {
  const MAX_INTENTOS = 4;
  let ultimoError: unknown;
  for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
    try {
      return await op();
    } catch (err) {
      ultimoError = err;
      if (intento >= MAX_INTENTOS || !esErrorSheetsReintetnable(err)) break;
      const base = SHEETS_BACKOFF_MS[intento - 1] ?? 20000;
      const espera = base + Math.floor(Math.random() * 400); // jitter ≤400ms
      logger.warn(
        {
          etiqueta,
          intento,
          de: MAX_INTENTOS,
          espera_ms: espera,
          error: err instanceof Error ? err.message : String(err),
        },
        'Reintentando operación de Google Sheets (backoff)',
      );
      await sleep(espera);
    }
  }
  throw ultimoError;
}

/** Abre y autentica un documento por su id (sin caché), con reintentos. */
async function openDoc(
  email: string,
  privateKey: string,
  sheetId: string,
): Promise<GoogleSpreadsheet> {
  return withSheetsRetry(async () => {
    // JWT nuevo en cada intento → fuerza una conexión/handshake fresco.
    const jwt = new JWT({ email, key: privateKey, scopes: SCOPES });
    const doc = new GoogleSpreadsheet(sheetId, jwt);
    await doc.loadInfo();
    return doc;
  }, 'openDoc');
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

/**
 * Abre (y cachea) un spreadsheet EXTERNO arbitrario por su id, usando las
 * mismas credenciales de la cuenta de servicio (control/output). Pensado para
 * escribir en hojas finales de reportes fuera del Output Sheet propio (p.ej.
 * `NoticiasPatron`), que deben compartirse con el email de la cuenta de
 * servicio como Editor para que esto funcione. NUNCA crea el documento: si no
 * existe o no hay permiso, `doc.loadInfo()` lanza.
 */
export async function getSpreadsheetById(sheetId: string): Promise<GoogleSpreadsheet> {
  const cached = cachedById.get(sheetId);
  if (cached) return cached;
  const { email, privateKey } = requireSheetsEnv();
  const doc = await openDoc(email, privateKey, sheetId);
  cachedById.set(sheetId, doc);
  return doc;
}

/** Obtiene una pestaña de un spreadsheet externo arbitrario por id + título. */
export async function getTabById(
  sheetId: string,
  title: string,
): Promise<GoogleSpreadsheetWorksheet> {
  return resolveTab(await getSpreadsheetById(sheetId), title);
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
