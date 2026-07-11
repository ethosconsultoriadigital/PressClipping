import { describe, it, expect } from 'vitest';
import {
  calcEstado,
  parseArgs,
  computeRollingBacktest,
} from '../scripts/generate-internal-daily-shadow-report.js';

describe('calcEstado', () => {
  it('shadow-only con 0 menciones → SHADOW_CONFIG_OK_SIN_DATOS', () => {
    expect(
      calcEstado({ clienteId: 'CLI-MERY-TEST', totalMenciones: 0, diasConActividad: 0, windowDays: 7, isShadowOnly: true }),
    ).toBe('SHADOW_CONFIG_OK_SIN_DATOS');
  });

  it('cliente regular con 0 menciones → SIN_ACTIVIDAD_RECIENTE', () => {
    expect(
      calcEstado({ clienteId: 'CLI-0001', totalMenciones: 0, diasConActividad: 0, windowDays: 7, isShadowOnly: false }),
    ).toBe('SIN_ACTIVIDAD_RECIENTE');
  });

  it('densidad ≥ 0.5 → ACTIVO_ESTABLE', () => {
    // 4 días con actividad de 7 = 0.57 → ACTIVO_ESTABLE
    expect(
      calcEstado({ clienteId: 'CLI-0001', totalMenciones: 10, diasConActividad: 4, windowDays: 7, isShadowOnly: false }),
    ).toBe('ACTIVO_ESTABLE');
  });

  it('densidad < 0.5 → ACTIVO_CON_SENALES', () => {
    // 2 días con actividad de 7 = 0.28 → ACTIVO_CON_SENALES
    expect(
      calcEstado({ clienteId: 'CLI-0001', totalMenciones: 5, diasConActividad: 2, windowDays: 7, isShadowOnly: false }),
    ).toBe('ACTIVO_CON_SENALES');
  });

  it('shadow-only con menciones → evalúa por densidad normal', () => {
    expect(
      calcEstado({ clienteId: 'CLI-MERY-TEST', totalMenciones: 3, diasConActividad: 4, windowDays: 7, isShadowOnly: true }),
    ).toBe('ACTIVO_ESTABLE');
  });
});

describe('parseArgs', () => {
  it('sin args → windowDays = 7', () => {
    expect(parseArgs([])).toEqual({ windowDays: 7 });
  });

  it('--window-days=14 → windowDays = 14', () => {
    expect(parseArgs(['--window-days=14'])).toEqual({ windowDays: 14 });
  });

  it('--window-days=30 → windowDays = 30', () => {
    expect(parseArgs(['--window-days=30'])).toEqual({ windowDays: 30 });
  });

  it('arg desconocido ignorado', () => {
    expect(parseArgs(['--foo=bar', '--unknown'])).toEqual({ windowDays: 7 });
  });

  it('--window-days no numérico → usa default', () => {
    expect(parseArgs(['--window-days=abc'])).toEqual({ windowDays: 7 });
  });
});

describe('computeRollingBacktest', () => {
  it('sin menciones → todos los clientes objetivo con 0 y estados correctos', () => {
    const result = computeRollingBacktest([], 7);
    expect(result.size).toBe(4); // CLI-0001, CLI-0002, CLI-0003, CLI-MERY-TEST

    const cli0001 = result.get('CLI-0001');
    expect(cli0001?.total_menciones).toBe(0);
    expect(cli0001?.estado).toBe('SIN_ACTIVIDAD_RECIENTE');

    const mery = result.get('CLI-MERY-TEST');
    expect(mery?.total_menciones).toBe(0);
    expect(mery?.estado).toBe('SHADOW_CONFIG_OK_SIN_DATOS');
  });

  it('cuenta menciones y alertas por cliente', () => {
    const rows = [
      { cliente_id: 'CLI-0001', keyword_id: 'kw1', keyword: 'jumex', requiere_alerta: true,  score_relevancia: 0.9, created_at: '2026-07-10T10:00:00Z' },
      { cliente_id: 'CLI-0001', keyword_id: 'kw2', keyword: 'jugo',  requiere_alerta: false, score_relevancia: 0.5, created_at: '2026-07-10T11:00:00Z' },
      { cliente_id: 'CLI-0002', keyword_id: 'kw3', keyword: 'tequila', requiere_alerta: true, score_relevancia: 0.8, created_at: '2026-07-10T12:00:00Z' },
    ];
    const result = computeRollingBacktest(rows, 7);

    const cli1 = result.get('CLI-0001');
    expect(cli1?.total_menciones).toBe(2);
    expect(cli1?.total_alertas).toBe(1);
    expect(cli1?.keywords_distintas).toBe(2);

    const cli2 = result.get('CLI-0002');
    expect(cli2?.total_menciones).toBe(1);
    expect(cli2?.total_alertas).toBe(1);
  });

  it('ignora clientes fuera de CLIENTES_OBJETIVO', () => {
    const rows = [
      { cliente_id: 'CLI-PRUEBA', keyword_id: 'kw1', keyword: 'test', requiere_alerta: false, score_relevancia: 0, created_at: '2026-07-10T10:00:00Z' },
      { cliente_id: 'DESCONOCIDO', keyword_id: 'kw2', keyword: 'foo', requiere_alerta: false, score_relevancia: 0, created_at: '2026-07-10T10:00:00Z' },
    ];
    const result = computeRollingBacktest(rows, 7);
    expect(result.get('CLI-0001')?.total_menciones).toBe(0);
    // CLI-PRUEBA y DESCONOCIDO no deben aparecer en el resultado
    expect(result.has('CLI-PRUEBA')).toBe(false);
    expect(result.has('DESCONOCIDO')).toBe(false);
  });

  it('calcula keywords distintas correctamente (dedup por cliente)', () => {
    const rows = [
      { cliente_id: 'CLI-0001', keyword_id: 'kw1', keyword: 'a', requiere_alerta: false, score_relevancia: 0, created_at: '2026-07-09T10:00:00Z' },
      { cliente_id: 'CLI-0001', keyword_id: 'kw1', keyword: 'a', requiere_alerta: false, score_relevancia: 0, created_at: '2026-07-10T10:00:00Z' },
      { cliente_id: 'CLI-0001', keyword_id: 'kw2', keyword: 'b', requiere_alerta: false, score_relevancia: 0, created_at: '2026-07-10T11:00:00Z' },
    ];
    const result = computeRollingBacktest(rows, 7);
    // kw1 aparece dos días pero es la misma keyword → 2 keywords distintas (kw1, kw2)
    expect(result.get('CLI-0001')?.keywords_distintas).toBe(2);
  });

  it('calcula promedio y max score', () => {
    const rows = [
      { cliente_id: 'CLI-0001', keyword_id: 'kw1', keyword: 'a', requiere_alerta: false, score_relevancia: 0.6, created_at: '2026-07-10T10:00:00Z' },
      { cliente_id: 'CLI-0001', keyword_id: 'kw2', keyword: 'b', requiere_alerta: false, score_relevancia: 0.8, created_at: '2026-07-10T11:00:00Z' },
    ];
    const result = computeRollingBacktest(rows, 7);
    const cli1 = result.get('CLI-0001');
    expect(cli1?.promedio_score).toBe(0.7);
    expect(cli1?.max_score).toBe(0.8);
  });
});
