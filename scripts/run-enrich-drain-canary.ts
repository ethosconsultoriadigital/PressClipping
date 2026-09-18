/**
 * CANARY MANUAL de ENRICH DRAIN V1 — solo `workflow_dispatch`.
 *
 * Corre EXCLUSIVAMENTE la ruta de enrich drain sobre medios explícitos. No
 * hace crawl, ni detect, ni comparativo, ni Sheets, ni envíos: su único
 * propósito es observar el comportamiento del drain en el entorno cloud antes
 * de considerar encenderlo en un cron.
 *
 * Precondiciones duras (falla legible, nunca auto-repara):
 *   1. `--media-ids` explícito y no vacío. NO existe "todos los medios".
 *   2. La migración 0014 debe estar aplicada. NO se aplica desde aquí.
 *   3. Los medios pedidos deben existir en el catálogo.
 *   4. `ENRICH_DRAIN_V1` debe estar encendido para esta corrida.
 *
 * Uso:
 *   ENRICH_DRAIN_V1=1 npm run enrich-drain-canary -- --media-ids=MED-0039,MED-0069
 */
import { pathToFileURL } from 'node:url';
import { logger } from '../src/utils/logger.js';
import {
  ENRICH_DRAIN_FLAG,
  drainHabilitado,
  resolverJobStart,
  resolverTimeBudget,
  calcularDeadlineDrain,
  resolverOpcionesDrain,
} from '../src/config/enrichDrainConfig.js';
import { runEnrichDrain, type DrainResult } from '../src/enrichers/enrichDrain.js';
import { crearProcesadorDeArticulos } from '../src/enrichers/drainArticle.js';
import { articleEnrichBloqueado } from '../src/config/cloudEnrichExclusions.js';
import { evaluarIntegridadCronCatalogo } from '../src/config/cronCatalogIntegrity.js';
import {
  getCatalogoMediosPorIds,
  getNoticiasDrainPage,
  updateNoticiaDrain,
  verificarMigracionDrain,
} from '../src/supabase/repositories.js';

export interface CanaryArgs {
  mediaIds: string[];
  pageSize: number | null;
  timeBudgetMinutes: number | null;
  freshShare: number | null;
  jobStartedAt: string | null;
}

export const EXIT_BAD_INPUT = 2;
export const EXIT_PRECONDITION = 3;
export const EXIT_DRAIN_FATAL = 4;

export function parseCanaryArgs(argv: string[]): CanaryArgs {
  const out: CanaryArgs = {
    mediaIds: [],
    pageSize: null,
    timeBudgetMinutes: null,
    freshShare: null,
    jobStartedAt: null,
  };
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    const key = eq === -1 ? body : body.slice(0, eq);
    const val = eq === -1 ? '' : body.slice(eq + 1);
    switch (key) {
      case 'media-ids':
        out.mediaIds = val.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
        break;
      case 'page-size': out.pageSize = Number(val) || null; break;
      case 'time-budget-minutes': out.timeBudgetMinutes = Number(val) || null; break;
      case 'fresh-share': out.freshShare = Number.isFinite(Number(val)) ? Number(val) : null; break;
      case 'job-started-at': out.jobStartedAt = val || null; break;
    }
  }
  return out;
}

export interface CanaryPrecondiciones {
  ok: boolean;
  exitCode: number | null;
  motivo: string;
}

export interface PrecondicionDeps {
  drainEnabled: boolean;
  verificarMigracion: () => Promise<{ estado: 'APLICADA' | 'NO_APLICADA' | 'INDETERMINADA'; detalle: string }>;
  cargarCatalogo: (ids: readonly string[]) => Promise<Array<{ medio_id: string; activo: boolean | null }>>;
}

/** Comprueba, en orden, las cuatro precondiciones del canary. */
export async function verificarPrecondicionesCanary(
  mediaIds: readonly string[],
  deps: PrecondicionDeps,
): Promise<CanaryPrecondiciones> {
  if (mediaIds.length === 0) {
    return {
      ok: false,
      exitCode: EXIT_BAD_INPUT,
      motivo: '--media-ids es obligatorio: el canary NUNCA corre sobre todos los medios.',
    };
  }

  if (!deps.drainEnabled) {
    return {
      ok: false,
      exitCode: EXIT_PRECONDITION,
      motivo: `${ENRICH_DRAIN_FLAG} está apagado: el canary debe encenderlo explícitamente.`,
    };
  }

  const migracion = await deps.verificarMigracion();
  if (migracion.estado !== 'APLICADA') {
    return {
      ok: false,
      exitCode: EXIT_PRECONDITION,
      motivo: `Migración de drain ${migracion.estado}: ${migracion.detalle}`,
    };
  }

  let catalogo: Array<{ medio_id: string; activo: boolean | null }>;
  try {
    catalogo = await deps.cargarCatalogo(mediaIds);
  } catch (err) {
    return {
      ok: false,
      exitCode: EXIT_PRECONDITION,
      motivo: `No se pudo leer el catálogo (INFRA_ERROR): ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const integridad = evaluarIntegridadCronCatalogo(
    mediaIds.map((id) => ({ medio_id: id, tier: 'daily_validated' as const, nombre: null })),
    { ok: true, medios: catalogo },
  );
  if (integridad.status !== 'OK') {
    return {
      ok: false,
      exitCode: EXIT_PRECONDITION,
      motivo: `Medios inexistentes en catálogo: ${integridad.orphan_ids.join(', ')}`,
    };
  }

  return { ok: true, exitCode: null, motivo: 'precondiciones OK' };
}

/** Resumen del canary. Solo métricas: ningún secreto, ninguna URL de proyecto. */
export function resumenCanary(result: DrainResult, mediaIds: readonly string[]) {
  return {
    media_ids: [...mediaIds],
    termination_reason: result.termination_reason,
    cutoff: result.cutoff,
    deadline: result.deadline,
    attempted: result.attempted,
    persisted_success: result.persisted_success,
    failed_retryable: result.failed_retryable,
    failed_blocked: result.failed_blocked,
    empty_clean: result.empty_clean,
    write_failed: result.write_failed,
    failure_classes: result.failure_classes,
    duplicate_attempts: result.duplicate_attempts,
    duplicate_candidates_filtered: result.duplicate_candidates_filtered,
    fresh_attempted: result.fresh_attempted,
    backlog_attempted: result.backlog_attempted,
    media_served: result.media_served,
    media_attempts: result.media_attempts,
    passes: result.passes,
    duration_ms: result.duration_ms,
    deferred_time_budget: result.deferred_time_budget,
    remaining_eligible_estimate: result.remaining_eligible_estimate,
    infra_error: result.infra_error,
  };
}

async function main(): Promise<void> {
  const args = parseCanaryArgs(process.argv.slice(2));

  const pre = await verificarPrecondicionesCanary(args.mediaIds, {
    drainEnabled: drainHabilitado(),
    verificarMigracion: verificarMigracionDrain,
    cargarCatalogo: getCatalogoMediosPorIds,
  });
  if (!pre.ok) {
    logger.error({ media_ids: args.mediaIds }, `CANARY ABORTADO: ${pre.motivo}`);
    process.exit(pre.exitCode ?? EXIT_PRECONDITION);
  }

  const ahora = new Date();
  const jobStart = resolverJobStart({ explicito: args.jobStartedAt, now: ahora });
  const budget = resolverTimeBudget();
  if (args.timeBudgetMinutes != null) {
    budget.jobTimeoutMinutes = args.timeBudgetMinutes;
  }
  const deadline = calcularDeadlineDrain({ jobStart: jobStart.at, now: ahora, budget });
  const opciones = resolverOpcionesDrain({ deadline, medioIds: args.mediaIds });
  if (args.pageSize != null) opciones.pageSize = args.pageSize;
  if (args.freshShare != null) opciones.freshShare = args.freshShare;

  logger.info(
    {
      media_ids: args.mediaIds,
      job_start: jobStart.at.toISOString(),
      job_start_source: jobStart.source,
      deadline: deadline.toISOString(),
      page_size: opciones.pageSize,
      fresh_share: opciones.freshShare,
    },
    '=== ENRICH DRAIN CANARY (manual, solo drain) ===',
  );

  const result = await runEnrichDrain(
    {
      fetchPage: getNoticiasDrainPage,
      processArticle: crearProcesadorDeArticulos(),
      persist: updateNoticiaDrain,
      now: () => new Date(),
      isEnvironmentBlocked: (medioId) => articleEnrichBloqueado(medioId),
    },
    opciones,
  );

  logger.info(resumenCanary(result, args.mediaIds), '=== ENRICH DRAIN CANARY completado ===');

  if (result.termination_reason === 'NO_PROGRESS' || result.termination_reason === 'INFRA_ERROR') {
    process.exit(EXIT_DRAIN_FATAL);
  }
}

export { main };

function esEntrypointCli(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (esEntrypointCli()) {
  main().catch((err) => {
    logger.error(
      { error: err instanceof Error ? err.message : String(err) },
      'Error fatal en run-enrich-drain-canary',
    );
    process.exit(1);
  });
}
