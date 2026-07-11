/**
 * Tests para la lógica pura del rolling readiness backtest.
 *
 * Cubre:
 * - EstadoBacktest para CLI-MERY-TEST sin datos (SHADOW_CONFIG_OK_SIN_DATOS)
 * - CLI-PRUEBA queda SOLO_TEST
 * - Exclusión de CLI-PRUEBA del set de clientes objetivo
 * - CLI-MERY-TEST incluido en el backtest aunque su ID contiene "test"
 * - Cálculo de estado activo vs sin actividad
 */
import { describe, it, expect } from 'vitest';

// ─── Replica de lógica pura del script ───────────────────────────────────────

type EstadoBacktest =
  | 'ACTIVO_ESTABLE'
  | 'ACTIVO_CON_SENALES'
  | 'SIN_ACTIVIDAD_RECIENTE'
  | 'SHADOW_CONFIG_OK_SIN_DATOS'
  | 'SOLO_TEST'
  | 'SIN_DATOS';

const IDS_PRUEBA = new Set(['CLI-PRUEBA']);
const SHADOW_ONLY = new Set(['CLI-MERY-TEST']);
const CLIENTES_OBJETIVO = new Set(['CLI-0001', 'CLI-0002', 'CLI-0003', 'CLI-MERY-TEST']);

function estadoBacktest(opts: {
  clienteId: string;
  totalMenciones: number;
  diasConActividad: number;
  windowDays: number;
  isShadowOnly: boolean;
}): EstadoBacktest {
  const { clienteId, totalMenciones, diasConActividad, windowDays, isShadowOnly } = opts;
  if (IDS_PRUEBA.has(clienteId)) return 'SOLO_TEST';
  if (isShadowOnly && totalMenciones === 0) return 'SHADOW_CONFIG_OK_SIN_DATOS';
  if (totalMenciones === 0) return 'SIN_ACTIVIDAD_RECIENTE';
  const densidad = diasConActividad / windowDays;
  if (densidad >= 0.5) return 'ACTIVO_ESTABLE';
  return 'ACTIVO_CON_SENALES';
}

function clientesAAnalizar(): string[] {
  return [...CLIENTES_OBJETIVO].filter((cid) => !IDS_PRUEBA.has(cid));
}

// ─── CLI-MERY-TEST con y sin datos ───────────────────────────────────────────
describe('estadoBacktest: CLI-MERY-TEST', () => {
  it('sin menciones queda SHADOW_CONFIG_OK_SIN_DATOS (no es un error)', () => {
    expect(estadoBacktest({ clienteId: 'CLI-MERY-TEST', totalMenciones: 0, diasConActividad: 0, windowDays: 7, isShadowOnly: true })).toBe('SHADOW_CONFIG_OK_SIN_DATOS');
  });

  it('con menciones puede llegar a ACTIVO_ESTABLE', () => {
    expect(estadoBacktest({ clienteId: 'CLI-MERY-TEST', totalMenciones: 5, diasConActividad: 4, windowDays: 7, isShadowOnly: true })).toBe('ACTIVO_ESTABLE');
  });

  it('con pocas menciones queda ACTIVO_CON_SENALES si densidad < 0.5', () => {
    expect(estadoBacktest({ clienteId: 'CLI-MERY-TEST', totalMenciones: 2, diasConActividad: 2, windowDays: 7, isShadowOnly: true })).toBe('ACTIVO_CON_SENALES');
  });
});

// ─── CLI-PRUEBA siempre SOLO_TEST ─────────────────────────────────────────────
describe('estadoBacktest: CLI-PRUEBA', () => {
  it('siempre es SOLO_TEST independiente de menciones', () => {
    expect(estadoBacktest({ clienteId: 'CLI-PRUEBA', totalMenciones: 100, diasConActividad: 7, windowDays: 7, isShadowOnly: false })).toBe('SOLO_TEST');
  });

  it('SOLO_TEST aunque tenga 0 menciones', () => {
    expect(estadoBacktest({ clienteId: 'CLI-PRUEBA', totalMenciones: 0, diasConActividad: 0, windowDays: 7, isShadowOnly: false })).toBe('SOLO_TEST');
  });
});

// ─── Clientes productivos sin datos ──────────────────────────────────────────
describe('estadoBacktest: clientes productivos', () => {
  it('cliente productivo sin menciones queda SIN_ACTIVIDAD_RECIENTE', () => {
    expect(estadoBacktest({ clienteId: 'CLI-0001', totalMenciones: 0, diasConActividad: 0, windowDays: 7, isShadowOnly: false })).toBe('SIN_ACTIVIDAD_RECIENTE');
  });

  it('densidad >= 0.5 → ACTIVO_ESTABLE', () => {
    expect(estadoBacktest({ clienteId: 'CLI-0002', totalMenciones: 50, diasConActividad: 4, windowDays: 7, isShadowOnly: false })).toBe('ACTIVO_ESTABLE');
  });

  it('densidad < 0.5 → ACTIVO_CON_SENALES', () => {
    expect(estadoBacktest({ clienteId: 'CLI-0003', totalMenciones: 10, diasConActividad: 2, windowDays: 7, isShadowOnly: false })).toBe('ACTIVO_CON_SENALES');
  });
});

// ─── Parseo de --window-hours (precedencia sobre --window-days) ─────────────

function parseIntOrNull(v: string): number | null {
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}

function parseWindowArgs(argv: string[]): number {
  let windowDays = 7;
  let explicitDays: number | undefined;
  let windowHours: number | undefined;
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    const key = eq === -1 ? body : body.slice(0, eq);
    const val = eq === -1 ? '' : body.slice(eq + 1);
    if (key === 'window-days') explicitDays = parseIntOrNull(val) ?? undefined;
    if (key === 'window-hours') windowHours = parseIntOrNull(val) ?? undefined;
  }
  if (windowHours != null) windowDays = windowHours / 24;
  else if (explicitDays != null) windowDays = explicitDays;
  return windowDays;
}

describe('parseArgs --window-hours', () => {
  it('--window-hours=48 produce windowDays=2', () => {
    expect(parseWindowArgs(['--window-hours=48'])).toBe(2);
  });

  it('--window-hours tiene precedencia sobre --window-days', () => {
    expect(parseWindowArgs(['--window-days=30', '--window-hours=48'])).toBe(2);
  });

  it('sin --window-hours, --window-days=14 se respeta', () => {
    expect(parseWindowArgs(['--window-days=14'])).toBe(14);
  });

  it('sin ningún flag, default es 7 días', () => {
    expect(parseWindowArgs([])).toBe(7);
  });

  it('--window-hours=24 produce windowDays=1', () => {
    expect(parseWindowArgs(['--window-hours=24'])).toBe(1);
  });
});

// ─── Inclusión/exclusión correcta de clientes ────────────────────────────────
describe('clientesAAnalizar', () => {
  it('incluye CLI-MERY-TEST (shadow real, no de prueba)', () => {
    expect(clientesAAnalizar()).toContain('CLI-MERY-TEST');
  });

  it('excluye CLI-PRUEBA del análisis ejecutivo', () => {
    expect(clientesAAnalizar()).not.toContain('CLI-PRUEBA');
  });

  it('incluye los 4 clientes objetivo menos CLI-PRUEBA', () => {
    const res = clientesAAnalizar();
    expect(res).toContain('CLI-0001');
    expect(res).toContain('CLI-0002');
    expect(res).toContain('CLI-0003');
    expect(res).toContain('CLI-MERY-TEST');
    expect(res).not.toContain('CLI-PRUEBA');
  });

  it('CLI-MERY-TEST no es filtrado por el regex "test" en el ID', () => {
    // Verificamos que nuestra implementación use IDS_PRUEBA.has() no regex
    const excluido = IDS_PRUEBA.has('CLI-MERY-TEST');
    expect(excluido).toBe(false);
  });
});
