/**
 * S2 — matriz del coordinador de drain.
 *
 * El lake falso implementa la MISMA semántica que el plan de query real
 * (elegibilidad, cutoff W, colas fresh/backlog, keyset estricto), así que los
 * tests ejercitan la paginación de verdad: los éxitos desaparecen del conjunto
 * pendiente y los fallos siguen con `texto_nota_limpia` NULL.
 *
 * Sin red, sin DB, sin reloj real.
 */
import { describe, it, expect } from 'vitest';
import {
  runEnrichDrain,
  drainPermiteDownstream,
  drainDejoDeuda,
  type DrainArticleOutcome,
  type DrainCandidateRow,
  type DrainDeps,
  type DrainOptions,
  type DrainUpdateFields,
} from '../src/enrichers/enrichDrain.js';
import type { DrainPageRequest } from '../src/enrichers/enrichDrainQuery.js';

const T0 = Date.parse('2026-09-19T12:45:00.000Z');

interface FakeRow {
  noticia_id: string;
  medio_id: string | null;
  url_original: string;
  created_at: string;
  texto_nota_limpia: string | null;
  enrich_last_attempt_at: string | null;
  enrich_next_attempt_at: string | null;
  enrich_failure_class: string | null;
}

function fila(over: Partial<FakeRow> & { noticia_id: string }): FakeRow {
  return {
    medio_id: 'MED-0001',
    url_original: `https://medio.mx/${over.noticia_id}`,
    created_at: new Date(T0 - 60_000).toISOString(),
    texto_nota_limpia: null,
    enrich_last_attempt_at: null,
    enrich_next_attempt_at: null,
    enrich_failure_class: null,
    ...over,
  };
}

/** Lake en memoria con la semántica exacta del query de drain. */
class FakeLake {
  readonly rows = new Map<string, FakeRow>();
  paginas = 0;

  constructor(rows: FakeRow[]) {
    for (const r of rows) this.rows.set(r.noticia_id, r);
  }

  fetchPage = async (req: DrainPageRequest): Promise<DrainCandidateRow[]> => {
    this.paginas += 1;
    const asc = req.queue === 'backlog';
    const elegibles = [...this.rows.values()].filter((r) => {
      if (r.texto_nota_limpia !== null) return false; // `is null` real: '' NO entra
      if (r.created_at > req.cutoff) return false;
      if (req.queue === 'fresh' ? !(r.created_at > req.freshSince) : !(r.created_at <= req.freshSince)) {
        return false;
      }
      if (req.medioIds && req.medioIds.length > 0 && !req.medioIds.includes(r.medio_id ?? '')) {
        return false;
      }
      const nuncaIntentada = r.enrich_last_attempt_at === null;
      const reintentoVencido =
        r.enrich_next_attempt_at !== null && r.enrich_next_attempt_at <= req.cutoff;
      if (!nuncaIntentada && !reintentoVencido) return false;
      if (req.cursor) {
        const clave = `${r.created_at}|${r.noticia_id}`;
        const cur = `${req.cursor.created_at}|${req.cursor.noticia_id}`;
        if (asc ? clave <= cur : clave >= cur) return false;
      }
      return true;
    });
    elegibles.sort((a, b) => {
      const ka = `${a.created_at}|${a.noticia_id}`;
      const kb = `${b.created_at}|${b.noticia_id}`;
      return asc ? ka.localeCompare(kb) : kb.localeCompare(ka);
    });
    return elegibles.slice(0, req.pageSize).map((r) => ({ ...r }));
  };

  persist = async (noticiaId: string, fields: DrainUpdateFields): Promise<boolean> => {
    const row = this.rows.get(noticiaId);
    if (!row) return false;
    Object.assign(row, fields);
    return true;
  };
}

interface HarnessOpts extends Partial<DrainOptions> {
  articleMs?: number;
  outcome?: (row: DrainCandidateRow, n: number) => DrainArticleOutcome;
  persist?: DrainDeps['persist'];
  fetchPage?: DrainDeps['fetchPage'];
  isEnvironmentBlocked?: DrainDeps['isEnvironmentBlocked'];
}

const exito = (texto = 'cuerpo limpio'): DrainArticleOutcome => ({
  ok: true,
  cleanText: texto,
  fields: { texto_nota_limpia: texto, estado_extraccion: 'enriquecido' },
});

const falloHttp = (clase: DrainArticleOutcome['failureClass']): DrainArticleOutcome => ({
  ok: false,
  cleanText: null,
  fields: { error_extraccion: `fallo ${clase}` },
  failureClass: clase,
});

async function correr(lake: FakeLake, opts: HarnessOpts = {}) {
  const reloj = { t: T0 };
  const intentos: string[] = [];
  let n = 0;
  const deps: DrainDeps = {
    fetchPage: opts.fetchPage ?? lake.fetchPage,
    persist: opts.persist ?? lake.persist,
    now: () => new Date(reloj.t),
    isEnvironmentBlocked: opts.isEnvironmentBlocked,
    processArticle: async (row) => {
      intentos.push(row.noticia_id);
      reloj.t += opts.articleMs ?? 100;
      n += 1;
      return opts.outcome ? opts.outcome(row, n) : exito();
    },
  };
  const result = await runEnrichDrain(deps, {
    cutoff: new Date(T0),
    deadline: new Date(T0 + (opts.deadline ? 0 : 60 * 60_000)),
    ...opts,
    ...(opts.deadline ? { deadline: opts.deadline } : {}),
  } as DrainOptions);
  return { result, intentos, reloj };
}

function lote(n: number, over: (i: number) => Partial<FakeRow> = () => ({})): FakeRow[] {
  return Array.from({ length: n }, (_, i) =>
    fila({
      noticia_id: `n${String(i).padStart(5, '0')}`,
      created_at: new Date(T0 - 60_000 - i * 1000).toISOString(),
      ...over(i),
    }),
  );
}

describe('runEnrichDrain — volumen y drenado completo', () => {
  it('0 candidatos ⇒ DRAINED sin intentos', async () => {
    const { result, intentos } = await correr(new FakeLake([]));
    expect(result.termination_reason).toBe('DRAINED');
    expect(result.attempted).toBe(0);
    expect(intentos).toHaveLength(0);
    expect(result.remaining_eligible_estimate).toBe(0);
  });

  it('500 candidatos: los drena todos (el cupo fijo de 500 ya no existe)', async () => {
    const lake = new FakeLake(lote(500));
    const { result } = await correr(lake);
    expect(result.termination_reason).toBe('DRAINED');
    expect(result.attempted).toBe(500);
    expect(result.persisted_success).toBe(500);
    expect(result.duplicate_attempts).toBe(0);
  });

  it('700 candidatos: drena los 700 (el incidente de 622 > 500 no se repite)', async () => {
    const lake = new FakeLake(lote(700));
    const { result } = await correr(lake);
    expect(result.termination_reason).toBe('DRAINED');
    expect(result.attempted).toBe(700);
    expect(result.persisted_success).toBe(700);
    expect([...lake.rows.values()].every((r) => r.texto_nota_limpia === 'cuerpo limpio')).toBe(true);
  });

  it('1500 candidatos sintéticos: drenado completo, sin duplicados, paginado acotado', async () => {
    const lake = new FakeLake(lote(1500));
    const { result, intentos } = await correr(lake, { pageSize: 100, maxPasses: 500 });
    expect(result.termination_reason).toBe('DRAINED');
    expect(result.attempted).toBe(1500);
    expect(new Set(intentos).size).toBe(1500);
    expect(result.duplicate_attempts).toBe(0);
    expect(result.passes).toBeLessThanOrEqual(500);
  });
});

describe('runEnrichDrain — invariantes de paginación', () => {
  it('los éxitos desaparecen del pendiente y aun así no se salta ningún candidato', async () => {
    const lake = new FakeLake(lote(250));
    const { result, intentos } = await correr(lake, { pageSize: 50 });
    expect(result.attempted).toBe(250);
    expect(new Set(intentos).size).toBe(250);
  });

  it('primera página entera 403: no se reintenta en el mismo run', async () => {
    const lake = new FakeLake(lote(300));
    const { result, intentos } = await correr(lake, {
      pageSize: 100,
      outcome: (_row, n) => (n <= 100 ? falloHttp('HTTP_403') : exito()),
    });
    expect(result.termination_reason).toBe('DRAINED');
    expect(result.attempted).toBe(300);
    expect(new Set(intentos).size).toBe(300);
    expect(result.failed_retryable).toBe(100);
    expect(result.persisted_success).toBe(200);
    expect(result.failure_classes.HTTP_403).toBe(100);
  });

  it('las fallidas siguen con clean NULL pero NO reaparecen (attempted_this_run)', async () => {
    const lake = new FakeLake(lote(120));
    const { result, intentos } = await correr(lake, {
      pageSize: 40,
      outcome: () => falloHttp('TIMEOUT'),
    });
    expect(result.attempted).toBe(120);
    expect(new Set(intentos).size).toBe(120);
    expect(result.duplicate_attempts).toBe(0);
    expect([...lake.rows.values()].every((r) => r.texto_nota_limpia === null)).toBe(true);
    // Quedaron reprogramadas hacia el futuro, no borradas.
    expect([...lake.rows.values()].every((r) => r.enrich_next_attempt_at !== null)).toBe(true);
  });

  it('si la DB devuelve una fila ya intentada, se descarta sin volver a intentarla', async () => {
    const rows = lote(3);
    const lake = new FakeLake(rows);
    let llamadas = 0;
    const fetchPage: DrainDeps['fetchPage'] = async (req) => {
      llamadas += 1;
      if (req.queue === 'backlog') return [];
      // Segunda página: repite una fila ya servida junto a una nueva.
      if (llamadas === 1) return [{ ...rows[0]! }, { ...rows[1]! }];
      if (llamadas === 2) return [{ ...rows[1]! }, { ...rows[2]! }];
      return [];
    };
    const { result, intentos } = await correr(lake, { pageSize: 2, fetchPage });
    expect(new Set(intentos).size).toBe(intentos.length);
    expect(result.duplicate_attempts).toBe(0);
    expect(result.duplicate_candidates_filtered).toBeGreaterThan(0);
  });

  it('timestamps idénticos: el uuid desempata y no se pierde ni se repite ninguna fila', async () => {
    const mismoInstante = new Date(T0 - 5000).toISOString();
    const lake = new FakeLake(lote(120, () => ({ created_at: mismoInstante })));
    const { result, intentos } = await correr(lake, { pageSize: 25 });
    expect(result.attempted).toBe(120);
    expect(new Set(intentos).size).toBe(120);
  });

  it('las filas creadas después de W se ignoran (cola no móvil)', async () => {
    const lake = new FakeLake([
      ...lote(5),
      fila({ noticia_id: 'futura-1', created_at: new Date(T0 + 60_000).toISOString() }),
      fila({ noticia_id: 'futura-2', created_at: new Date(T0 + 120_000).toISOString() }),
    ]);
    const { result, intentos } = await correr(lake);
    expect(result.attempted).toBe(5);
    expect(intentos).not.toContain('futura-1');
    expect(intentos).not.toContain('futura-2');
  });

  it('BLOCKED_REVIEW (last != NULL, next NULL) no es elegible', async () => {
    const lake = new FakeLake([
      fila({ noticia_id: 'bloqueada', enrich_last_attempt_at: new Date(T0 - 86_400_000).toISOString(), enrich_failure_class: 'HTTP_404_410' }),
      fila({ noticia_id: 'vencida', enrich_last_attempt_at: new Date(T0 - 86_400_000).toISOString(), enrich_next_attempt_at: new Date(T0 - 3600_000).toISOString(), enrich_failure_class: 'TIMEOUT' }),
      fila({ noticia_id: 'futura', enrich_last_attempt_at: new Date(T0 - 86_400_000).toISOString(), enrich_next_attempt_at: new Date(T0 + 3600_000).toISOString(), enrich_failure_class: 'TIMEOUT' }),
      fila({ noticia_id: 'nueva' }),
    ]);
    const { intentos } = await correr(lake);
    expect(intentos.sort()).toEqual(['nueva', 'vencida']);
  });
});

describe('runEnrichDrain — fresh / backlog y fairness', () => {
  it('reparte el servicio entre las dos colas según freshShare', async () => {
    const viejo = new Date(T0 - 5 * 86_400_000).toISOString();
    const lake = new FakeLake([
      ...lote(100, (i) => ({ noticia_id: `f${i}`, created_at: new Date(T0 - 60_000 - i * 1000).toISOString() })),
      ...lote(100, (i) => ({ noticia_id: `b${i}`, created_at: new Date(Date.parse(viejo) - i * 1000).toISOString() })),
    ]);
    const { result } = await correr(lake, { pageSize: 20, freshShare: 0.7, maxAttempts: 100 });
    expect(result.termination_reason).toBe('SAFETY_LIMIT');
    expect(result.attempted).toBe(100);
    expect(result.fresh_attempted).toBe(70);
    expect(result.backlog_attempted).toBe(30);
  });

  it('freshShare es configurable, no una constante del motor', async () => {
    const viejo = new Date(T0 - 5 * 86_400_000).toISOString();
    const lake = new FakeLake([
      ...lote(100, (i) => ({ noticia_id: `f${i}`, created_at: new Date(T0 - 60_000 - i * 1000).toISOString() })),
      ...lote(100, (i) => ({ noticia_id: `b${i}`, created_at: new Date(Date.parse(viejo) - i * 1000).toISOString() })),
    ]);
    const { result } = await correr(lake, { pageSize: 20, freshShare: 0.5, maxAttempts: 100 });
    expect(result.fresh_attempted).toBe(50);
    expect(result.backlog_attempted).toBe(50);
  });

  it('si una cola se vacía, la otra usa toda la capacidad', async () => {
    const lake = new FakeLake(lote(30));
    const { result } = await correr(lake, { pageSize: 10 });
    expect(result.termination_reason).toBe('DRAINED');
    expect(result.attempted).toBe(30);
    expect(result.backlog_attempted).toBe(0);
    expect(result.fresh_attempted).toBe(30);
  });

  it('un medio de alto volumen no monopoliza: round-robin dentro del buffer', async () => {
    const rows = [
      ...lote(100, (i) => ({ noticia_id: `alto-${i}`, medio_id: 'MED-ALTO', created_at: new Date(T0 - 10_000 - i).toISOString() })),
      ...lote(5, (i) => ({ noticia_id: `bajo-${i}`, medio_id: 'MED-BAJO', created_at: new Date(T0 - 900_000 - i).toISOString() })),
    ];
    const lake = new FakeLake(rows);
    const { result, intentos } = await correr(lake, { pageSize: 100, maxAttempts: 10 });
    const primeros = intentos.slice(0, 10);
    expect(primeros.filter((id) => id.startsWith('bajo-')).length).toBeGreaterThanOrEqual(4);
    expect(result.media_served).toBe(2);
    expect(result.media_attempts['MED-BAJO']).toBeGreaterThanOrEqual(4);
  });

  it('maxPerMediaPerPass permite ráfagas controladas por medio', async () => {
    const rows = [
      ...lote(10, (i) => ({ noticia_id: `a-${i}`, medio_id: 'MED-A', created_at: new Date(T0 - 10_000 - i).toISOString() })),
      ...lote(10, (i) => ({ noticia_id: `b-${i}`, medio_id: 'MED-B', created_at: new Date(T0 - 20_000 - i).toISOString() })),
    ];
    const { intentos } = await correr(new FakeLake(rows), { pageSize: 20, maxPerMediaPerPass: 2, maxAttempts: 4 });
    expect(intentos.map((id) => id.split('-')[0])).toEqual(['a', 'a', 'b', 'b']);
  });

  it('el número de queries es O(páginas), no O(artículos)', async () => {
    const lake = new FakeLake(lote(400));
    const { result } = await correr(lake, { pageSize: 100 });
    expect(result.attempted).toBe(400);
    expect(lake.paginas).toBeLessThanOrEqual(12);
  });
});

describe('runEnrichDrain — contrato de éxito y fallo', () => {
  it('clean vacío NO es éxito: cuenta como EMPTY_CLEAN_TEXT y queda bloqueado', async () => {
    const lake = new FakeLake(lote(3));
    const { result } = await correr(lake, {
      outcome: () => ({ ok: true, cleanText: '   ', fields: { texto_nota_limpia: '   ' } }),
    });
    expect(result.persisted_success).toBe(0);
    expect(result.empty_clean).toBe(3);
    expect(result.failure_classes.EMPTY_CLEAN_TEXT).toBe(3);
    // No se escribió texto falso ni se marcó como resuelta.
    expect([...lake.rows.values()].every((r) => r.texto_nota_limpia === null)).toBe(true);
    expect([...lake.rows.values()].every((r) => r.enrich_next_attempt_at === null)).toBe(true);
  });

  it('escritura no confirmada NO es éxito: WRITE_FAILED', async () => {
    const lake = new FakeLake(lote(3));
    let intento = 0;
    const { result } = await correr(lake, {
      persist: async (id, fields) => {
        intento += 1;
        // Falla la confirmación del contenido, deja pasar la de metadata.
        if (fields.texto_nota_limpia != null) return false;
        return lake.persist(id, fields);
      },
    });
    expect(intento).toBeGreaterThan(0);
    expect(result.persisted_success).toBe(0);
    expect(result.write_failed).toBe(3);
    expect(result.failure_classes.WRITE_FAILED).toBe(3);
  });

  it('un throw de la escritura tampoco cuenta como éxito', async () => {
    const lake = new FakeLake(lote(2));
    const { result } = await correr(lake, {
      persist: async () => {
        throw new Error('statement timeout');
      },
    });
    expect(result.persisted_success).toBe(0);
    expect(result.write_failed).toBe(2);
  });

  it('un throw de processArticle se captura como UNKNOWN y no rompe la sesión', async () => {
    const lake = new FakeLake(lote(4));
    const { result } = await correr(lake, {
      outcome: () => {
        throw new Error('boom inesperado');
      },
    });
    expect(result.attempted).toBe(4);
    expect(result.failure_classes.UNKNOWN).toBe(4);
    expect(result.termination_reason).toBe('DRAINED');
  });

  it('403 con bloqueo de entorno ⇒ BLOCKED_REVIEW (no vuelve a gastar intentos)', async () => {
    const lake = new FakeLake(lote(3, () => ({ medio_id: 'MED-0029' })));
    const { result } = await correr(lake, {
      outcome: () => falloHttp('HTTP_403'),
      isEnvironmentBlocked: (medioId) => medioId === 'MED-0029',
    });
    expect(result.failed_blocked).toBe(3);
    expect(result.failed_retryable).toBe(0);
    expect([...lake.rows.values()].every((r) => r.enrich_next_attempt_at === null)).toBe(true);
    expect([...lake.rows.values()].every((r) => r.enrich_failure_class === 'HTTP_403')).toBe(true);
  });

  it('404/410 queda bloqueado; 429 y 5xx reprograman', async () => {
    const lake = new FakeLake([
      fila({ noticia_id: 'a', medio_id: 'M1' }),
      fila({ noticia_id: 'b', medio_id: 'M2' }),
      fila({ noticia_id: 'c', medio_id: 'M3' }),
    ]);
    const clases: Record<string, DrainArticleOutcome> = {
      a: falloHttp('HTTP_404_410'),
      b: falloHttp('HTTP_429'),
      c: falloHttp('HTTP_5XX'),
    };
    const { result } = await correr(lake, { outcome: (row) => clases[row.noticia_id]! });
    expect(result.failed_blocked).toBe(1);
    expect(result.failed_retryable).toBe(2);
    expect(lake.rows.get('a')!.enrich_next_attempt_at).toBeNull();
    expect(lake.rows.get('b')!.enrich_next_attempt_at).not.toBeNull();
    expect(lake.rows.get('c')!.enrich_next_attempt_at).not.toBeNull();
  });

  it('los buckets son mutuamente excluyentes y suman attempted', async () => {
    const lake = new FakeLake(lote(10));
    const { result } = await correr(lake, {
      outcome: (_row, n) => (n % 2 === 0 ? exito() : falloHttp('TIMEOUT')),
    });
    const suma =
      result.persisted_success +
      result.failed_retryable +
      result.failed_blocked +
      result.empty_clean +
      result.write_failed;
    expect(suma).toBe(result.attempted);
  });
});

describe('runEnrichDrain — terminaciones', () => {
  it('TIME_BUDGET: no arranca un artículo que invade la reserva final', async () => {
    const lake = new FakeLake(lote(100));
    const { result } = await correr(lake, {
      pageSize: 50,
      articleMs: 1000,
      articleBudgetMs: 2000,
      operationSafetyMs: 1000,
      deadline: new Date(T0 + 20_000),
    });
    expect(result.termination_reason).toBe('TIME_BUDGET');
    expect(result.attempted).toBeLessThan(100);
    expect(result.deferred_time_budget).toBeGreaterThan(0);
    expect(result.remaining_eligible_estimate).not.toBe(0);
    expect(drainPermiteDownstream(result)).toBe(true);
    expect(drainDejoDeuda(result)).toBe(true);
  });

  it('TIME_BUDGET respeta la reserva: para antes del deadline', async () => {
    const lake = new FakeLake(lote(100));
    const { result, reloj } = await correr(lake, {
      pageSize: 50,
      articleMs: 1000,
      articleBudgetMs: 2000,
      operationSafetyMs: 3000,
      deadline: new Date(T0 + 30_000),
    });
    expect(result.termination_reason).toBe('TIME_BUDGET');
    expect(reloj.t).toBeLessThanOrEqual(T0 + 30_000 - 3000);
  });

  it('SAFETY_LIMIT por maxPasses nunca reporta DRAINED', async () => {
    const lake = new FakeLake(lote(1000));
    const { result } = await correr(lake, { pageSize: 10, maxPasses: 3 });
    expect(result.termination_reason).toBe('SAFETY_LIMIT');
    expect(result.passes).toBeLessThanOrEqual(3);
  });

  it('SAFETY_LIMIT por maxAttempts', async () => {
    const lake = new FakeLake(lote(200));
    const { result } = await correr(lake, { pageSize: 50, maxAttempts: 25 });
    expect(result.termination_reason).toBe('SAFETY_LIMIT');
    expect(result.attempted).toBe(25);
  });

  it('NO_PROGRESS si el cursor no avanza (misma página una y otra vez)', async () => {
    const repetida: DrainCandidateRow[] = [
      { ...fila({ noticia_id: 'x1' }) },
      { ...fila({ noticia_id: 'x2' }) },
    ];
    const lake = new FakeLake([]);
    const { result } = await correr(lake, {
      pageSize: 2,
      fetchPage: async () => repetida.map((r) => ({ ...r })),
    });
    expect(result.termination_reason).toBe('NO_PROGRESS');
    expect(drainPermiteDownstream(result)).toBe(false);
  });

  it('INFRA_ERROR si la lectura de página falla', async () => {
    const lake = new FakeLake(lote(10));
    const { result } = await correr(lake, {
      fetchPage: async () => {
        throw new Error('PGRST002 schema cache');
      },
    });
    expect(result.termination_reason).toBe('INFRA_ERROR');
    expect(result.infra_error).toContain('PGRST002');
    expect(drainPermiteDownstream(result)).toBe(false);
  });

  it('INFRA_ERROR tras demasiadas escrituras fallidas consecutivas', async () => {
    const lake = new FakeLake(lote(50));
    const { result } = await correr(lake, {
      persist: async () => false,
      maxConsecutiveWriteErrors: 3,
    });
    expect(result.termination_reason).toBe('INFRA_ERROR');
    expect(result.write_failed).toBe(3);
  });

  it('DRAINED limpio no reporta deuda', async () => {
    const { result } = await correr(new FakeLake(lote(5)));
    expect(result.termination_reason).toBe('DRAINED');
    expect(drainDejoDeuda(result)).toBe(false);
    expect(drainPermiteDownstream(result)).toBe(true);
  });
});

describe('runEnrichDrain — resultado estructurado', () => {
  it('reporta cutoff, ventana, colas, medios y clases', async () => {
    const lake = new FakeLake(lote(6, (i) => ({ medio_id: i % 2 === 0 ? 'MED-A' : 'MED-B' })));
    const { result } = await correr(lake, { freshnessWindowMinutes: 1440 });
    expect(result.cutoff).toBe(new Date(T0).toISOString());
    expect(result.fresh_since).toBe(new Date(T0 - 1440 * 60_000).toISOString());
    expect(result.media_served).toBe(2);
    expect(result.eligible_seen).toBe(6);
    expect(result.attempted).toBe(6);
    expect(Object.keys(result.failure_classes).length).toBeGreaterThan(0);
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('acota el drain a los medios pedidos', async () => {
    const lake = new FakeLake([
      ...lote(3, (i) => ({ noticia_id: `in-${i}`, medio_id: 'MED-0039' })),
      ...lote(3, (i) => ({ noticia_id: `out-${i}`, medio_id: 'MED-9999' })),
    ]);
    const { result, intentos } = await correr(lake, { medioIds: ['MED-0039'] });
    expect(result.attempted).toBe(3);
    expect(intentos.every((id) => id.startsWith('in-'))).toBe(true);
  });
});
