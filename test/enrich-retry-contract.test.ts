/**
 * S1 — contrato de metadata de reintento del enrich.
 *
 * Cubre las tres piezas: estados derivados, política de reintento y el plan de
 * query de elegibilidad/keyset. Todo puro: sin DB, sin red, sin reloj real.
 */
import { describe, it, expect } from 'vitest';
import {
  derivarEstadoEnrich,
  esTextoLimpioUtil,
  planEnrichRetry,
  limpiarMetadataFallo,
  esClaseReintentable,
  DEFAULT_ENRICH_RETRY_CONFIG,
  ENRICH_FAILURE_CLASSES,
  type EnrichDebtRow,
} from '../src/enrichers/enrichRetryPolicy.js';
import {
  buildDrainPageQueryPlan,
  expresionElegibilidad,
  expresionKeyset,
  cursorDesdeFila,
  cursorAvanzo,
  DRAIN_SELECT,
} from '../src/enrichers/enrichDrainQuery.js';
import { aplicarPlanDrain, type DrainQueryBuilder } from '../src/supabase/repositories.js';

const NOW = new Date('2026-09-19T12:45:00.000Z');
const CUTOFF = '2026-09-19T12:45:00.000Z';
const FRESH_SINCE = '2026-09-18T12:45:00.000Z';

function row(over: Partial<EnrichDebtRow> = {}): EnrichDebtRow {
  return {
    texto_nota_limpia: null,
    enrich_last_attempt_at: null,
    enrich_next_attempt_at: null,
    enrich_failure_class: null,
    ...over,
  };
}

describe('esTextoLimpioUtil — contrato de éxito', () => {
  it('texto con contenido es útil', () => {
    expect(esTextoLimpioUtil('Cuerpo de la nota')).toBe(true);
  });

  it('NULL, cadena vacía y whitespace NO son éxito', () => {
    expect(esTextoLimpioUtil(null)).toBe(false);
    expect(esTextoLimpioUtil('')).toBe(false);
    expect(esTextoLimpioUtil('   \n\t ')).toBe(false);
  });
});

describe('derivarEstadoEnrich', () => {
  it('clean con texto ⇒ SUCCESS aunque haya metadata vieja de fallo', () => {
    expect(
      derivarEstadoEnrich(
        row({ texto_nota_limpia: 'ok', enrich_last_attempt_at: NOW.toISOString(), enrich_failure_class: 'HTTP_403' }),
      ),
    ).toBe('SUCCESS');
  });

  it('empty string NO cuenta como SUCCESS', () => {
    expect(derivarEstadoEnrich(row({ texto_nota_limpia: '' }))).toBe('NEVER_ATTEMPTED');
  });

  it('sin intentos ⇒ NEVER_ATTEMPTED', () => {
    expect(derivarEstadoEnrich(row())).toBe('NEVER_ATTEMPTED');
  });

  it('con next_attempt ⇒ RETRY_SCHEDULED', () => {
    expect(
      derivarEstadoEnrich(
        row({
          enrich_last_attempt_at: '2026-09-18T12:00:00.000Z',
          enrich_next_attempt_at: '2026-09-19T12:00:00.000Z',
          enrich_failure_class: 'TIMEOUT',
        }),
      ),
    ).toBe('RETRY_SCHEDULED');
  });

  it('intentada sin next_attempt ⇒ BLOCKED_REVIEW', () => {
    expect(
      derivarEstadoEnrich(
        row({ enrich_last_attempt_at: '2026-09-18T12:00:00.000Z', enrich_failure_class: 'HTTP_404_410' }),
      ),
    ).toBe('BLOCKED_REVIEW');
  });
});

describe('planEnrichRetry — política V1', () => {
  it('TIMEOUT y NETWORK_TRANSIENT reprograman con el delay transitorio', () => {
    for (const clase of ['TIMEOUT', 'NETWORK_TRANSIENT'] as const) {
      const plan = planEnrichRetry({ failureClass: clase, now: NOW });
      expect(plan.state).toBe('RETRY_SCHEDULED');
      expect(plan.enrich_failure_class).toBe(clase);
      expect(plan.enrich_last_attempt_at).toBe(NOW.toISOString());
      expect(new Date(plan.enrich_next_attempt_at!).getTime() - NOW.getTime()).toBe(
        DEFAULT_ENRICH_RETRY_CONFIG.transientMinutes * 60_000,
      );
    }
  });

  it('429 sin Retry-After usa el delay de rate limit', () => {
    const plan = planEnrichRetry({ failureClass: 'HTTP_429', now: NOW });
    expect(new Date(plan.enrich_next_attempt_at!).getTime() - NOW.getTime()).toBe(
      DEFAULT_ENRICH_RETRY_CONFIG.rateLimitMinutes * 60_000,
    );
  });

  it('429 con Retry-After grande lo respeta (sin dormir el proceso)', () => {
    const plan = planEnrichRetry({ failureClass: 'HTTP_429', now: NOW, retryAfterSeconds: 43_200 });
    expect(new Date(plan.enrich_next_attempt_at!).getTime() - NOW.getTime()).toBe(720 * 60_000);
  });

  it('Retry-After absurdo se topa con maxRetryAfterMinutes', () => {
    const plan = planEnrichRetry({ failureClass: 'HTTP_429', now: NOW, retryAfterSeconds: 999_999 });
    expect(new Date(plan.enrich_next_attempt_at!).getTime() - NOW.getTime()).toBe(
      DEFAULT_ENRICH_RETRY_CONFIG.maxRetryAfterMinutes * 60_000,
    );
  });

  it('403 normal recibe cooldown; 403 con bloqueo de entorno queda BLOCKED_REVIEW', () => {
    const cooldown = planEnrichRetry({ failureClass: 'HTTP_403', now: NOW });
    expect(cooldown.state).toBe('RETRY_SCHEDULED');
    expect(new Date(cooldown.enrich_next_attempt_at!).getTime() - NOW.getTime()).toBe(
      DEFAULT_ENRICH_RETRY_CONFIG.forbiddenCooldownMinutes * 60_000,
    );

    const bloqueado = planEnrichRetry({ failureClass: 'HTTP_403', now: NOW, environmentBlocked: true });
    expect(bloqueado.state).toBe('BLOCKED_REVIEW');
    expect(bloqueado.enrich_next_attempt_at).toBeNull();
  });

  it('404/410 y EMPTY_CLEAN_TEXT quedan como deuda visible, no como reintento', () => {
    for (const clase of ['HTTP_404_410', 'EMPTY_CLEAN_TEXT'] as const) {
      const plan = planEnrichRetry({ failureClass: clase, now: NOW });
      expect(plan.state).toBe('BLOCKED_REVIEW');
      expect(plan.enrich_next_attempt_at).toBeNull();
      expect(plan.enrich_failure_class).toBe(clase);
    }
  });

  it('WRITE_FAILED se reintenta pronto', () => {
    const plan = planEnrichRetry({ failureClass: 'WRITE_FAILED', now: NOW });
    expect(new Date(plan.enrich_next_attempt_at!).getTime() - NOW.getTime()).toBe(
      DEFAULT_ENRICH_RETRY_CONFIG.writeFailedMinutes * 60_000,
    );
  });

  it('los delays son configurables', () => {
    const plan = planEnrichRetry({
      failureClass: 'TIMEOUT',
      now: NOW,
      config: { ...DEFAULT_ENRICH_RETRY_CONFIG, transientMinutes: 15 },
    });
    expect(new Date(plan.enrich_next_attempt_at!).getTime() - NOW.getTime()).toBe(15 * 60_000);
  });

  it('toda clase conocida produce un plan con last_attempt', () => {
    for (const clase of ENRICH_FAILURE_CLASSES) {
      expect(planEnrichRetry({ failureClass: clase, now: NOW }).enrich_last_attempt_at).toBe(
        NOW.toISOString(),
      );
    }
  });

  it('esClaseReintentable separa reintentables de bloqueantes', () => {
    expect(esClaseReintentable('TIMEOUT')).toBe(true);
    expect(esClaseReintentable('HTTP_403')).toBe(true);
    expect(esClaseReintentable('HTTP_403', { environmentBlocked: true })).toBe(false);
    expect(esClaseReintentable('HTTP_404_410')).toBe(false);
    expect(esClaseReintentable('EMPTY_CLEAN_TEXT')).toBe(false);
  });

  it('limpiarMetadataFallo borra clase y reintento al confirmar éxito', () => {
    expect(limpiarMetadataFallo(NOW)).toEqual({
      enrich_last_attempt_at: NOW.toISOString(),
      enrich_next_attempt_at: null,
      enrich_failure_class: null,
    });
  });
});

describe('buildDrainPageQueryPlan — elegibilidad', () => {
  it('siempre exige clean NULL y respeta el cutoff W', () => {
    const plan = buildDrainPageQueryPlan({
      queue: 'fresh',
      cutoff: CUTOFF,
      freshSince: FRESH_SINCE,
      pageSize: 100,
    });
    expect(plan.filters).toContainEqual({ kind: 'is', column: 'texto_nota_limpia', value: null });
    expect(plan.filters).toContainEqual({ kind: 'lte', column: 'created_at', value: CUTOFF });
    expect(plan.select).toBe(DRAIN_SELECT);
    expect(plan.limit).toBe(100);
  });

  it('never-attempted y reintento vencido son elegibles; BLOCKED_REVIEW no', () => {
    const plan = buildDrainPageQueryPlan({
      queue: 'fresh',
      cutoff: CUTOFF,
      freshSince: FRESH_SINCE,
      pageSize: 10,
    });
    const or = plan.filters.find((f) => f.kind === 'or' && f.expression.includes('enrich_last_attempt_at'));
    expect(or).toEqual({ kind: 'or', expression: expresionElegibilidad(CUTOFF) });
    // La expresión solo tiene dos ramas: last IS NULL, o next <= W. Una fila
    // BLOCKED_REVIEW (last != NULL, next NULL) no satisface ninguna.
    expect(expresionElegibilidad(CUTOFF)).toBe(
      `enrich_last_attempt_at.is.null,enrich_next_attempt_at.lte.${CUTOFF}`,
    );
  });

  it('NUNCA filtra por menciones_procesado', () => {
    const plan = buildDrainPageQueryPlan({
      queue: 'backlog',
      cutoff: CUTOFF,
      freshSince: FRESH_SINCE,
      pageSize: 10,
    });
    expect(JSON.stringify(plan)).not.toContain('menciones_procesado');
  });

  it('acota por medio_id deduplicando', () => {
    const plan = buildDrainPageQueryPlan({
      queue: 'fresh',
      cutoff: CUTOFF,
      freshSince: FRESH_SINCE,
      pageSize: 10,
      medioIds: ['MED-0039', 'MED-0039', 'MED-0069'],
    });
    expect(plan.filters).toContainEqual({ kind: 'in', column: 'medio_id', values: ['MED-0039', 'MED-0069'] });
  });

  it('sin medioIds no agrega el filtro', () => {
    const plan = buildDrainPageQueryPlan({
      queue: 'fresh',
      cutoff: CUTOFF,
      freshSince: FRESH_SINCE,
      pageSize: 10,
      medioIds: [],
    });
    expect(plan.filters.some((f) => f.kind === 'in')).toBe(false);
  });

  it('rechaza pageSize inválido', () => {
    expect(() =>
      buildDrainPageQueryPlan({ queue: 'fresh', cutoff: CUTOFF, freshSince: FRESH_SINCE, pageSize: 0 }),
    ).toThrow(/pageSize/);
  });
});

describe('buildDrainPageQueryPlan — colas y keyset', () => {
  it('FRESH toma la ventana reciente en orden descendente', () => {
    const plan = buildDrainPageQueryPlan({
      queue: 'fresh',
      cutoff: CUTOFF,
      freshSince: FRESH_SINCE,
      pageSize: 50,
    });
    expect(plan.filters).toContainEqual({ kind: 'gt', column: 'created_at', value: FRESH_SINCE });
    expect(plan.order).toEqual([
      { column: 'created_at', ascending: false },
      { column: 'noticia_id', ascending: false },
    ]);
  });

  it('BACKLOG toma lo viejo en orden ascendente', () => {
    const plan = buildDrainPageQueryPlan({
      queue: 'backlog',
      cutoff: CUTOFF,
      freshSince: FRESH_SINCE,
      pageSize: 50,
    });
    expect(plan.filters).toContainEqual({ kind: 'lte', column: 'created_at', value: FRESH_SINCE });
    expect(plan.order).toEqual([
      { column: 'created_at', ascending: true },
      { column: 'noticia_id', ascending: true },
    ]);
  });

  it('el cursor desempata por noticia_id en el sentido de la cola', () => {
    const cursor = { created_at: '2026-09-19T10:00:00.000Z', noticia_id: 'uuid-7' };
    const fresh = buildDrainPageQueryPlan({
      queue: 'fresh', cutoff: CUTOFF, freshSince: FRESH_SINCE, pageSize: 10, cursor,
    });
    expect(fresh.filters).toContainEqual({ kind: 'or', expression: expresionKeyset(cursor, false) });
    expect(expresionKeyset(cursor, false)).toContain('created_at.lt.');
    expect(expresionKeyset(cursor, false)).toContain('and(created_at.eq.2026-09-19T10:00:00.000Z,noticia_id.lt.uuid-7)');

    const backlog = buildDrainPageQueryPlan({
      queue: 'backlog', cutoff: CUTOFF, freshSince: FRESH_SINCE, pageSize: 10, cursor,
    });
    expect(backlog.filters).toContainEqual({ kind: 'or', expression: expresionKeyset(cursor, true) });
    expect(expresionKeyset(cursor, true)).toContain('created_at.gt.');
  });

  it('el plan NUNCA usa offset/range ni NOT IN', () => {
    const plan = buildDrainPageQueryPlan({
      queue: 'fresh',
      cutoff: CUTOFF,
      freshSince: FRESH_SINCE,
      pageSize: 10,
      cursor: { created_at: CUTOFF, noticia_id: 'uuid-1' },
    });
    const serial = JSON.stringify(plan).toLowerCase();
    expect(serial).not.toContain('offset');
    expect(serial).not.toContain('range');
    expect(serial).not.toContain('not.in');
  });
});

describe('cursorDesdeFila / cursorAvanzo', () => {
  it('construye el cursor de la fila leída', () => {
    expect(cursorDesdeFila({ created_at: CUTOFF, noticia_id: 'n1' })).toEqual({
      created_at: CUTOFF,
      noticia_id: 'n1',
    });
    expect(cursorDesdeFila({ created_at: null, noticia_id: 'n1' })).toBeNull();
  });

  it('detecta cursor repetido (base de NO_PROGRESS)', () => {
    const c = { created_at: CUTOFF, noticia_id: 'n1' };
    expect(cursorAvanzo(null, c)).toBe(true);
    expect(cursorAvanzo(c, { ...c })).toBe(false);
    expect(cursorAvanzo(c, { created_at: CUTOFF, noticia_id: 'n2' })).toBe(true);
    expect(cursorAvanzo(c, null)).toBe(false);
  });
});

describe('aplicarPlanDrain — traducción a PostgREST', () => {
  it('traduce filtros, orden y limit sin offset', () => {
    const llamadas: Array<[string, unknown]> = [];
    const builder = new Proxy({} as DrainQueryBuilder, {
      get(_t, prop: string) {
        return (...args: unknown[]) => {
          llamadas.push([prop, args]);
          return builder;
        };
      },
    });

    const plan = buildDrainPageQueryPlan({
      queue: 'backlog',
      cutoff: CUTOFF,
      freshSince: FRESH_SINCE,
      pageSize: 25,
      medioIds: ['MED-0039'],
      cursor: { created_at: FRESH_SINCE, noticia_id: 'n9' },
    });
    aplicarPlanDrain(builder, plan);

    const metodos = llamadas.map(([m]) => m);
    expect(metodos[0]).toBe('select');
    expect(metodos).toContain('is');
    expect(metodos).toContain('in');
    expect(metodos.filter((m) => m === 'or')).toHaveLength(2);
    expect(metodos.filter((m) => m === 'order')).toHaveLength(2);
    expect(metodos[metodos.length - 1]).toBe('limit');
    expect(metodos).not.toContain('range');
    expect(llamadas.find(([m]) => m === 'limit')?.[1]).toEqual([25]);
  });
});
