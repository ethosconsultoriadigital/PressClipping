/**
 * V7 operational hardening dry-run. 0 MASTER / News Lake / gap / alert writes.
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getAllClientes, getKeywordsActivas } from '../src/supabase/repositories.js';
import { getSpreadsheetById } from '../src/sheets/client.js';
import { getSupabase } from '../src/supabase/client.js';
import { toKeywordRule } from '../src/matching/detectMentionsCore.js';
import { evaluateKeywordContextPolicy, matchKeyword } from '../src/matchers/keyword.js';
import { anyWordPresent, foldText } from '../src/matchers/text.js';
import { buildTrustedMatchingFields } from '../src/matching/trustedBody.js';
import {
  MERY_FRASE_EXACTA_BODY_KEYWORD_IDS,
  MERY_CONTEXTUAL_BODY_CANDIDATE_IDS,
  MERY_BODY_ALLOWLIST_FULL,
  isBodyCampo,
} from '../src/matching/masterBodyCanary.js';
import { emptyBodyMatchingCounters } from '../src/matching/bodyMatchingMetrics.js';
import {
  DEEP_RECOVERY_WINDOW_HOURS,
  LIVE_WINDOW_HOURS,
  RECOVERY_WINDOW_HOURS,
  windowSinceHours,
} from '../src/matching/matchWindows.js';
import { runGoogleGapRadar } from './google-news-gap-radar.js';
import {
  buildRows,
  fetchEligibleNewsPaged,
  groupKeywordsByActiveClient,
  loadExistingKeys,
  RECOVERY_FETCH_CAP,
  type MasterNewsRow,
} from './mentions-master-fast-lane.js';

const ALLOW = [...MERY_FRASE_EXACTA_BODY_KEYWORD_IDS];
const MASTER_SHEET = '1T4-RLnBrK0lp3p-r23hRjrJAmI03QLzBavWM3ZpcmOA';
const INFORMADOR_IDS = [
  '7a790fdf-49bb-47c9-8153-d341614c14a7',
  'c00957ec-4bb7-4f66-85ba-e4965e02678b',
  'cde2e64c-767d-41a0-ac31-793ea9cff836',
];
const signalOpts = { masterBodyV2: false as const, mode: 'current' as const };
const allowOpts = {
  masterBodyV2: true as const,
  bodyPolicy: 'allowlist' as const,
  keywordAllowlist: ALLOW,
  mode: 'body_v4' as const,
};

type OutRow = Record<string, string | number | boolean | null>;

function wouldAppend(rows: OutRow[], existing: Set<string>): OutRow[] {
  return rows.filter((r) => {
    const k = String(r['dedupe_key'] ?? '').trim().toLowerCase();
    return k && !existing.has(k);
  });
}

function mapNews(n: Record<string, unknown>): MasterNewsRow {
  const medios = n.medios as { nombre_medio?: string } | null;
  return {
    noticia_id: String(n.noticia_id ?? ''),
    medio_id: (n.medio_id as string | null) ?? null,
    medio_nombre: medios?.nombre_medio ?? null,
    titulo: (n.titulo as string | null) ?? null,
    subtitulo: (n.subtitulo as string | null) ?? null,
    resumen: (n.resumen as string | null) ?? null,
    url_original: (n.url_original as string | null) ?? null,
    fecha_publicacion: (n.fecha_publicacion as string | null) ?? null,
    fecha_captura: (n.fecha_captura as string | null) ?? null,
    autor: (n.autor as string | null) ?? null,
    seccion: (n.seccion as string | null) ?? null,
    texto_extraido: (n.texto_extraido as string | null) ?? null,
    texto_nota_limpia: (n.texto_nota_limpia as string | null) ?? null,
    texto_cuerpo_nota: (n.texto_cuerpo_nota as string | null) ?? null,
    tipo_nota: (n.tipo_nota as string | null) ?? null,
    calidad_extraccion: (n.calidad_extraccion as string | null) ?? null,
  };
}

function recoveryReport(opts: {
  hours: number;
  windowStart: string;
  news: MasterNewsRow[];
  pagesScanned: number;
  capHit: boolean;
  signalRows: OutRow[];
  allowRows: OutRow[];
  existing: Set<string>;
}) {
  const signalKeys = new Set(opts.signalRows.map((r) => String(r['dedupe_key']).toLowerCase()));
  const allowlistBody = opts.allowRows.filter((r) => {
    const campo = String(r['campo_match'] ?? '');
    return /texto_cuerpo_nota|texto_nota_limpia/i.test(campo) && !signalKeys.has(String(r['dedupe_key']).toLowerCase());
  });
  const would = wouldAppend(opts.allowRows, opts.existing);
  const newsById = new Map(opts.news.map((n) => [n.noticia_id, n]));
  let missing_title = 0;
  let missing_summary = 0;
  let missing_url = 0;
  let recovered_due_to_null_metadata = 0;
  let recovered_due_to_window_overlap = 0;
  const liveSince = windowSinceHours(LIVE_WINDOW_HOURS);
  for (const r of would) {
    const n = newsById.get(String(r['NOTICIA'] ?? ''));
    if (!n) continue;
    const mt = !n.titulo?.trim();
    const ms = !n.resumen?.trim();
    const mu = !n.url_original?.trim();
    if (mt) missing_title += 1;
    if (ms) missing_summary += 1;
    if (mu) missing_url += 1;
    if (mt || ms || mu) recovered_due_to_null_metadata += 1;
    if ((n.fecha_captura ?? '') < liveSince) recovered_due_to_window_overlap += 1;
  }
  return {
    window_start: opts.windowStart,
    window_end: new Date().toISOString(),
    news_scanned: opts.news.length,
    pages_scanned: opts.pagesScanned,
    cap_hit: opts.capHit,
    RECOVERY_INCOMPLETE: opts.capHit,
    signal_matches: opts.signalRows.length,
    allowlist_body_matches: allowlistBody.length,
    would_append: would.length,
    appended: 0,
    dedupe_skipped: opts.allowRows.length - would.length,
    missing_title,
    missing_summary,
    missing_url,
    recovered_due_to_null_metadata,
    recovered_due_to_window_overlap,
  };
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const since24 = windowSinceHours(RECOVERY_WINDOW_HOURS);
  const since72 = windowSinceHours(DEEP_RECOVERY_WINDOW_HOURS);
  const [clients, keywords] = await Promise.all([getAllClientes(), getKeywordsActivas()]);
  const { keywordsByClient, clientNames } = groupKeywordsByActiveClient(clients, keywords);
  const kwById = new Map(keywords.map((k) => [k.keyword_id, k]));

  const { data: informadorRaw, error: informadorErr } = await getSupabase()
    .from('noticias')
    .select(
      'noticia_id, medio_id, titulo, subtitulo, resumen, url_original, fecha_publicacion, fecha_captura, autor, seccion, texto_extraido, texto_nota_limpia, texto_cuerpo_nota, tipo_nota, calidad_extraccion, medios(nombre_medio)',
    )
    .in('noticia_id', INFORMADOR_IDS);
  if (informadorErr) throw new Error(informadorErr.message);
  const informadorNews = (informadorRaw ?? []).map((n) => mapNews(n as Record<string, unknown>));

  const tFetch = Date.now();
  const paged = await fetchEligibleNewsPaged(since72, undefined, RECOVERY_FETCH_CAP);
  const fetchMs = Date.now() - tFetch;
  const news72 = paged.rows;
  const news24 = news72.filter((n) => (n.fecha_captura ?? '') >= since24);

  const tMatch = Date.now();
  const signal24 = buildRows(news24, keywordsByClient, clientNames, signalOpts);
  const allow24 = buildRows(news24, keywordsByClient, clientNames, {
    ...allowOpts,
    metrics: emptyBodyMatchingCounters(),
  });
  const match24Ms = Date.now() - tMatch;
  const t72 = Date.now();
  const signal72 = buildRows(news72, keywordsByClient, clientNames, signalOpts);
  const allow72 = buildRows(news72, keywordsByClient, clientNames, allowOpts);
  const match72Ms = Date.now() - t72;

  let existing = new Set<string>();
  try {
    const doc = await getSpreadsheetById(MASTER_SHEET);
    const sheet = doc.sheetsByTitle['MENCIONES_MASTER'];
    if (sheet) existing = await loadExistingKeys(sheet);
  } catch {
    /* dry-run continues */
  }

  const sig24w = wouldAppend(signal24, existing);
  const all24w = wouldAppend(allow24, existing);
  const signalKeySet = new Set(sig24w.map((r) => String(r['dedupe_key']).toLowerCase()));
  const allowExtra = all24w.filter((r) => !signalKeySet.has(String(r['dedupe_key']).toLowerCase()));

  const informadorSignal = INFORMADOR_IDS.map((id) => {
    const n = informadorNews.find((x) => x.noticia_id === id);
    const signalRows = n ? buildRows([n], keywordsByClient, clientNames, signalOpts) : [];
    const allowRows = n ? buildRows([n], keywordsByClient, clientNames, allowOpts) : [];
    const key = signalRows[0] ? String(signalRows[0]['dedupe_key']).toLowerCase() : '';
    const inMaster = key ? existing.has(key) : false;
    return {
      noticia_id: id,
      found_in_lake: Boolean(n),
      titulo: n?.titulo ?? null,
      resumen: n?.resumen ?? null,
      fecha_captura: n?.fecha_captura ?? null,
      in_24h_window: Boolean(n && (n.fecha_captura ?? '') >= since24),
      in_72h_window: Boolean(n && (n.fecha_captura ?? '') >= since72),
      signal_match: signalRows[0] ?? null,
      campo_match: signalRows[0]?.['campo_match'] ?? null,
      keyword_id: signalRows[0]?.['keyword_id'] ?? null,
      in_master: inMaster,
      would_append_signal: Boolean(signalRows[0] && !inMaster),
      allowlist_campo: allowRows[0]?.['campo_match'] ?? null,
    };
  });

  const contextualKws = keywords.filter((k) =>
    (MERY_CONTEXTUAL_BODY_CANDIDATE_IDS as readonly string[]).includes(k.keyword_id),
  );
  const contextualMatches = [];
  let trueContextInvalid = 0;
  for (const n of news72) {
    const signalPacked = buildTrustedMatchingFields(n, { mode: 'current' });
    const bodyPacked = buildTrustedMatchingFields(n, { mode: 'body_v4' });
    for (const kw of contextualKws) {
      const rule = toKeywordRule(kw);
      const ungated = { ...rule, contextoIncluir: [] as string[], contextoExcluir: [] as string[] };
      const termHit = matchKeyword(ungated, bodyPacked.campos);
      if (!termHit || (!isBodyCampo(termHit.campo) && !/texto_nota_limpia/i.test(termHit.campo))) continue;
      const signalHit = matchKeyword(ungated, signalPacked.campos);
      if (signalHit) continue;
      const gatedHit = matchKeyword(rule, bodyPacked.campos);
      const ctx = evaluateKeywordContextPolicy(rule, bodyPacked.campos);
      const folded = foldText(bodyPacked.campos.map((c) => c.texto).join('\n'));
      const includeHit = rule.contextoIncluir.length === 0 || anyWordPresent(rule.contextoIncluir, folded);
      const excludeHit = rule.contextoExcluir.length > 0 && anyWordPresent(rule.contextoExcluir, folded);
      if (gatedHit && !ctx.pasa) trueContextInvalid += 1;
      const verdict = gatedHit && ctx.pasa ? 'VALID' : 'INVALID';
      contextualMatches.push({
        keyword_id: kw.keyword_id,
        noticia_id: n.noticia_id,
        medio: n.medio_nombre,
        title: n.titulo,
        snippet: termHit.texto_match,
        campo: termHit.campo,
        context_include_hit: includeHit,
        context_exclude_hit: excludeHit,
        matcher_verdict: verdict,
      });
    }
  }

  const tG = Date.now();
  const radar = await runGoogleGapRadar({ batchSize: 12, persistCursor: false });
  const googleMs = Date.now() - tG;

  const recovery24 = recoveryReport({
    hours: 24,
    windowStart: since24,
    news: news24,
    pagesScanned: paged.pagesScanned,
    capHit: paged.capHit,
    signalRows: signal24,
    allowRows: allow24,
    existing,
  });
  const recovery72 = recoveryReport({
    hours: 72,
    windowStart: since72,
    news: news72,
    pagesScanned: paged.pagesScanned,
    capHit: paged.capHit,
    signalRows: signal72,
    allowRows: allow72,
    existing,
  });

  const payload = {
    production_writes: 0,
    alerts_sent: 0,
    whatsapp_sent: 0,
    email_sent: 0,
    twilio_sent: 0,
    SIGNAL_WOULD_APPEND_24H: sig24w.length,
    ALLOWLIST_WOULD_APPEND_24H: all24w.length,
    SIGNAL_ONLY_KEYS: sig24w.map((r) => ({
      noticia_id: r['NOTICIA'],
      keyword_id: r['keyword_id'],
      campo_match: r['campo_match'],
      dedupe_key: r['dedupe_key'],
    })),
    ALLOWLIST_EXTRA_KEYS: allowExtra.map((r) => ({
      noticia_id: r['NOTICIA'],
      keyword_id: r['keyword_id'],
      campo_match: r['campo_match'],
      titulo: r['titulo / titular'],
      medio: r['medio'],
    })),
    INFORMADOR: informadorSignal,
    MERY_CONTEXTUAL_0048_0051_MATCHES: contextualMatches.filter((m) => m.matcher_verdict === 'VALID').length,
    MERY_CONTEXTUAL_TRUE_INVALID: trueContextInvalid,
    MERY_CONTEXTUAL_GATED_OUT: contextualMatches.filter((m) => m.matcher_verdict === 'INVALID').length,
    MERY_CONTEXTUAL_SAMPLES: contextualMatches.slice(0, 40),
    MERY_FULL_ALLOWLIST_RECOMMENDATION:
      trueContextInvalid === 0 ? [...MERY_BODY_ALLOWLIST_FULL] : 'BLOCKED_TRUE_CONTEXT_INVALID',
    RECOVERY_24H_DRY: recovery24,
    RECOVERY_72H_DRY: recovery72,
    radar: {
      QUERY_TOTAL: radar.QUERY_TOTAL,
      QUERY_PROCESSED: radar.QUERY_PROCESSED,
      QUERY_CURSOR_DURABLE: radar.QUERY_CURSOR_DURABLE,
      GOOGLE_ALREADY_IN_LAKE: radar.GOOGLE_ALREADY_IN_LAKE,
      GOOGLE_MISSING_KNOWN: radar.GOOGLE_MISSING_KNOWN,
      GOOGLE_AMBIGUOUS: radar.GOOGLE_AMBIGUOUS,
      GOOGLE_UNKNOWN: radar.GOOGLE_UNKNOWN,
      GOOGLE_UNRESOLVED: radar.GOOGLE_UNRESOLVED,
      SOURCE_REGISTRY_READY: radar.SOURCE_REGISTRY_READY,
      SOURCE_REGISTRY_FALLBACK: radar.SOURCE_REGISTRY_FALLBACK,
      REGISTRY_CHANNELS_READ: radar.REGISTRY_CHANNELS_READ,
      REGISTRY_IDENTITY_MATCHES: radar.REGISTRY_IDENTITY_MATCHES,
      cursor: radar.cursor,
    },
    perf: {
      MATCH_24H_DURATION: match24Ms,
      MATCH_72H_DURATION: match72Ms,
      FETCH_72H_DURATION: fetchMs,
      GOOGLE_DURATION: googleMs,
      TOTAL_DURATION: Date.now() - t0,
      PEAK_MEMORY_MB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    },
  };

  const dir = join(process.cwd(), 'artifacts');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  writeFileSync(join(dir, `zero-loss-operational-v7-${stamp}.json`), JSON.stringify(payload, null, 2));
  console.log(JSON.stringify(payload, null, 2));
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
