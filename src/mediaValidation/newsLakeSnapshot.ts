/**
 * News Lake Snapshot — Media Validation & Certification, FASE 1C
 * (HARDENING FINAL: identidad temporal + validación runtime + drift).
 *
 * Responde la pregunta que Fase 1B (Run Evidence Aggregator) NO puede
 * responder por sí sola: "¿qué existe REALMENTE en News Lake para cada
 * medio_id, en un instante dado?". Fase 1B describe lo que el pipeline
 * REPORTÓ durante la ejecución; este módulo lee el estado PERSISTIDO real,
 * por lectura directa de `noticias`, SOLO LECTURA (no INSERT/UPDATE/
 * DELETE/UPSERT).
 *
 * INVARIANTE CRÍTICA: ZERO ROWS != QUERY FAILED != QUERY PARTIAL. Un error
 * de Supabase en CUALQUIER página nunca se convierte silenciosamente en
 * "0 noticias", y una paginación interrumpida nunca se presenta como
 * snapshot completo. `MediaSnapshot.status` distingue `'COMPLETE'` de
 * `'PARTIAL'`/`'ERROR'`, y en esos dos últimos casos los contadores se
 * dejan en `null`.
 *
 * ── HARDENING FINAL (blockers de la auditoría adversarial) ────────────────
 *
 * B1C — TEMPORAL WINDOW NO ANCLADA: antes, el cutoff temporal se derivaba
 * de `Date.now()` en el momento de cada consulta, así que BEFORE y AFTER
 * (capturados en instantes distintos por diseño) podían usar ventanas
 * ligeramente distintas aunque `windowDays` fuera igual. Ahora el cutoff se
 * deriva EXCLUSIVAMENTE de `windowAnchor` (ver `temporalWindow.ts`), un
 * ISO timestamp explícito que el llamador genera UNA vez y reutiliza sin
 * cambios en BEFORE y en AFTER. Si `windowDays` está activo, `windowAnchor`
 * es OBLIGATORIO (se rechaza con excepción si falta — nunca se inventa uno
 * en este módulo, ver `buildNewsLakeSnapshot`).
 *
 * B4C (parcial) — IDENTIDAD: cada snapshot ahora lleva `context_id`
 * (identidad explícita del intento de validación, compartida entre BEFORE/
 * RUN/AFTER) y `snapshot_role` (`'BEFORE'|'AFTER'`) — nunca inferido del
 * nombre de archivo. La verificación de coherencia entre ambos snapshots
 * vive en `runContext.ts` (`checkRunContextIdentity`).
 *
 * §33 (pagination drift, fix menor pero incluido en este pass): un
 * `noticia_id` repetido entre páginas (`duplicate_rows_skipped > 0`) es
 * señal observable de que el dataset se movió durante la paginación
 * (escritura concurrente). El ÉXITO DE LA QUERY (`status`) se mantiene
 * separado de esa señal — se añade `consistency: 'STABLE_OBSERVED' |
 * 'POSSIBLE_DRIFT' | 'UNKNOWN'` para no esconder el drift detrás de un
 * `status='COMPLETE'` que de otro modo sonaría a "certeza total". La capa
 * de composición (`runValidationEvidence.ts`) bloquea `persistence=VERIFIED`
 * cuando hay `POSSIBLE_DRIFT` (B5C/§34).
 */
import type { SupabaseErrorLike } from '../supabase/errors.js';
import { getSupabase } from '../supabase/client.js';
import { retryPostgrest, describeSupabaseError } from '../supabase/errors.js';
import { computeWindowStart, isValidIsoTimestamp } from './temporalWindow.js';

// ─────────────────────────────────────────────────────────────────────────────
// Contrato de fila — mínimo necesario para las métricas soportadas.
// ─────────────────────────────────────────────────────────────────────────────

export interface NoticiaSnapshotRow {
  noticia_id: string;
  medio_id: string;
  /** Mismo campo que consume `enrichNews.ts` para "texto limpio disponible". */
  texto_nota_limpia: string | null;
  /** Mismo campo que consume `enrichNews.ts` para "body disponible". */
  texto_cuerpo_nota: string | null;
}

/**
 * Mismo predicado que `vacio()` en `src/enrichers/enrichNews.ts` (no
 * exportado allí — Fase 1C NO reabre ese archivo). Reimplementado idéntico
 * a propósito: `null`/`undefined`/string en blanco cuentan como "vacío".
 */
function vacio(v: string | null | undefined): boolean {
  return v === null || v === undefined || v.trim().length === 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Seam de I/O — inyectable para tests deterministas. La implementación real
// (`createSupabaseFetchNoticiasPage`) es la única pieza que toca Supabase.
// ─────────────────────────────────────────────────────────────────────────────

export interface FetchNoticiasPageParams {
  medioId: string;
  /** `null` = sin filtro temporal (todo el histórico). */
  windowDays: number | null;
  /** Identidad temporal explícita (ver `temporalWindow.ts`). Requerido cuando `windowDays !== null`. */
  windowAnchor: string | null;
  /** 0-based, inclusive. */
  offset: number;
  pageSize: number;
}

export interface FetchNoticiasPageResult {
  data: NoticiaSnapshotRow[] | null;
  error: SupabaseErrorLike | null;
}

export type FetchNoticiasPage = (params: FetchNoticiasPageParams) => Promise<FetchNoticiasPageResult>;

/** PostgREST trunca silenciosamente cualquier página por encima de ~1000 filas. */
export const DEFAULT_PAGE_SIZE = 1000;

/** Versión del contrato `SnapshotResult` — frontera de filesystem (compose CLI la valida, §31-32). */
export const NEWS_LAKE_SNAPSHOT_SCHEMA_VERSION = 1;

export type SnapshotRole = 'BEFORE' | 'AFTER';

/**
 * Implementación REAL contra Supabase. SOLO LECTURA. El cutoff temporal
 * SIEMPRE se deriva de `windowAnchor` vía `computeWindowStart` — NUNCA de
 * `Date.now()` (fix de B1C). Reintenta errores TRANSITORIOS con
 * `retryPostgrest`; errores no transitorios se devuelven de inmediato para
 * que el llamador los clasifique como `'ERROR'`, nunca como cero filas.
 */
export function createSupabaseFetchNoticiasPage(): FetchNoticiasPage {
  return async ({ medioId, windowDays, windowAnchor, offset, pageSize }) => {
    const result = await retryPostgrest(`newsLakeSnapshot:${medioId}`, () => {
      let q = getSupabase()
        .from('noticias')
        .select('noticia_id, medio_id, texto_nota_limpia, texto_cuerpo_nota')
        .eq('medio_id', medioId)
        .order('noticia_id', { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (windowDays !== null && windowDays > 0) {
        if (windowAnchor === null) {
          // Defensivo: `buildNewsLakeSnapshot` ya valida esto antes de llegar
          // aquí (§7 del prompt: "no inventes uno en compose/aquí").
          throw new Error('createSupabaseFetchNoticiasPage: windowDays activo sin windowAnchor');
        }
        const desde = computeWindowStart(windowAnchor, windowDays);
        q = q.gte('fecha_publicacion', desde);
      }
      return q;
    });
    return {
      data: (result.data ?? null) as NoticiaSnapshotRow[] | null,
      error: result.error as SupabaseErrorLike | null,
    };
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Contrato de snapshot
// ─────────────────────────────────────────────────────────────────────────────

export type SnapshotStatus = 'COMPLETE' | 'PARTIAL' | 'ERROR' | 'UNKNOWN';

/**
 * Señal de estabilidad de la lectura paginada, SEPARADA del éxito de la
 * query (§33 del prompt de hardening). `status='COMPLETE'` significa "todas
 * las páginas respondieron sin error" — NO significa "el dataset no se movió
 * mientras paginábamos". `consistency` es esa segunda dimensión:
 * - `'STABLE_OBSERVED'`: COMPLETE y sin filas duplicadas entre páginas.
 * - `'POSSIBLE_DRIFT'`: COMPLETE pero se observaron duplicados entre páginas
 *   (`duplicate_rows_skipped > 0`) — señal de escritura concurrente durante
 *   la paginación. La capa de persistencia NUNCA declara `VERIFIED` con esto.
 * - `'UNKNOWN'`: no aplica (status !== 'COMPLETE' — ya hay una dimensión de
 *   incertidumbre mayor, la de `status`).
 */
export type SnapshotConsistency = 'STABLE_OBSERVED' | 'POSSIBLE_DRIFT' | 'UNKNOWN';

export interface MediaSnapshot {
  medio_id: string;
  status: SnapshotStatus;
  /** `null` cuando `status !== 'COMPLETE'` — nunca se presenta un conteo parcial como total. */
  total_news: number | null;
  clean_text_count: number | null;
  body_count: number | null;
  pages_read: number;
  duplicate_rows_skipped: number;
  errors: string[];
  consistency: SnapshotConsistency;
}

export interface SnapshotResult {
  schema_version: typeof NEWS_LAKE_SNAPSHOT_SCHEMA_VERSION;
  /** Identidad explícita del intento de validación (BEFORE/RUN/AFTER) — compartida, nunca autogenerada por separado en cada snapshot. */
  context_id: string;
  /** Rol explícito, nunca inferido por nombre de archivo. */
  snapshot_role: SnapshotRole;
  /** Mismo `window_anchor` debe usarse en before y after — identidad temporal explícita (B1C). */
  window_anchor: string | null;
  window_days: number | null;
  /** ISO — antes de iniciar la primera consulta. */
  capture_started_at: string;
  /** ISO — tras completar (con éxito o no) la última consulta. Garantía: `capture_started_at <= capture_completed_at`. */
  capture_completed_at: string;
  /** Universo EXACTO solicitado para este snapshot (siempre concreto — un snapshot no puede operar sobre un universo desconocido, ver §11). */
  requested_media_ids: string[];
  media: MediaSnapshot[];
}

export interface BuildSnapshotOptions {
  contextId: string;
  snapshotRole: SnapshotRole;
  /** Universo EXACTO a consultar — nunca se deriva de cron/catálogo activo, nunca se deriva de un universo `null`/desconocido (§11). */
  mediaIds: string[];
  windowDays: number | null;
  /** Requerido (no `undefined`) cuando `windowDays !== null` — se valida explícitamente, nunca se sustituye por `Date.now()`. */
  windowAnchor: string | null;
  fetchPage: FetchNoticiasPage;
  pageSize?: number;
}

function normalizeMediaIds(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter((id) => id.length > 0))];
}

async function fetchOneMediaSnapshot(
  medioId: string,
  windowDays: number | null,
  windowAnchor: string | null,
  pageSize: number,
  fetchPage: FetchNoticiasPage,
): Promise<MediaSnapshot> {
  const seenIds = new Set<string>();
  let totalNews = 0;
  let cleanText = 0;
  let body = 0;
  let duplicateRowsSkipped = 0;
  let pagesRead = 0;
  const errors: string[] = [];
  let offset = 0;

  for (;;) {
    let result: FetchNoticiasPageResult;
    try {
      result = await fetchPage({ medioId, windowDays, windowAnchor, offset, pageSize });
    } catch (err) {
      result = { data: null, error: { message: err instanceof Error ? err.message : String(err) } };
    }

    if (result.error) {
      errors.push(describeSupabaseError(result.error));
      break; // NUNCA se sigue paginando tras un error.
    }

    const rows = result.data ?? [];
    pagesRead += 1;

    for (const row of rows) {
      if (seenIds.has(row.noticia_id)) {
        duplicateRowsSkipped += 1;
        continue; // duplicación entre páginas no se inventa como noticias nuevas.
      }
      seenIds.add(row.noticia_id);
      totalNews += 1;
      if (!vacio(row.texto_nota_limpia)) cleanText += 1;
      if (!vacio(row.texto_cuerpo_nota)) body += 1;
    }

    if (rows.length < pageSize) break; // condición REAL de fin.
    offset += pageSize;
  }

  const succeeded = errors.length === 0;
  const status: SnapshotStatus = succeeded ? 'COMPLETE' : pagesRead > 0 ? 'PARTIAL' : 'ERROR';
  const consistency: SnapshotConsistency =
    status !== 'COMPLETE' ? 'UNKNOWN' : duplicateRowsSkipped > 0 ? 'POSSIBLE_DRIFT' : 'STABLE_OBSERVED';

  return {
    medio_id: medioId,
    status,
    total_news: succeeded ? totalNews : null,
    clean_text_count: succeeded ? cleanText : null,
    body_count: succeeded ? body : null,
    pages_read: pagesRead,
    duplicate_rows_skipped: duplicateRowsSkipped,
    errors,
    consistency,
  };
}

/**
 * Construye un snapshot BEFORE o AFTER para EXACTAMENTE `opts.mediaIds`.
 * Secuencial por medio_id (no en paralelo) por simplicidad/auditabilidad —
 * complejidad O(N + R) donde N = medios y R = filas totales observadas.
 *
 * Valida ANTES de tocar Supabase (fail-fast, nunca silencioso):
 * - `contextId` no vacío (B4C);
 * - `windowAnchor`, si no es `null`, debe ser un ISO timestamp válido
 *   (rechaza `""`/`"foo"`/`Invalid Date` — B1C/§7);
 * - si `windowDays !== null`, `windowAnchor` es OBLIGATORIO — nunca se
 *   sustituye por `Date.now()` (B1C/§7: "no inventes uno").
 */
export async function buildNewsLakeSnapshot(opts: BuildSnapshotOptions): Promise<SnapshotResult> {
  if (!opts.contextId || opts.contextId.trim().length === 0) {
    throw new Error('buildNewsLakeSnapshot: contextId no puede estar vacío (B4C — identidad de contexto obligatoria).');
  }
  if (opts.windowAnchor !== null && !isValidIsoTimestamp(opts.windowAnchor)) {
    throw new Error(`buildNewsLakeSnapshot: windowAnchor inválido: ${JSON.stringify(opts.windowAnchor)}`);
  }
  if (opts.windowDays !== null && opts.windowAnchor === null) {
    throw new Error(
      'buildNewsLakeSnapshot: windowDays está activo pero falta windowAnchor — la comparación before/after ' +
        'exige una identidad temporal explícita (B1C). No se sustituye por Date.now().',
    );
  }

  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const mediaIds = normalizeMediaIds(opts.mediaIds);
  const captureStartedAt = new Date().toISOString();

  const media: MediaSnapshot[] = [];
  for (const medioId of mediaIds) {
    media.push(await fetchOneMediaSnapshot(medioId, opts.windowDays, opts.windowAnchor, pageSize, opts.fetchPage));
  }

  const captureCompletedAt = new Date().toISOString();

  return {
    schema_version: NEWS_LAKE_SNAPSHOT_SCHEMA_VERSION,
    context_id: opts.contextId,
    snapshot_role: opts.snapshotRole,
    window_anchor: opts.windowAnchor,
    window_days: opts.windowDays,
    capture_started_at: captureStartedAt,
    capture_completed_at: captureCompletedAt,
    requested_media_ids: mediaIds,
    media,
  };
}
