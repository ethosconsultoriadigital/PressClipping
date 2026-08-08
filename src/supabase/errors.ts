/**
 * Clasificación de errores de PostgREST/Supabase y reintentos con backoff.
 *
 * Motivación: PostgREST usa la frase "schema cache" en DOS situaciones muy
 * distintas y confundirlas manda al diagnóstico equivocado:
 *
 *   1. `PGRST205` — "Could not find the table 'public.x' in the schema cache"
 *      → la tabla realmente NO existe (falta migración).
 *   2. `PGRST002` — "Could not query the database for the schema cache. Retrying."
 *      → PostgREST está arriba pero NO pudo consultar Postgres para construir su
 *        caché de esquema. Es TRANSITORIO (proyecto reiniciando/pausado, pool de
 *        conexiones agotado, incidente). Afecta a TODAS las tablas por igual.
 *
 * Clasificar por CÓDIGO primero (nunca por substring de "schema cache") evita
 * reportar "aplica la migración" cuando en realidad la base está degradada.
 */
import { logger } from '../utils/logger.js';

/** Forma mínima de un error de PostgREST (`PostgrestError`) o de transporte. */
export interface SupabaseErrorLike {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

export type SupabaseFailureKind =
  /** PGRST002: PostgREST no pudo leer el esquema desde Postgres. Transitorio. */
  | 'transient_schema_cache'
  /** Fallo de conexión/timeout/5xx. Transitorio. */
  | 'transient_connection'
  /** La tabla no existe (falta migración). NO transitorio. */
  | 'missing_table'
  /** La columna no existe (query mal escrita). NO transitorio. */
  | 'missing_column'
  /** Permisos/API key. NO transitorio. */
  | 'permission'
  | 'other';

function textoDe(err: unknown): string {
  if (err == null) return '';
  if (typeof err === 'string') return err.toLowerCase();
  const e = err as SupabaseErrorLike & { name?: string };
  return [e.code, e.message, e.details, e.hint, e.name]
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .join(' | ')
    .toLowerCase();
}

function codigoDe(err: unknown): string {
  if (err == null || typeof err === 'string') return '';
  const code = (err as SupabaseErrorLike).code;
  return typeof code === 'string' ? code.trim().toUpperCase() : '';
}

/**
 * Clasifica un error de Supabase. El orden importa: primero los códigos
 * inequívocos, y solo al final las heurísticas por mensaje.
 */
export function classifySupabaseError(err: unknown): SupabaseFailureKind {
  const code = codigoDe(err);
  const txt = textoDe(err);

  // --- Códigos inequívocos de PostgREST -------------------------------------
  // PGRST205 / 42P01 → tabla ausente de verdad (su mensaje TAMBIÉN dice
  // "schema cache", por eso se evalúa antes que el caso transitorio).
  if (code === 'PGRST205' || code === '42P01') return 'missing_table';
  // PGRST204 / 42703 → columna inexistente.
  if (code === 'PGRST204' || code === '42703') return 'missing_column';
  // PGRST002 → no pudo consultar Postgres para la caché de esquema (transitorio).
  if (code === 'PGRST002') return 'transient_schema_cache';
  // PGRST001 → no pudo conectarse a la base (transitorio).
  if (code === 'PGRST001') return 'transient_connection';
  // 42501 / PGRST301 → permisos o JWT.
  if (code === '42501' || code === 'PGRST301') return 'permission';
  // 53300 (too_many_connections) / 57P03 (cannot_connect_now) → transitorio.
  if (code === '53300' || code === '57P03') return 'transient_connection';

  // --- Heurísticas por mensaje (proyectos/versiones sin código) -------------
  if (txt.includes('could not query the database for the schema cache')) {
    return 'transient_schema_cache';
  }
  if (txt.includes('could not find the table') || txt.includes('does not exist')) {
    return 'missing_table';
  }
  if (txt.includes('could not find the') && txt.includes('column')) {
    return 'missing_column';
  }
  if (txt.includes('invalid api key') || txt.includes('jwt') || txt.includes('permission denied')) {
    return 'permission';
  }
  for (const p of [
    'fetch failed',
    'econnreset',
    'econnrefused',
    'etimedout',
    'enotfound',
    'socket hang up',
    'network',
    'timeout',
    'service unavailable',
    'bad gateway',
    '503',
    '502',
    '504',
  ]) {
    if (txt.includes(p)) return 'transient_connection';
  }
  return 'other';
}

/** ¿Conviene reintentar? (base degradada, no un bug de query). */
export function isTransientSupabaseError(err: unknown): boolean {
  const kind = classifySupabaseError(err);
  return kind === 'transient_schema_cache' || kind === 'transient_connection';
}

/** ¿La tabla realmente no existe? (falta migración). */
export function isMissingTableError(err: unknown): boolean {
  return classifySupabaseError(err) === 'missing_table';
}

/**
 * Descripción auditable de un error: incluye código y clasificación, nunca la
 * URL del proyecto ni la service role key.
 */
export function describeSupabaseError(err: unknown): string {
  const code = codigoDe(err);
  const kind = classifySupabaseError(err);
  const msg =
    err == null
      ? 'error desconocido'
      : typeof err === 'string'
        ? err
        : ((err as SupabaseErrorLike).message ?? String(err));
  return `[${kind}${code ? ` ${code}` : ''}] ${msg}`;
}

/** Pista accionable según el tipo de fallo (para logs y mensajes de error). */
export function hintForSupabaseError(err: unknown): string {
  switch (classifySupabaseError(err)) {
    case 'transient_schema_cache':
      return 'PostgREST no pudo leer el esquema desde Postgres. NO es una migración faltante: ' +
        'revisa que el proyecto Supabase no esté pausado/reiniciando y reintenta en unos minutos ' +
        '(npm run diagnose:supabase).';
    case 'transient_connection':
      return 'Fallo de conexión/timeout contra Supabase. Reintenta; si persiste, revisa el estado del proyecto.';
    case 'missing_table':
      return 'La tabla no existe: aplica las migraciones de supabase/migrations.';
    case 'missing_column':
      return 'La columna no existe: revisa el select del query contra el esquema real.';
    case 'permission':
      return 'Problema de credenciales/permisos: revisa SUPABASE_SERVICE_ROLE_KEY y las políticas.';
    default:
      return 'Revisa el mensaje del error para más detalle.';
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Esperas de backoff (ms) entre reintentos. Máximo 4 intentos. */
export const SUPABASE_BACKOFF_MS = [1500, 4000, 9000] as const;

/**
 * Forma mínima de una respuesta de PostgREST. Se declara laxa a propósito para
 * aceptar tanto `PostgrestResponse` como los builders (que son thenables, no
 * Promises) sin perder el tipo de `data` en el llamador.
 */
export interface PostgrestResultLike {
  data: unknown;
  error: SupabaseErrorLike | null;
}

/**
 * Ejecuta un query de PostgREST reintentando SOLO ante errores transitorios
 * (PGRST002 / conexión). Los errores de esquema o permisos se devuelven de
 * inmediato: reintentarlos solo esconde el bug.
 *
 * Devuelve el mismo `{ data, error }` del cliente para no cambiar el flujo de
 * los llamadores. `run` se recibe como thenable porque los query builders de
 * supabase-js no son Promises completas.
 */
export async function retryPostgrest<R extends PostgrestResultLike>(
  etiqueta: string,
  run: () => PromiseLike<R>,
  maxIntentos = 4,
): Promise<R> {
  let ultimo = { data: null, error: null } as unknown as R;
  for (let intento = 1; intento <= maxIntentos; intento++) {
    try {
      ultimo = await run();
    } catch (err) {
      // Errores de transporte llegan como excepción, no como `error`.
      ultimo = { data: null, error: err as SupabaseErrorLike } as unknown as R;
    }
    if (!ultimo.error) return ultimo;
    if (intento >= maxIntentos || !isTransientSupabaseError(ultimo.error)) return ultimo;

    const base = SUPABASE_BACKOFF_MS[intento - 1] ?? 9000;
    const espera = base + Math.floor(Math.random() * 400); // jitter ≤400ms
    logger.warn(
      {
        etiqueta,
        intento,
        de: maxIntentos,
        espera_ms: espera,
        clasificacion: classifySupabaseError(ultimo.error),
        error: describeSupabaseError(ultimo.error),
      },
      'Reintentando query de Supabase (error transitorio)',
    );
    await sleep(espera);
  }
  return ultimo;
}
