/**
 * V6 production-candidate shadow. 0 MASTER writes. 0 News Lake writes.
 * BODY general = shadow only.
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getAllClientes, getKeywordsActivas, type KeywordActivaRow } from '../src/supabase/repositories.js';
import { getSpreadsheetById } from '../src/sheets/client.js';
import { getSupabase } from '../src/supabase/client.js';
import { canonicalizeUrl } from '../src/normalizers/url.js';
import { toKeywordRule } from '../src/matching/detectMentionsCore.js';
import { evaluateKeywordContextPolicy, matchKeyword, type CampoBuscable } from '../src/matchers/keyword.js';
import { buildTrustedMatchingFields } from '../src/matching/trustedBody.js';
import { MERY_FRASE_EXACTA_BODY_KEYWORD_IDS, isBodyCampo } from '../src/matching/masterBodyCanary.js';
import { emptyBodyMatchingCounters } from '../src/matching/bodyMatchingMetrics.js';
import {
  DEEP_RECOVERY_WINDOW_HOURS,
  LIVE_WINDOW_HOURS,
  RECOVERY_WINDOW_HOURS,
  windowSinceHours,
} from '../src/matching/matchWindows.js';
import { buildGoogleRecoveryQueryPlan, sliceQueryPlan, queriesByClient } from '../src/matching/googleQueryPlan.js';
import { fetchGoogleNewsItems } from '../src/matching/googleNewsRecoveryRadar.js';
import { classifyPublisherIdentity, aggregatePublisherArticles } from '../src/matching/publisherIdentity.js';
import { resolveGoogleNewsUrl, unwindCacheSize } from '../src/matching/googleNewsUrlUnwind.js';
import { esKeywordLaboralAmpliaCli0003 } from '../src/matching/contextualKeywordRules.js';
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
const signalOpts = { masterBodyV2: false as const, mode: 'current' as const };
const allowOpts = { masterBodyV2: true as const, bodyPolicy: 'allowlist' as const, keywordAllowlist: ALLOW, mode: 'body_v4' as const };
const generalOpts = { masterBodyV2: true as const, bodyPolicy: 'general' as const, mode: 'body_v4' as const };

type OutRow = Record<string, string | number | boolean | null>;

function wouldAppend(rows: OutRow[], existing: Set<string>): OutRow[] {
  return rows.filter((r) => {
    const k = String(r['dedupe_key'] ?? '').trim().toLowerCase();
    return k && !existing.has(k);
  });
}

function camposFromNews(n: MasterNewsRow, mode: 'current' | 'body_v4'): CampoBuscable[] {
  return buildTrustedMatchingFields(n, { mode }).campos;
}

function suggestBodyPolicy(kw: KeywordActivaRow, bodyOnly: number, signal: number): { suggested_body_policy: string; reason: string } {
  const tipo = String(kw.tipo_keyword ?? '').toLowerCase();
  const phrase = kw.keyword.trim();
  if (tipo === 'contiene' || tipo === 'booleana' || tipo === 'exacta') {
    return { suggested_body_policy: 'SIGNAL_ONLY', reason: 'tipo no frase/contextual' };
  }
  if (esKeywordLaboralAmpliaCli0003(kw.keyword)) {
    return { suggested_body_policy: 'SHADOW_ONLY', reason: 'keyword laboral amplia' };
  }
  if (tipo === 'exacta_contextual' && (kw.contexto_incluir || kw.contexto_excluir)) {
    return { suggested_body_policy: 'BODY_CONTEXTUAL', reason: 'exacta_contextual con gates BD' };
  }
  if (tipo === 'frase_exacta' && (phrase.includes(' ') || phrase.length >= 12)) {
    return { suggested_body_policy: 'BODY_TRUSTED', reason: 'frase_exacta de identidad larga' };
  }
  if (bodyOnly > 10 && signal === 0) {
    return { suggested_body_policy: 'SHADOW_ONLY', reason: 'alto body-only sin señal' };
  }
  return { suggested_body_policy: 'SHADOW_ONLY', reason: 'default conservador' };
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const since24 = windowSinceHours(RECOVERY_WINDOW_HOURS);
  const since72 = windowSinceHours(DEEP_RECOVERY_WINDOW_HOURS);
  const [clients, keywords] = await Promise.all([getAllClientes(), getKeywordsActivas()]);
  const { keywordsByClient, clientNames } = groupKeywordsByActiveClient(clients, keywords);
  const kwById = new Map(keywords.map((k) => [k.keyword_id, k]));

  const tFetch = Date.now();
  const paged = await fetchEligibleNewsPaged(since72, undefined, RECOVERY_FETCH_CAP);
  const fetchMs = Date.now() - tFetch;
  const news72 = paged.rows;
  const news24 = news72.filter((n) => (n.fecha_captura ?? '') >= since24);
  const news24ById = new Map(news24.map((n) => [n.noticia_id, n]));

  const tMatch = Date.now();
  const signal24 = buildRows(news24, keywordsByClient, clientNames, signalOpts);
  const allow24 = buildRows(news24, keywordsByClient, clientNames, { ...allowOpts, metrics: emptyBodyMatchingCounters() });
  const general24 = buildRows(news24, keywordsByClient, clientNames, { ...generalOpts, metrics: emptyBodyMatchingCounters() });
  const match24Ms = Date.now() - tMatch;
  const t72 = Date.now();
  const signal72 = buildRows(news72, keywordsByClient, clientNames, signalOpts);
  const allow72 = buildRows(news72, keywordsByClient, clientNames, allowOpts);
  const general72 = buildRows(news72, keywordsByClient, clientNames, generalOpts);
  const match72Ms = Date.now() - t72;

  let existing = new Set<string>();
  try {
    const doc = await getSpreadsheetById(MASTER_SHEET);
    const sheet = doc.sheetsByTitle['MENCIONES_MASTER'];
    if (sheet) existing = await loadExistingKeys(sheet);
  } catch { /* dry-run continues */ }

  const sig24w = wouldAppend(signal24, existing);
  const all24w = wouldAppend(allow24, existing);
  const gen24w = wouldAppend(general24, existing);
  const sig72w = wouldAppend(signal72, existing);
  const all72w = wouldAppend(allow72, existing);
  const gen72w = wouldAppend(general72, existing);

  let trueContextInvalid = 0;
  for (const r of general24) {
    const n = news24ById.get(String(r['NOTICIA'] ?? ''));
    const krow = kwById.get(String(r['keyword_id'] ?? ''));
    if (!n || !krow) continue;
    const rule = toKeywordRule(krow);
    const campos = camposFromNews(n, 'body_v4');
    const hit = matchKeyword(rule, campos);
    const ctx = evaluateKeywordContextPolicy(rule, campos);
    if (hit && !ctx.pasa) trueContextInvalid += 1;
  }

  const signalKeys24 = new Set(signal24.map((r) => String(r['dedupe_key']).toLowerCase()));
  const stats = new Map<string, { signal: number; body: number; body_only: number }>();
  for (const r of general24) {
    const kid = String(r['keyword_id'] ?? '');
    const rec = stats.get(kid) ?? { signal: 0, body: 0, body_only: 0 };
    const body = isBodyCampo(String(r['campo_match'] ?? '')) || /texto_nota_limpia/i.test(String(r['campo_match'] ?? ''));
    if (body) rec.body += 1;
    if (body && !signalKeys24.has(String(r['dedupe_key']).toLowerCase())) rec.body_only += 1;
    stats.set(kid, rec);
  }
  for (const r of signal24) {
    const kid = String(r['keyword_id'] ?? '');
    const rec = stats.get(kid) ?? { signal: 0, body: 0, body_only: 0 };
    rec.signal += 1;
    stats.set(kid, rec);
  }

  const bodyPolicyCandidates = keywords.map((kw) => {
    const s = stats.get(kw.keyword_id) ?? { signal: 0, body: 0, body_only: 0 };
    const sug = suggestBodyPolicy(kw, s.body_only, s.signal);
    return {
      keyword_id: kw.keyword_id,
      cliente_id: kw.cliente_id,
      keyword: kw.keyword,
      tipo_keyword: kw.tipo_keyword,
      contexto_incluir: kw.contexto_incluir,
      contexto_excluir: kw.contexto_excluir,
      signal_hits_24h: s.signal,
      body_hits_24h: s.body,
      body_only_24h: s.body_only,
      ...sug,
    };
  });

  const cli0003BodyOnly = general24.filter((r) =>
    String(r['cliente_id']) === 'CLI-0003'
    && (isBodyCampo(String(r['campo_match'] ?? '')) || /texto_nota_limpia/i.test(String(r['campo_match'] ?? '')))
    && !signalKeys24.has(String(r['dedupe_key']).toLowerCase()),
  );
  const byKw = new Map<string, OutRow[]>();
  for (const r of cli0003BodyOnly) {
    const kid = String(r['keyword_id']);
    const list = byKw.get(kid) ?? [];
    list.push(r);
    byKw.set(kid, list);
  }
  let ruleValid = 0;
  let potentiallyNoisy = 0;
  const samples = [];
  for (const [kid, list] of byKw) {
    const krow = kwById.get(kid);
    for (const r of list.slice(0, 2)) {
      const n = news24ById.get(String(r['NOTICIA']));
      const valid = Boolean(krow && n && matchKeyword(toKeywordRule(krow), camposFromNews(n, 'body_v4')));
      const noisy = krow ? esKeywordLaboralAmpliaCli0003(krow.keyword) || (krow.keyword_id === 'KEY-0005' && list.length > 10) : false;
      if (valid) ruleValid += 1;
      if (noisy) potentiallyNoisy += 1;
      samples.push({ keyword_id: kid, titulo: r['titulo / titular'], verdict: noisy ? 'POTENTIALLY_NOISY' : 'RULE_VALID' });
    }
  }

  const key0031 = kwById.get('KEY-0031');
  const key0031Rows = general24.filter((r) => String(r['keyword_id']) === 'KEY-0031' && !signalKeys24.has(String(r['dedupe_key']).toLowerCase()));
  const key0031Audit = key0031Rows.slice(0, 5).map((r) => {
    const n = news24ById.get(String(r['NOTICIA']));
    if (!key0031 || !n) return { titulo: r['titulo / titular'], verdict: 'INVALID' };
    const rule = toKeywordRule(key0031);
    const campos = camposFromNews(n, 'body_v4');
    const hit = matchKeyword(rule, campos);
    const ctx = evaluateKeywordContextPolicy(rule, campos);
    let verdict: 'VALID_RULE_MATCH' | 'NOISY_BUT_VALID' | 'INVALID' = 'INVALID';
    if (hit && ctx.pasa) verdict = /arancel/i.test(String(r['titulo / titular'] ?? '')) ? 'VALID_RULE_MATCH' : 'NOISY_BUT_VALID';
    return { titulo: r['titulo / titular'], campo: hit?.campo, snippet: hit?.texto_match, contexto_pasa: ctx.pasa, verdict };
  });

  const tG = Date.now();
  const plan = buildGoogleRecoveryQueryPlan(keywords);
  const sliced = sliceQueryPlan(plan, { offset: 0, updated_at: new Date().toISOString() }, 6);
  const { data: medios } = await getSupabase().from('medios').select('medio_id,nombre_medio,url_base');
  const raw = [];
  for (const q of sliced.processed) {
    try {
      const items = await fetchGoogleNewsItems(q.query, q.keyword_ids[0] ?? null, q.cliente_ids[0] ?? null);
      for (const it of items.slice(0, 8)) raw.push({ ...it, keyword_ids: q.keyword_ids, cliente_ids: q.cliente_ids });
    } catch { /* best-effort shard */ }
  }
  const resolved = [];
  for (const it of raw) {
    const r = await resolveGoogleNewsUrl(it.google_item_url, { timeoutMs: 8000 });
    resolved.push({ ...it, publisher_final_url: r.publisher_final_url ? canonicalizeUrl(r.publisher_final_url) : null, method: r.method, status: r.status });
  }
  const uniq = aggregatePublisherArticles(resolved.filter((x) => x.publisher_final_url));
  const articles = [...uniq.entries()].map(([url, group]) => {
    const ident = classifyPublisherIdentity(url, medios ?? [], []);
    return { url, ident, group };
  });
  const googleMs = Date.now() - tG;

  const knownUnique = articles.filter((a) => a.ident.kind === 'KNOWN_UNIQUE');
  const missingKnown = [];
  for (const a of knownUnique.slice(0, 40)) {
    const { data } = await getSupabase().from('noticias').select('noticia_id').eq('url_original', a.url).limit(1);
    if (!data?.length) missingKnown.push(a);
  }

  const gapHandoff = {
    generated_at: new Date().toISOString(),
    for_agent: 'A',
    writes: 0,
    KNOWN_MISSING: missingKnown.map((a) => ({
      canonical_publisher_url: a.url,
      hostname: a.ident.hostname,
      candidate_medio_ids: a.ident.candidate_medio_ids,
      candidate_fuente_ids: a.ident.candidate_fuente_ids,
      cliente_ids: [...new Set(a.group.flatMap((g) => g.cliente_ids ?? []))],
      keyword_ids: [...new Set(a.group.flatMap((g) => g.keyword_ids ?? []))],
      queries: [...new Set(a.group.map((g) => g.query))],
      discovered_at: new Date().toISOString(),
    })),
    UNKNOWN_SOURCE: articles.filter((a) => a.ident.kind === 'UNKNOWN').slice(0, 40).map((a) => ({
      canonical_publisher_url: a.url,
      hostname: a.ident.hostname,
      cliente_ids: [...new Set(a.group.flatMap((g) => g.cliente_ids ?? []))],
      keyword_ids: [...new Set(a.group.flatMap((g) => g.keyword_ids ?? []))],
      queries: [...new Set(a.group.map((g) => g.query))],
      discovered_at: new Date().toISOString(),
    })),
  };

  const dir = join(process.cwd(), 'artifacts');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  writeFileSync(join(dir, `body-policy-candidate-v6.json`), JSON.stringify({ generated_at: new Date().toISOString(), production: false, keywords: bodyPolicyCandidates }, null, 2));
  writeFileSync(join(dir, `agent-a-gap-handoff-v6-${stamp}.json`), JSON.stringify(gapHandoff, null, 2));
  writeFileSync(join(dir, `agent-a-source-discovery-v6-${stamp}.json`), JSON.stringify({ UNKNOWN_SOURCE: gapHandoff.UNKNOWN_SOURCE, KNOWN_AMBIGUOUS: articles.filter((a) => a.ident.kind === 'KNOWN_AMBIGUOUS').map((a) => ({ url: a.url, hostname: a.ident.hostname, candidate_medio_ids: a.ident.candidate_medio_ids })) }, null, 2));

  const payload = {
    production_writes: 0,
    live_window_hours: LIVE_WINDOW_HOURS,
    SIGNAL_WOULD_APPEND_24H: sig24w.length,
    ALLOWLIST_WOULD_APPEND_24H: all24w.length,
    GENERAL_SHADOW_WOULD_APPEND_24H: gen24w.length,
    SIGNAL_WOULD_APPEND_72H: sig72w.length,
    ALLOWLIST_WOULD_APPEND_72H: all72w.length,
    GENERAL_SHADOW_WOULD_APPEND_72H: gen72w.length,
    cap_hit: paged.capHit,
    news_24h: news24.length,
    news_72h: news72.length,
    TRUE_CONTEXT_INVALID: trueContextInvalid,
    cli0003: { body_only: cli0003BodyOnly.length, RULE_VALID: ruleValid, POTENTIALLY_NOISY: potentiallyNoisy, samples },
    KEY0031: key0031Audit,
    google: {
      QUERY_TOTAL: plan.QUERY_TOTAL,
      QUERY_EXECUTED: sliced.QUERY_PROCESSED,
      RAW_ITEMS: raw.length,
      UNIQUE_PUBLISHER: articles.length,
      methods: resolved.reduce<Record<string, number>>((acc, r) => { acc[r.method] = (acc[r.method] ?? 0) + 1; return acc; }, {}),
      cache_size: unwindCacheSize(),
      unresolved: resolved.filter((r) => r.status === 'GOOGLE_URL_UNRESOLVED').length,
      known_unique: knownUnique.length,
      missing_known_unique: missingKnown.length,
      ambiguous: articles.filter((a) => a.ident.kind === 'KNOWN_AMBIGUOUS').length,
      unknown: articles.filter((a) => a.ident.kind === 'UNKNOWN').length,
      per_client: Object.fromEntries([...queriesByClient(plan, sliced.processed).entries()]),
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
  writeFileSync(join(dir, `zero-loss-production-candidate-v6-${stamp}.json`), JSON.stringify(payload, null, 2));
  console.log(JSON.stringify(payload, null, 2));
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
