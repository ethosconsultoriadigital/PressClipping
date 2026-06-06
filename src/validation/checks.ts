/**
 * Comprobaciones de salud de entorno, Supabase y Google Sheets.
 *
 * Todas son de SOLO LECTURA: cuentan filas con head:true (no traen datos) y
 * listan pestañas. No escriben ni borran nada.
 */
import { env } from '../config/env.js';
import { getSupabase } from '../supabase/client.js';
import { getSpreadsheet, SHEET_TABS } from '../sheets/client.js';

/** Tablas que el esquema debe tener (migraciones 0001-0003). */
export const TABLAS_ESPERADAS = [
  'configuracion',
  'medios',
  'clientes',
  'keywords',
  'noticias',
  'clusters',
  'menciones',
  'logs_ingesta',
] as const;

export interface EnvCheck {
  supabase: boolean;
  sheets: boolean;
  anthropic: boolean;
  faltantes: string[];
}

/** Reporta qué grupos de credenciales están presentes (sin lanzar). */
export function checkEnv(): EnvCheck {
  const faltantes: string[] = [];
  const supabase = Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
  if (!env.SUPABASE_URL) faltantes.push('SUPABASE_URL');
  if (!env.SUPABASE_SERVICE_ROLE_KEY) faltantes.push('SUPABASE_SERVICE_ROLE_KEY');

  const sheets = Boolean(
    env.GOOGLE_SERVICE_ACCOUNT_EMAIL && env.GOOGLE_PRIVATE_KEY && env.GOOGLE_SHEET_ID,
  );
  if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL) faltantes.push('GOOGLE_SERVICE_ACCOUNT_EMAIL');
  if (!env.GOOGLE_PRIVATE_KEY) faltantes.push('GOOGLE_PRIVATE_KEY');
  if (!env.GOOGLE_SHEET_ID) faltantes.push('GOOGLE_SHEET_ID');

  return { supabase, sheets, anthropic: Boolean(env.ANTHROPIC_API_KEY), faltantes };
}

export interface TableCheck {
  tabla: string;
  ok: boolean;
  filas: number | null;
  error: string | null;
}

/** Verifica existencia y cuenta filas de cada tabla esperada. */
export async function checkSupabaseTables(): Promise<TableCheck[]> {
  const supabase = getSupabase();
  const out: TableCheck[] = [];
  for (const tabla of TABLAS_ESPERADAS) {
    const { error, count } = await supabase
      .from(tabla)
      .select('*', { count: 'exact', head: true });
    out.push({
      tabla,
      ok: !error,
      filas: error ? null : count ?? 0,
      error: error ? error.message : null,
    });
  }
  return out;
}

export interface SheetsCheck {
  titulo: string;
  pestañas: string[];
  faltantes: string[];
  conteos: Record<string, number>;
}

/** Lista pestañas de la Sheet y cuenta filas de las pestañas de entrada. */
export async function checkSheetsTabs(): Promise<SheetsCheck> {
  const doc = await getSpreadsheet();
  const pestañas = Object.keys(doc.sheetsByTitle);
  const esperadas = Object.values(SHEET_TABS);
  const faltantes = esperadas.filter((t) => !pestañas.includes(t));

  const entrada = [
    SHEET_TABS.MEDIOS,
    SHEET_TABS.KEYWORDS,
    SHEET_TABS.CLIENTES,
    SHEET_TABS.CONFIGURACION,
  ];
  const conteos: Record<string, number> = {};
  for (const tab of entrada) {
    const sheet = doc.sheetsByTitle[tab];
    if (sheet) conteos[tab] = sheet.rowCount > 0 ? Math.max(0, sheet.rowCount - 1) : 0;
  }

  return { titulo: doc.title, pestañas, faltantes, conteos };
}
