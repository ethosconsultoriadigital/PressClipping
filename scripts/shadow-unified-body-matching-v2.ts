/**
 * Shadow Unified Matching V2.
 * NO escribe MENCIONES_MASTER. NO alertas. NO Apps Script.
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getSupabase } from '../src/supabase/client.js';
import { getAllClientes, getKeywordsActivas, type KeywordActivaRow } from '../src/supabase/repositories.js';
import { matchKeyword, type TipoKeyword } from '../src/matchers/keyword.js';
import { toKeywordRule } from '../src/matching/detectMentionsCore.js';
import {
  buildTrustedMatchingFields,
  selectTrustedBody,
  type MatchingMode,
} from '../src/matching/trustedBody.js';
import {
  DEFAULT_BODY_PROXIMITY_CHARS,
  isBroadOrContextualKeyword,
} from '../src/matching/bodyProximity.js';
import { bump, emptyBodyMatchingCounters } from '../src/matching/bodyMatchingMetrics.js';
import {
  fetchEligibleNews,
  groupKeywordsByActiveClient,
  type MasterNewsRow,
} from './mentions-master-fast-lane.js';
import { logger } from '../src/utils/logger.js';

const CANARY_ID = '498630e1-5b8e-42d2-b6c5-cbc70387004f';
const SHADOW_FETCH_CAP = 80_000;
const SAMPLE_LIMIT = 40;
const BROAD_SAMPLE = /trabajadores|huelga|presupuesto|tequila|alcohol|reforma|congreso/i;

interface ShadowRow {
  cliente_id: string;
  noticia_id: string;
  medio_id: string | null;
  medio: string | null;
  titulo: string | null;
  keyword: string;
  keyword_id: string;
  tipo_keyword: string;
  campo_match: string;
  keywords_matched: string[];
  keyword_ids_matched: string[];
  calidad_extraccion: string | null;
  body_status: string;
  body_source: string;
  match_count: number;
}

function parseHours(argv: string[]): number {
  const hit = argv.find((a) => a.startsWith('--hours='));
  return hit ? Number(hit.slice('--hours='.length)) || 48 : 48;
}

function signalOnly(n: MasterNewsRow) {
  return buildTrustedMatchingFields(n, { mode: 'current' }).campos;
}

function evalNews(
  n: MasterNewsRow,
  keywordsByClient: Map<string, KeywordActivaRow[]>,
  mode: MatchingMode,
  proximity: boolean,
): ShadowRow[] {
  const packed = buildTrustedMatchingFields(n, {
    mode: mode === 'body_with_proximity' ? 'body_high' : mode,
  });
  const out: ShadowRow[] = [];
  for (const [clientId, kws] of keywordsByClient.entries()) {
    const hits: ShadowRow['keywords_matched'] = [];
    const ids: string[] = [];
    let bestCampo = '';
    let bestKw = '';
    let bestKwId = '';
    let bestTipo = '';
    let bestScore = -1;
    for (const kw of kws) {
      const rule = toKeywordRule(kw);
      const tipo = rule.tipo as TipoKeyword;
      const radius =
        proximity && isBroadOrContextualKeyword(rule.keyword, tipo)
          ? DEFAULT_BODY_PROXIMITY_CHARS
          : undefined;
      const result = matchKeyword(rule, packed.campos, { contextRadius: radius });
      if (!result) continue;
      hits.push(kw.keyword);
      ids.push(kw.keyword_id);
      if (result.score > bestScore) {
        bestScore = result.score;
        bestCampo = result.campo;
        bestKw = kw.keyword;
        bestKwId = kw.keyword_id;
        bestTipo = kw.tipo_keyword;
      }
    }
    if (hits.length === 0) continue;
    out.push({
      cliente_id: clientId,
      noticia_id: n.noticia_id,
      medio_id: n.medio_id,
      medio: n.medio_nombre,
      titulo: n.titulo,
      keyword: bestKw,
      keyword_id: bestKwId,
      tipo_keyword: bestTipo,
      campo_match: bestCampo.toUpperCase(),
      keywords_matched: [...new Set(hits)],
      keyword_ids_matched: [...new Set(ids)],
      calidad_extraccion: n.calidad_extraccion,
      body_status: packed.body.status,
      body_source: packed.body.campo ?? 'NONE',
      match_count: hits.length,
    });
  }
  return out;
}

function classifyBodyOnly(row: ShadowRow, n: MasterNewsRow): string {
  const kw = row.keyword;
  if (BROAD_SAMPLE.test(kw) && /contextual|contiene/i.test(row.tipo_keyword)) {
    return 'LIKELY_FALSE_POSITIVE';
  }
  if (/frase_exacta|exacta/i.test(row.tipo_keyword) && kw.trim().split(/\s+/).length >= 2) {
    return 'LIKELY_TRUE_POSITIVE';
  }
  const raw = n.texto_extraido ?? '';
  if (/notas relacionadas|te puede interesar|más noticias/i.test(raw) && row.body_source === 'texto_cuerpo_nota') {
    return 'NEEDS_REVIEW';
  }
  return 'NEEDS_REVIEW';
}

function summarize(
  label: string,
  news: MasterNewsRow[],
  current: ShadowRow[],
  variant: ShadowRow[],
) {
  const curKeys = new Set(current.map((r) => `${r.cliente_id.toLowerCase()}//${r.noticia_id.toLowerCase()}`));
  const varKeys = new Set(variant.map((r) => `${r.cliente_id.toLowerCase()}//${r.noticia_id.toLowerCase()}`));
  const bodyOnly = variant.filter((r) => !curKeys.has(`${r.cliente_id.toLowerCase()}//${r.noticia_id.toLowerCase()}`));
  const byClient: Record<string, number> = {};
  const byKeyword: Record<string, number> = {};
  const byMedio: Record<string, number> = {};
  const byTipo: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  const byCalidad: Record<string, number> = {};
  const byCampo: Record<string, number> = {};
  for (const r of variant) {
    bump(byClient, r.cliente_id);
    bump(byKeyword, r.keyword_id);
    bump(byMedio, r.medio_id ?? 'NA');
    bump(byTipo, r.tipo_keyword);
    bump(bySource, r.body_source);
    bump(byCalidad, r.calidad_extraccion ?? 'NA');
    bump(byCampo, r.campo_match);
  }
  const bodyOnlyByClient: Record<string, number> = {};
  for (const r of bodyOnly) bump(bodyOnlyByClient, r.cliente_id);
  return {
    label,
    noticias_evaluadas: news.length,
    matches_current: current.length,
    matches_variant: variant.length,
    delta_abs: variant.length - current.length,
    delta_pct: current.length === 0 ? null : Number((((variant.length - current.length) / current.length) * 100).toFixed(2)),
    body_only: bodyOnly.length,
    body_only_by_client: bodyOnlyByClient,
    by_client: byClient,
    by_keyword: byKeyword,
    by_medio: byMedio,
    by_tipo_keyword: byTipo,
    by_body_source: bySource,
    by_calidad: byCalidad,
    by_campo_match: byCampo,
    current_keys: curKeys.size,
    variant_keys: varKeys.size,
    body_only_rows: bodyOnly as ShadowRow[],
  };
}

function publicSummary(s: ReturnType<typeof summarize>) {
  const { body_only_rows: _omit, ...rest } = s;
  return rest;
}

async function lakeSnapshot(hours: number) {
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  const sb = getSupabase();
  const base = () =>
    sb.from('noticias').select('*', { count: 'exact', head: true }).gte('fecha_captura', since);
  const recent = await base();
  const withBody = await sb
    .from('noticias')
    .select('*', { count: 'exact', head: true })
    .gte('fecha_captura', since)
    .not('texto_cuerpo_nota', 'is', null);
  const alta = await sb
    .from('noticias')
    .select('*', { count: 'exact', head: true })
    .gte('fecha_captura', since)
    .eq('calidad_extraccion', 'alta');
  const altaBody = await sb
    .from('noticias')
    .select('*', { count: 'exact', head: true })
    .gte('fecha_captura', since)
    .eq('calidad_extraccion', 'alta')
    .not('texto_cuerpo_nota', 'is', null);
  return {
    hours,
    since,
    recent: recent.count ?? 0,
    with_texto_cuerpo_nota: withBody.count ?? 0,
    calidad_alta: alta.count ?? 0,
    alta_plus_cuerpo: altaBody.count ?? 0,
  };
}

async function canaryCheck(keywordsByClient: Map<string, KeywordActivaRow[]>) {
  const { data, error } = await getSupabase()
    .from('noticias')
    .select(
      'noticia_id, medio_id, titulo, subtitulo, resumen, url_original, fecha_publicacion, fecha_captura, autor, seccion, texto_extraido, texto_nota_limpia, texto_cuerpo_nota, tipo_nota, calidad_extraccion, medios(nombre_medio)',
    )
    .eq('noticia_id', CANARY_ID)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { found: false };
  const n: MasterNewsRow = {
    noticia_id: data.noticia_id,
    medio_id: data.medio_id ?? null,
    medio_nombre: (data as any).medios?.nombre_medio ?? null,
    titulo: data.titulo,
    subtitulo: data.subtitulo,
    resumen: data.resumen,
    url_original: data.url_original,
    fecha_publicacion: data.fecha_publicacion,
    fecha_captura: data.fecha_captura,
    autor: data.autor,
    seccion: data.seccion,
    texto_extraido: data.texto_extraido,
    texto_nota_limpia: data.texto_nota_limpia,
    texto_cuerpo_nota: data.texto_cuerpo_nota,
    tipo_nota: data.tipo_nota,
    calidad_extraccion: data.calidad_extraccion,
  };
  const current = evalNews(n, keywordsByClient, 'current', false);
  const v2 = evalNews(n, keywordsByClient, 'body_high', false);
  return {
    found: true,
    titulo: n.titulo,
    calidad: n.calidad_extraccion,
    cuerpo_chars: (n.texto_cuerpo_nota ?? '').length,
    title_has_mery: /mery/i.test(`${n.titulo ?? ''} ${n.resumen ?? ''}`),
    body_has_mery: /mery/i.test(n.texto_cuerpo_nota ?? ''),
    current_matches: current.filter((r) => r.cliente_id === 'CLI-MERY-TEST'),
    v2_matches: v2.filter((r) => r.cliente_id === 'CLI-MERY-TEST'),
  };
}

async function runWindow(hours: number, keywordsByClient: Map<string, KeywordActivaRow[]>) {
  const sinceIso = new Date(Date.now() - hours * 3600_000).toISOString();
  const news = await fetchEligibleNews(sinceIso, undefined, SHADOW_FETCH_CAP);
  const counters = emptyBodyMatchingCounters();
  const current: ShadowRow[] = [];
  const bodyHigh: ShadowRow[] = [];
  const plusClean: ShadowRow[] = [];
  const withProx: ShadowRow[] = [];
  const newsById = new Map(news.map((n) => [n.noticia_id, n]));
  let i = 0;

  for (const n of news) {
    const body = selectTrustedBody(n, 'body_high_plus_clean');
    if ((n.texto_cuerpo_nota ?? '').trim()) counters.body_available += 1;
    if (body.status === 'BODY_TRUSTED') counters.body_trusted += 1;
    else if (body.status === 'BODY_FALLBACK_CLEAN') counters.body_fallback_clean += 1;
    else if (body.status === 'BODY_REJECTED') counters.body_rejected += 1;
    else counters.no_body += 1;
    if ((n.texto_extraido ?? '').trim() && !(n.texto_cuerpo_nota ?? '').trim() && !(n.texto_nota_limpia ?? '').trim()) {
      counters.raw_text_rejected += 1;
    }
    current.push(...evalNews(n, keywordsByClient, 'current', false));
    const highRows = evalNews(n, keywordsByClient, 'body_high', false);
    bodyHigh.push(...highRows);
    const highBody = selectTrustedBody(n, 'body_high');
    const cleanBody = selectTrustedBody(n, 'body_high_plus_clean');
    if (highBody.status === cleanBody.status && highBody.text === cleanBody.text) {
      plusClean.push(...highRows);
    } else {
      plusClean.push(...evalNews(n, keywordsByClient, 'body_high_plus_clean', false));
    }
    withProx.push(...evalNews(n, keywordsByClient, 'body_with_proximity', true));
    i += 1;
    if (i % 2000 === 0) {
      logger.info({ hours, processed: i, total: news.length }, 'shadow progress');
    }
  }

  const sHigh = summarize(`${hours}h_BODY_HIGH`, news, current, bodyHigh);
  const sClean = summarize(`${hours}h_PLUS_CLEAN`, news, current, plusClean);
  const sProx = summarize(`${hours}h_PROXIMITY`, news, current, withProx);

  for (const r of bodyHigh) {
    const isBody = r.campo_match === 'TEXTO_CUERPO_NOTA' || r.campo_match === 'TEXTO_NOTA_LIMPIA';
    const signalCampos = ['TITULO', 'SUBTITULO', 'RESUMEN', 'SECCION'];
    if (signalCampos.includes(r.campo_match)) counters.signal_matches += 1;
    if (isBody) counters.body_matches += 1;
    if (r.match_count > 1) counters.multi_field_matches += 1;
  }
  counters.body_only_matches = sHigh.body_only;

  const sample = sHigh.body_only_rows.slice(0, SAMPLE_LIMIT).map((r) => {
    const n = newsById.get(r.noticia_id)!;
    return {
      cliente_id: r.cliente_id,
      noticia_id: r.noticia_id,
      medio: r.medio,
      titulo: r.titulo,
      keyword: r.keyword,
      tipo_keyword: r.tipo_keyword,
      campo_match: r.campo_match,
      verdict: classifyBodyOnly(r, n),
    };
  });
  const verdicts: Record<string, number> = {};
  for (const s of sample) bump(verdicts, s.verdict);

  const highKeys = new Set(bodyHigh.map((r) => `${r.cliente_id.toLowerCase()}//${r.noticia_id.toLowerCase()}`));
  const proxKeys = new Set(withProx.map((r) => `${r.cliente_id.toLowerCase()}//${r.noticia_id.toLowerCase()}`));
  const lostToProx = [...highKeys].filter((k) => !proxKeys.has(k)).slice(0, 15).map((k) => {
    const r = bodyHigh.find((x) => `${x.cliente_id.toLowerCase()}//${x.noticia_id.toLowerCase()}` === k)!;
    return {
      cliente_id: r.cliente_id,
      noticia_id: r.noticia_id,
      keyword: r.keyword,
      tipo_keyword: r.tipo_keyword,
    };
  });

  return {
    hours,
    sinceIso,
    fetched: news.length,
    fetch_cap: SHADOW_FETCH_CAP,
    counters,
    current_matches: current.length,
    body_high: publicSummary(sHigh),
    plus_clean: publicSummary(sClean),
    proximity: publicSummary(sProx),
    body_only_sample: sample,
    sample_verdicts: verdicts,
    proximity_drops_vs_body_high: sHigh.matches_variant - sProx.matches_variant,
    proximity_note:
      'Proximity (±400) only on broad/contextual keywords. Proper names like Mery Gómez Pozos stay full-document.',
    lost_to_proximity_sample: lostToProx,
  };
}

async function main(): Promise<void> {
  const hours = parseHours(process.argv.slice(2));
  const windows = hours === 48 ? [48, 168] : [hours];
  const [clients, keywords] = await Promise.all([getAllClientes(), getKeywordsActivas()]);
  const { keywordsByClient } = groupKeywordsByActiveClient(clients, keywords);
  const lake48 = await lakeSnapshot(48);
  const canary = await canaryCheck(keywordsByClient);
  const results: Record<string, unknown> = {};
  for (const h of windows) {
    logger.info({ hours: h }, 'shadow unified body matching window');
    results[`w${h}`] = await runWindow(h, keywordsByClient);
  }
  const payload = {
    generated_at: new Date().toISOString(),
    production_writes: 0,
    master_rows_written: 0,
    alerts_sent: 0,
    body_matching_v2_env: process.env.BODY_MATCHING_V2 ?? null,
    lake_48h: lake48,
    canary,
    results,
  };
  const dir = join(process.cwd(), 'artifacts');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `unified-body-matching-v2-shadow-${new Date().toISOString().slice(0, 10)}.json`);
  writeFileSync(out, JSON.stringify(payload, null, 2));
  logger.info({ out, windows }, 'shadow written (no MASTER writes)');
  console.log(JSON.stringify({ out, lake48, canary_found: canary.found, windows }, null, 2));
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
