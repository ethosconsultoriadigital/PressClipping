/**
 * S6 — canary manual del drain: preparado, NO ejecutado.
 *
 * Tests estáticos del workflow + tests de las precondiciones y del parser de
 * argumentos. No dispara nada: no hay red, no hay DB, no hay dispatch.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseCanaryArgs,
  verificarPrecondicionesCanary,
  resumenCanary,
  EXIT_BAD_INPUT,
  EXIT_PRECONDITION,
} from '../scripts/run-enrich-drain-canary.js';
import type { DrainResult } from '../src/enrichers/enrichDrain.js';

const WF = readFileSync(join(process.cwd(), '.github/workflows/enrich-drain-canary.yml'), 'utf-8');

const depsOk = {
  drainEnabled: true,
  verificarMigracion: async () => ({ estado: 'APLICADA' as const, detalle: 'ok' }),
  cargarCatalogo: async (ids: readonly string[]) => ids.map((id) => ({ medio_id: id, activo: true })),
};

describe('workflow del canary', () => {
  it('existe y es SOLO workflow_dispatch', () => {
    expect(WF).toContain('workflow_dispatch');
    expect(WF).not.toMatch(/^\s*schedule:/m);
    expect(WF).not.toMatch(/cron:/);
  });

  it('exige media_ids y no tiene default de "todos los medios"', () => {
    expect(WF).toMatch(/media_ids:[\s\S]*?required:\s*true/);
    expect(WF).not.toMatch(/media_ids:[\s\S]*?default:\s*'\*'/);
  });

  it('ofrece los inputs de seguridad opcionales', () => {
    for (const input of ['page_size', 'time_budget_minutes', 'fresh_share']) {
      expect(WF).toContain(`${input}:`);
    }
  });

  it('enciende ENRICH_DRAIN_V1 de forma estática en este canary manual', () => {
    expect(WF).toContain("ENRICH_DRAIN_V1: '1'");
  });

  it('hace checkout, setup node e instala dependencias', () => {
    expect(WF).toContain('actions/checkout@v4');
    expect(WF).toContain('actions/setup-node@v4');
    expect(WF).toContain('npm ci');
  });

  it('corre SOLO la ruta de drain: sin crawl, detect, compare, Sheets ni envíos', () => {
    expect(WF).toContain('npm run enrich-drain-canary');
    // Solo los pasos ejecutables: la cabecera documental sí NOMBRA lo que el
    // canary no hace.
    const pasos = WF.slice(WF.indexOf('jobs:'))
      .split('\n')
      .filter((l) => !l.trim().startsWith('#'))
      .join('\n');
    for (const prohibido of [
      'npm run crawl',
      'detect-mentions',
      'run-live-comparison',
      'shadow-daily-validated-tier',
      'export-results',
      'generate-xml',
      'classify-ia',
      'twilio',
      'whatsapp',
    ]) {
      expect(pasos.toLowerCase()).not.toContain(prohibido.toLowerCase());
    }
    expect(WF).not.toContain('GOOGLE_SERVICE_ACCOUNT_EMAIL');
  });

  it('registra el inicio del job antes del checkout', () => {
    expect(WF.indexOf('JOB_STARTED_AT=')).toBeLessThan(WF.indexOf('actions/checkout@v4'));
  });

  it('no auto-aplica migraciones', () => {
    expect(WF).not.toMatch(/migrat/i);
  });

  it('el daily validated no hardcodea ON: schedule siempre, dispatch solo con checkbox', () => {
    const diario = readFileSync(
      join(process.cwd(), '.github/workflows/live-comparison-shadow-daily-validated.yml'),
      'utf-8',
    );
    expect(diario).toMatch(
      /^\s*ENRICH_DRAIN_V1:\s*"\$\{\{\s*\(github\.event_name\s*==\s*'schedule'\s*\|\|\s*inputs\.use_enrich_drain_v1\)\s*&&\s*'1'\s*\|\|\s*'0'\s*\}\}"\s*$/m,
    );
    expect(diario).not.toContain("ENRICH_DRAIN_V1: '1'");
    expect(diario).toMatch(/use_enrich_drain_v1:[\s\S]*?type:\s*boolean[\s\S]*?default:\s*false/);
  });

  it('el script está registrado en package.json', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['enrich-drain-canary']).toBe('tsx scripts/run-enrich-drain-canary.ts');
  });
});

describe('parseCanaryArgs', () => {
  it('lee media-ids separados por coma y limpia vacíos', () => {
    const a = parseCanaryArgs(['--media-ids=MED-0039, MED-0069 ,']);
    expect(a.mediaIds).toEqual(['MED-0039', 'MED-0069']);
  });

  it('sin media-ids deja la lista vacía (no asume nada)', () => {
    expect(parseCanaryArgs([]).mediaIds).toEqual([]);
    expect(parseCanaryArgs(['--media-ids=']).mediaIds).toEqual([]);
  });

  it('lee los overrides opcionales', () => {
    const a = parseCanaryArgs([
      '--media-ids=MED-0039',
      '--page-size=25',
      '--time-budget-minutes=10',
      '--fresh-share=0.5',
      '--job-started-at=2026-09-19T12:00:00Z',
    ]);
    expect(a.pageSize).toBe(25);
    expect(a.timeBudgetMinutes).toBe(10);
    expect(a.freshShare).toBe(0.5);
    expect(a.jobStartedAt).toBe('2026-09-19T12:00:00Z');
  });
});

describe('precondiciones del canary', () => {
  it('sin media_ids falla con exit 2', async () => {
    const r = await verificarPrecondicionesCanary([], depsOk);
    expect(r.ok).toBe(false);
    expect(r.exitCode).toBe(EXIT_BAD_INPUT);
    expect(r.motivo).toContain('media-ids');
  });

  it('con el flag apagado falla', async () => {
    const r = await verificarPrecondicionesCanary(['MED-0039'], { ...depsOk, drainEnabled: false });
    expect(r.ok).toBe(false);
    expect(r.exitCode).toBe(EXIT_PRECONDITION);
    expect(r.motivo).toContain('ENRICH_DRAIN_V1');
  });

  it('si la migración no está aplicada falla de forma legible y NO migra', async () => {
    let migro = false;
    const r = await verificarPrecondicionesCanary(['MED-0039'], {
      ...depsOk,
      verificarMigracion: async () => {
        migro = true;
        return { estado: 'NO_APLICADA' as const, detalle: 'Faltan las columnas enrich_*' };
      },
    });
    expect(r.ok).toBe(false);
    expect(r.exitCode).toBe(EXIT_PRECONDITION);
    expect(r.motivo).toContain('NO_APLICADA');
    expect(r.motivo).toContain('enrich_');
    expect(migro).toBe(true); // solo verificó; no existe ruta de auto-migración
  });

  it('una migración indeterminada (fallo de DB) también bloquea', async () => {
    const r = await verificarPrecondicionesCanary(['MED-0039'], {
      ...depsOk,
      verificarMigracion: async () => ({ estado: 'INDETERMINADA' as const, detalle: 'PGRST002' }),
    });
    expect(r.ok).toBe(false);
    expect(r.motivo).toContain('INDETERMINADA');
  });

  it('un medio inexistente en catálogo bloquea', async () => {
    const r = await verificarPrecondicionesCanary(['MED-0039', 'MED-9999'], {
      ...depsOk,
      cargarCatalogo: async (ids) => ids.filter((i) => i !== 'MED-9999').map((id) => ({ medio_id: id, activo: true })),
    });
    expect(r.ok).toBe(false);
    expect(r.motivo).toContain('MED-9999');
  });

  it('un fallo de catálogo es error de precondición, no catálogo vacío', async () => {
    const r = await verificarPrecondicionesCanary(['MED-0039'], {
      ...depsOk,
      cargarCatalogo: async () => {
        throw new Error('PGRST002 schema cache');
      },
    });
    expect(r.ok).toBe(false);
    expect(r.motivo).toContain('INFRA_ERROR');
  });

  it('con todo en orden pasa', async () => {
    const r = await verificarPrecondicionesCanary(['MED-0039', 'MED-0069'], depsOk);
    expect(r.ok).toBe(true);
    expect(r.exitCode).toBeNull();
  });

  it('el orden de verificación es media_ids → flag → migración → catálogo', async () => {
    const orden: string[] = [];
    await verificarPrecondicionesCanary(['MED-0039'], {
      drainEnabled: true,
      verificarMigracion: async () => {
        orden.push('migracion');
        return { estado: 'APLICADA' as const, detalle: 'ok' };
      },
      cargarCatalogo: async (ids) => {
        orden.push('catalogo');
        return ids.map((id) => ({ medio_id: id, activo: true }));
      },
    });
    expect(orden).toEqual(['migracion', 'catalogo']);
  });
});

describe('resumen del canary', () => {
  const result = {
    termination_reason: 'DRAINED',
    cutoff: '2026-09-19T12:45:00.000Z',
    fresh_since: '2026-09-18T12:45:00.000Z',
    deadline: '2026-09-19T13:00:00.000Z',
    eligible_seen: 20,
    attempted: 20,
    persisted_success: 18,
    failed_retryable: 1,
    failed_blocked: 1,
    empty_clean: 0,
    write_failed: 0,
    fresh_attempted: 14,
    backlog_attempted: 6,
    media_served: 2,
    media_attempts: { 'MED-0039': 10, 'MED-0069': 10 },
    deferred_time_budget: 0,
    passes: 3,
    duration_ms: 1234,
    duplicate_attempts: 0,
    duplicate_candidates_filtered: 0,
    failure_classes: {
      TIMEOUT: 1, NETWORK_TRANSIENT: 0, HTTP_429: 0, HTTP_5XX: 0, HTTP_403: 0,
      HTTP_404_410: 1, EMPTY_CLEAN_TEXT: 0, WRITE_FAILED: 0, UNKNOWN: 0,
    },
    remaining_eligible_estimate: 0,
    infra_error: null,
  } as DrainResult;

  it('incluye las métricas pedidas', () => {
    const r = resumenCanary(result, ['MED-0039', 'MED-0069']);
    for (const clave of [
      'termination_reason', 'attempted', 'persisted_success', 'failure_classes',
      'duplicate_attempts', 'fresh_attempted', 'backlog_attempted', 'media_served',
      'duration_ms', 'deferred_time_budget', 'remaining_eligible_estimate',
    ]) {
      expect(r).toHaveProperty(clave);
    }
    expect(r.media_ids).toEqual(['MED-0039', 'MED-0069']);
  });

  it('no expone secretos ni credenciales', () => {
    const serial = JSON.stringify(resumenCanary(result, ['MED-0039'])).toLowerCase();
    for (const prohibido of ['key', 'secret', 'token', 'supabase.co', 'password']) {
      expect(serial).not.toContain(prohibido);
    }
  });
});
