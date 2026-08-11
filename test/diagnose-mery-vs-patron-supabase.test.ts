/**
 * Tests del diagnóstico dirigido Mery vs Patrón.
 *
 * Cubre solo la lógica pura (plan de queries y clasificación de resultados),
 * sin tocar Supabase de verdad: `run()` se reemplaza por un stub en memoria.
 */
import { describe, it, expect } from 'vitest';
import {
  buildQueryPlan,
  runQueryDiag,
  QUERY_TIMEOUT_MS,
  DIAG_MAX_INTENTOS,
  type QueryPlanItem,
} from '../scripts/diagnose-mery-vs-patron-supabase.js';

describe('buildQueryPlan', () => {
  it('devuelve 7 queries (a-g) sin --full-limit-test', () => {
    const plan = buildQueryPlan({ fullLimitTest: false });
    expect(plan).toHaveLength(7);
    expect(plan.map((p) => p.nombre[0])).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  });

  it('agrega la query h) opcional con --full-limit-test', () => {
    const plan = buildQueryPlan({ fullLimitTest: true });
    expect(plan).toHaveLength(8);
    expect(plan[7]!.nombre.startsWith('h)')).toBe(true);
    expect(plan[7]!.limite).toBe(5000);
  });

  it('probes a-c son limit(0) sin filtro/joins', () => {
    const plan = buildQueryPlan({ fullLimitTest: false });
    for (const nombre of ['a', 'b', 'c']) {
      const item = plan.find((p) => p.nombre.startsWith(`${nombre})`))!;
      expect(item.limite).toBe(0);
      expect(item.joins).toBe('ninguno');
    }
  });

  it('d) filtra CLI-MERY-TEST y e) filtra CLI-0002, ambos limit(1)', () => {
    const plan = buildQueryPlan({ fullLimitTest: false });
    const d = plan.find((p) => p.nombre.startsWith('d)'))!;
    const e = plan.find((p) => p.nombre.startsWith('e)'))!;
    expect(d.filtro).toContain('CLI-MERY-TEST');
    expect(d.limite).toBe(1);
    expect(e.filtro).toContain('CLI-0002');
    expect(e.limite).toBe(1);
  });

  it('f) y g) son la comparación directa: mismo limit=20 y mismo rango, distinto join', () => {
    const plan = buildQueryPlan({ fullLimitTest: false });
    const mery = plan.find((p) => p.nombre.startsWith('f)'))!;
    const patron = plan.find((p) => p.nombre.startsWith('g)'))!;

    expect(mery.limite).toBe(20);
    expect(patron.limite).toBe(20);
    expect(mery.rango).toBe(patron.rango);
    expect(mery.orden).toBe(patron.orden);

    expect(mery.filtro).toContain('CLI-MERY-TEST');
    expect(patron.filtro).toContain('CLI-0002');

    // La diferencia estructural clave: INNER (Mery) vs LEFT/default (Patrón).
    expect(mery.joins).toContain('INNER');
    expect(patron.joins).toContain('LEFT');
  });

  it('h) opcional reproduce el límite real de producción de Mery (5000 = 500*10)', () => {
    const plan = buildQueryPlan({ fullLimitTest: true });
    const full = plan.find((p) => p.nombre.startsWith('h)'))!;
    const mery = plan.find((p) => p.nombre.startsWith('f)'))!;
    expect(full.filtro).toBe(mery.filtro);
    expect(full.joins).toBe(mery.joins);
    expect(full.limite).toBe(5000);
  });
});

describe('DIAG_MAX_INTENTOS / QUERY_TIMEOUT_MS', () => {
  it('usa menos reintentos que producción (4) para no alargar el diagnóstico', () => {
    expect(DIAG_MAX_INTENTOS).toBeLessThan(4);
    expect(DIAG_MAX_INTENTOS).toBeGreaterThanOrEqual(1);
  });

  it('el timeout por query es mayor al probe simple (10s) para admitir reintentos', () => {
    expect(QUERY_TIMEOUT_MS).toBeGreaterThan(10_000);
  });
});

function stubItem(
  nombre: string,
  run: QueryPlanItem['run'],
): QueryPlanItem {
  return { nombre, tabla: 'menciones', filtro: 'x', orden: 'x', rango: 'x', joins: 'x', limite: 1, run };
}

describe('runQueryDiag', () => {
  it('clasifica éxito como OK y cuenta filas', async () => {
    const item = stubItem('ok-test', async () => ({ data: [{ a: 1 }, { a: 2 }], error: null }));
    const r = await runQueryDiag(item);
    expect(r.ok).toBe(true);
    expect(r.clasificacion).toBe('OK');
    expect(r.filas).toBe(2);
    expect(r.codigo).toBeNull();
  });

  it('clasifica missing_table sin reintentar (no transitorio)', async () => {
    let llamadas = 0;
    const item = stubItem('missing-table-test', async () => {
      llamadas++;
      return { data: null, error: { code: 'PGRST205', message: 'Could not find the table' } };
    });
    const r = await runQueryDiag(item);
    expect(r.ok).toBe(false);
    expect(r.clasificacion).toBe('missing_table');
    expect(r.codigo).toBe('PGRST205');
    expect(llamadas).toBe(1); // no reintenta errores no transitorios
  });

  it('clasifica permission sin reintentar', async () => {
    const item = stubItem('perm-test', async () => ({
      data: null,
      error: { code: '42501', message: 'permission denied' },
    }));
    const r = await runQueryDiag(item);
    expect(r.ok).toBe(false);
    expect(r.clasificacion).toBe('permission');
  });

  it('reintenta transient_schema_cache hasta DIAG_MAX_INTENTOS veces y luego falla', async () => {
    let llamadas = 0;
    const item = stubItem('pgrst002-test', async () => {
      llamadas++;
      return { data: null, error: { code: 'PGRST002', message: 'Could not query the database for the schema cache. Retrying.' } };
    });
    const r = await runQueryDiag(item);
    expect(r.ok).toBe(false);
    expect(r.clasificacion).toBe('transient_schema_cache');
    expect(r.codigo).toBe('PGRST002');
    expect(llamadas).toBe(DIAG_MAX_INTENTOS);
  }, 15_000);

  it('captura excepciones lanzadas por run() y las clasifica', async () => {
    const item = stubItem('throw-test', async () => {
      throw { code: '42P01', message: 'relation does not exist' };
    });
    const r = await runQueryDiag(item);
    expect(r.ok).toBe(false);
    expect(r.clasificacion).toBe('missing_table');
  });
});
