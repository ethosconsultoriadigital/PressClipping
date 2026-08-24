/**
 * Client Live Sheet Export — exportador genérico de LIVE shadow a Google Sheets.
 *
 * Busca noticias del news lake (ventana rolling de N días), las clasifica en
 * buckets y hace append-only a una Google Sheet arbitraria. Pensado para
 * revisión humana antes de activar alertas internas / WhatsApp.
 *
 * Soporta dos modos de búsqueda:
 *   Caso A: --client-id  → carga keywords activas del cliente, genera términos
 *           de búsqueda a partir de ellas (frases completas y variantes, no
 *           palabras sueltas) y busca candidatos en el News Lake por término
 *           (fts con fallback ilike), en vez de escanear las últimas N
 *           noticias genéricas. Luego aplica matchKeyword sobre los candidatos
 *           deduplicados para clasificar en buckets. Los resultados se
 *           CONSOLIDAN por noticia: si varias keywords matchean la misma
 *           noticia, se escribe UNA sola fila (no una por keyword), con las
 *           keywords/motivos agregados en columnas y el mejor score como
 *           score principal.
 *   Caso B: --query/--exact/--contains → búsqueda ad-hoc sin cliente.
 * Si se combinan, gana --client-id sobre los modos ad-hoc.
 *
 * Buckets:
 *   01_LIVE_Notas_Capturadas  → todas las noticias candidatas del lake.
 *   02_Menciones_Detectadas   → alta confianza (match en título/resumen o exact/contains).
 *   03_Revision_Humana        → posible match / contexto ambiguo / query broad.
 *   04_Excluidas              → (headers creados; v1 se rellena manualmente).
 *   05_Comparativo_vs_Actual  → (headers creados; v1 vacío).
 *   06_Logs                   → fila de resumen por corrida.
 *
 * Garantías:
 *   - Append-only: nunca borra ni reemplaza contenido existente.
 *   - Dedup por dedupe_key: si la fila ya existe en la tab destino, no se duplica.
 *   - Dry-run seguro por defecto: sin --dry-run=false no escribe nada.
 *   - No inserta en `menciones`. No envía alertas/email/WhatsApp/Twilio/SMTP.
 *   - No toca Patrón, Jumex, NOTAS ENVIADAS MERYPOZOS.
 *
 * Uso:
 *   npm run client-live:sheet -- --dry-run --sheet-id=<ID> --client-id=CLI-0002
 *   npm run client-live:sheet -- --dry-run --sheet-id=<ID> --query="Mery Pozos"
 *   npm run client-live:sheet -- --dry-run=false --sheet-id=<ID> --client-id=CLI-0002 --window-days=7
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import type { GoogleSpreadsheet, GoogleSpreadsheetWorksheet } from 'google-spreadsheet';
import {
  getNoticiasEnVentana,
  getKeywordsActivas,
  type NoticiaLakeRow,
  type KeywordActivaRow,
} from '../src/supabase/repositories.js';
import {
  matchKeyword,
  splitTerminos,
  PESOS_CAMPO,
  type KeywordRule,
  type CampoBuscable,
  type TipoKeyword,
  type MatchResultado,
} from '../src/matchers/keyword.js';
import { getSpreadsheetById, withSheetsRetry } from '../src/sheets/client.js';
import { normalizeHeader, parseIntOrNull, parseBool } from '../src/utils/parse.js';
import { logger } from '../src/utils/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Constantes
// ─────────────────────────────────────────────────────────────────────────────

const SOURCE_SCRIPT = 'client-live-sheet-export';
const RUN_BY = process.env['RUN_BY'] ?? 'local';
const TEXTO_MAX_CHARS = 5_000;

export const LIVE_HEADERS = [
  'dedupe_key', 'fecha_export', 'client_id', 'client_name', 'query', 'match_mode',
  'bucket', 'confidence', 'medio_id', 'medio_nombre', 'fecha_publicacion', 'titulo',
  'resumen', 'url_original', 'texto', 'motivo',
  // Columnas de consolidación (modo --client-id): cuando varias keywords
  // matchean la misma noticia, se agregan aquí en vez de generar una fila
  // por keyword. En modo ad-hoc quedan vacías.
  'keywords_matched', 'keyword_ids_matched', 'motivos_match', 'best_score', 'match_count',
  'source_script', 'run_by',
] as const;

export const LOG_HEADERS = [
  'fecha_export', 'run_by', 'source_script', 'client_id', 'client_name', 'query',
  'match_mode', 'noticias_escaneadas', 'filas_notas_capturadas', 'filas_menciones',
  'filas_revision', 'filas_excluidas', 'filas_omitidas_dedupe', 'mismatch', 'duracion_ms',
] as const;

export const COMPARATIVO_HEADERS = [
  'dedupe_key', 'fecha_export', 'client_id', 'titulo', 'url_original',
  'en_ethos', 'en_sistema_actual', 'status',
] as const;

const TIPOS_VALIDOS: TipoKeyword[] = ['exacta', 'frase_exacta', 'contiene', 'booleana', 'exacta_contextual'];

/**
 * Tuning de recuperación de candidatos por keyword para el modo --client-id.
 * Bounds deliberadamente conservadores: priorizan recall dirigido por término
 * (frases del cliente) sobre un escaneo genérico masivo de la ventana.
 */
export const MAX_TERMINOS_BUSQUEDA_CLIENTE = 15;
export const CANDIDATOS_POR_TERMINO_CLIENTE = 50;
export const MAX_CANDIDATOS_CLIENTE_TOTAL = 300;
/** Términos más cortos que esto se descartan (demasiado ruidosos para fts/ilike). */
const MIN_LEN_TERMINO_BUSQUEDA = 3;

// ─────────────────────────────────────────────────────────────────────────────
// Args
// ─────────────────────────────────────────────────────────────────────────────

export interface LiveSheetExportArgs {
  dryRun: boolean;
  sheetId: string | null;
  tabPrefix: string;
  clientId: string | null;
  clientName: string | null;
  query: string | null;
  exact: string | null;
  contains: string | null;
  windowDays: number;
  limit: number;
  maxRows: number;
  includeFullText: boolean;
  /**
   * Argumentos posicionales no reconocidos (no empiezan con '--').
   * Si contiene elementos, main() hace process.exit(1) con mensaje claro.
   * Detecta errores de quoting en workflow donde "--query=Mery Pozos"
   * llega partido como ["--query=Mery", "Pozos"].
   */
  unknownPositional: string[];
}

function parseQuoted(v: string): string {
  let s = v;
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  return s;
}

export function parseArgs(argv: string[]): LiveSheetExportArgs {
  const out: LiveSheetExportArgs = {
    dryRun: true,
    sheetId: null,
    tabPrefix: 'ETHOS_LIVE',
    clientId: null,
    clientName: null,
    query: null,
    exact: null,
    contains: null,
    windowDays: 30,
    limit: 100,
    maxRows: 100,
    includeFullText: true,
    unknownPositional: [],
  };
  for (const arg of argv) {
    if (arg === '--dry-run') { out.dryRun = true; continue; }
    if (arg === '--no-dry-run') { out.dryRun = false; continue; }
    if (!arg.startsWith('--')) {
      // Argumento posicional no reconocido. Muy probablemente indica un error de
      // quoting en el workflow: "--query=Mery Pozos" llegó partido como
      // "--query=Mery" + "Pozos". Se recolecta para que main() lo reporte y falle.
      out.unknownPositional.push(arg);
      continue;
    }
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    const key = eq === -1 ? body : body.slice(0, eq);
    const rawVal = eq === -1 ? '' : body.slice(eq + 1);
    const val = parseQuoted(rawVal);
    switch (key) {
      case 'dry-run':
        out.dryRun = rawVal === '' ? true : val !== 'false';
        break;
      case 'sheet-id': out.sheetId = val || null; break;
      case 'tab-prefix': if (val) out.tabPrefix = val; break;
      case 'client-id': out.clientId = val || null; break;
      case 'client-name': out.clientName = val || null; break;
      case 'query': out.query = val || null; break;
      case 'exact': out.exact = val || null; break;
      case 'contains': out.contains = val || null; break;
      case 'window-days': out.windowDays = parseIntOrNull(val) ?? out.windowDays; break;
      case 'limit': out.limit = parseIntOrNull(val) ?? out.limit; break;
      case 'max-rows': out.maxRows = parseIntOrNull(val) ?? out.maxRows; break;
      case 'include-full-text': out.includeFullText = val === '' ? true : parseBool(val, true); break;
      default:
        logger.warn({ flag: arg }, 'Flag desconocido ignorado');
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tipos de salida
// ─────────────────────────────────────────────────────────────────────────────

export type OutRow = Record<string, string | number | boolean | null | undefined>;

export interface BucketRows {
  notasCapturadas: OutRow[];
  mencionesDetectadas: OutRow[];
  revisionHumana: OutRow[];
}

export interface WriteResult {
  filas_notas_capturadas: number;
  filas_menciones: number;
  filas_revision: number;
  filas_omitidas_dedupe: number;
  mismatch: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers puros (exportados para testabilidad)
// ─────────────────────────────────────────────────────────────────────────────

/** Construye una clave de dedup estable por fila. Todos los segmentos se normalizan a lowercase. */
export function buildDedupeKey(identifier: string, noticiaId: string, suffix: string): string {
  const clean = (s: string): string =>
    s.toLowerCase().replace(/[^a-z0-9_\-]/g, '-').replace(/-+/g, '-').slice(0, 40);
  return `${clean(identifier)}//${clean(noticiaId)}//${clean(suffix)}`;
}

/** Texto disponible de mayor calidad para la columna `texto`. */
export function textoEfectivo(row: NoticiaLakeRow): string {
  return row.texto_cuerpo_nota ?? row.texto_nota_limpia ?? row.texto_extraido ?? row.resumen ?? '';
}

/** Campos buscables de una nota del lake (compatibles con matchKeyword). */
export function camposDeLake(row: NoticiaLakeRow): CampoBuscable[] {
  return [
    { nombre: 'titulo', texto: row.titulo ?? '', peso: PESOS_CAMPO.titulo! },
    { nombre: 'resumen', texto: row.resumen ?? '', peso: PESOS_CAMPO.resumen! },
    { nombre: 'texto_extraido', texto: textoEfectivo(row), peso: PESOS_CAMPO.texto_extraido! },
    { nombre: 'medio', texto: row.medio_nombre ?? '', peso: PESOS_CAMPO.medio! },
  ];
}

/** Convierte una KeywordActivaRow a KeywordRule (para matchKeyword). */
export function toKeywordRule(kw: KeywordActivaRow): KeywordRule {
  const tipo: TipoKeyword = (TIPOS_VALIDOS as string[]).includes(kw.tipo_keyword)
    ? (kw.tipo_keyword as TipoKeyword)
    : 'contiene';
  return {
    keyword_id: kw.keyword_id,
    cliente_id: kw.cliente_id,
    keyword: kw.keyword,
    terminos: splitTerminos(kw.keyword, kw.alias_o_variantes),
    tipo,
    regla: kw.regla,
    contextoIncluir: splitTerminos(kw.contexto_incluir),
    contextoExcluir: splitTerminos(kw.contexto_excluir),
  };
}

/** Determina el bucket y confianza según el resultado del match. */
export function clasificarBucket(
  result: MatchResultado,
): { bucket: string; confidence: string; motivo: string } {
  if (result.score >= 0.6) {
    return {
      bucket: 'Menciones_Detectadas',
      confidence: 'high',
      motivo: `match ${result.campo} score=${result.score}`,
    };
  }
  return {
    bucket: 'Revision_Humana',
    confidence: 'medium',
    motivo: `match ${result.campo} score=${result.score} (score bajo)`,
  };
}

function truncar(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function formatValue(v: OutRow[string]): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v);
}

function baseRow(
  args: LiveSheetExportArgs,
  row: NoticiaLakeRow,
  extra: {
    identifier: string;
    matchMode: string;
    dedupeSuffix: string;
    bucket: string;
    confidence: string;
    motivo: string;
    textoMatch?: string;
    fechaExport: string;
    /** Campos de consolidación (solo modo --client-id, cuando >1 keyword matcheó). */
    keywordsMatched?: string;
    keywordIdsMatched?: string;
    motivosMatch?: string;
    bestScore?: number;
    matchCount?: number;
  },
): OutRow {
  const textoCompleto = args.includeFullText
    ? truncar(textoEfectivo(row), TEXTO_MAX_CHARS)
    : (extra.textoMatch ?? '');
  return {
    dedupe_key: buildDedupeKey(extra.identifier, row.noticia_id, extra.dedupeSuffix),
    fecha_export: extra.fechaExport,
    client_id: args.clientId ?? null,
    client_name: args.clientName ?? null,
    query: args.query ?? args.exact ?? args.contains ?? null,
    match_mode: extra.matchMode,
    bucket: extra.bucket,
    confidence: extra.confidence,
    medio_id: row.medio_id,
    medio_nombre: row.medio_nombre,
    fecha_publicacion: row.fecha_publicacion,
    titulo: row.titulo,
    resumen: row.resumen,
    url_original: row.url_original,
    texto: textoCompleto,
    motivo: extra.motivo,
    keywords_matched: extra.keywordsMatched ?? null,
    keyword_ids_matched: extra.keywordIdsMatched ?? null,
    motivos_match: extra.motivosMatch ?? null,
    best_score: extra.bestScore ?? null,
    match_count: extra.matchCount ?? null,
    source_script: SOURCE_SCRIPT,
    run_by: RUN_BY,
  };
}

/**
 * Extrae términos de búsqueda candidatos a partir de las keywords activas de
 * un cliente (keyword + alias_o_variantes, ya separados por splitTerminos).
 * Descarta términos demasiado cortos (ruidosos para fts/ilike) y prioriza
 * frases largas/específicas (mayor precisión, p.ej. "diputada Mery Pozos")
 * sobre términos cortos, para maximizar recall dirigido sin abrir la puerta
 * a ruido masivo.
 */
export function extraerTerminosBusqueda(
  keywords: KeywordActivaRow[],
  minLen: number = MIN_LEN_TERMINO_BUSQUEDA,
): string[] {
  const set = new Set<string>();
  for (const kw of keywords) {
    for (const t of splitTerminos(kw.keyword, kw.alias_o_variantes)) {
      const trimmed = t.trim();
      if (trimmed.length >= minLen) set.add(trimmed);
    }
  }
  // Frases más largas primero (más específicas / mayor precisión).
  return [...set].sort((a, b) => b.length - a.length);
}

export interface CandidatosClienteResultado {
  noticias: NoticiaLakeRow[];
  terminosUsados: string[];
}

/**
 * Busca candidatos del News Lake para un cliente usando sus keywords activas
 * como términos de búsqueda dirigida (fts, con fallback a ilike por término),
 * en vez de escanear las últimas N noticias genéricas de la ventana completa.
 *
 * Deduplica por noticia_id y por url_original (por si una misma nota aparece
 * bajo IDs distintos). Acota el total de candidatos a MAX_CANDIDATOS_CLIENTE_TOTAL
 * para evitar volúmenes de ruido masivo incluso si hay muchas keywords.
 *
 * Si el cliente no tiene keywords activas (o ninguna produce términos útiles),
 * devuelve candidatos vacíos: sin keywords no hay base para filtrar, y por
 * diseño NO se recurre a un escaneo genérico como fallback (evita ruido).
 */
export async function buscarCandidatosCliente(
  keywords: KeywordActivaRow[],
  windowDays: number,
): Promise<CandidatosClienteResultado> {
  const terminos = extraerTerminosBusqueda(keywords).slice(0, MAX_TERMINOS_BUSQUEDA_CLIENTE);
  if (terminos.length === 0) return { noticias: [], terminosUsados: [] };

  const porNoticiaId = new Map<string, NoticiaLakeRow>();
  const seenUrls = new Set<string>();

  for (const termino of terminos) {
    if (porNoticiaId.size >= MAX_CANDIDATOS_CLIENTE_TOTAL) break;

    let encontradas: NoticiaLakeRow[] = [];
    try {
      encontradas = await getNoticiasEnVentana({
        windowDays,
        limit: CANDIDATOS_POR_TERMINO_CLIENTE,
        textFilter: { modo: 'fts', query: termino },
      });
    } catch {
      try {
        encontradas = await getNoticiasEnVentana({
          windowDays,
          limit: CANDIDATOS_POR_TERMINO_CLIENTE,
          textFilter: { modo: 'ilike', term: termino },
        });
      } catch {
        encontradas = [];
      }
    }

    for (const n of encontradas) {
      if (porNoticiaId.has(n.noticia_id)) continue;
      const url = (n.url_original ?? '').trim().toLowerCase();
      if (url && seenUrls.has(url)) continue;
      porNoticiaId.set(n.noticia_id, n);
      if (url) seenUrls.add(url);
    }
  }

  return {
    noticias: [...porNoticiaId.values()].slice(0, MAX_CANDIDATOS_CLIENTE_TOTAL),
    terminosUsados: terminos,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Procesamiento de noticias → buckets (sin tocar DB ni Sheets)
// ─────────────────────────────────────────────────────────────────────────────

/** Caso A: client_id con keywords activas. `noticias` ya deben venir como los
 * candidatos filtrados por keyword (ver buscarCandidatosCliente), no un
 * escaneo genérico de la ventana completa. */
export function procesarCasoCliente(
  noticias: NoticiaLakeRow[],
  keywords: KeywordActivaRow[],
  args: LiveSheetExportArgs,
  fechaExport: string,
): BucketRows {
  const identifier = args.clientId!;
  const reglas = keywords.map(toKeywordRule);

  const notasCapturadas: OutRow[] = noticias.map((n) =>
    baseRow(args, n, {
      identifier,
      matchMode: 'cliente_keyword',
      dedupeSuffix: 'raw',
      bucket: 'LIVE_Notas_Capturadas',
      confidence: '-',
      motivo: `candidato por keyword search (ventana ${args.windowDays}d)`,
      fechaExport,
    }),
  );

  const mencionesDetectadas: OutRow[] = [];
  const revisionHumana: OutRow[] = [];

  for (const noticia of noticias) {
    const campos = camposDeLake(noticia);

    // Recolecta TODOS los matches de keyword para esta noticia; se consolidan
    // en UNA sola fila (no una fila por keyword) antes de exportar.
    const matches: { keywordId: string; keyword: string; result: MatchResultado }[] = [];
    for (const regla of reglas) {
      const result = matchKeyword(regla, campos);
      if (!result) continue;
      matches.push({ keywordId: regla.keyword_id, keyword: regla.keyword, result });
    }
    if (matches.length === 0) continue; // sin match de ninguna keyword: no va a Menciones ni Revisión.

    // El mejor score decide el bucket/confidence/motivo principal (prioridad
    // Menciones_Detectadas > Revision_Humana; nunca ambos para la misma nota).
    matches.sort((a, b) => b.result.score - a.result.score);
    const mejor = matches[0]!;
    const { bucket, confidence, motivo } = clasificarBucket(mejor.result);
    const matchCount = matches.length;

    const keywordsMatched = matches.map((m) => m.keyword).join(' | ');
    const keywordIdsMatched = matches.map((m) => m.keywordId).join(' | ');
    const motivosMatch = matches
      .map((m) => `${m.keyword}: match ${m.result.campo} score=${m.result.score}`)
      .join(' | ');
    const motivoConsolidado =
      matchCount > 1 ? `${motivo} (+${matchCount - 1} keyword(s) adicional(es))` : motivo;

    const row = baseRow(args, noticia, {
      identifier,
      matchMode: 'cliente_keyword',
      // Suffix estable NO dependiente del keyword_id: una nota consolidada
      // siempre mapea a la misma dedupe_key sin importar cuántas/cuáles
      // keywords matcheen en corridas sucesivas.
      dedupeSuffix: 'mention',
      bucket,
      confidence,
      motivo: motivoConsolidado,
      textoMatch: mejor.result.texto_match,
      fechaExport,
      keywordsMatched,
      keywordIdsMatched,
      motivosMatch,
      bestScore: mejor.result.score,
      matchCount,
    });

    if (bucket === 'Menciones_Detectadas') {
      mencionesDetectadas.push(row);
    } else {
      revisionHumana.push(row);
    }
  }

  return { notasCapturadas, mencionesDetectadas, revisionHumana };
}

/** Caso B: query/exact/contains ad-hoc. */
export function procesarCasoAdHoc(
  noticias: NoticiaLakeRow[],
  args: LiveSheetExportArgs,
  searchMode: 'query' | 'exact' | 'contains',
  fechaExport: string,
): BucketRows {
  const searchTerm = args.query ?? args.exact ?? args.contains ?? 'adhoc';
  const identifier = `${searchMode}:${searchTerm}`;

  const notasCapturadas: OutRow[] = noticias.map((n) =>
    baseRow(args, n, {
      identifier,
      matchMode: searchMode,
      dedupeSuffix: 'raw',
      bucket: 'LIVE_Notas_Capturadas',
      confidence: '-',
      motivo: `nota encontrada por ${searchMode}`,
      fechaExport,
    }),
  );

  const mencionesDetectadas: OutRow[] = [];
  const revisionHumana: OutRow[] = [];

  for (const noticia of noticias) {
    let bucket: string;
    let confidence: string;
    let motivo: string;

    if (searchMode === 'exact' || searchMode === 'contains') {
      // El match ya fue hecho por el buscador (matchKeyword en memoria o frase exacta);
      // todos los resultados devueltos son matches válidos → alta confianza.
      bucket = 'Menciones_Detectadas';
      confidence = searchMode === 'exact' ? 'high' : 'medium';
      motivo = `${searchMode} match: "${searchTerm}"`;
    } else {
      // --query (fts/ilike): verificar si hay match exacto en titulo/resumen.
      const reglaExacta: KeywordRule = {
        keyword_id: 'AD-HOC',
        cliente_id: null,
        keyword: searchTerm,
        terminos: [searchTerm],
        tipo: 'frase_exacta',
        regla: null,
        contextoIncluir: [],
        contextoExcluir: [],
      };
      const camposTituloResumen: CampoBuscable[] = [
        { nombre: 'titulo', texto: noticia.titulo ?? '', peso: 1.0 },
        { nombre: 'resumen', texto: noticia.resumen ?? '', peso: 0.6 },
      ];
      const exactoEnTituloResumen = matchKeyword(reglaExacta, camposTituloResumen);
      if (exactoEnTituloResumen) {
        bucket = 'Menciones_Detectadas';
        confidence = 'medium';
        motivo = `query: match exacto en ${exactoEnTituloResumen.campo}`;
      } else {
        bucket = 'Revision_Humana';
        confidence = 'low';
        motivo = 'query broad: sin match exacto en título/resumen — revisión humana requerida';
      }
    }

    const row = baseRow(args, noticia, {
      identifier,
      matchMode: searchMode,
      dedupeSuffix: 'adhoc',
      bucket,
      confidence,
      motivo,
      fechaExport,
    });
    if (bucket === 'Menciones_Detectadas') {
      mencionesDetectadas.push(row);
    } else {
      revisionHumana.push(row);
    }
  }

  return { notasCapturadas, mencionesDetectadas, revisionHumana };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de Sheets (exportados para testabilidad)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Garantiza que una pestaña exista en el doc dado, creándola si hace falta.
 * NUNCA borra filas ni reordena columnas. Operación segura sobre cualquier
 * spreadsheet abierto via getSpreadsheetById.
 */
export async function ensureTabInDoc(
  doc: GoogleSpreadsheet,
  title: string,
  headers: readonly string[],
): Promise<GoogleSpreadsheetWorksheet> {
  const existing = doc.sheetsByTitle[title];
  if (existing) {
    try {
      await withSheetsRetry(() => existing.loadHeaderRow(), `loadHeaderRow ${title}`);
      if (!existing.headerValues || existing.headerValues.length === 0) {
        await withSheetsRetry(() => existing.setHeaderRow([...headers]), `setHeaderRow ${title}`);
      }
    } catch {
      await withSheetsRetry(() => existing.setHeaderRow([...headers]), `setHeaderRow ${title}`);
    }
    return existing;
  }
  logger.info({ title }, 'Creando pestaña LIVE shadow (no existía)');
  return withSheetsRetry(
    () => doc.addSheet({ title, headerValues: [...headers] }),
    `addSheet ${title}`,
  );
}

/**
 * Lee las dedupe_key existentes en una pestaña. Si la pestaña no existe o está
 * vacía, devuelve un Set vacío (no lanza). Solo lectura.
 */
export async function leerDedupKeys(
  doc: GoogleSpreadsheet,
  tabTitle: string,
): Promise<Set<string>> {
  const sheet = doc.sheetsByTitle[tabTitle];
  if (!sheet) return new Set();
  try {
    await withSheetsRetry(() => sheet.loadHeaderRow(), `loadHeaderRow ${tabTitle}`);
    const rows = await withSheetsRetry(() => sheet.getRows(), `getRows ${tabTitle}`);
    const set = new Set<string>();
    for (const row of rows) {
      const key = String(row.get('dedupe_key') ?? '').trim();
      if (key) set.add(key);
    }
    return set;
  } catch {
    return new Set();
  }
}

/**
 * Hace append de filas a una pestaña del doc, excluyendo las que ya tienen una
 * dedupe_key presente. Devuelve cuántas filas se escribieron y cuántas se
 * omitieron. NUNCA borra ni reemplaza filas.
 */
export async function appendDeduped(
  doc: GoogleSpreadsheet,
  tabTitle: string,
  rows: OutRow[],
  existingKeys: Set<string>,
  maxRows: number,
): Promise<{ appended: number; skipped: number }> {
  const nuevas = rows.filter((r) => {
    const k = String(r['dedupe_key'] ?? '').trim();
    return k !== '' && !existingKeys.has(k);
  });
  const aEscribir = nuevas.slice(0, Math.max(0, maxRows));

  if (aEscribir.length === 0) return { appended: 0, skipped: rows.length - aEscribir.length };

  const sheet = doc.sheetsByTitle[tabTitle];
  if (!sheet) throw new Error(`Pestaña "${tabTitle}" no encontrada en el doc`);

  await withSheetsRetry(() => sheet.loadHeaderRow(), `loadHeaderRow ${tabTitle}`);

  const normToRaw = new Map<string, string>();
  for (const raw of sheet.headerValues) {
    normToRaw.set(normalizeHeader(raw), raw);
  }

  const mapped = aEscribir.map((row) => {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(row)) {
      const rawHeader = normToRaw.get(normalizeHeader(key));
      if (!rawHeader) continue;
      out[rawHeader] = formatValue(value);
    }
    return out;
  });

  await withSheetsRetry(() => sheet.addRows(mapped), `addRows ${tabTitle}`);

  const skipped = rows.length - aEscribir.length;
  return { appended: aEscribir.length, skipped };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

export async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const started = Date.now();
  const fechaExport = new Date().toISOString();

  // Detecta errores de quoting del workflow antes de cualquier otra validación.
  if (args.unknownPositional.length > 0) {
    logger.error(
      { desconocidos: args.unknownPositional },
      `Argumentos posicionales/desconocidos no permitidos: ${args.unknownPositional.join(', ')}. ` +
      'Posible error de quoting en el workflow: un valor con espacios llegó partido. ' +
      'Usa --flag="valor con espacios" o la sintaxis de array de Bash: ARGS+=( "--flag=valor con espacios" ).',
    );
    process.exit(1);
  }

  logger.info(
    {
      dry_run: args.dryRun,
      sheet_id: args.sheetId ? args.sheetId.slice(0, 8) + '...' : null,
      tab_prefix: args.tabPrefix,
      client_id: args.clientId,
      client_name: args.clientName,
      query: args.query,
      exact: args.exact,
      contains: args.contains,
      window_days: args.windowDays,
      limit: args.limit,
      max_rows: args.maxRows,
    },
    '=== Client Live Sheet Export (shadow, append-only, sin alertas) ===',
  );

  // Validación de guardrails.
  if (!args.dryRun && !args.sheetId) {
    logger.error('--sheet-id es requerido cuando dry-run=false. Abortando.');
    process.exit(1);
  }
  const modosBusqueda = [args.clientId, args.query, args.exact, args.contains].filter(Boolean);
  if (modosBusqueda.length === 0) {
    logger.error('Se requiere al menos un modo de búsqueda: --client-id, --query, --exact o --contains.');
    process.exit(1);
  }
  if (args.clientId && (args.query || args.exact || args.contains)) {
    logger.warn('Se usa --client-id como modo primario. Los flags --query/--exact/--contains se ignoran.');
  }

  // ── Paso 1: Fetch noticias del lake ──────────────────────────────────────
  const searchMode: 'query' | 'exact' | 'contains' =
    args.exact ? 'exact' : args.contains ? 'contains' : 'query';

  let noticias: NoticiaLakeRow[];
  let keywords: KeywordActivaRow[] = [];
  let terminosBusqueda: string[] = [];

  if (args.clientId) {
    // Caso A: cargar keywords ANTES de buscar candidatos, y usarlas como
    // términos de búsqueda dirigida (fts/ilike por término) en vez de
    // escanear las últimas N noticias genéricas de la ventana completa.
    // Esto es lo que corrige el problema de recall: antes se traían hasta
    // 500 noticias por fecha_publicacion (sin relación al cliente) y luego
    // se aplicaba matchKeyword encima, perdiendo candidatos fuera de ese top-N.
    const todasKw = await getKeywordsActivas();
    keywords = todasKw.filter((k) => k.cliente_id === args.clientId);
    logger.info({ clientId: args.clientId, keywords: keywords.length }, 'Keywords del cliente cargadas');
    if (keywords.length === 0) {
      logger.warn({ clientId: args.clientId }, 'Sin keywords activas para este cliente. Revisa la configuración.');
    }

    const candidatos = await buscarCandidatosCliente(keywords, args.windowDays);
    noticias = candidatos.noticias;
    terminosBusqueda = candidatos.terminosUsados;
    logger.info(
      { terminos_busqueda: terminosBusqueda.length, terminos_muestra: terminosBusqueda.slice(0, 5) },
      'Términos de búsqueda derivados de keywords activas',
    );
  } else {
    // Caso B: búsqueda ad-hoc con filtro de texto en la query.
    const textFilter =
      args.exact
        ? undefined // para --exact se hace matchKeyword en memoria; se trae la ventana sin filtro texto
        : args.contains
        ? undefined // ídem para --contains
        : args.query
        ? { modo: 'fts' as const, query: args.query }
        : undefined;

    try {
      noticias = await getNoticiasEnVentana({
        windowDays: args.windowDays,
        limit: args.limit,
        textFilter,
      });
    } catch {
      // Fallback ilike si fts falla.
      if (args.query && textFilter?.modo === 'fts') {
        logger.warn('fts falló; usando fallback ILIKE');
        noticias = await getNoticiasEnVentana({
          windowDays: args.windowDays,
          limit: args.limit,
          textFilter: { modo: 'ilike', term: args.query },
        });
      } else {
        throw new Error('Error en búsqueda de noticias del lake');
      }
    }

    // Para exact/contains: aplicar matchKeyword en memoria (igual que search-news-lake).
    if (args.exact || args.contains) {
      const termino = args.exact ?? args.contains!;
      const tipo: 'frase_exacta' | 'contiene' = args.exact ? 'frase_exacta' : 'contiene';
      const reglaAdHoc: KeywordRule = {
        keyword_id: 'AD-HOC', cliente_id: null, keyword: termino,
        terminos: [termino], tipo, regla: null, contextoIncluir: [], contextoExcluir: [],
      };
      const scanLimit = Math.min(2000, Math.max(args.limit * 10, 200));
      if (!noticias.length) {
        noticias = await getNoticiasEnVentana({ windowDays: args.windowDays, limit: scanLimit });
      }
      noticias = noticias
        .filter((n) => matchKeyword(reglaAdHoc, camposDeLake(n)) !== null)
        .slice(0, args.limit);
    }
  }

  logger.info({ noticias_encontradas: noticias.length }, 'Noticias/candidatos del lake cargados');

  // ── Paso 2: Clasificar en buckets ────────────────────────────────────────
  const buckets: BucketRows = args.clientId
    ? procesarCasoCliente(noticias, keywords, args, fechaExport)
    : procesarCasoAdHoc(noticias, args, searchMode, fechaExport);

  logger.info(
    {
      notas_capturadas: buckets.notasCapturadas.length,
      menciones_detectadas: buckets.mencionesDetectadas.length,
      revision_humana: buckets.revisionHumana.length,
    },
    'Clasificación completada',
  );

  // ── Paso 3: Dry-run (plan + preview) ─────────────────────────────────────
  if (args.dryRun) {
    logger.info(
      {
        tabs: [
          `${args.tabPrefix}_01_LIVE_Notas_Capturadas`,
          `${args.tabPrefix}_02_Menciones_Detectadas`,
          `${args.tabPrefix}_03_Revision_Humana`,
          `${args.tabPrefix}_04_Excluidas`,
          `${args.tabPrefix}_05_Comparativo_vs_Actual`,
          `${args.tabPrefix}_06_Logs`,
        ],
        sheet_id: args.sheetId ? `${args.sheetId.slice(0, 8)}...` : '(no pasado)',
        terminos_busqueda_usados: args.clientId ? terminosBusqueda.length : null,
        preview_notas_capturadas: buckets.notasCapturadas.slice(0, 3).map((r) => ({
          dedupe_key: r['dedupe_key'], titulo: r['titulo'], bucket: r['bucket'],
        })),
        preview_menciones: buckets.mencionesDetectadas.slice(0, 3).map((r) => ({
          dedupe_key: r['dedupe_key'], titulo: r['titulo'], motivo: r['motivo'],
          keywords_matched: r['keywords_matched'], match_count: r['match_count'],
        })),
        preview_revision: buckets.revisionHumana.slice(0, 3).map((r) => ({
          dedupe_key: r['dedupe_key'], titulo: r['titulo'], motivo: r['motivo'],
          keywords_matched: r['keywords_matched'], match_count: r['match_count'],
        })),
      },
      '[dry-run] Plan completo — NO se crea tab ni se escribe nada',
    );
    return;
  }

  // ── Paso 4: Escritura real ────────────────────────────────────────────────
  const doc = await getSpreadsheetById(args.sheetId!);

  const tabs = {
    notas: `${args.tabPrefix}_01_LIVE_Notas_Capturadas`,
    menciones: `${args.tabPrefix}_02_Menciones_Detectadas`,
    revision: `${args.tabPrefix}_03_Revision_Humana`,
    excluidas: `${args.tabPrefix}_04_Excluidas`,
    comparativo: `${args.tabPrefix}_05_Comparativo_vs_Actual`,
    logs: `${args.tabPrefix}_06_Logs`,
  };

  // Asegurar que todas las tabs existan.
  await ensureTabInDoc(doc, tabs.notas, LIVE_HEADERS);
  await ensureTabInDoc(doc, tabs.menciones, LIVE_HEADERS);
  await ensureTabInDoc(doc, tabs.revision, LIVE_HEADERS);
  await ensureTabInDoc(doc, tabs.excluidas, LIVE_HEADERS);
  await ensureTabInDoc(doc, tabs.comparativo, COMPARATIVO_HEADERS);
  await ensureTabInDoc(doc, tabs.logs, LOG_HEADERS);

  // Leer dedupe keys existentes en paralelo (solo lectura).
  const [keysNotas, keysMenciones, keysRevision] = await Promise.all([
    leerDedupKeys(doc, tabs.notas),
    leerDedupKeys(doc, tabs.menciones),
    leerDedupKeys(doc, tabs.revision),
  ]);

  // Append con dedup.
  const maxPerTab = Math.max(1, Math.floor(args.maxRows / 3));
  const [resNotas, resMenciones, resRevision] = await Promise.all([
    appendDeduped(doc, tabs.notas, buckets.notasCapturadas, keysNotas, maxPerTab),
    appendDeduped(doc, tabs.menciones, buckets.mencionesDetectadas, keysMenciones, maxPerTab),
    appendDeduped(doc, tabs.revision, buckets.revisionHumana, keysRevision, maxPerTab),
  ]);

  // Readback: verificar que las filas nuevas aparecen.
  const [rbNotas, rbMenciones, rbRevision] = await Promise.all([
    withSheetsRetry(() => doc.sheetsByTitle[tabs.notas]!.getRows(), `readback ${tabs.notas}`),
    withSheetsRetry(() => doc.sheetsByTitle[tabs.menciones]!.getRows(), `readback ${tabs.menciones}`),
    withSheetsRetry(() => doc.sheetsByTitle[tabs.revision]!.getRows(), `readback ${tabs.revision}`),
  ]);

  const mismatch =
    rbNotas.length !== keysNotas.size + resNotas.appended ||
    rbMenciones.length !== keysMenciones.size + resMenciones.appended ||
    rbRevision.length !== keysRevision.size + resRevision.appended;

  const duracionMs = Date.now() - started;
  const totalOmitidas = resNotas.skipped + resMenciones.skipped + resRevision.skipped;

  const logRow: OutRow = {
    fecha_export: fechaExport,
    run_by: RUN_BY,
    source_script: SOURCE_SCRIPT,
    client_id: args.clientId ?? null,
    client_name: args.clientName ?? null,
    query: args.query ?? args.exact ?? args.contains ?? null,
    match_mode: args.clientId ? 'cliente_keyword' : searchMode,
    noticias_escaneadas: noticias.length,
    filas_notas_capturadas: resNotas.appended,
    filas_menciones: resMenciones.appended,
    filas_revision: resRevision.appended,
    filas_excluidas: 0,
    filas_omitidas_dedupe: totalOmitidas,
    mismatch: mismatch ? 'TRUE' : 'FALSE',
    duracion_ms: duracionMs,
  };

  await appendDeduped(doc, tabs.logs, [logRow], new Set(), 1000);

  logger.info(
    {
      filas_notas_capturadas: resNotas.appended,
      filas_menciones: resMenciones.appended,
      filas_revision: resRevision.appended,
      filas_omitidas_dedupe: totalOmitidas,
      mismatch,
      duracion_ms: duracionMs,
    },
    '=== Client Live Sheet Export completado ===',
  );
}

function esEntrypointCli(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (esEntrypointCli()) {
  main().catch((err) => {
    logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Error fatal en client-live-sheet-export');
    process.exit(1);
  });
}
