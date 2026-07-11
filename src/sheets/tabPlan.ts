/**
 * Planificación PURA de "asegurar pestaña + headers" en Google Sheets.
 *
 * Separa la lógica determinista (¿hay que crear la pestaña? ¿qué columnas
 * agregar?) del acceso de red a Sheets, igual que `mergePlan.ts`. Así es
 * testeable sin tocar la API. El writer real (`ensureSheetTabAndHeaders` en
 * `write.ts`) usa este plan.
 *
 * Reglas de seguridad que el plan garantiza:
 *  - NUNCA borra filas existentes (no las conoce ni las toca).
 *  - NUNCA reordena ni elimina columnas existentes: solo agrega al final las
 *    que faltan (comparando por cabecera normalizada).
 *  - Si la pestaña existe con headers completos, no propone ningún cambio.
 */
import { normalizeHeader } from '../utils/parse.js';

export type EnsureTabAccion = 'crear_tab' | 'fijar_headers_vacios' | 'agregar_columnas' | 'sin_cambios';

export interface EnsureTabPlan {
  accion: EnsureTabAccion;
  headers_despues: string[];
  columnas_agregadas: string[];
}

/**
 * @param tabExiste        ¿la pestaña ya existe en el spreadsheet?
 * @param headersActuales  cabeceras reales actuales de la pestaña (vacío si no tiene fila de cabecera).
 * @param headersRequeridas cabeceras que deben existir al final.
 */
export function planEnsureTabHeaders(
  tabExiste: boolean,
  headersActuales: string[],
  headersRequeridas: string[],
): EnsureTabPlan {
  if (!tabExiste) {
    return { accion: 'crear_tab', headers_despues: [...headersRequeridas], columnas_agregadas: [...headersRequeridas] };
  }
  if (headersActuales.length === 0) {
    return { accion: 'fijar_headers_vacios', headers_despues: [...headersRequeridas], columnas_agregadas: [...headersRequeridas] };
  }
  const existentesNorm = new Set(headersActuales.map(normalizeHeader));
  const faltantes = headersRequeridas.filter((h) => !existentesNorm.has(normalizeHeader(h)));
  if (faltantes.length === 0) {
    return { accion: 'sin_cambios', headers_despues: [...headersActuales], columnas_agregadas: [] };
  }
  return { accion: 'agregar_columnas', headers_despues: [...headersActuales, ...faltantes], columnas_agregadas: faltantes };
}
