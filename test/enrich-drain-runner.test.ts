/**
 * S4 — integración del drain en el runner del tier diario.
 * El default de aplicación sigue OFF; el workflow daily-validated enciende
 * el flag en `schedule` y, en `workflow_dispatch`, solo si
 * `use_enrich_drain_v1` es true (default false = legacy).
 *
 * Verifica el feature flag, el reloj de inicio de job, el deadline, el
 * preflight cron→catálogo y el manejo de terminaciones.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  ENRICH_DRAIN_FLAG,
  DEFAULT_TIME_BUDGET,
  drainHabilitado,
  resolverJobStart,
  resolverTimeBudget,
  calcularDeadlineDrain,
  resolverOpcionesDrain,
} from '../src/config/enrichDrainConfig.js';
import {
  preflightCronCatalogo,
  ejecutarPasoEnrich,
  etiquetaDecisionEnrich,
  EXIT_CONFIG_ORPHAN,
  EXIT_DRAIN_NO_PROGRESS,
  EXIT_INFRA_ERROR,
} from '../src/enrichers/drainRunner.js';
import type { DrainResult, DrainTerminationReason } from '../src/enrichers/enrichDrain.js';

const T0 = new Date('2026-09-19T12:45:00.000Z');

function drainResult(over: Partial<DrainResult> & { termination_reason: DrainTerminationReason }): DrainResult {
  return {
    cutoff: T0.toISOString(),
    fresh_since: T0.toISOString(),
    deadline: T0.toISOString(),
    eligible_seen: 0,
    attempted: 0,
    persisted_success: 0,
    failed_retryable: 0,
    failed_blocked: 0,
    empty_clean: 0,
    write_failed: 0,
    fresh_attempted: 0,
    backlog_attempted: 0,
    media_served: 0,
    media_attempts: {},
    deferred_time_budget: 0,
    passes: 0,
    duration_ms: 0,
    duplicate_attempts: 0,
    duplicate_candidates_filtered: 0,
    failure_classes: {
      TIMEOUT: 0, NETWORK_TRANSIENT: 0, HTTP_429: 0, HTTP_5XX: 0, HTTP_403: 0,
      HTTP_404_410: 0, EMPTY_CLEAN_TEXT: 0, WRITE_FAILED: 0, UNKNOWN: 0,
    },
    remaining_eligible_estimate: null,
    infra_error: null,
    ...over,
  };
}

describe('feature flag ENRICH_DRAIN_V1', () => {
  it('el default es OFF', () => {
    expect(drainHabilitado({})).toBe(false);
    expect(drainHabilitado({ [ENRICH_DRAIN_FLAG]: '' })).toBe(false);
  });

  it('solo valores afirmativos explícitos lo encienden', () => {
    for (const v of ['1', 'true', 'TRUE', 'yes', 'on']) {
      expect(drainHabilitado({ [ENRICH_DRAIN_FLAG]: v })).toBe(true);
    }
    for (const v of ['0', 'false', 'off', 'no', 'quizá']) {
      expect(drainHabilitado({ [ENRICH_DRAIN_FLAG]: v })).toBe(false);
    }
  });
});

describe('reloj de inicio de job y deadline', () => {
  it('usa el valor explícito del workflow', () => {
    const r = resolverJobStart({ explicito: '2026-09-19T12:40:00Z', now: T0 });
    expect(r.source).toBe('explicit');
    expect(r.at.toISOString()).toBe('2026-09-19T12:40:00.000Z');
  });

  it('cae al entorno JOB_STARTED_AT si no hay argumento', () => {
    const r = resolverJobStart({ env: { JOB_STARTED_AT: '2026-09-19T12:30:00Z' }, now: T0 });
    expect(r.source).toBe('env');
    expect(r.at.toISOString()).toBe('2026-09-19T12:30:00.000Z');
  });

  it('si no hay dato fiable degrada a `now` y lo reporta', () => {
    expect(resolverJobStart({ explicito: 'basura', env: {}, now: T0 }).source).toBe('fallback_now');
    expect(resolverJobStart({ env: {}, now: T0 }).at).toBe(T0);
  });

  it('deadline = jobStart + 25 − 2 − 3 = minuto 20 del job', () => {
    const deadline = calcularDeadlineDrain({ jobStart: T0, now: T0 });
    expect(deadline.getTime() - T0.getTime()).toBe(20 * 60_000);
  });

  it('el deadline cuenta desde el inicio del JOB, no del script', () => {
    const arranqueScript = new Date(T0.getTime() + 4 * 60_000);
    const deadline = calcularDeadlineDrain({ jobStart: T0, now: arranqueScript });
    expect(deadline.getTime() - arranqueScript.getTime()).toBe(16 * 60_000);
  });

  it('nunca devuelve un deadline en el pasado', () => {
    const tarde = new Date(T0.getTime() + 40 * 60_000);
    expect(calcularDeadlineDrain({ jobStart: T0, now: tarde })).toEqual(tarde);
  });

  it('reserva y margen son overrideables por entorno, sin tocar código', () => {
    const budget = resolverTimeBudget({
      JOB_TIMEOUT_MINUTES: '30',
      ENRICH_DRAIN_RESERVE_MINUTES: '5',
      ENRICH_DRAIN_SAFETY_MINUTES: '4',
    });
    expect(budget).toEqual({
      jobTimeoutMinutes: 30,
      reserveAfterEnrichMinutes: 5,
      safetyMarginMinutes: 4,
    });
    expect(calcularDeadlineDrain({ jobStart: T0, now: T0, budget }).getTime() - T0.getTime()).toBe(21 * 60_000);
  });

  it('valores basura del entorno caen al default', () => {
    expect(resolverTimeBudget({ JOB_TIMEOUT_MINUTES: 'abc' })).toEqual(DEFAULT_TIME_BUDGET);
  });

  it('las opciones del drain salen del entorno con defaults seguros', () => {
    const deadline = new Date(T0.getTime() + 10 * 60_000);
    const base = resolverOpcionesDrain({ deadline, env: {} });
    expect(base.pageSize).toBe(100);
    expect(base.freshShare).toBe(0.7);

    const custom = resolverOpcionesDrain({
      deadline,
      medioIds: ['MED-0039'],
      env: { ENRICH_DRAIN_PAGE_SIZE: '25', ENRICH_DRAIN_FRESH_SHARE: '0.5', ENRICH_DRAIN_MAX_ATTEMPTS: '40' },
    });
    expect(custom.pageSize).toBe(25);
    expect(custom.freshShare).toBe(0.5);
    expect(custom.maxAttempts).toBe(40);
    expect(custom.medioIds).toEqual(['MED-0039']);
  });
});

describe('preflight cron→catálogo en el runner', () => {
  it('pasa cuando todos los IDs existen', async () => {
    const r = await preflightCronCatalogo({
      tiers: ['daily_validated'],
      cargarCatalogo: async (ids) => ids.map((id) => ({ medio_id: id, activo: true })),
    });
    expect(r.ok).toBe(true);
    expect(r.exitCode).toBeNull();
  });

  it('un huérfano bloquea el crawl con exit 2', async () => {
    const r = await preflightCronCatalogo({
      tiers: ['daily_validated'],
      cargarCatalogo: async (ids) => ids.slice(1).map((id) => ({ medio_id: id, activo: true })),
    });
    expect(r.ok).toBe(false);
    expect(r.exitCode).toBe(EXIT_CONFIG_ORPHAN);
    expect(r.mensaje).toContain('FALLA');
  });

  it('un fallo de DB es INFRA_ERROR, nunca catálogo vacío', async () => {
    const r = await preflightCronCatalogo({
      tiers: ['daily_validated'],
      cargarCatalogo: async () => {
        throw new Error('PGRST002 schema cache');
      },
    });
    expect(r.ok).toBe(false);
    expect(r.exitCode).toBe(EXIT_INFRA_ERROR);
    expect(r.report.status).toBe('INFRA_ERROR');
    expect(r.report.orphan_ids).toEqual([]);
  });

  it('un medio inactivo pero existente no bloquea', async () => {
    const r = await preflightCronCatalogo({
      tiers: ['daily_validated'],
      cargarCatalogo: async (ids) => ids.map((id, i) => ({ medio_id: id, activo: i !== 0 })),
    });
    expect(r.ok).toBe(true);
    expect(r.report.inactive_ids).toHaveLength(1);
  });
});

describe('ejecutarPasoEnrich — una sola invocación por corrida', () => {
  it('flag OFF invoca legacy exactamente una vez y nunca el drain', async () => {
    let legacy = 0;
    let drain = 0;
    const r = await ejecutarPasoEnrich({
      drainEnabled: false,
      runLegacyEnrich: async () => { legacy += 1; return { code: 0 }; },
      runDrain: async () => { drain += 1; return drainResult({ termination_reason: 'DRAINED' }); },
    });
    expect(legacy).toBe(1);
    expect(drain).toBe(0);
    expect(r.modo).toBe('legacy');
    expect(r.invocaciones).toBe(1);
    expect(r.continuar).toBe(true);
    expect(etiquetaDecisionEnrich(r)).toBe('LEGACY_ENRICH');
  });

  it('flag ON invoca el drain exactamente una vez y nunca el legacy', async () => {
    let legacy = 0;
    let drain = 0;
    const r = await ejecutarPasoEnrich({
      drainEnabled: true,
      runLegacyEnrich: async () => { legacy += 1; return { code: 0 }; },
      runDrain: async () => { drain += 1; return drainResult({ termination_reason: 'DRAINED', attempted: 10, persisted_success: 10 }); },
    });
    expect(drain).toBe(1);
    expect(legacy).toBe(0);
    expect(r.modo).toBe('drain');
    expect(r.invocaciones).toBe(1);
    expect(etiquetaDecisionEnrich(r)).toBe('DRAIN_FULL');
  });
});

describe('ejecutarPasoEnrich — manejo de terminaciones', () => {
  async function conTerminacion(over: Partial<DrainResult> & { termination_reason: DrainTerminationReason }) {
    return ejecutarPasoEnrich({
      drainEnabled: true,
      runLegacyEnrich: async () => ({ code: 0 }),
      runDrain: async () => drainResult(over),
    });
  }

  it('DRAINED limpio continúa y no marca deuda', async () => {
    const r = await conTerminacion({ termination_reason: 'DRAINED', attempted: 5, persisted_success: 5 });
    expect(r.continuar).toBe(true);
    expect(r.degradado).toBe(false);
  });

  it('DRAINED con fallos continúa pero marca deuda', async () => {
    const r = await conTerminacion({ termination_reason: 'DRAINED', attempted: 5, persisted_success: 3, failed_retryable: 2 });
    expect(r.continuar).toBe(true);
    expect(r.degradado).toBe(true);
    expect(etiquetaDecisionEnrich(r)).toBe('DRAIN_DEGRADED_DEBT');
  });

  it('TIME_BUDGET deja seguir a detect/compare pero NO se reporta como drenado', async () => {
    const r = await conTerminacion({ termination_reason: 'TIME_BUDGET', deferred_time_budget: 120 });
    expect(r.continuar).toBe(true);
    expect(r.degradado).toBe(true);
    expect(r.motivo).toContain('120');
    expect(etiquetaDecisionEnrich(r)).not.toBe('DRAIN_FULL');
  });

  it('SAFETY_LIMIT es condición degradada visible', async () => {
    const r = await conTerminacion({ termination_reason: 'SAFETY_LIMIT', passes: 200 });
    expect(r.continuar).toBe(true);
    expect(r.degradado).toBe(true);
    expect(etiquetaDecisionEnrich(r)).toBe('DRAIN_DEGRADED_DEBT');
  });

  it('NO_PROGRESS detiene el downstream', async () => {
    const r = await conTerminacion({ termination_reason: 'NO_PROGRESS' });
    expect(r.continuar).toBe(false);
    expect(r.exitCode).toBe(EXIT_DRAIN_NO_PROGRESS);
    expect(etiquetaDecisionEnrich(r)).toBe('DRAIN_FATAL');
  });

  it('INFRA_ERROR detiene el downstream y no se convierte en SHADOW_OK', async () => {
    const r = await conTerminacion({ termination_reason: 'INFRA_ERROR', infra_error: 'PGRST002' });
    expect(r.continuar).toBe(false);
    expect(r.exitCode).toBe(EXIT_INFRA_ERROR);
    expect(r.motivo).toContain('PGRST002');
    expect(etiquetaDecisionEnrich(r)).toBe('DRAIN_FATAL');
  });
});

describe('workflow daily-validated — reloj de job y flag scoped a schedule + checkbox', () => {
  const wf = readFileSync(
    join(process.cwd(), '.github/workflows/live-comparison-shadow-daily-validated.yml'),
    'utf-8',
  );
  const FLAG_EXPR =
    /^\s*ENRICH_DRAIN_V1:\s*"\$\{\{\s*\(github\.event_name\s*==\s*'schedule'\s*\|\|\s*inputs\.use_enrich_drain_v1\)\s*&&\s*'1'\s*\|\|\s*'0'\s*\}\}"\s*$/m;

  it('registra el inicio del job antes de checkout', () => {
    expect(wf).toContain('JOB_STARTED_AT=');
    expect(wf.indexOf('JOB_STARTED_AT=')).toBeLessThan(wf.indexOf('actions/checkout@v4'));
  });

  it('pasa el inicio del job al runner de forma explícita', () => {
    expect(wf).toContain('--job-started-at="$JOB_STARTED_AT"');
  });

  it('declara JOB_TIMEOUT_MINUTES coherente con timeout-minutes', () => {
    expect(wf).toContain('timeout-minutes: 25');
    expect(wf).toContain("JOB_TIMEOUT_MINUTES: '25'");
  });

  it('expone use_enrich_drain_v1 boolean default false en workflow_dispatch', () => {
    const bloque = wf.slice(wf.indexOf('workflow_dispatch:'), wf.indexOf('concurrency:'));
    expect(bloque).toContain('use_enrich_drain_v1:');
    expect(bloque).toMatch(/type:\s*boolean/);
    expect(bloque).toMatch(/default:\s*false/);
    expect(bloque).toMatch(/required:\s*false/);
    expect(bloque).toContain('window_hours:');
  });

  it('enciende ENRICH_DRAIN_V1 en schedule y en dispatch solo si el checkbox es true', () => {
    expect(wf).toMatch(FLAG_EXPR);
    expect(wf).toContain('workflow_dispatch:');
    expect(wf).toMatch(/^\s*schedule:/m);
    expect(wf).not.toContain("ENRICH_DRAIN_V1: '1'");
    expect(wf).not.toContain('ENRICH_DRAIN_V1=1');
  });

  it('no activa el drain en otros workflows/tiers', () => {
    const dir = join(process.cwd(), '.github/workflows');
    const permitidos = new Set([
      'live-comparison-shadow-daily-validated.yml',
      'live-comparison-shadow-daily-validated-b.yml',
      'live-comparison-shadow-daily-validated-c.yml',
      'enrich-drain-canary.yml',
    ]);
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.yml') || x.endsWith('.yaml'))) {
      if (permitidos.has(f)) continue;
      const body = readFileSync(join(dir, f), 'utf-8');
      expect(body, f).not.toMatch(/^\s*ENRICH_DRAIN_V1:/m);
    }
  });
});

describe('detect limit', () => {
  it('sigue en 300 (KNOWN_FUTURE_CAPACITY_RISK, fuera de alcance)', () => {
    const script = readFileSync(join(process.cwd(), 'scripts/run-shadow-daily-validated-tier.ts'), 'utf-8');
    expect(script).toContain('detectLimit: 300');
  });
});
