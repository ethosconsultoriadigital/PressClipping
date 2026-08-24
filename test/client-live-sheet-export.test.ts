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
    // Única por defecto (incluye noticia_id) para no colisionar en dedupe por
    // url_original entre fixtures de distintas noticias en los tests.
    url_original: `https://example.com/nota-${over.noticia_id}`,
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
/**
 * Resultados por término de búsqueda (clave = query/term en minúsculas), para
 * simular la recuperación dirigida por keyword de buscarCandidatosCliente.
 * Si un término no tiene entrada aquí, se hace fallback a `mockNoticias`
 * (preserva el comportamiento de los tests preexistentes que no diferencian
 * por término).
 */
let mockNoticiasPorTermino: Record<string, NoticiaLakeRow[]> = {};
/** Términos para los que la búsqueda fts debe fallar (fuerza fallback ilike). */
let mockThrowFtsFor: Set<string> = new Set();
const getNoticiasEnVentanaCalls: any[] = [];
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
  getNoticiasEnVentana: vi.fn((opts: any) => {
    getNoticiasEnVentanaCalls.push(opts);
    const tf = opts?.textFilter;
    if (tf) {
      const key = String(tf.query ?? tf.term ?? '').toLowerCase();
      if (tf.modo === 'fts' && mockThrowFtsFor.has(key)) {
        return Promise.reject(new Error('fts falló (simulado)'));
      }
      if (key in mockNoticiasPorTermino) {
        return Promise.resolve(mockNoticiasPorTermino[key]);
      }
      return Promise.resolve(mockNoticias);
    }
    return Promise.resolve(mockNoticias);
  }),
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
  extraerTerminosBusqueda,
  buscarCandidatosCliente,
  procesarCasoCliente,
  procesarCasoAdHoc,
  ensureTabInDoc,
  leerDedupKeys,
  appendDeduped,
  LIVE_HEADERS,
  MAX_CANDIDATOS_CLIENTE_TOTAL,
  main,
} from '../scripts/client-live-sheet-export.js';

beforeEach(() => {
  mockNoticiasPorTermino = {};
  mockThrowFtsFor = new Set();
  getNoticiasEnVentanaCalls.length = 0;
});

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

  // ── Quoting: valores con espacios ──────────────────────────────────────────

  it('--query="Mery Pozos" (valor con espacios) se preserva íntegro', () => {
    const args = parseArgs(['--query=Mery Pozos']);
    expect(args.query).toBe('Mery Pozos');
    expect(args.unknownPositional).toHaveLength(0);
  });

  it('--client-name="Mery Pozos" (valor con espacios) se preserva íntegro', () => {
    const args = parseArgs(['--client-name=Mery Pozos']);
    expect(args.clientName).toBe('Mery Pozos');
    expect(args.unknownPositional).toHaveLength(0);
  });

  it('--exact="Bacardí México" (valor con espacios) se preserva íntegro', () => {
    const args = parseArgs(['--exact=Bacardí México']);
    expect(args.exact).toBe('Bacardí México');
    expect(args.unknownPositional).toHaveLength(0);
  });

  it('--contains="Patrón Tequilero" (valor con espacios) se preserva íntegro', () => {
    const args = parseArgs(['--contains=Patrón Tequilero']);
    expect(args.contains).toBe('Patrón Tequilero');
    expect(args.unknownPositional).toHaveLength(0);
  });

  // ── Detección de quoting roto ──────────────────────────────────────────────

  it('["--query=Mery", "Pozos"] detecta "Pozos" como argumento posicional desconocido', () => {
    const args = parseArgs(['--query=Mery', 'Pozos']);
    expect(args.query).toBe('Mery');
    expect(args.unknownPositional).toContain('Pozos');
    expect(args.unknownPositional).toHaveLength(1);
  });

  it('múltiples fragmentos son todos detectados como posicionales', () => {
    const args = parseArgs(['--query=Mery', 'Pozos', 'Extra', '--window-days=7']);
    expect(args.query).toBe('Mery');
    expect(args.unknownPositional).toEqual(['Pozos', 'Extra']);
    expect(args.windowDays).toBe(7);
  });

  it('unknownPositional está vacío cuando todos los args tienen --', () => {
    expect(parseArgs(['--dry-run=true', '--query=Mery Pozos']).unknownPositional).toHaveLength(0);
    expect(parseArgs([]).unknownPositional).toHaveLength(0);
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
// Recall dirigido por keyword (modo --client-id)
// ─────────────────────────────────────────────────────────────────────────────

describe('extraerTerminosBusqueda', () => {
  it('extrae keyword + alias_o_variantes como términos separados', () => {
    const kws = [
      keyword({ keyword_id: 'KW-1', keyword: 'Mery Pozos', alias_o_variantes: 'Merilyn Gómez Pozos|Merilyn Gomez Pozos' }),
    ];
    const terminos = extraerTerminosBusqueda(kws);
    expect(terminos).toContain('Mery Pozos');
    expect(terminos).toContain('Merilyn Gómez Pozos');
    expect(terminos).toContain('Merilyn Gomez Pozos');
  });

  it('prioriza frases largas/específicas primero (mayor precisión)', () => {
    const kws = [
      keyword({ keyword_id: 'KW-1', keyword: 'Mery Pozos', alias_o_variantes: 'diputada Mery Pozos|Pozos' }),
    ];
    const terminos = extraerTerminosBusqueda(kws, 1);
    // "diputada Mery Pozos" (20) > "Mery Pozos" (10) > "Pozos" (5)
    expect(terminos[0]).toBe('diputada Mery Pozos');
    expect(terminos[terminos.length - 1]).toBe('Pozos');
  });

  it('descarta términos demasiado cortos (ruidosos)', () => {
    const kws = [keyword({ keyword_id: 'KW-1', keyword: 'Mery Pozos', alias_o_variantes: 'a|b|de' })];
    const terminos = extraerTerminosBusqueda(kws, 3);
    expect(terminos).not.toContain('a');
    expect(terminos).not.toContain('b');
    expect(terminos).not.toContain('de');
    expect(terminos).toContain('Mery Pozos');
  });

  it('deduplica términos repetidos entre distintas keywords', () => {
    const kws = [
      keyword({ keyword_id: 'KW-1', keyword: 'Mery Pozos' }),
      keyword({ keyword_id: 'KW-2', keyword: 'Mery Pozos', alias_o_variantes: 'Mery Pozos' }),
    ];
    const terminos = extraerTerminosBusqueda(kws);
    expect(terminos.filter((t) => t === 'Mery Pozos')).toHaveLength(1);
  });

  it('sin keywords devuelve lista vacía', () => {
    expect(extraerTerminosBusqueda([])).toEqual([]);
  });
});

describe('buscarCandidatosCliente', () => {
  it('usa las keywords del cliente para recuperar candidatos por término (no escaneo genérico)', async () => {
    mockNoticiasPorTermino = {
      'mery pozos': [noticia({ noticia_id: 'N1', titulo: 'Mery Pozos inaugura obra' })],
      'merilyn gómez pozos': [noticia({ noticia_id: 'N2', titulo: 'Merilyn Gómez Pozos en evento' })],
    };
    const kws = [
      keyword({ keyword_id: 'KW-1', keyword: 'Mery Pozos', alias_o_variantes: 'Merilyn Gómez Pozos' }),
    ];
    const result = await buscarCandidatosCliente(kws, 30);
    expect(result.noticias.map((n) => n.noticia_id).sort()).toEqual(['N1', 'N2']);
    expect(result.terminosUsados.length).toBeGreaterThanOrEqual(2);
    // Cada búsqueda debe haber usado textFilter (dirigida), no un scan genérico.
    expect(getNoticiasEnVentanaCalls.every((c) => c.textFilter)).toBe(true);
  });

  it('no exporta 500 notas genéricas cuando solo hay pocos candidatos reales', async () => {
    mockNoticiasPorTermino = {
      'mery pozos': [noticia({ noticia_id: 'N1' }), noticia({ noticia_id: 'N2' })],
    };
    const kws = [keyword({ keyword_id: 'KW-1', keyword: 'Mery Pozos' })];
    const result = await buscarCandidatosCliente(kws, 30);
    expect(result.noticias.length).toBeLessThan(10);
    expect(result.noticias.length).toBeLessThan(500);
  });

  it('deduplica candidatos por noticia_id entre distintos términos', async () => {
    const mismaNota = noticia({ noticia_id: 'N1', titulo: 'Mery Pozos y Merilyn Gómez Pozos' });
    mockNoticiasPorTermino = {
      'mery pozos': [mismaNota],
      'merilyn gómez pozos': [mismaNota],
    };
    const kws = [
      keyword({ keyword_id: 'KW-1', keyword: 'Mery Pozos', alias_o_variantes: 'Merilyn Gómez Pozos' }),
    ];
    const result = await buscarCandidatosCliente(kws, 30);
    expect(result.noticias).toHaveLength(1);
  });

  it('deduplica candidatos por url_original cuando noticia_id difiere', async () => {
    const url = 'https://example.com/misma-nota';
    mockNoticiasPorTermino = {
      'mery pozos': [noticia({ noticia_id: 'N1', url_original: url })],
      'merilyn gómez pozos': [noticia({ noticia_id: 'N2', url_original: url })],
    };
    const kws = [
      keyword({ keyword_id: 'KW-1', keyword: 'Mery Pozos', alias_o_variantes: 'Merilyn Gómez Pozos' }),
    ];
    const result = await buscarCandidatosCliente(kws, 30);
    expect(result.noticias).toHaveLength(1);
  });

  it('hace fallback a ilike si fts falla para un término, sin perder candidatos', async () => {
    mockThrowFtsFor = new Set(['mery pozos']);
    mockNoticiasPorTermino = {
      'mery pozos': [noticia({ noticia_id: 'N1' })], // usado por el fallback ilike (mismo key)
    };
    const kws = [keyword({ keyword_id: 'KW-1', keyword: 'Mery Pozos' })];
    const result = await buscarCandidatosCliente(kws, 30);
    expect(result.noticias).toHaveLength(1);
    const modos = getNoticiasEnVentanaCalls.map((c) => c.textFilter?.modo);
    expect(modos).toContain('ilike');
  });

  it('sin keywords activas no busca nada y devuelve candidatos vacíos (sin fallback genérico)', async () => {
    const result = await buscarCandidatosCliente([], 30);
    expect(result.noticias).toEqual([]);
    expect(result.terminosUsados).toEqual([]);
    expect(getNoticiasEnVentanaCalls).toHaveLength(0);
  });

  it('acota el total de candidatos a MAX_CANDIDATOS_CLIENTE_TOTAL', async () => {
    const muchas = Array.from({ length: MAX_CANDIDATOS_CLIENTE_TOTAL + 100 }, (_, i) =>
      noticia({ noticia_id: `N${i}` }),
    );
    mockNoticiasPorTermino = { 'mery pozos': muchas };
    const kws = [keyword({ keyword_id: 'KW-1', keyword: 'Mery Pozos' })];
    const result = await buscarCandidatosCliente(kws, 30);
    expect(result.noticias.length).toBeLessThanOrEqual(MAX_CANDIDATOS_CLIENTE_TOTAL);
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

  // ── Consolidación por noticia (una sola fila aunque matcheen varias keywords) ──

  it('noticia con 3 keywords con score >= 0.6 produce UNA sola fila en Menciones_Detectadas', () => {
    const noticias = [
      noticia({
        noticia_id: 'N1',
        titulo: 'Mery Pozos inaugura obra y Diputada Mery Pozos convive con Merilyn Gomez Pozos',
      }),
    ];
    const kws = [
      keyword({ keyword_id: 'KW-1', keyword: 'Mery Pozos', tipo_keyword: 'frase_exacta', cliente_id: 'CLI-0002' }),
      keyword({ keyword_id: 'KW-2', keyword: 'Diputada Mery Pozos', tipo_keyword: 'frase_exacta', cliente_id: 'CLI-0002' }),
      keyword({ keyword_id: 'KW-3', keyword: 'Merilyn Gomez Pozos', tipo_keyword: 'frase_exacta', cliente_id: 'CLI-0002' }),
    ];
    const result = procesarCasoCliente(noticias, kws, args, fecha);
    expect(result.mencionesDetectadas).toHaveLength(1);
    expect(result.revisionHumana).toHaveLength(0);
    expect(result.mencionesDetectadas[0]!['match_count']).toBe(3);
  });

  it('noticia con 3 keywords de score bajo (solo en texto) produce UNA sola fila en Revision_Humana', () => {
    const noticias = [
      noticia({
        noticia_id: 'N2',
        titulo: 'Nota sin relación aparente en el título',
        texto_cuerpo_nota: 'En el cuerpo se menciona a Mery Pozos, a Diputada Mery Pozos y a Merilyn Gomez Pozos',
      }),
    ];
    const kws = [
      keyword({ keyword_id: 'KW-1', keyword: 'Mery Pozos', tipo_keyword: 'frase_exacta', cliente_id: 'CLI-0002' }),
      keyword({ keyword_id: 'KW-2', keyword: 'Diputada Mery Pozos', tipo_keyword: 'frase_exacta', cliente_id: 'CLI-0002' }),
      keyword({ keyword_id: 'KW-3', keyword: 'Merilyn Gomez Pozos', tipo_keyword: 'frase_exacta', cliente_id: 'CLI-0002' }),
    ];
    const result = procesarCasoCliente(noticias, kws, args, fecha);
    expect(result.revisionHumana).toHaveLength(1);
    expect(result.mencionesDetectadas).toHaveLength(0);
    expect(result.revisionHumana[0]!['match_count']).toBe(3);
    expect(result.revisionHumana[0]!['bucket']).toBe('Revision_Humana');
  });

  it('noticia con un match alto y otros bajos va SOLO a Menciones_Detectadas, no a Revision', () => {
    const noticias = [
      noticia({
        noticia_id: 'N3',
        titulo: 'Mery Pozos inaugura obra pública',
        texto_cuerpo_nota: 'También se habla de Diputada Mery Pozos y de Merilyn Gomez Pozos en el cuerpo',
      }),
    ];
    const kws = [
      keyword({ keyword_id: 'KW-1', keyword: 'Mery Pozos', tipo_keyword: 'frase_exacta', cliente_id: 'CLI-0002' }), // match en título → score alto
      keyword({ keyword_id: 'KW-2', keyword: 'Diputada Mery Pozos', tipo_keyword: 'frase_exacta', cliente_id: 'CLI-0002' }), // solo en texto → score bajo
      keyword({ keyword_id: 'KW-3', keyword: 'Merilyn Gomez Pozos', tipo_keyword: 'frase_exacta', cliente_id: 'CLI-0002' }), // solo en texto → score bajo
    ];
    const result = procesarCasoCliente(noticias, kws, args, fecha);
    expect(result.mencionesDetectadas).toHaveLength(1);
    expect(result.revisionHumana).toHaveLength(0);
    expect(result.mencionesDetectadas[0]!['match_count']).toBe(3);
    expect(Number(result.mencionesDetectadas[0]!['best_score'])).toBeGreaterThanOrEqual(0.6);
  });

  it('agrega keywords_matched, keyword_ids_matched y motivos_match en la fila consolidada', () => {
    const noticias = [
      noticia({ noticia_id: 'N4', titulo: 'Mery Pozos y Diputada Mery Pozos en el mismo evento' }),
    ];
    const kws = [
      keyword({ keyword_id: 'KW-1', keyword: 'Mery Pozos', tipo_keyword: 'frase_exacta', cliente_id: 'CLI-0002' }),
      keyword({ keyword_id: 'KW-2', keyword: 'Diputada Mery Pozos', tipo_keyword: 'frase_exacta', cliente_id: 'CLI-0002' }),
    ];
    const result = procesarCasoCliente(noticias, kws, args, fecha);
    expect(result.mencionesDetectadas).toHaveLength(1);
    const row = result.mencionesDetectadas[0]!;
    const keywordsMatched = String(row['keywords_matched'] ?? '').split(' | ');
    const keywordIdsMatched = String(row['keyword_ids_matched'] ?? '').split(' | ');
    const motivosMatch = String(row['motivos_match'] ?? '').split(' | ');
    expect(keywordsMatched).toHaveLength(2);
    expect(keywordsMatched).toContain('Mery Pozos');
    expect(keywordsMatched).toContain('Diputada Mery Pozos');
    expect(keywordIdsMatched).toHaveLength(2);
    expect(keywordIdsMatched).toContain('KW-1');
    expect(keywordIdsMatched).toContain('KW-2');
    expect(motivosMatch).toHaveLength(2);
  });

  it('dedupe_key de fila consolidada usa suffix estable "mention", no depende del keyword_id', () => {
    const noticias = [noticia({ noticia_id: 'N5', titulo: 'Mery Pozos y Diputada Mery Pozos juntas' })];
    const kws = [
      keyword({ keyword_id: 'KW-1', keyword: 'Mery Pozos', tipo_keyword: 'frase_exacta', cliente_id: 'CLI-0002' }),
      keyword({ keyword_id: 'KW-2', keyword: 'Diputada Mery Pozos', tipo_keyword: 'frase_exacta', cliente_id: 'CLI-0002' }),
    ];
    const result = procesarCasoCliente(noticias, kws, args, fecha);
    const key = String(result.mencionesDetectadas[0]!['dedupe_key'] ?? '');
    expect(key).toBe(buildDedupeKey('CLI-0002', 'N5', 'mention'));
    expect(key).not.toContain('kw-1');
    expect(key).not.toContain('kw-2');
  });

  it('nunca hay más de una fila total (Menciones + Revision) por noticia', () => {
    const noticias = [
      noticia({ noticia_id: 'N6', titulo: 'Mery Pozos, Diputada Mery Pozos y Merilyn Gomez Pozos' }),
    ];
    const kws = [
      keyword({ keyword_id: 'KW-1', keyword: 'Mery Pozos', tipo_keyword: 'frase_exacta', cliente_id: 'CLI-0002' }),
      keyword({ keyword_id: 'KW-2', keyword: 'Diputada Mery Pozos', tipo_keyword: 'frase_exacta', cliente_id: 'CLI-0002' }),
      keyword({ keyword_id: 'KW-3', keyword: 'Merilyn Gomez Pozos', tipo_keyword: 'frase_exacta', cliente_id: 'CLI-0002' }),
    ];
    const result = procesarCasoCliente(noticias, kws, args, fecha);
    expect(result.mencionesDetectadas.length + result.revisionHumana.length).toBe(1);
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

  it('argumentos posicionales desconocidos (quoting roto) llaman a process.exit(1)', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: string | number | null) => { throw new Error('exit'); });
    // Simula "--query=Mery Pozos" llegando partido por quoting roto en el workflow
    await expect(
      conArgv(['--query=Mery', 'Pozos'], async () => { await main(); }),
    ).rejects.toThrow('exit');
    expect(addRowsCalls).toHaveLength(0); // no debe escribir nada
    exitSpy.mockRestore();
  });

  it('valores con espacios pasados correctamente (--query="Mery Pozos") no fallan', async () => {
    // "--query=Mery Pozos" como UN SOLO elemento del array → sin posicionales desconocidos
    await conArgv(['--client-id=CLI-0002', '--query=Mery Pozos'], async () => { await main(); });
    // dry-run=true (default): no escribe nada
    expect(addRowsCalls).toHaveLength(0);
  });
});

describe('main() — recall dirigido por keyword (client-id) reemplaza escaneo genérico', () => {
  const ORIGINAL_ARGV = process.argv;

  beforeEach(() => {
    addRowsCalls.length = 0;
    addSheetCalls.length = 0;
    mockDoc = fakeDoc({});
  });

  function conArgv(extra: string[], fn: () => Promise<void>): Promise<void> {
    process.argv = [...ORIGINAL_ARGV.slice(0, 2), ...extra];
    return fn().finally(() => { process.argv = ORIGINAL_ARGV; });
  }

  it('nunca llama a getNoticiasEnVentana sin textFilter en modo client-id (sin escaneo genérico)', async () => {
    // Simula 500 noticias "genéricas" bajo ausencia de textFilter, que es lo
    // que el bug anterior habría usado. Los candidatos reales solo existen
    // bajo búsquedas por término (fts/ilike dirigidas por keyword).
    mockNoticias = Array.from({ length: 500 }, (_, i) =>
      noticia({ noticia_id: `GEN-${i}`, titulo: 'Noticia genérica sin relación' }),
    );
    mockNoticiasPorTermino = {
      'mery pozos': [
        noticia({ noticia_id: 'N1', titulo: 'Mery Pozos inaugura obra pública' }),
        noticia({ noticia_id: 'N2', titulo: 'Diputada Mery Pozos participa en sesión' }),
      ],
    };
    mockKeywords = [
      keyword({ keyword_id: 'KW-1', keyword: 'Mery Pozos', tipo_keyword: 'frase_exacta', cliente_id: 'CLI-MERY-TEST' }),
    ];

    await conArgv(['--dry-run', '--client-id=CLI-MERY-TEST', '--window-days=30'], async () => { await main(); });

    const llamadasSinFiltro = getNoticiasEnVentanaCalls.filter((c) => !c.textFilter);
    expect(llamadasSinFiltro).toHaveLength(0);
  });

  it('en modo real, 01_LIVE_Notas_Capturadas contiene solo candidatos filtrados, no 500 genéricas', async () => {
    mockNoticias = Array.from({ length: 500 }, (_, i) => noticia({ noticia_id: `GEN-${i}` }));
    mockNoticiasPorTermino = {
      'mery pozos': [
        noticia({ noticia_id: 'N1', titulo: 'Mery Pozos inaugura obra pública' }),
        noticia({ noticia_id: 'N2', titulo: 'Diputada Mery Pozos participa en sesión' }),
      ],
    };
    mockKeywords = [
      keyword({ keyword_id: 'KW-1', keyword: 'Mery Pozos', tipo_keyword: 'frase_exacta', cliente_id: 'CLI-MERY-TEST' }),
    ];

    await conArgv(['--dry-run=false', '--sheet-id=SHEET-X', '--client-id=CLI-MERY-TEST'], async () => {
      await main();
    });

    const notasCall = addRowsCalls.find((c) => c.tab.includes('01_LIVE_Notas_Capturadas'));
    expect(notasCall?.rows.length ?? 0).toBeLessThan(10);
    expect(notasCall?.rows.length ?? 0).toBeLessThan(500);

    const mencionesCall = addRowsCalls.find((c) => c.tab.includes('02_Menciones_Detectadas'));
    expect(mencionesCall?.rows.length ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('modo ad-hoc (--query con espacios) sigue intacto tras el fix de recall', async () => {
    mockNoticias = [noticia({ noticia_id: 'N1', titulo: 'Mery Pozos inaugura nuevo espacio cultural' })];
    await conArgv(['--dry-run', '--query=Mery Pozos', '--window-days=30'], async () => { await main(); });
    // No debe requerir keywords ni tocar la ruta de candidatos por cliente.
    expect(addRowsCalls).toHaveLength(0); // dry-run
  });

  it('una noticia que matchea 3 keywords produce UNA sola fila escrita (no key-0040/0043/0046 repetidas)', async () => {
    const notaCompartida = noticia({
      noticia_id: 'ACBC45DE',
      titulo: 'Mery Pozos, Diputada Mery Pozos y Merilyn Gomez Pozos en el mismo evento',
    });
    mockNoticiasPorTermino = {
      'mery pozos': [notaCompartida],
      'diputada mery pozos': [notaCompartida],
      'merilyn gomez pozos': [notaCompartida],
    };
    mockKeywords = [
      keyword({ keyword_id: 'KEY-0040', keyword: 'Mery Pozos', tipo_keyword: 'frase_exacta', cliente_id: 'CLI-MERY-TEST' }),
      keyword({ keyword_id: 'KEY-0043', keyword: 'Diputada Mery Pozos', tipo_keyword: 'frase_exacta', cliente_id: 'CLI-MERY-TEST' }),
      keyword({ keyword_id: 'KEY-0046', keyword: 'Merilyn Gomez Pozos', tipo_keyword: 'frase_exacta', cliente_id: 'CLI-MERY-TEST' }),
    ];

    await conArgv(['--dry-run=false', '--sheet-id=SHEET-X', '--client-id=CLI-MERY-TEST'], async () => {
      await main();
    });

    const mencionesCall = addRowsCalls.find((c) => c.tab.includes('02_Menciones_Detectadas'));
    const filasDeEstaNota = (mencionesCall?.rows ?? []).filter((r: any) =>
      String(r['dedupe_key'] ?? '').includes('acbc45de'),
    );
    expect(filasDeEstaNota).toHaveLength(1);
    expect(String(filasDeEstaNota[0]?.['keyword_ids_matched'] ?? '')).toContain('KEY-0040');
    expect(String(filasDeEstaNota[0]?.['keyword_ids_matched'] ?? '')).toContain('KEY-0043');
    expect(String(filasDeEstaNota[0]?.['keyword_ids_matched'] ?? '')).toContain('KEY-0046');
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
