import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildMentionScope, resolveExportClients } from '../src/matching/controlPlaneScope.js';
import {
  parseDetectArgs,
  runDetectMentions,
  scanNoticiasForMentions,
  toKeywordRule,
  type DetectIo,
} from '../src/matching/detectMentionsCore.js';
import { evaluarTitleOnly, reglaAptaTitleOnly } from '../src/matching/titleOnlyLane.js';
import { planMentionQueue } from '../src/matching/mentionQueue.js';
import { parseExportResultsArgs } from '../scripts/export-results-to-sheets.js';
import { planUniqueAppendByKey } from '../src/sheets/uniqueAppendPlan.js';
import type { KeywordActivaRow, MencionInsert, NoticiaScanRow } from '../src/supabase/repositories.js';
import type { MentionQueueTelemetry } from '../src/matching/mentionQueue.js';

const jumex = { cliente_id: 'CLI-0001', activo: true };
const alcohol = { cliente_id: 'CLI-0002', activo: true };
const laboral = { cliente_id: 'CLI-0003', activo: true };
const inactivo = { cliente_id: 'CLI-OLD', activo: false };
const prueba = { cliente_id: 'CLI-PRUEBA', activo: true };

function kw(
  over: Partial<KeywordActivaRow> & Pick<KeywordActivaRow, 'keyword_id' | 'cliente_id' | 'keyword'>,
): KeywordActivaRow {
  return {
    alias_o_variantes: null,
    tipo_keyword: 'exacta',
    regla: null,
    contexto_incluir: null,
    contexto_excluir: null,
    alerta: false,
    ...over,
  };
}

function news(id: string, titulo: string, extra: Partial<NoticiaScanRow> = {}): NoticiaScanRow {
  return {
    noticia_id: id,
    medio_id: 'MED-0001',
    created_at: '2026-09-29T12:00:00.000Z',
    titulo,
    subtitulo: null,
    resumen: null,
    texto_extraido: null,
    texto_nota_limpia: null,
    texto_cuerpo_nota: `Cuerpo ${titulo}`,
    seccion: null,
    medio_nombre: 'Demo',
    ...extra,
  };
}

function emptyTelemetry(n: number): MentionQueueTelemetry {
  return {
    event: 'mention_queue_selection',
    schema_version: 1,
    fresh_lane: true,
    anchor: '2026-09-29T12:00:00.000Z',
    cutoff: '2026-09-27T12:00:00.000Z',
    limit: n,
    fresh_hours: 48,
    fresh_share: 0.7,
    fresh_target: Math.round(n * 0.7),
    backlog_target: n - Math.round(n * 0.7),
    fresh_pool: n,
    backlog_pool: 0,
    selected_total: n,
    fresh_selected: n,
    backlog_selected: 0,
    duplicate_filtered: 0,
    oldest_selected: null,
    newest_selected: null,
  };
}

function ioMock(opts: {
  clientes?: { cliente_id: string; activo: boolean }[];
  keywords?: KeywordActivaRow[];
  noticias?: NoticiaScanRow[];
  insert?: (rows: MencionInsert[]) => Promise<number>;
  mark?: (ids: string[]) => Promise<void>;
}): { io: DetectIo; marked: string[]; inserted: MencionInsert[][] } {
  const marked: string[] = [];
  const inserted: MencionInsert[][] = [];
  return {
    marked,
    inserted,
    io: {
      getClientes: async () => opts.clientes ?? [jumex, alcohol],
      getKeywordsActivas: async () =>
        opts.keywords ?? [
          kw({ keyword_id: 'KEY-0001', cliente_id: 'CLI-0001', keyword: 'Jumex' }),
        ],
      getCola: async () => ({
        rows: opts.noticias ?? [news('n1', 'Jumex lanza campaña')],
        telemetry: emptyTelemetry((opts.noticias ?? [news('n1', 'Jumex')]).length),
      }),
      insertMenciones: async (rows) => {
        inserted.push(rows);
        if (opts.insert) return opts.insert(rows);
        return rows.length;
      },
      markNoticiasProcesadas: async (ids) => {
        marked.push(...ids);
        if (opts.mark) await opts.mark(ids);
      },
    },
  };
}

describe('Mentions Generalization V1', () => {
  it('1. 0 clientes activos elegibles', async () => {
    const { io, marked, inserted } = ioMock({ clientes: [inactivo], keywords: [] });
    const r = await runDetectMentions({ dryRun: false, limit: 10 }, io);
    expect(r.termination_reason).toBe('NO_ACTIVE_CLIENTS');
    expect(r.writes).toBe(0);
    expect(marked).toHaveLength(0);
    expect(inserted).toHaveLength(0);
  });

  it('2. 1 cliente', () => {
    const scope = buildMentionScope({
      clientes: [jumex, inactivo],
      keywords: [{ keyword_id: 'KEY-0001', cliente_id: 'CLI-0001', keyword: 'Jumex', tipo_keyword: 'exacta' }],
    });
    expect(scope.detection_client_ids).toEqual(['CLI-0001']);
    expect(scope.detection_keywords).toHaveLength(1);
  });

  it('3. múltiples clientes', () => {
    const scope = buildMentionScope({
      clientes: [jumex, alcohol, laboral],
      keywords: [
        { keyword_id: 'KEY-0001', cliente_id: 'CLI-0001', keyword: 'Jumex', tipo_keyword: 'exacta' },
        { keyword_id: 'KEY-0003', cliente_id: 'CLI-0002', keyword: 'tequila', tipo_keyword: 'contiene' },
      ],
    });
    expect(scope.detection_client_ids).toEqual(['CLI-0001', 'CLI-0002', 'CLI-0003']);
    expect(scope.detection_keywords.map((k) => k.keyword_id).sort()).toEqual(['KEY-0001', 'KEY-0003']);
  });

  it('4. cliente nuevo del Control Plane sin tocar código', () => {
    const antes = buildMentionScope({
      clientes: [jumex],
      keywords: [{ keyword_id: 'KEY-0001', cliente_id: 'CLI-0001', keyword: 'Jumex', tipo_keyword: 'exacta' }],
    });
    const despues = buildMentionScope({
      clientes: [jumex, prueba],
      keywords: [
        { keyword_id: 'KEY-0001', cliente_id: 'CLI-0001', keyword: 'Jumex', tipo_keyword: 'exacta' },
        { keyword_id: 'KEY-NEW', cliente_id: 'CLI-PRUEBA', keyword: 'Marca Nueva', tipo_keyword: 'exacta' },
      ],
    });
    expect(antes.detection_client_ids).not.toContain('CLI-PRUEBA');
    expect(despues.detection_client_ids).toContain('CLI-PRUEBA');
    expect(despues.detection_keywords.some((k) => k.keyword_id === 'KEY-NEW')).toBe(true);
  });

  it('5. cliente inactivo no procesa', () => {
    const scope = buildMentionScope({
      clientes: [inactivo],
      keywords: [{ keyword_id: 'KEY-X', cliente_id: 'CLI-OLD', keyword: 'viejo', tipo_keyword: 'exacta', activa: true }],
    });
    expect(scope.detection_keywords).toHaveLength(0);
    expect(scope.skipped_inactive_clients).toEqual(['CLI-OLD']);
  });

  it('6. keyword inactiva no procesa', () => {
    const scope = buildMentionScope({
      clientes: [jumex],
      keywords: [
        { keyword_id: 'KEY-OFF', cliente_id: 'CLI-0001', keyword: 'off', tipo_keyword: 'exacta', activa: false },
        { keyword_id: 'KEY-ON', cliente_id: 'CLI-0001', keyword: 'Jumex', tipo_keyword: 'exacta', activa: true },
      ],
    });
    expect(scope.detection_keywords.map((k) => k.keyword_id)).toEqual(['KEY-ON']);
    expect(scope.skipped_inactive_keywords).toBe(1);
  });

  it('7. múltiples keywords sobre misma noticia', () => {
    const reglas = [
      kw({ keyword_id: 'KEY-A', cliente_id: 'CLI-0001', keyword: 'AlphaBrand' }),
      kw({ keyword_id: 'KEY-B', cliente_id: 'CLI-0001', keyword: 'BetaBrand' }),
    ].map(toKeywordRule);
    const hits = scanNoticiasForMentions(
      [news('n1', 'AlphaBrand y BetaBrand en el mercado')],
      reglas,
      new Map(),
    );
    expect(hits.map((h) => h.keyword_id).sort()).toEqual(['KEY-A', 'KEY-B']);
  });

  it('8. múltiples clientes sobre misma noticia', () => {
    const reglas = [
      kw({ keyword_id: 'KEY-A', cliente_id: 'CLI-0001', keyword: 'AlphaBrand' }),
      kw({ keyword_id: 'KEY-C', cliente_id: 'CLI-0002', keyword: 'GammaCo' }),
    ].map(toKeywordRule);
    const hits = scanNoticiasForMentions(
      [news('n1', 'AlphaBrand y GammaCo firman acuerdo')],
      reglas,
      new Map(),
    );
    expect(new Set(hits.map((h) => h.cliente_id))).toEqual(new Set(['CLI-0001', 'CLI-0002']));
  });

  it('9. idempotencia in-batch mismo par noticia+keyword', () => {
    const regla = toKeywordRule(kw({ keyword_id: 'KEY-0001', cliente_id: 'CLI-0001', keyword: 'Jumex' }));
    const hits = scanNoticiasForMentions([news('n1', 'Jumex Jumex')], [regla, regla], new Map());
    expect(hits).toHaveLength(1);
  });

  it('10. no duplicate mentions (clave noticia|keyword)', () => {
    const regla = toKeywordRule(kw({ keyword_id: 'KEY-0001', cliente_id: 'CLI-0001', keyword: 'Jumex' }));
    const hits = scanNoticiasForMentions([news('n1', 'Jumex'), news('n1', 'Jumex')], [regla], new Map());
    expect(hits).toHaveLength(1);
  });

  it('11. fresh news no bloqueada por backlog', () => {
    const fresh = { noticia_id: 'fresh', created_at: '2026-09-29T10:00:00.000Z' };
    const backlog = Array.from({ length: 40 }, (_, i) => ({
      noticia_id: `old-${i}`,
      created_at: `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`,
    }));
    const plan = planMentionQueue({ fresh: [fresh], backlog, limit: 10, freshShare: 0.7 });
    expect(plan.selected.some((r) => r.noticia_id === 'fresh')).toBe(true);
    expect(plan.fresh_selected).toBeGreaterThan(0);
  });

  it('12. backlog sigue progresando', () => {
    const fresh = [{ noticia_id: 'fresh', created_at: '2026-09-29T10:00:00.000Z' }];
    const backlog = [
      { noticia_id: 'old-1', created_at: '2026-01-01T00:00:00.000Z' },
      { noticia_id: 'old-2', created_at: '2026-01-02T00:00:00.000Z' },
    ];
    const plan = planMentionQueue({ fresh, backlog, limit: 10, freshShare: 0.7 });
    expect(plan.backlog_selected).toBeGreaterThan(0);
    expect(plan.selected.some((r) => r.noticia_id.startsWith('old-'))).toBe(true);
  });

  it('13. title-only scoped por tipo, no por ID hardcodeado', () => {
    expect(
      reglaAptaTitleOnly({
        keyword_id: 'KEY-NEW',
        cliente_id: 'CLI-PRUEBA',
        keyword: 'Marca Nueva',
        terminos: ['Marca Nueva'],
        tipo: 'exacta',
        regla: null,
        contextoIncluir: [],
        contextoExcluir: [],
      }),
    ).toBe(true);
    expect(
      reglaAptaTitleOnly({
        keyword_id: 'KEY-0003',
        cliente_id: 'CLI-0002',
        keyword: 'tequila',
        terminos: ['tequila'],
        tipo: 'contiene',
        regla: null,
        contextoIncluir: [],
        contextoExcluir: [],
      }),
    ).toBe(false);
    const hits = evaluarTitleOnly({ noticia_id: 'n1', titulo: 'Marca Nueva abre planta' }, [
      {
        keyword_id: 'KEY-NEW',
        cliente_id: 'CLI-PRUEBA',
        keyword: 'Marca Nueva',
        terminos: ['Marca Nueva'],
        tipo: 'exacta',
        regla: null,
        contextoIncluir: [],
        contextoExcluir: [],
      },
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.mark_processed).toBe(false);
  });

  it('14. export dinámico desde Control Plane', () => {
    const parsed = parseExportResultsArgs(['--mentions-only', '--from-control-plane', '--dry-run']);
    expect(parsed.fromControlPlane).toBe(true);
    expect(parsed.clients).toBeNull();
    expect(
      resolveExportClients({
        overrideClients: null,
        fromControlPlane: true,
        controlPlaneClientIds: ['CLI-0001', 'CLI-PRUEBA'],
      }),
    ).toEqual(['CLI-0001', 'CLI-PRUEBA']);
  });

  it('15. export no duplica', () => {
    const incoming = [{ mencion_id: 'm1' }, { mencion_id: 'm2' }];
    const first = planUniqueAppendByKey([], incoming, 'mencion_id');
    const second = planUniqueAppendByKey(
      first.to_append.map((r) => String(r.mencion_id)),
      incoming,
      'mencion_id',
    );
    expect(second.to_append).toEqual([]);
  });

  it('16. exportado_sheets solo tras persistencia correcta (mismatch no marca)', () => {
    const plan = planUniqueAppendByKey([], [{ mencion_id: 'm1' }], 'mencion_id');
    expect(plan.to_append).toHaveLength(1);
    // El CLI no marca si readback.mismatch; cubierto en unique-append-export.
    expect(plan.selected_ids).toEqual(['m1']);
  });

  it('17. dry-run = 0 writes', async () => {
    const { io, marked, inserted } = ioMock({});
    const r = await runDetectMentions({ dryRun: true, limit: 10, freshLane: true }, io);
    expect(r.writes).toBe(0);
    expect(r.termination_reason).toBe('DRY_RUN');
    expect(marked).toHaveLength(0);
    expect(inserted).toHaveLength(0);
    expect(r.matches).toBeGreaterThan(0);
  });

  it('18. errores parciales no marcan estados falsos', async () => {
    const { io, marked } = ioMock({
      insert: async () => {
        throw new Error('db down');
      },
    });
    const r = await runDetectMentions({ dryRun: false, limit: 10 }, io);
    expect(r.termination_reason).toBe('INSERT_FAILED');
    expect(r.writes).toBe(0);
    expect(marked).toHaveLength(0);
  });

  it('19. --client no marca procesado (legacy canary)', async () => {
    const { io, marked, inserted } = ioMock({});
    const r = await runDetectMentions({ dryRun: false, limit: 10, clientIds: ['CLI-0001'] }, io);
    expect(inserted.length).toBe(1);
    expect(marked).toHaveLength(0);
    expect(r.termination_reason).toBe('OK_CLIENT_FILTER_NO_MARK');
  });

  it('parseDetectArgs default no es apply silencioso', () => {
    expect(parseDetectArgs([]).dryRun).toBe(false);
    expect(parseDetectArgs([]).freshLane).toBeUndefined();
    expect(parseDetectArgs(['--dry-run', '--fresh-lane', '--clients=CLI-0001,CLI-0002']).clientIds).toEqual([
      'CLI-0001',
      'CLI-0002',
    ]);
  });
});

describe('LIVE workflow generalized', () => {
  const wf = readFileSync(join(process.cwd(), '.github/workflows/live-mentions-fresh.yml'), 'utf8');
  it('export usa Control Plane, no IDs hardcodeados', () => {
    expect(wf).toContain('--from-control-plane');
    expect(wf).not.toMatch(/--clients=CLI-MERY-TEST,CLI-0001,CLI-0002/);
    expect(wf).not.toMatch(/^\s*schedule:/m);
  });
});
