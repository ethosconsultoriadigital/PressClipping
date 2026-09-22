/**
 * Política de integración del drain en un runner de cron.
 *
 * Aísla las DECISIONES (¿preflight pasa? ¿legacy o drain? ¿se puede seguir a
 * detect/compare?) de la mecánica del script (spawn, Sheets, logs), para que
 * se puedan testear sin procesos hijos ni red.
 *
 * Regla que este módulo hace cumplir: un exit 0 NO equivale a drain sano. Un
 * NO_PROGRESS o un INFRA_ERROR paran el pipeline; un TIME_BUDGET deja seguir
 * pero marcado como deuda, nunca como "drenado".
 */
import {
  verificarIntegridadCronCatalogo,
  describirIntegridadCronCatalogo,
  type CatalogLoader,
  type CronCatalogIntegrityReport,
  type CronConfiguredMedio,
  type CronTierId,
} from '../config/cronCatalogIntegrity.js';
import type { DrainResult } from './enrichDrain.js';

/** Códigos de salida del runner. 2 ya se usaba para abortos de configuración. */
export const EXIT_CONFIG_ORPHAN = 2;
export const EXIT_DRAIN_NO_PROGRESS = 3;
export const EXIT_INFRA_ERROR = 4;

export interface PreflightResult {
  ok: boolean;
  exitCode: number | null;
  report: CronCatalogIntegrityReport;
  mensaje: string;
}

/**
 * Preflight cron→catálogo. Falla RÁPIDO ante huérfanos: el
 * "48 configurados / 47 encontrados / seguimos" es exactamente lo que dejó a
 * MED-0204 invisible durante semanas.
 */
export async function preflightCronCatalogo(opts: {
  cargarCatalogo: CatalogLoader;
  tiers?: readonly CronTierId[];
  configured?: readonly CronConfiguredMedio[];
}): Promise<PreflightResult> {
  const report = await verificarIntegridadCronCatalogo({
    cargarCatalogo: opts.cargarCatalogo,
    tiers: opts.tiers,
    configured: opts.configured,
  });
  const mensaje = describirIntegridadCronCatalogo(report);
  if (report.status === 'ORPHANS_FOUND') {
    return { ok: false, exitCode: EXIT_CONFIG_ORPHAN, report, mensaje };
  }
  if (report.status === 'INFRA_ERROR') {
    return { ok: false, exitCode: EXIT_INFRA_ERROR, report, mensaje };
  }
  return { ok: true, exitCode: null, report, mensaje };
}

export type EnrichModo = 'legacy' | 'drain';

export interface EnrichStepDeps {
  /** Estado del feature flag ENRICH_DRAIN_V1. */
  drainEnabled: boolean;
  /** Ruta legacy: spawn de `scripts/enrich-news.ts`. */
  runLegacyEnrich: () => Promise<{ code: number }>;
  /** Ruta nueva: UNA sola sesión de drain en ESTE proceso. */
  runDrain: () => Promise<DrainResult>;
}

export interface EnrichStepResult {
  modo: EnrichModo;
  /** Invocaciones del paso de enrich. Debe ser siempre 1. */
  invocaciones: number;
  /** ¿Se puede continuar a detect/compare? */
  continuar: boolean;
  /** Terminó, pero con deuda: reportar DEGRADED, no drenado. */
  degradado: boolean;
  exitCode: number | null;
  drain: DrainResult | null;
  legacyCode: number | null;
  motivo: string;
}

/**
 * Ejecuta el paso de enrich UNA sola vez por corrida, por la ruta que indique
 * el feature flag.
 */
export async function ejecutarPasoEnrich(deps: EnrichStepDeps): Promise<EnrichStepResult> {
  if (!deps.drainEnabled) {
    const { code } = await deps.runLegacyEnrich();
    return {
      modo: 'legacy',
      invocaciones: 1,
      continuar: true,
      degradado: false,
      exitCode: null,
      drain: null,
      legacyCode: code,
      motivo: 'ENRICH_DRAIN_V1 OFF: ruta legacy',
    };
  }

  const drain = await deps.runDrain();
  const base = { modo: 'drain' as const, invocaciones: 1, drain, legacyCode: null };

  switch (drain.termination_reason) {
    case 'DRAINED':
      return {
        ...base,
        continuar: true,
        degradado: drain.failed_retryable + drain.failed_blocked + drain.empty_clean + drain.write_failed > 0,
        exitCode: null,
        motivo: 'drain completo',
      };
    case 'TIME_BUDGET':
      return {
        ...base,
        continuar: true,
        degradado: true,
        exitCode: null,
        motivo: `drain cortado por presupuesto de tiempo (${drain.deferred_time_budget} candidatos diferidos)`,
      };
    case 'SAFETY_LIMIT':
      return {
        ...base,
        continuar: true,
        degradado: true,
        exitCode: null,
        motivo: `drain cortado por tope de seguridad (${drain.passes} páginas)`,
      };
    case 'NO_PROGRESS':
      return {
        ...base,
        continuar: false,
        degradado: true,
        exitCode: EXIT_DRAIN_NO_PROGRESS,
        motivo: 'drain sin progreso: el cursor no avanza (posible bug de paginación)',
      };
    case 'INFRA_ERROR':
    default:
      return {
        ...base,
        continuar: false,
        degradado: true,
        exitCode: EXIT_INFRA_ERROR,
        motivo: `drain con error de infraestructura: ${drain.infra_error ?? 'desconocido'}`,
      };
  }
}

/** Etiqueta de decisión del ciclo, para 08_Cobertura_Medios y logs. */
export function etiquetaDecisionEnrich(result: EnrichStepResult): string {
  if (result.modo === 'legacy') return 'LEGACY_ENRICH';
  if (!result.continuar) return 'DRAIN_FATAL';
  return result.degradado ? 'DRAIN_DEGRADED_DEBT' : 'DRAIN_FULL';
}
