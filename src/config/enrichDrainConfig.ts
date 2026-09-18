/**
 * Configuración y feature flag de ENRICH DRAIN V1.
 *
 * El drain se construye ahora pero NO se activa: `ENRICH_DRAIN_V1` está OFF por
 * defecto y ningún workflow programado lo enciende. Mientras esté apagado, el
 * runner sigue usando el enrich legacy tal cual.
 *
 * Todas las constantes de tiempo son overrideables por entorno: ajustar el
 * presupuesto del canary o de un job no debe requerir tocar código.
 */
import {
  DRAIN_DEFAULTS,
  type DrainOptions,
} from '../enrichers/enrichDrain.js';

export type EnvMap = Record<string, string | undefined>;

/** Nombre del feature flag. Un solo lugar donde se escribe. */
export const ENRICH_DRAIN_FLAG = 'ENRICH_DRAIN_V1';

/** Presupuesto temporal del job, en minutos. */
export interface DrainTimeBudgetConfig {
  /** Timeout del job de Actions (`timeout-minutes`). */
  jobTimeoutMinutes: number;
  /** Reserva para lo que corre DESPUÉS del enrich (detect, compare, 07/08). */
  reserveAfterEnrichMinutes: number;
  /** Margen de seguridad extra antes del timeout duro. */
  safetyMarginMinutes: number;
}

export const DEFAULT_TIME_BUDGET: DrainTimeBudgetConfig = {
  jobTimeoutMinutes: 25,
  reserveAfterEnrichMinutes: 2,
  safetyMarginMinutes: 3,
};

function num(env: EnvMap, clave: string, fallback: number): number {
  const raw = env[clave];
  if (raw == null || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function frac(env: EnvMap, clave: string, fallback: number): number {
  const raw = env[clave];
  if (raw == null || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback;
}

/**
 * ¿Está activado el drain? Solo valores afirmativos explícitos cuentan; todo
 * lo demás (ausente, vacío, '0', 'false', basura) deja el flag en OFF.
 */
export function drainHabilitado(env: EnvMap = process.env): boolean {
  const raw = env[ENRICH_DRAIN_FLAG];
  if (raw == null) return false;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

/** De dónde salió el reloj de inicio del job. */
export type JobStartSource = 'explicit' | 'env' | 'fallback_now';

export interface JobStart {
  at: Date;
  source: JobStartSource;
}

/**
 * Reloj de inicio del JOB (no del script). El workflow lo registra antes del
 * setup pesado; si no llega, se degrada a `now` y se reporta la fuente, porque
 * un deadline calculado desde el script sobrestima el tiempo disponible.
 */
export function resolverJobStart(
  opts: { explicito?: string | null; env?: EnvMap; now: Date },
): JobStart {
  const env = opts.env ?? process.env;
  for (const [valor, source] of [
    [opts.explicito, 'explicit'],
    [env['JOB_STARTED_AT'], 'env'],
  ] as const) {
    if (valor == null || valor.trim() === '') continue;
    const ms = Date.parse(valor);
    if (!Number.isNaN(ms)) return { at: new Date(ms), source };
  }
  return { at: opts.now, source: 'fallback_now' };
}

export function resolverTimeBudget(env: EnvMap = process.env): DrainTimeBudgetConfig {
  return {
    jobTimeoutMinutes: num(env, 'JOB_TIMEOUT_MINUTES', DEFAULT_TIME_BUDGET.jobTimeoutMinutes),
    reserveAfterEnrichMinutes: num(
      env,
      'ENRICH_DRAIN_RESERVE_MINUTES',
      DEFAULT_TIME_BUDGET.reserveAfterEnrichMinutes,
    ),
    safetyMarginMinutes: num(
      env,
      'ENRICH_DRAIN_SAFETY_MINUTES',
      DEFAULT_TIME_BUDGET.safetyMarginMinutes,
    ),
  };
}

/**
 * Deadline absoluto del drain:
 *
 *     jobStart + jobTimeout − reserva downstream − margen de seguridad
 *
 * Con los valores iniciales (25 / 2 / 3) el drain para alrededor del minuto 20
 * del job, dejando detect + compare + 07/08 dentro del timeout.
 *
 * Nunca devuelve un deadline anterior a `now`: si el job ya consumió el
 * presupuesto, el drain terminará de inmediato con TIME_BUDGET en vez de
 * quedarse con una ventana negativa.
 */
export function calcularDeadlineDrain(opts: {
  jobStart: Date;
  now: Date;
  budget?: DrainTimeBudgetConfig;
}): Date {
  const b = opts.budget ?? DEFAULT_TIME_BUDGET;
  const disponibleMin = b.jobTimeoutMinutes - b.reserveAfterEnrichMinutes - b.safetyMarginMinutes;
  const deadline = new Date(opts.jobStart.getTime() + disponibleMin * 60_000);
  return deadline.getTime() < opts.now.getTime() ? opts.now : deadline;
}

/** Opciones del drain resueltas desde entorno (todas overrideables). */
export function resolverOpcionesDrain(
  opts: { deadline: Date; cutoff?: Date; medioIds?: readonly string[] | null; env?: EnvMap },
): DrainOptions {
  const env = opts.env ?? process.env;
  return {
    deadline: opts.deadline,
    cutoff: opts.cutoff,
    medioIds: opts.medioIds ?? null,
    pageSize: num(env, 'ENRICH_DRAIN_PAGE_SIZE', DRAIN_DEFAULTS.pageSize),
    freshShare: frac(env, 'ENRICH_DRAIN_FRESH_SHARE', DRAIN_DEFAULTS.freshShare),
    freshnessWindowMinutes: num(
      env,
      'ENRICH_DRAIN_FRESHNESS_MINUTES',
      DRAIN_DEFAULTS.freshnessWindowMinutes,
    ),
    maxPasses: num(env, 'ENRICH_DRAIN_MAX_PASSES', DRAIN_DEFAULTS.maxPasses),
    maxAttempts: Number(env['ENRICH_DRAIN_MAX_ATTEMPTS'] ?? 0) || 0,
    articleBudgetMs: num(env, 'ENRICH_DRAIN_ARTICLE_BUDGET_MS', DRAIN_DEFAULTS.articleBudgetMs),
    operationSafetyMs: num(env, 'ENRICH_DRAIN_OPERATION_SAFETY_MS', DRAIN_DEFAULTS.operationSafetyMs),
  };
}
