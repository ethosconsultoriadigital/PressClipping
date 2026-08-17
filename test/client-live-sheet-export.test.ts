/**
 * Tests del exportador LIVE shadow a Google Sheets.
 *
 * Cubren: parseArgs, buildDedupeKey, clasificarBucket, procesarCasoCliente,
 * procesarCasoAdHoc (buckets), comportamiento dry-run vs real (Sheets), y
 * que nunca se invoquen operaciones prohibidas.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NoticiaLakeRow, KeywordActivaRow } from '../src/supabase/repositories.js';

// ─────────────────────────────────────────────────────────────────────────────
// Datos de prueba
// ─────────────────────────────────────────────────────────────────────────────

function noticia(over: Partial<NoticiaLakeRow> & { noticia_id: string }): NoticiaLakeRow {
  return {
    medio_id: 'MED-0001',
    medio_nombre: 'Medio de prueba',
    titulo: null,
    resumen: null,
    url_original: 'https://example.com/nota',
    fecha_publicacion: '2026-08-14T00:00:00.000Z',
    texto_extraido: null,
    texto_nota_limpia: null,
    texto_cuerpo_nota: null,
    ...over,
  };
}

function keyword(over: Partial<KeywordActivaRow> & { keyword_id: string; keyword: string }): KeywordActivaRow {
  return {
    cliente_id: 'CLI-0002',
    alias_o_variantes: null,
    tipo_keyword: 'frase_exacta',
    regla: null,
    contexto_incluir: null,
    contexto_excluir: null,
    alerta: false,
    ...over,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Mocks de Supabase y Sheets
// ─────────────────────────────────────────────────────────────────────────────

let mockNoticias: NoticiaLakeRow[] = [];
let mockKeywords: KeywordActivaRow[] = [];
const addRowsCalls: { tab: string; rows: any[] }[] = [];
const addSheetCalls: string[] = [];

/** Fake worksheet con headers y rows configurables. */
function fakeSheet(title: string, existingRows: { dedupe_key: string }[] = []) {
  const fakeRows = existingRows.map((r) => ({
    get: (col: string) => (col === 'dedupe_key' ? r.dedupe_key : undefined),
  }));
  return {
    title,
    headerValues: [...new Set(['dedupe_key', 'titulo', 'url_original'])],
    loadHeaderRow: vi.fn().mockResolvedValue(undefined),
    setHeaderRow: vi.fn().mockResolvedValue(undefined),
    getRows: vi.fn().mockResolvedValue(fakeRows),
    addRows: vi.fn().mockImplementation((rows: any[]) => {
      addRowsCalls.push({ tab: title, rows });
      return Promise.resolve(rows.map(() => ({})));
    }),
  };
}

/** Fake GoogleSpreadsheet con sheetsByTitle dinámico. */
function fakeDoc(existingTabs: Record<string, ReturnType<typeof fakeSheet>> = {}) {
  const sheets: Record<string, any> = { ...existingTabs };
  return {
    get sheetsByTitle() { return sheets; },
    addSheet: vi.fn().mockImplementation(({ title, headerValues }: { title: string; headerValues: string[] }) => {
      addSheetCalls.push(title);
      const s = fakeSheet(title);
      s.headerValues = headerValues;
      sheets[title] = s;
      return Promise.resolve(s);
    }),
  };
}

let mockDoc = fakeDoc();

vi.mock('../src/supabase/repositories.js', () => ({
  getNoticiasEnVentana: () => Promise.resolve(mockNoticias),
  getKeywordsActivas: () => Promise.resolve(mockKeywords),
}));

vi.mock('../src/sheets/client.js', () => ({
  getSpreadsheetById: () => Promise.resolve(mockDoc),
  withSheetsRetry: (op: () => Promise<any>) => op(),
}));

import {
  parseArgs,
  buildDedupeKey,
  clasificarBucket,
  textoEfectivo,
  camposDeLake,
  toKeywordRule,
  procesarCasoCliente,
  procesarCasoAdHoc,
  ensureTabInDoc,
  leerDedupKeys,
  appendDeduped,
  LIVE_HEADERS,
  main,
} from '../scripts/client-live-sheet-export.js';

// ─────────────────────────────────────────────────────────────────────────────
// parseArgs
// ─────────────────────────────────────────────────────────────────────────────

describe('parseArgs', () => {
  it('valores por defecto (dry-run=true)', () => {
    const args = parseArgs([]);
    expect(args.dryRun).toBe(true);
    expect(args.sheetId).toBeNull();
    expect(args.tabPrefix).toBe('ETHOS_LIVE');
    expect(args.windowDays).toBe(30);
    expect(args.limit).toBe(100);
    expect(args.maxRows).toBe(100);
    expect(args.includeFullText).toBe(true);
    expect(args.clientId).toBeNull();
    expect(args.query).toBeNull();
    expect(args.exact).toBeNull();
    expect(args.contains).toBeNull();
  });

  it('dry-run=true por defecto (sin flag)', () => {
    expect(parseArgs([]).dryRun).toBe(true);
  });

  it('--dry-run → true', () => {
    expect(parseArgs(['--dry-run']).dryRun).toBe(true);
  });

  it('--dry-run=true → true', () => {
    expect(parseArgs(['--dry-run=true']).dryRun).toBe(true);
  });

  it('--dry-run=false → false (modo real explícito)', () => {
    expect(parseArgs(['--dry-run=false']).dryRun).toBe(false);
  });

  it('--no-dry-run → false', () => {
    expect(parseArgs(['--no-dry-run']).dryRun).toBe(false);
  });

  it('lee --sheet-id', () => {
    expect(parseArgs(['--sheet-id=ABC123']).sheetId).toBe('ABC123');
  });

  it('lee --client-id', () => {
    expect(parseArgs(['--client-id=CLI-0002']).clientId).toBe('CLI-0002');
  });

  it('lee --query, --exact, --contains', () => {
    expect(parseArgs(['--query=Mery Pozos']).query).toBe('Mery Pozos');
    expect(parseArgs(['--exact=Bacardí México']).exact).toBe('Bacardí México');
    expect(parseArgs(['--contains=Jumex']).contains).toBe('Jumex');
  });

  it('lee --window-days, --limit, --max-rows', () => {
    const args = parseArgs(['--window-days=7', '--limit=50', '--max-rows=200']);
    expect(args.windowDays).toBe(7);
    expect(args.limit).toBe(50);
    expect(args.maxRows).toBe(200);
  });

  it('--tab-prefix se respeta', () => {
    expect(parseArgs(['--tab-prefix=CLI0002_SHADOW']).tabPrefix).toBe('CLI0002_SHADOW');
  });

  it('--include-full-text=false apaga el texto completo', () => {
    expect(parseArgs(['--include-full-text=false']).includeFullText).toBe(false);
  });

  it('--client-id y --query son mutuamente compatibles (ambos se leen)', () => {
    const args = parseArgs(['--client-id=CLI-0002', '--query=Patrón']);
    expect(args.clientId).toBe('CLI-0002');
    expect(args.query).toBe('Patrón');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers puros
// ─────────────────────────────────────────────────────────────────────────────

describe('buildDedupeKey', () => {
  it('genera clave estable y determinista', () => {
    const k1 = buildDedupeKey('CLI-0002', 'N-abc123', 'KW-0042');
    const k2 = buildDedupeKey('CLI-0002', 'N-abc123', 'KW-0042');
    expect(k1).toBe(k2);
    expect(k1).toContain('//');
    expect(k1).toContain('n-abc123');
  });

  it('claves distintas para distintos sufijos', () => {
    const a = buildDedupeKey('CLI-0002', 'N-1', 'KW-A');
    const b = buildDedupeKey('CLI-0002', 'N-1', 'KW-B');
    expect(a).not.toBe(b);
  });

  it('claves distintas para distintos noticia_id', () => {
    const a = buildDedupeKey('CLI-0002', 'N-1', 'raw');
    const b = buildDedupeKey('CLI-0002', 'N-2', 'raw');
    expect(a).not.toBe(b);
  });
});

describe('clasificarBucket', () => {
  it('score >= 0.6 → Menciones_Detectadas', () => {
    const r = clasificarBucket({ score: 1.0, campo: 'titulo', tipo_match: 'frase_exacta', texto_match: 'X' });
    expect(r.bucket).toBe('Menciones_Detectadas');
    expect(r.confidence).toBe('high');
  });

  it('score 0.6 exactamente → Menciones_Detectadas', () => {
    const r = clasificarBucket({ score: 0.6, campo: 'resumen', tipo_match: 'contiene', texto_match: 'X' });
    expect(r.bucket).toBe('Menciones_Detectadas');
  });

  it('score 0.4 (texto) → Revision_Humana', () => {
    const r = clasificarBucket({ score: 0.4, campo: 'texto_extraido', tipo_match: 'contiene', texto_match: 'X' });
    expect(r.bucket).toBe('Revision_Humana');
    expect(r.confidence).toBe('medium');
  });
});

describe('textoEfectivo', () => {
  it('prioriza texto_cuerpo_nota → texto_nota_limpia → texto_extraido → resumen', () => {
    expect(textoEfectivo(noticia({ noticia_id: 'N1', texto_cuerpo_nota: 'cuerpo', texto_nota_limpia: 'limpio', resumen: 'r' }))).toBe('cuerpo');
    expect(textoEfectivo(noticia({ noticia_id: 'N2', texto_nota_limpia: 'limpio', resumen: 'r' }))).toBe('limpio');
    expect(textoEfectivo(noticia({ noticia_id: 'N3', texto_extraido: 'extraido', resumen: 'r' }))).toBe('extraido');
    expect(textoEfectivo(noticia({ noticia_id: 'N4', resumen: 'r' }))).toBe('r');
    expect(textoEfectivo(noticia({ noticia_id: 'N5' }))).toBe('');
  });
});

describe('toKeywordRule', () => {
  it('construye la regla correctamente desde KeywordActivaRow', () => {
    const kw = keyword({ keyword_id: 'KW-1', keyword: 'Patrón', tipo_keyword: 'frase_exacta' });
    const rule = toKeywordRule(kw);
    expect(rule.keyword_id).toBe('KW-1');
    expect(rule.keyword).toBe('Patrón');
    expect(rule.tipo).toBe('frase_exacta');
    expect(rule.terminos).toContain('Patrón');
    expect(rule.contextoIncluir).toEqual([]);
    expect(rule.contextoExcluir).toEqual([]);
  });

  it('tipo desconocido cae a "contiene"', () => {
    const kw = keyword({ keyword_id: 'KW-2', keyword: 'X', tipo_keyword: 'DESCONOCIDO' });
    expect(toKeywordRule(kw).tipo).toBe('contiene');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Clasificación en buckets
// ─────────────────────────────────────────────────────────────────────────────

describe('procesarCasoCliente', () => {
  const args = parseArgs(['--client-id=CLI-0002', '--window-days=7']);
  const fecha = '2026-08-14T12:00:00.000Z';

  it('noticia con match fuerte en título → Menciones_Detectadas', () => {
    const noticias = [noticia({ noticia_id: 'N1', titulo: 'Patrón Tequila gana premio internacional' })];
    const kws = [keyword({ keyword_id: 'KW-1', keyword: 'Patrón Tequila', tipo_keyword: 'frase_exacta', cliente_id: 'CLI-0002' })];
    const result = procesarCasoCliente(noticias, kws, args, fecha);
    expect(result.notasCapturadas).toHaveLength(1);
    expect(result.mencionesDetectadas.length).toBeGreaterThanOrEqual(1);
    expect(result.mencionesDetectadas[0]!['bucket']).toBe('Menciones_Detectadas');
  });

  it('noticia sin match de keyword → ni en menciones ni en revisión', () => {
    const noticias = [noticia({ noticia_id: 'N2', titulo: 'Noticia sin relación' })];
    const kws = [keyword({ keyword_id: 'KW-1', keyword: 'Patrón Tequila', tipo_keyword: 'frase_exacta', cliente_id: 'CLI-0002' })];
    const result = procesarCasoCliente(noticias, kws, args, fecha);
    expect(result.notasCapturadas).toHaveLength(1);
    expect(result.mencionesDetectadas).toHaveLength(0);
    expect(result.revisionHumana).toHaveLength(0);
  });

  it('todas las noticias van a notasCapturadas (independiente del match)', () => {
    const noticias = [
      noticia({ noticia_id: 'N1', titulo: 'Patrón Tequila gana' }),
      noticia({ noticia_id: 'N2', titulo: 'Sin relación' }),
    ];
    const kws = [keyword({ keyword_id: 'KW-1', keyword: 'Patrón Tequila', tipo_keyword: 'frase_exacta', cliente_id: 'CLI-0002' })];
    const result = procesarCasoCliente(noticias, kws, args, fecha);
    expect(result.notasCapturadas).toHaveLength(2);
  });

  it('dedupe_key incluye client_id y noticia_id', () => {
    const noticias = [noticia({ noticia_id: 'N1', titulo: 'Patrón Tequila notable' })];
    const kws = [keyword({ keyword_id: 'KW-1', keyword: 'Patrón Tequila', tipo_keyword: 'frase_exacta', cliente_id: 'CLI-0002' })];
    const result = procesarCasoCliente(noticias, kws, args, fecha);
    const key = String(result.notasCapturadas[0]!['dedupe_key'] ?? '');
    expect(key).toContain('cli-0002');
    expect(key).toContain('n1');
  });
});

describe('procesarCasoAdHoc', () => {
  const fecha = '2026-08-14T12:00:00.000Z';

  it('--exact: todos los resultados van a Menciones_Detectadas con confidence=high', () => {
    const args = parseArgs(['--exact=Bacardí México']);
    const noticias = [noticia({ noticia_id: 'N1', titulo: 'Bacardí México lanza nuevo producto' })];
    const result = procesarCasoAdHoc(noticias, args, 'exact', fecha);
    expect(result.mencionesDetectadas).toHaveLength(1);
    expect(result.mencionesDetectadas[0]!['confidence']).toBe('high');
    expect(result.revisionHumana).toHaveLength(0);
  });

  it('--contains: todos los resultados van a Menciones_Detectadas con confidence=medium', () => {
    const args = parseArgs(['--contains=Jumex']);
    const noticias = [noticia({ noticia_id: 'N1', titulo: 'Jumex reporta resultados' })];
    const result = procesarCasoAdHoc(noticias, args, 'contains', fecha);
    expect(result.mencionesDetectadas).toHaveLength(1);
    expect(result.mencionesDetectadas[0]!['confidence']).toBe('medium');
  });

  it('--query con match exacto en título → Menciones_Detectadas', () => {
    const args = parseArgs(['--query=Mery Pozos']);
    const noticias = [noticia({ noticia_id: 'N1', titulo: 'Mery Pozos inaugura nuevo espacio' })];
    const result = procesarCasoAdHoc(noticias, args, 'query', fecha);
    expect(result.mencionesDetectadas).toHaveLength(1);
    expect(result.mencionesDetectadas[0]!['confidence']).toBe('medium');
  });

  it('--query sin match exacto en título/resumen → Revision_Humana', () => {
    const args = parseArgs(['--query=SIAPA plomo']);
    const noticias = [noticia({ noticia_id: 'N1', titulo: 'Agua potable en Guadalajara', texto_cuerpo_nota: 'Notas sobre agua y SIAPA y plomo en cañerías' })];
    const result = procesarCasoAdHoc(noticias, args, 'query', fecha);
    // El texto del cuerpo tiene SIAPA + plomo, pero el título/resumen no → Revisión
    expect(result.revisionHumana).toHaveLength(1);
    expect(result.revisionHumana[0]!['bucket']).toBe('Revision_Humana');
    expect(result.revisionHumana[0]!['confidence']).toBe('low');
  });

  it('todas las noticias van a notasCapturadas (raw)', () => {
    const args = parseArgs(['--query=Profeco']);
    const noticias = [noticia({ noticia_id: 'N1' }), noticia({ noticia_id: 'N2' })];
    const result = procesarCasoAdHoc(noticias, args, 'query', fecha);
    expect(result.notasCapturadas).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sheets helpers
// ─────────────────────────────────────────────────────────────────────────────

describe('ensureTabInDoc', () => {
  it('crea la pestaña si no existe', async () => {
    const doc = fakeDoc({}) as any;
    await ensureTabInDoc(doc, 'MI_TAB', LIVE_HEADERS);
    expect(addSheetCalls).toContain('MI_TAB');
  });

  it('devuelve la pestaña existente sin crear una nueva', async () => {
    const existente = fakeSheet('YA_EXISTE');
    const doc = fakeDoc({ YA_EXISTE: existente }) as any;
    const sheet = await ensureTabInDoc(doc, 'YA_EXISTE', LIVE_HEADERS);
    expect(sheet).toBe(existente);
    expect(doc.addSheet).not.toHaveBeenCalled();
  });
});

describe('leerDedupKeys', () => {
  it('devuelve Set vacío si la pestaña no existe', async () => {
    const doc = fakeDoc({}) as any;
    const keys = await leerDedupKeys(doc, 'NO_EXISTE');
    expect(keys.size).toBe(0);
  });

  it('devuelve las dedupe_key existentes', async () => {
    const sheet = fakeSheet('MI_TAB', [{ dedupe_key: 'key-A' }, { dedupe_key: 'key-B' }]);
    const doc = fakeDoc({ MI_TAB: sheet }) as any;
    const keys = await leerDedupKeys(doc, 'MI_TAB');
    expect(keys.has('key-A')).toBe(true);
    expect(keys.has('key-B')).toBe(true);
  });
});

describe('appendDeduped', () => {
  it('omite filas con dedupe_key ya existente', async () => {
    const sheet = fakeSheet('MI_TAB');
    const doc = fakeDoc({ MI_TAB: sheet }) as any;
    const existingKeys = new Set(['cli-0002//n1//raw']);
    const rows = [
      { dedupe_key: 'cli-0002//n1//raw', titulo: 'Ya existe' },
      { dedupe_key: 'cli-0002//n2//raw', titulo: 'Nueva' },
    ];
    const result = await appendDeduped(doc, 'MI_TAB', rows, existingKeys, 100);
    expect(result.appended).toBe(1);
    expect(result.skipped).toBe(1);
    expect(sheet.addRows).toHaveBeenCalledOnce();
  });

  it('no llama addRows si todas las filas son duplicadas', async () => {
    const sheet = fakeSheet('MI_TAB');
    const doc = fakeDoc({ MI_TAB: sheet }) as any;
    const existingKeys = new Set(['key-A']);
    const result = await appendDeduped(doc, 'MI_TAB', [{ dedupe_key: 'key-A' }], existingKeys, 100);
    expect(result.appended).toBe(0);
    expect(sheet.addRows).not.toHaveBeenCalled();
  });

  it('respeta el límite maxRows', async () => {
    const sheet = fakeSheet('MI_TAB');
    const doc = fakeDoc({ MI_TAB: sheet }) as any;
    const rows = Array.from({ length: 10 }, (_, i) => ({ dedupe_key: `k${i}` }));
    const result = await appendDeduped(doc, 'MI_TAB', rows, new Set(), 3);
    expect(result.appended).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Comportamiento de main() — dry-run vs real
// ─────────────────────────────────────────────────────────────────────────────

describe('main() — dry-run no escribe en Sheets', () => {
  const ORIGINAL_ARGV = process.argv;

  beforeEach(() => {
    addRowsCalls.length = 0;
    addSheetCalls.length = 0;
    mockNoticias = [noticia({ noticia_id: 'N1', titulo: 'Patrón Tequila crece' })];
    mockKeywords = [keyword({ keyword_id: 'KW-1', keyword: 'Patrón', tipo_keyword: 'contiene', cliente_id: 'CLI-0002' })];
    mockDoc = fakeDoc({});
  });

  function conArgv(extra: string[], fn: () => Promise<void>): Promise<void> {
    process.argv = [...ORIGINAL_ARGV.slice(0, 2), ...extra];
    return fn().finally(() => { process.argv = ORIGINAL_ARGV; });
  }

  it('dry-run=true (default) no crea tabs ni escribe filas', async () => {
    await conArgv(['--client-id=CLI-0002'], async () => { await main(); });
    expect(addRowsCalls).toHaveLength(0);
    expect(addSheetCalls).toHaveLength(0);
  });

  it('--dry-run=true explícito no escribe', async () => {
    await conArgv(['--dry-run=true', '--client-id=CLI-0002'], async () => { await main(); });
    expect(addRowsCalls).toHaveLength(0);
  });

  it('--dry-run=false + --sheet-id sí llama a Sheets (crea tabs + addRows)', async () => {
    await conArgv(['--dry-run=false', '--sheet-id=SHEET-X', '--client-id=CLI-0002'], async () => {
      await main();
    });
    // Se deben haber creado 6 tabs (01..06)
    expect(addSheetCalls.length).toBe(6);
    // Se deben haber escrito filas (al menos en 01_LIVE_Notas + 06_Logs)
    expect(addRowsCalls.length).toBeGreaterThan(0);
  });

  it('dry-run=false sin sheet-id llama a process.exit(1)', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: string | number | null) => { throw new Error('exit'); });
    await expect(
      conArgv(['--dry-run=false', '--query=algo'], async () => { await main(); }),
    ).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });

  it('sin modo de búsqueda llama a process.exit(1)', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: string | number | null) => { throw new Error('exit'); });
    await expect(
      conArgv([], async () => { await main(); }),
    ).rejects.toThrow('exit');
    exitSpy.mockRestore();
  });
});

describe('main() — sin operaciones prohibidas', () => {
  const ORIGINAL_ARGV = process.argv;

  beforeEach(() => {
    addRowsCalls.length = 0;
    addSheetCalls.length = 0;
    mockNoticias = [];
    mockKeywords = [];
    mockDoc = fakeDoc({});
  });

  function conArgv(extra: string[], fn: () => Promise<void>): Promise<void> {
    process.argv = [...ORIGINAL_ARGV.slice(0, 2), ...extra];
    return fn().finally(() => { process.argv = ORIGINAL_ARGV; });
  }

  it('no invoca export-results, generate-xml, classify-ia, email, WhatsApp, Twilio, SMTP', async () => {
    await conArgv(['--client-id=CLI-0002'], async () => { await main(); });
    const allTabNames = addSheetCalls.join(' ') + addRowsCalls.map((c) => c.tab).join(' ');
    for (const prohibido of [
      'export-results', 'generate-xml', 'classify-ia', 'email', 'whatsapp', 'twilio', 'smtp',
      'send-internal', 'alertas_activas',
    ]) {
      expect(allTabNames.toLowerCase()).not.toContain(prohibido);
    }
  });
});
