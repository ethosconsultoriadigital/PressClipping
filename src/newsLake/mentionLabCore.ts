/**
 * Mention Lab V1 — lógica pura del backfill exhaustivo del News Lake.
 *
 * No escribe `menciones`, no marca `menciones_procesado`, no alerta.
 * El retrieval paginado y Sheets viven en el runner; este módulo es
 * determinístico y testeable sin red.
 */
import {
  matchKeyword,
  splitTerminos,
  PESOS_CAMPO,
  type KeywordRule,
  type CampoBuscable,
  type TipoKeyword,
  type MatchResultado,
} from '../matchers/keyword.js';
import { foldText } from '../matchers/text.js';
import { clasificarCategoriaJumexPorId, type CategoriaJumex } from '../editorial/jumexCriteria.js';
import { clasificarMery, type CategoriaEditorialMery } from '../editorial/meryCriteria.js';
import { clasificarConsolidado } from '../editorial/consolidation.js';

export const LAB_CLIENT_IDS = ['CLI-MERY-TEST', 'CLI-0001', 'CLI-0002'] as const;
export type LabClientId = (typeof LAB_CLIENT_IDS)[number];

export const LAB_TABS = {
  todas: 'MENTIONS_LAB_01_TODAS',
  revision: 'MENTIONS_LAB_02_REVISION',
  logs: 'MENTIONS_LAB_03_LOGS',
  keywords: 'MENTIONS_LAB_04_KEYWORDS',
} as const;

export const LAB_FORBIDDEN_TABS = [
  '01_Noticias_Raw',
  '02_Menciones',
  '03_XML_Export',
  '04_Logs',
  '05_Comparativo_PressClipping',
  '06_Resumen_Diario',
  '07_Metricas_Live',
  '08_Cobertura_Medios',
  '09_Medios_PressClipping',
] as const;

export const PAGE_SIZE_DEFAULT = 400;
export const SAFETY_LIMIT_DEFAULT = 50_000;
export const TEXTO_MAX_CHARS = 5_000;
export const MIN_LEN_TERMINO = 3;
export const TIPOS_VALIDOS: TipoKeyword[] = [
  'exacta',
  'frase_exacta',
  'contiene',
  'booleana',
  'exacta_contextual',
];

export const TODAS_HEADERS = [
  'dedupe_key',
  'lab_run_id',
  'fecha_export',
  'client_id',
  'client_name',
  'noticia_id',
  'medio_id',
  'medio_nombre',
  'grupo_medio',
  'region',
  'categoria',
  'pais',
  'estado',
  'fecha_publicacion',
  'fecha_captura',
  'created_at',
  'titulo',
  'subtitulo',
  'resumen',
  'autor',
  'seccion',
  'url_original',
  'url_canonica',
  'fuente_extraccion',
  'calidad_extraccion',
  'texto_limpio_chars',
  'cuerpo_nota_chars',
  'tipo_nota',
  'keywords_matched',
  'keyword_ids_matched',
  'match_count',
  'best_score',
  'best_match_type',
  'best_match_field',
  'best_match_text',
  'all_match_details',
  'editorial_category',
  'confidence',
  'review_status',
  'texto',
] as const;

export const REVISION_HEADERS = TODAS_HEADERS;

export const LOG_HEADERS = [
  'lab_run_id',
  'fecha_export',
  'client_id',
  'client_name',
  'window_days',
  'run_cutoff',
  'window_start',
  'active_keywords',
  'unique_search_terms',
  'pages_executed',
  'raw_rows_fetched',
  'unique_candidates',
  'candidates_deduped',
  'matched_unique_news',
  'high_confidence',
  'review',
  'zero_match_keywords',
  'keywords_with_hits',
  'safety_limit_hit',
  'complete',
  'infra_error',
  'dry_run',
  'duration_ms',
] as const;

export const KEYWORDS_HEADERS = [
  'lab_run_id',
  'client_id',
  'client_name',
  'keyword_id',
  'keyword',
  'alias_o_variantes',
  'tipo_keyword',
  'prioridad',
  'alerta',
  'contexto_incluir',
  'contexto_excluir',
  'activa',
] as const;

export interface LabKeywordRow {
  keyword_id: string;
  cliente_id: string | null;
  keyword: string;
  alias_o_variantes: string | null;
  tipo_keyword: string;
  regla: string | null;
  contexto_incluir: string | null;
  contexto_excluir: string | null;
  alerta: boolean;
  prioridad: string | null;
  activa: boolean;
}

export interface LabNewsRow {
  noticia_id: string;
  medio_id: string | null;
  medio_nombre: string | null;
  grupo_medio: string | null;
  region: string | null;
  categoria: string | null;
  pais: string | null;
  estado: string | null;
  fecha_publicacion: string | null;
  fecha_captura: string | null;
  created_at: string | null;
  titulo: string | null;
  subtitulo: string | null;
  resumen: string | null;
  autor: string | null;
  seccion: string | null;
  url_original: string | null;
  url_canonica: string | null;
  fuente_extraccion: string | null;
  calidad_extraccion: string | null;
  texto_limpio_chars: number | null;
  cuerpo_nota_chars: number | null;
  tipo_nota: string | null;
  texto_extraido: string | null;
  texto_nota_limpia: string | null;
  texto_cuerpo_nota: string | null;
}

export interface RetrievedTerm {
  term: string;
  keyword_ids: string[];
}

export interface MatchDetail {
  keyword_id: string;
  keyword: string;
  retrieval_term: string;
  tipo_keyword: TipoKeyword;
  campo_match: string;
  texto_match: string;
  score: number;
}

export interface ConsolidatedMention {
  client_id: string;
  client_name: string;
  news: LabNewsRow;
  matches: MatchDetail[];
  best: MatchDetail;
  editorial_category: string;
  confidence: 'high' | 'medium';
  review_status: 'ok' | 'review';
  review_reasons: string[];
}

export interface ClientCompleteness {
  client_id: string;
  client_name: string;
  active_keywords: number;
  unique_search_terms: number;
  pages_executed: number;
  raw_rows_fetched: number;
  unique_candidates: number;
  candidates_deduped: number;
  matched_unique_news: number;
  high_confidence: number;
  review: number;
  zero_match_keywords: string[];
  keywords_with_hits: string[];
  safety_limit_hit: boolean;
  complete: boolean;
  infra_error: string | null;
}

export interface CandidateIndex {
  byId: Map<string, LabNewsRow>;
  byUrl: Map<string, string>;
  retrievalTermById: Map<string, string>;
}

export function isLabClientId(raw: string): raw is LabClientId {
  return (LAB_CLIENT_IDS as readonly string[]).includes(raw);
}

export function freezeWindow(cutoffIso: string, windowDays: number): { cutoff: string; windowStart: string } {
  const cutoffMs = Date.parse(cutoffIso);
  if (!Number.isFinite(cutoffMs) || windowDays <= 0) {
    throw new Error(`ventana inválida: cutoff=${cutoffIso} windowDays=${windowDays}`);
  }
  return {
    cutoff: new Date(cutoffMs).toISOString(),
    windowStart: new Date(cutoffMs - windowDays * 24 * 60 * 60 * 1000).toISOString(),
  };
}

export function toKeywordRule(kw: LabKeywordRow): KeywordRule {
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

/**
 * Términos de búsqueda desde keyword + TODOS los alias. Sin tope de 15.
 * Dedup por forma plegada; conserva la representación original más larga.
 */
export function extraerTerminosBusquedaLab(
  keywords: LabKeywordRow[],
  minLen: number = MIN_LEN_TERMINO,
): RetrievedTerm[] {
  const byFold = new Map<string, RetrievedTerm>();
  for (const kw of keywords.filter((k) => k.activa)) {
    for (const raw of splitTerminos(kw.keyword, kw.alias_o_variantes)) {
      const t = raw.trim();
      if (t.length < minLen) continue;
      const key = foldText(t);
      const existing = byFold.get(key);
      if (!existing) {
        byFold.set(key, { term: t, keyword_ids: [kw.keyword_id] });
        continue;
      }
      if (!existing.keyword_ids.includes(kw.keyword_id)) existing.keyword_ids.push(kw.keyword_id);
      if (t.length > existing.term.length) existing.term = t;
    }
  }
  return [...byFold.values()].sort((a, b) => b.term.length - a.term.length || a.term.localeCompare(b.term));
}

export function normalizeUrl(url: string | null | undefined): string {
  return (url ?? '').trim().toLowerCase().replace(/\/+$/, '');
}

export function buildDedupeKey(clientId: string, noticiaId: string): string {
  return `${clientId}//${noticiaId}`;
}

export function emptyCandidateIndex(): CandidateIndex {
  return { byId: new Map(), byUrl: new Map(), retrievalTermById: new Map() };
}

/** Inserta candidatos; retorna cuántos eran nuevos vs duplicados. */
export function ingestCandidates(
  index: CandidateIndex,
  rows: LabNewsRow[],
  retrievalTerm: string,
  safetyLimit: number,
): { added: number; deduped: number; safetyHit: boolean } {
  let added = 0;
  let deduped = 0;
  for (const row of rows) {
    if (index.byId.size >= safetyLimit) return { added, deduped, safetyHit: true };
    if (!row.noticia_id) {
      deduped += 1;
      continue;
    }
    if (index.byId.has(row.noticia_id)) {
      deduped += 1;
      continue;
    }
    const url = normalizeUrl(row.url_original) || normalizeUrl(row.url_canonica);
    if (url && index.byUrl.has(url)) {
      deduped += 1;
      continue;
    }
    index.byId.set(row.noticia_id, row);
    if (url) index.byUrl.set(url, row.noticia_id);
    if (!index.retrievalTermById.has(row.noticia_id)) {
      index.retrievalTermById.set(row.noticia_id, retrievalTerm);
    }
    added += 1;
  }
  return { added, deduped, safetyHit: index.byId.size >= safetyLimit };
}

export function textoPreferido(row: LabNewsRow): string {
  return (row.texto_cuerpo_nota || row.texto_nota_limpia || row.texto_extraido || row.resumen || '').trim();
}

export function truncarTexto(s: string, max: number = TEXTO_MAX_CHARS): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function camposDeLab(row: LabNewsRow): CampoBuscable[] {
  const cuerpo = textoPreferido(row);
  return [
    { nombre: 'titulo', texto: row.titulo ?? '', peso: PESOS_CAMPO.titulo! },
    { nombre: 'subtitulo', texto: row.subtitulo ?? '', peso: PESOS_CAMPO.subtitulo! },
    { nombre: 'resumen', texto: row.resumen ?? '', peso: PESOS_CAMPO.resumen! },
    { nombre: 'seccion', texto: row.seccion ?? '', peso: PESOS_CAMPO.seccion! },
    { nombre: 'texto_extraido', texto: cuerpo, peso: PESOS_CAMPO.texto_extraido! },
    { nombre: 'medio', texto: row.medio_nombre ?? '', peso: PESOS_CAMPO.medio! },
  ];
}

export function matchAllRules(
  row: LabNewsRow,
  rules: KeywordRule[],
  retrievalTerm: string,
): MatchDetail[] {
  const campos = camposDeLab(row);
  const out: MatchDetail[] = [];
  for (const rule of rules) {
    const hit: MatchResultado | null = matchKeyword(rule, campos);
    if (!hit) continue;
    out.push({
      keyword_id: rule.keyword_id,
      keyword: rule.keyword,
      retrieval_term: retrievalTerm,
      tipo_keyword: hit.tipo_match,
      campo_match: hit.campo,
      texto_match: hit.texto_match,
      score: hit.score,
    });
  }
  return out.sort((a, b) => b.score - a.score || a.keyword_id.localeCompare(b.keyword_id));
}

export function editorialCategory(
  clientId: string,
  matches: MatchDetail[],
  news: LabNewsRow,
): string {
  const keywords = [...new Set(matches.map((m) => m.keyword))];
  const titulo = news.titulo ?? '';
  const cuerpo = textoPreferido(news);
  if (clientId === 'CLI-0001') {
    const cats = matches.map((m) => clasificarCategoriaJumexPorId(m.keyword_id));
    const rank: Record<CategoriaJumex, number> = {
      MARCA_DIRECTA: 5,
      SECTOR_REGULATORIO_ALTO: 4,
      PRODUCTO_CATEGORIA: 3,
      SECTOR_GENERAL: 2,
      EXCLUIR: 1,
    };
    return cats.reduce((best, c) => (rank[c] > rank[best] ? c : best), cats[0] ?? 'SECTOR_GENERAL');
  }
  if (clientId === 'CLI-MERY-TEST') {
    const cats = matches.map((m) => clasificarMery(titulo, m.keyword_id, cuerpo));
    const rank: Record<CategoriaEditorialMery, number> = {
      POSIBLE_FP: 5,
      MENCION_DIRECTA: 4,
      CONTEXTO_POLITICO: 3,
      TEMA_RELACIONADO: 2,
      EXCLUIR: 1,
    };
    return cats.reduce((best, c) => (rank[c] > rank[best] ? c : best), cats[0] ?? 'TEMA_RELACIONADO');
  }
  if (clientId === 'CLI-0002') {
    return clasificarConsolidado(clientId, keywords, titulo).grupo_tema;
  }
  return '';
}

export function reviewDecision(
  clientId: string,
  best: MatchDetail,
  matches: MatchDetail[],
  category: string,
  titulo: string,
): { review_status: 'ok' | 'review'; confidence: 'high' | 'medium'; reasons: string[] } {
  const reasons: string[] = [];
  if (best.score < 0.6) reasons.push('score_bajo');
  if (best.tipo_keyword === 'exacta_contextual' && best.score < 1) reasons.push('contextual');
  if (clientId === 'CLI-0001' && category === 'EXCLUIR') reasons.push('categoria_excluible');
  if (clientId === 'CLI-MERY-TEST' && (category === 'POSIBLE_FP' || category === 'TEMA_RELACIONADO')) {
    reasons.push(category === 'POSIBLE_FP' ? 'ambiguedad' : 'contextual');
  }
  if (clientId === 'CLI-0002') {
    const cons = clasificarConsolidado(
      clientId,
      matches.map((m) => m.keyword),
      titulo,
    );
    if (cons.estado_editorial === 'REVISAR') reasons.push('ambiguedad');
  }
  const review = reasons.length > 0;
  return {
    review_status: review ? 'review' : 'ok',
    confidence: best.score >= 0.6 ? 'high' : 'medium',
    reasons: [...new Set(reasons)],
  };
}

export function consolidateClient(
  clientId: string,
  clientName: string,
  index: CandidateIndex,
  rules: KeywordRule[],
): ConsolidatedMention[] {
  const out: ConsolidatedMention[] = [];
  for (const [id, news] of index.byId) {
    const term = index.retrievalTermById.get(id) ?? '';
    const matches = matchAllRules(news, rules, term);
    if (matches.length === 0) continue;
    const best = matches[0]!;
    const category = editorialCategory(clientId, matches, news);
    const rev = reviewDecision(clientId, best, matches, category, news.titulo ?? '');
    out.push({
      client_id: clientId,
      client_name: clientName,
      news,
      matches,
      best,
      editorial_category: category,
      confidence: rev.confidence,
      review_status: rev.review_status,
      review_reasons: rev.reasons,
    });
  }
  out.sort((a, b) => (b.news.fecha_publicacion ?? '').localeCompare(a.news.fecha_publicacion ?? '') || a.news.noticia_id.localeCompare(b.news.noticia_id));
  return out;
}

export function completenessOf(
  clientId: string,
  clientName: string,
  keywords: LabKeywordRow[],
  terms: RetrievedTerm[],
  pages: number,
  rawFetched: number,
  index: CandidateIndex,
  mentions: ConsolidatedMention[],
  safetyHit: boolean,
  infraError: string | null,
): ClientCompleteness {
  const hitIds = new Set(mentions.flatMap((m) => m.matches.map((x) => x.keyword_id)));
  const active = keywords.filter((k) => k.activa);
  const zero = active.filter((k) => !hitIds.has(k.keyword_id)).map((k) => k.keyword_id);
  return {
    client_id: clientId,
    client_name: clientName,
    active_keywords: active.length,
    unique_search_terms: terms.length,
    pages_executed: pages,
    raw_rows_fetched: rawFetched,
    unique_candidates: index.byId.size,
    candidates_deduped: Math.max(0, rawFetched - index.byId.size),
    matched_unique_news: mentions.length,
    high_confidence: mentions.filter((m) => m.confidence === 'high' && m.review_status === 'ok').length,
    review: mentions.filter((m) => m.review_status === 'review').length,
    zero_match_keywords: zero,
    keywords_with_hits: active.filter((k) => hitIds.has(k.keyword_id)).map((k) => k.keyword_id),
    safety_limit_hit: safetyHit,
    complete: !safetyHit && !infraError && active.length > 0,
    infra_error: infraError,
  };
}

export function filterNewRows<T extends { dedupe_key: string }>(
  rows: T[],
  existing: Set<string>,
): { toWrite: T[]; skipped: number } {
  const toWrite = rows.filter((r) => r.dedupe_key && !existing.has(r.dedupe_key));
  return { toWrite, skipped: rows.length - toWrite.length };
}

export function rowTodas(
  m: ConsolidatedMention,
  labRunId: string,
  fechaExport: string,
): Record<string, string | number | boolean | null> {
  const details = m.matches.map((x) => ({
    keyword_id: x.keyword_id,
    keyword: x.keyword,
    retrieval_term: x.retrieval_term,
    tipo: x.tipo_keyword,
    campo: x.campo_match,
    score: x.score,
    texto_match: x.texto_match,
  }));
  return {
    dedupe_key: buildDedupeKey(m.client_id, m.news.noticia_id),
    lab_run_id: labRunId,
    fecha_export: fechaExport,
    client_id: m.client_id,
    client_name: m.client_name,
    noticia_id: m.news.noticia_id,
    medio_id: m.news.medio_id,
    medio_nombre: m.news.medio_nombre,
    grupo_medio: m.news.grupo_medio,
    region: m.news.region,
    categoria: m.news.categoria,
    pais: m.news.pais,
    estado: m.news.estado,
    fecha_publicacion: m.news.fecha_publicacion,
    fecha_captura: m.news.fecha_captura,
    created_at: m.news.created_at,
    titulo: m.news.titulo,
    subtitulo: m.news.subtitulo,
    resumen: m.news.resumen,
    autor: m.news.autor,
    seccion: m.news.seccion,
    url_original: m.news.url_original,
    url_canonica: m.news.url_canonica,
    fuente_extraccion: m.news.fuente_extraccion,
    calidad_extraccion: m.news.calidad_extraccion,
    texto_limpio_chars: m.news.texto_limpio_chars,
    cuerpo_nota_chars: m.news.cuerpo_nota_chars,
    tipo_nota: m.news.tipo_nota,
    keywords_matched: m.matches.map((x) => x.keyword).join(' | '),
    keyword_ids_matched: m.matches.map((x) => x.keyword_id).join('|'),
    match_count: m.matches.length,
    best_score: m.best.score,
    best_match_type: m.best.tipo_keyword,
    best_match_field: m.best.campo_match,
    best_match_text: m.best.texto_match,
    all_match_details: JSON.stringify(details),
    editorial_category: m.editorial_category,
    confidence: m.confidence,
    review_status: m.review_status,
    texto: truncarTexto(textoPreferido(m.news)),
  };
}

export function assertWriteAllowed(metrics: ClientCompleteness[]): { ok: true } | { ok: false; reason: string } {
  if (metrics.length === 0) return { ok: false, reason: 'sin clientes' };
  for (const m of metrics) {
    if (m.active_keywords < 1) return { ok: false, reason: `${m.client_id} sin keywords activas` };
    if (!m.complete) return { ok: false, reason: `${m.client_id} complete=false` };
    if (m.safety_limit_hit) return { ok: false, reason: `${m.client_id} safety_limit_hit` };
    if (m.infra_error) return { ok: false, reason: `${m.client_id} infra_error` };
  }
  return { ok: true };
}

export function escapeIlikeTerm(term: string): string {
  return term.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_').replace(/,/g, ' ');
}

export function assertLabTabAllowed(title: string): void {
  if ((LAB_FORBIDDEN_TABS as readonly string[]).includes(title)) {
    throw new Error(`LAB no puede escribir en tab prohibida: ${title}`);
  }
  const allowed: string[] = Object.values(LAB_TABS);
  if (!allowed.includes(title)) {
    throw new Error(`LAB tab desconocida: ${title}`);
  }
}

export function labRunIdFromCutoff(cutoffIso: string): string {
  return `LAB-${cutoffIso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}`;
}

export function rowKeywordSnapshot(
  labRunId: string,
  clientId: string,
  clientName: string,
  kw: LabKeywordRow,
): Record<string, string | number | boolean | null> {
  return {
    lab_run_id: labRunId,
    client_id: clientId,
    client_name: clientName,
    keyword_id: kw.keyword_id,
    keyword: kw.keyword,
    alias_o_variantes: kw.alias_o_variantes,
    tipo_keyword: kw.tipo_keyword,
    prioridad: kw.prioridad,
    alerta: kw.alerta,
    contexto_incluir: kw.contexto_incluir,
    contexto_excluir: kw.contexto_excluir,
    activa: kw.activa,
  };
}

export function rowLog(
  metrics: ClientCompleteness,
  labRunId: string,
  fechaExport: string,
  windowDays: number,
  cutoff: string,
  windowStart: string,
  dryRun: boolean,
  durationMs: number,
): Record<string, string | number | boolean | null> {
  return {
    lab_run_id: labRunId,
    fecha_export: fechaExport,
    client_id: metrics.client_id,
    client_name: metrics.client_name,
    window_days: windowDays,
    run_cutoff: cutoff,
    window_start: windowStart,
    active_keywords: metrics.active_keywords,
    unique_search_terms: metrics.unique_search_terms,
    pages_executed: metrics.pages_executed,
    raw_rows_fetched: metrics.raw_rows_fetched,
    unique_candidates: metrics.unique_candidates,
    candidates_deduped: metrics.candidates_deduped,
    matched_unique_news: metrics.matched_unique_news,
    high_confidence: metrics.high_confidence,
    review: metrics.review,
    zero_match_keywords: metrics.zero_match_keywords.join('|'),
    keywords_with_hits: metrics.keywords_with_hits.join('|'),
    safety_limit_hit: metrics.safety_limit_hit,
    complete: metrics.complete,
    infra_error: metrics.infra_error,
    dry_run: dryRun,
    duration_ms: durationMs,
  };
}
