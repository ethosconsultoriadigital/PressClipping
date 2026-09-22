/**
 * Mention Lab V1 — backfill exhaustivo (sin cap 15/300, paginado, LAB-only).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  MAX_TERMINOS_BUSQUEDA_CLIENTE,
  MAX_CANDIDATOS_CLIENTE_TOTAL,
  CANDIDATOS_POR_TERMINO_CLIENTE,
} from '../scripts/client-live-sheet-export.js';
import {
  LAB_CLIENT_IDS,
  LAB_TABS,
  LAB_FORBIDDEN_TABS,
  extraerTerminosBusquedaLab,
  emptyCandidateIndex,
  ingestCandidates,
  toKeywordRule,
  consolidateClient,
  completenessOf,
  filterNewRows,
  buildDedupeKey,
  freezeWindow,
  assertWriteAllowed,
  assertLabTabAllowed,
  rowTodas,
  matchAllRules,
  type LabKeywordRow,
  type LabNewsRow,
} from '../src/newsLake/mentionLabCore.js';
import { retrieveCandidatesPaged } from '../src/newsLake/mentionLabRun.js';
import {
  writeMentionLabSheets,
  isForbiddenTab,
  allowedLabTabs,
  type LabSheetPort,
  type LabOutRow,
} from '../src/newsLake/mentionLabSheets.js';
import { parseLabArgs } from '../scripts/news-lake-mention-backfill-lab.js';

function kw(over: Partial<LabKeywordRow> & Pick<LabKeywordRow, 'keyword_id' | 'keyword'>): LabKeywordRow {
  return {
    cliente_id: 'CLI-0001',
    alias_o_variantes: null,
    tipo_keyword: 'frase_exacta',
    regla: null,
    contexto_incluir: null,
    contexto_excluir: null,
    alerta: true,
    prioridad: 'Alta',
    activa: true,
    ...over,
  };
}

function news(over: Partial<LabNewsRow> & Pick<LabNewsRow, 'noticia_id'>): LabNewsRow {
  return {
    medio_id: 'MED-0001',
    medio_nombre: 'El Informador',
    grupo_medio: null,
    region: 'Occidente',
    categoria: 'noticias',
    pais: 'México',
    estado: 'Jalisco',
    fecha_publicacion: '2026-09-01T12:00:00.000Z',
    fecha_captura: '2026-09-01T13:00:00.000Z',
    created_at: '2026-09-01T13:00:00.000Z',
    titulo: 'Titulo',
    subtitulo: null,
    resumen: null,
    autor: null,
    seccion: null,
    url_original: `https://example.com/${over.noticia_id}`,
    url_canonica: null,
    fuente_extraccion: 'html',
    calidad_extraccion: 'alta',
    texto_limpio_chars: 100,
    cuerpo_nota_chars: 100,
    tipo_nota: 'nota',
    texto_extraido: null,
    texto_nota_limpia: null,
    texto_cuerpo_nota: null,
    ...over,
  };
}

const MERY: LabKeywordRow[] = [
  kw({ keyword_id: 'KEY-0040', cliente_id: 'CLI-MERY-TEST', keyword: 'Merilyn Gómez Pozos', alias_o_variantes: 'Merilyn Gomez Pozos' }),
  kw({ keyword_id: 'KEY-0041', cliente_id: 'CLI-MERY-TEST', keyword: 'Mery Pozos' }),
  kw({ keyword_id: 'KEY-0042', cliente_id: 'CLI-MERY-TEST', keyword: 'Mery Gómez Pozos', alias_o_variantes: 'Mery Gomez Pozos' }),
  kw({ keyword_id: 'KEY-0043', cliente_id: 'CLI-MERY-TEST', keyword: 'Merilyn Gomez Pozos' }),
  kw({ keyword_id: 'KEY-0044', cliente_id: 'CLI-MERY-TEST', keyword: 'Mery Gomez Pozos' }),
  kw({ keyword_id: 'KEY-0045', cliente_id: 'CLI-MERY-TEST', keyword: 'diputada Mery Pozos', alias_o_variantes: 'Mery Pozos diputada' }),
  kw({ keyword_id: 'KEY-0046', cliente_id: 'CLI-MERY-TEST', keyword: 'diputada Merilyn Gómez', alias_o_variantes: 'diputada Merilyn Gomez' }),
  kw({ keyword_id: 'KEY-0047', cliente_id: 'CLI-MERY-TEST', keyword: 'diputada federal Merilyn Gómez Pozos' }),
  kw({
    keyword_id: 'KEY-0048', cliente_id: 'CLI-MERY-TEST', keyword: 'Merilyn Gómez', alias_o_variantes: 'Merilyn Gomez',
    tipo_keyword: 'exacta_contextual', alerta: false,
    contexto_incluir: 'diputada|Congreso|Morena|Jalisco',
    contexto_excluir: 'actriz|cantante|entretenimiento',
  }),
  kw({
    keyword_id: 'KEY-0049', cliente_id: 'CLI-MERY-TEST', keyword: 'Mery Gómez',
    tipo_keyword: 'exacta_contextual', alerta: false,
    contexto_incluir: 'diputada|Congreso|Morena',
    contexto_excluir: 'actriz|cantante',
  }),
  kw({
    keyword_id: 'KEY-0050', cliente_id: 'CLI-MERY-TEST', keyword: 'Gómez Pozos', alias_o_variantes: 'Gomez Pozos',
    tipo_keyword: 'exacta_contextual', alerta: false,
    contexto_incluir: 'diputada|Congreso|Morena',
    contexto_excluir: 'Pemex|pozos petroleros|agua potable',
  }),
  kw({
    keyword_id: 'KEY-0051', cliente_id: 'CLI-MERY-TEST', keyword: 'Gomez Pozos',
    tipo_keyword: 'exacta_contextual', alerta: false,
    contexto_incluir: 'diputada|Congreso|Morena',
    contexto_excluir: 'Pemex|pozos petroleros',
  }),
];

const JUMEX: LabKeywordRow[] = [
  kw({ keyword_id: 'KEY-0001', keyword: 'Jumex', alias_o_variantes: 'Grupo Jumex|Jugos Jumex', tipo_keyword: 'contiene' }),
  kw({ keyword_id: 'KEY-0002', keyword: 'Museo Jumex', alias_o_variantes: 'Fundación Jumex|Fundacion Jumex' }),
  kw({ keyword_id: 'KEY-0009', keyword: 'bebidas azucaradas', tipo_keyword: 'contiene' }),
  kw({ keyword_id: 'KEY-0065', keyword: 'IEPS bebidas azucaradas', alias_o_variantes: 'IEPS refrescos' }),
  kw({
    keyword_id: 'KEY-0066', keyword: 'etiquetado frontal', tipo_keyword: 'exacta_contextual',
    contexto_incluir: 'Jumex|jugos|bebidas azucaradas',
  }),
  kw({
    keyword_id: 'KEY-0067', keyword: 'retiro de producto', tipo_keyword: 'exacta_contextual',
    contexto_incluir: 'Jumex|jugos',
  }),
  kw({
    keyword_id: 'KEY-0068', keyword: 'Profeco', tipo_keyword: 'exacta_contextual',
    contexto_incluir: 'Jumex|jugos|bebidas azucaradas',
    contexto_excluir: 'gasolina',
  }),
];

const PATRON_CTX =
  'tequila|Casa Patrón|Atotonilco|Bacardí|agave|destilería|CRT|añejo';
const PATRON_EXC =
  'patrón de conducta|jefe|empleador|santo patrón|patrón de diseño';

const PATRON: LabKeywordRow[] = [
  kw({ keyword_id: 'KEY-0060', cliente_id: 'CLI-0002', keyword: 'Tequila Patrón', alias_o_variantes: 'Tequila Patron' }),
  kw({ keyword_id: 'KEY-0061', cliente_id: 'CLI-0002', keyword: 'Casa Patrón', alias_o_variantes: 'Casa Patron' }),
  kw({
    keyword_id: 'KEY-0069', cliente_id: 'CLI-0002', keyword: 'Patrón', alias_o_variantes: 'Patron',
    tipo_keyword: 'exacta_contextual',
    contexto_incluir: PATRON_CTX,
    contexto_excluir: PATRON_EXC,
  }),
];

function memoryPort(seed: Record<string, LabOutRow[]> = {}): LabSheetPort & { store: Map<string, LabOutRow[]>; appends: string[] } {
  const store = new Map<string, LabOutRow[]>(Object.entries(seed).map(([k, v]) => [k, [...v]]));
  const appends: string[] = [];
  return {
    store,
    appends,
    async ensure(title) {
      assertLabTabAllowed(title);
      if (!store.has(title)) store.set(title, []);
    },
    async readKeys(title) {
      return new Set(
        (store.get(title) ?? [])
          .map((r) => String(r.dedupe_key ?? '').trim())
          .filter(Boolean),
      );
    },
    async append(title, rows) {
      assertLabTabAllowed(title);
      appends.push(title);
      const arr = store.get(title) ?? [];
      arr.push(...rows);
      store.set(title, arr);
      return rows.length;
    },
  };
}

function srcFiles(): string {
  const root = resolve(process.cwd());
  return [
    'src/newsLake/mentionLabCore.ts',
    'src/newsLake/mentionLabRun.ts',
    'src/newsLake/mentionLabSheets.ts',
    'scripts/news-lake-mention-backfill-lab.ts',
    '.github/workflows/news-lake-mentions-lab.yml',
  ].map((p) => readFileSync(resolve(root, p), 'utf8')).join('\n');
}

describe('Mention Lab — caps del preview no aplican', () => {
  it('client-live conserva topes de preview 15/50/300', () => {
    expect(MAX_TERMINOS_BUSQUEDA_CLIENTE).toBe(15);
    expect(CANDIDATOS_POR_TERMINO_CLIENTE).toBe(50);
    expect(MAX_CANDIDATOS_CLIENTE_TOTAL).toBe(300);
  });

  it('usa TODAS las keywords activas, sin cap 15', () => {
    const many = Array.from({ length: 16 }, (_, i) =>
      kw({ keyword_id: `KEY-T${String(i).padStart(2, '0')}`, keyword: `Marca Unica ${i} Labs` }),
    );
    const terms = extraerTerminosBusquedaLab(many);
    expect(terms.length).toBeGreaterThan(15);
    expect(terms.length).toBe(16);
  });

  it('Mery 12 activas + aliases; ignora inactivas; no usa "Mery" sola', () => {
    const withInactive = [
      ...MERY,
      kw({ keyword_id: 'KEY-DEAD', cliente_id: 'CLI-MERY-TEST', keyword: 'Mery', activa: false }),
    ];
    const terms = extraerTerminosBusquedaLab(withInactive);
    expect(MERY).toHaveLength(12);
    const used = new Set(terms.flatMap((t) => t.keyword_ids));
    for (const k of MERY) expect(used.has(k.keyword_id)).toBe(true);
    expect(terms.some((t) => t.keyword_ids.includes('KEY-DEAD'))).toBe(false);
    expect(terms.some((t) => t.term.toLowerCase() === 'mery')).toBe(false);
  });
});

describe('Mention Lab — paginación y dedupe de candidatos', () => {
  it('pagina más de 300 candidatos únicos', async () => {
    const all = Array.from({ length: 450 }, (_, i) =>
      news({
        noticia_id: `N${String(i).padStart(4, '0')}`,
        titulo: 'Grupo Jumex reporta resultados',
      }),
    );
    const retrieved = await retrieveCandidatesPaged(JUMEX, freezeWindow('2026-09-22T12:00:00.000Z', 30), {
      pageSize: 200,
      safetyLimit: 50_000,
      fetchPage: async (q) => {
        if (q.modo !== 'fts') return [];
        const start = q.afterId ? all.findIndex((n) => n.noticia_id === q.afterId) + 1 : 0;
        if (start < 0) return [];
        return all.slice(start, start + q.pageSize);
      },
    });
    expect(retrieved.index.byId.size).toBeGreaterThan(300);
    expect(retrieved.index.byId.size).toBe(450);
    expect(retrieved.safetyHit).toBe(false);
    expect(retrieved.pages).toBeGreaterThan(2);
  });

  it('dedupe por noticia_id y por URL normalizada', () => {
    const index = emptyCandidateIndex();
    const a = news({ noticia_id: 'N1', url_original: 'https://X.com/nota/' });
    const dupId = news({ noticia_id: 'N1', url_original: 'https://other.com/1' });
    const dupUrl = news({ noticia_id: 'N2', url_original: 'https://x.com/nota' });
    const r1 = ingestCandidates(index, [a], 'Jumex', 1000);
    const r2 = ingestCandidates(index, [dupId, dupUrl], 'Jumex', 1000);
    expect(r1.added).toBe(1);
    expect(r2.deduped).toBe(2);
    expect(index.byId.size).toBe(1);
  });
});

describe('Mention Lab — matching y consolidación', () => {
  it('consolida varias keywords de la misma noticia en UNA fila', () => {
    const index = emptyCandidateIndex();
    ingestCandidates(
      index,
      [news({
        noticia_id: 'NJ1',
        titulo: 'Grupo Jumex y IEPS bebidas azucaradas: nueva tasa',
        texto_cuerpo_nota: 'Jumex enfrenta el IEPS bebidas azucaradas junto con el etiquetado frontal de jugos.',
      })],
      'Jumex',
      1000,
    );
    const mentions = consolidateClient('CLI-0001', 'Jumex', index, JUMEX.map(toKeywordRule));
    expect(mentions).toHaveLength(1);
    expect(mentions[0]!.matches.length).toBeGreaterThan(1);
    expect(mentions[0]!.matches.map((m) => m.keyword_id)).toEqual(
      expect.arrayContaining(['KEY-0001', 'KEY-0065']),
    );
    const row = rowTodas(mentions[0]!, 'LAB-1', '2026-09-22T00:00:00.000Z');
    expect(row.dedupe_key).toBe('CLI-0001//NJ1');
    expect(Number(row.match_count)).toBe(mentions[0]!.matches.length);
  });

  it('Museo Jumex queda categorizado EXCLUIR pero NO se elimina', () => {
    const index = emptyCandidateIndex();
    ingestCandidates(
      index,
      [news({ noticia_id: 'NMU', titulo: 'Museo Jumex inaugura retrospectiva', texto_cuerpo_nota: 'La Fundación Jumex presenta obra.' })],
      'Museo Jumex',
      1000,
    );
    const mentions = consolidateClient('CLI-0001', 'Jumex', index, [toKeywordRule(JUMEX.find((k) => k.keyword_id === 'KEY-0002')!)]);
    expect(mentions).toHaveLength(1);
    expect(mentions[0]!.editorial_category).toBe('EXCLUIR');
    expect(mentions[0]!.review_status).toBe('review');
    expect(mentions[0]!.matches.some((m) => m.keyword_id === 'KEY-0002')).toBe(true);
  });

  it('contexto_incluir: Merilyn Gómez sin política no matchea', () => {
    const row = news({ noticia_id: 'MX', titulo: 'Merilyn Gómez ganó un premio cultural' });
    const hits = matchAllRules(row, [toKeywordRule(MERY.find((k) => k.keyword_id === 'KEY-0048')!)], 'Merilyn Gómez');
    expect(hits).toHaveLength(0);
  });

  it('contexto_excluir: Gómez Pozos + Pemex no matchea', () => {
    const row = news({
      noticia_id: 'MX2',
      titulo: 'Gómez Pozos y Pemex anuncian pozos petroleros',
      texto_cuerpo_nota: 'La diputada no aparece; es infraestructura de Pemex.',
    });
    const hits = matchAllRules(row, [toKeywordRule(MERY.find((k) => k.keyword_id === 'KEY-0050')!)], 'Gómez Pozos');
    expect(hits).toHaveLength(0);
  });

  it('homónimo Mery sola no produce mención', () => {
    const index = emptyCandidateIndex();
    ingestCandidates(
      index,
      [news({ noticia_id: 'MH', titulo: 'Mery lanzó nuevo álbum de entretenimiento' })],
      'Mery',
      1000,
    );
    const mentions = consolidateClient('CLI-MERY-TEST', 'Mery Pozos', index, MERY.map(toKeywordRule));
    expect(mentions).toHaveLength(0);
  });

  it('Patrón palabra común se bloquea según exacta_contextual', () => {
    const index = emptyCandidateIndex();
    ingestCandidates(
      index,
      [news({ noticia_id: 'PP', titulo: 'Analizan el patrón de conducta de los votantes y el jefe empleador' })],
      'Patrón',
      1000,
    );
    const mentions = consolidateClient('CLI-0002', 'Bebidas alcoholicas', index, PATRON.map(toKeywordRule));
    expect(mentions).toHaveLength(0);
  });

  it('Patrón + tequila sí matchea KEY-0069', () => {
    const index = emptyCandidateIndex();
    ingestCandidates(
      index,
      [news({ noticia_id: 'PT', titulo: 'Patrón lanza tequila añejo en su destilería de Atotonilco' })],
      'Patrón',
      1000,
    );
    const mentions = consolidateClient('CLI-0002', 'Bebidas alcoholicas', index, PATRON.map(toKeywordRule));
    expect(mentions).toHaveLength(1);
    expect(mentions[0]!.matches.some((m) => m.keyword_id === 'KEY-0069')).toBe(true);
  });
});

describe('Mention Lab — Sheets append-only + dry-run', () => {
  const cutoff = '2026-09-22T12:00:00.000Z';

  function bundleFromMentions(
    clientId: 'CLI-0001' | 'CLI-0002' | 'CLI-MERY-TEST',
    name: string,
    keywords: LabKeywordRow[],
    n: LabNewsRow,
  ) {
    const index = emptyCandidateIndex();
    ingestCandidates(index, [n], keywords[0]!.keyword, 1000);
    const mentions = consolidateClient(clientId, name, index, keywords.map(toKeywordRule));
    const metrics = completenessOf(
      clientId, name, keywords, extraerTerminosBusquedaLab(keywords),
      1, 1, index, mentions, false, null,
    );
    return { mentions, metrics, keywords };
  }

  it('dry-run no escribe nada', async () => {
    const port = memoryPort();
    const b = bundleFromMentions('CLI-0001', 'Jumex', JUMEX, news({
      noticia_id: 'W1', titulo: 'Grupo Jumex anuncia planta',
    }));
    const report = await writeMentionLabSheets([b], {
      labRunId: 'LAB-DRY',
      fechaExport: cutoff,
      cutoff,
      windowDays: 30,
      dryRun: true,
      durationMs: 10,
      port,
    });
    expect(report.write_attempted).toBe(false);
    expect(report.written_todas).toBe(0);
    expect(port.appends).toHaveLength(0);
  });

  it('write solo tabs LAB y dedupe por client_id//noticia_id', async () => {
    const existingKey = buildDedupeKey('CLI-0001', 'W1');
    const port = memoryPort({
      [LAB_TABS.todas]: [{ dedupe_key: existingKey }],
    });
    const b = bundleFromMentions('CLI-0001', 'Jumex', JUMEX, news({
      noticia_id: 'W1', titulo: 'Grupo Jumex anuncia planta',
    }));
    const b2 = bundleFromMentions('CLI-0001', 'Jumex', JUMEX, news({
      noticia_id: 'W2', titulo: 'Grupo Jumex inaugura expansión',
    }));
    const report = await writeMentionLabSheets([b, b2], {
      labRunId: 'LAB-W',
      fechaExport: cutoff,
      cutoff,
      windowDays: 30,
      dryRun: false,
      durationMs: 10,
      port,
    });
    expect(report.write_attempted).toBe(true);
    expect(report.skipped_dedupe).toBeGreaterThanOrEqual(1);
    expect(report.written_todas).toBeGreaterThanOrEqual(1);
    expect(report.mismatch).toBe(false);
    expect(port.appends.every((t) => allowedLabTabs().includes(t))).toBe(true);
    expect(port.appends.some((t) => isForbiddenTab(t))).toBe(false);
  });

  it('safety-limit → complete=false y write prohibido', async () => {
    const index = emptyCandidateIndex();
    const rows = Array.from({ length: 20 }, (_, i) => news({ noticia_id: `S${i}`, titulo: 'Jumex' }));
    const ingested = ingestCandidates(index, rows, 'Jumex', 5);
    expect(ingested.safetyHit).toBe(true);
    const mentions = consolidateClient('CLI-0001', 'Jumex', index, JUMEX.map(toKeywordRule));
    const metrics = completenessOf(
      'CLI-0001', 'Jumex', JUMEX, extraerTerminosBusquedaLab(JUMEX),
      1, 20, index, mentions, true, null,
    );
    expect(metrics.complete).toBe(false);
    expect(assertWriteAllowed([metrics]).ok).toBe(false);
    const port = memoryPort();
    const report = await writeMentionLabSheets(
      [{ mentions, metrics, keywords: JUMEX }],
      {
        labRunId: 'LAB-SAFE',
        fechaExport: cutoff,
        cutoff,
        windowDays: 30,
        dryRun: false,
        durationMs: 1,
        port,
      },
    );
    expect(report.write_attempted).toBe(false);
    expect(report.write_blocked_reason).toMatch(/complete=false|safety_limit/);
    expect(port.appends).toHaveLength(0);
  });

  it('tabs prohibidas lanzan', () => {
    expect(() => assertLabTabAllowed('02_Menciones')).toThrow(/prohibida/);
    expect(() => assertLabTabAllowed('01_Noticias_Raw')).toThrow(/prohibida/);
    for (const t of LAB_FORBIDDEN_TABS) {
      expect(isForbiddenTab(t)).toBe(true);
    }
  });
});

describe('Mention Lab — freeze, args, clientes fijos, no writes de producción', () => {
  it('freezeWindow es determinista', () => {
    const w = freezeWindow('2026-09-22T12:00:00.000Z', 30);
    expect(w.cutoff).toBe('2026-09-22T12:00:00.000Z');
    expect(Date.parse(w.windowStart)).toBe(Date.parse(w.cutoff) - 30 * 86400000);
  });

  it('parseLabArgs default dry-run true y window 30', () => {
    expect(parseLabArgs([]).dryRun).toBe(true);
    expect(parseLabArgs(['--dry-run=false', '--window-days=30']).dryRun).toBe(false);
    expect(parseLabArgs(['--window-days=30']).windowDays).toBe(30);
  });

  it('clientes V1 fijos', () => {
    expect([...LAB_CLIENT_IDS]).toEqual(['CLI-MERY-TEST', 'CLI-0001', 'CLI-0002']);
  });

  it('el código del Lab no inserta menciones ni marca procesado ni alerta', () => {
    const src = srcFiles();
    expect(src).not.toMatch(/insertMenciones\s*\(/);
    expect(src).not.toMatch(/markNoticiasProcesadas\s*\(/);
    expect(src).not.toMatch(/send-internal-alerts/);
    expect(src).not.toMatch(/TWILIO_/);
    expect(src).not.toMatch(/SMTP_/);
  });

  it('workflow es solo dispatch con concurrency propia', () => {
    const yml = readFileSync(resolve(process.cwd(), '.github/workflows/news-lake-mentions-lab.yml'), 'utf8');
    expect(yml).toMatch(/workflow_dispatch/);
    expect(yml).not.toMatch(/^\s+schedule:/m);
    expect(yml).toMatch(/group: news-lake-mentions-lab/);
    expect(yml).not.toMatch(/group: live-comparison-shadow/);
    expect(yml).toMatch(/timeout-minutes: 45/);
  });
});
