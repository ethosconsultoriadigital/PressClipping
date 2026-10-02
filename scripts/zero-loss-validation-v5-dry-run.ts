/**
 * V5 shadow validation. NO MASTER writes. NO News Lake writes. NO alertas.
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getSupabase } from '../src/supabase/client.js';
import { getAllClientes, getKeywordsActivas, type KeywordActivaRow } from '../src/supabase/repositories.js';
import { getSpreadsheetById } from '../src/sheets/client.js';
import { canonicalizeUrl } from '../src/normalizers/url.js';
import { fetchAndExtract } from '../src/extractors/html.js';
import { matchKeyword } from '../src/matchers/keyword.js';
import { anyWordPresent, foldText } from '../src/matchers/text.js';
import { toKeywordRule } from '../src/matching/detectMentionsCore.js';
import { hasTrustedSearchableText } from '../src/matching/trustedBody.js';
import {
  DEEP_RECOVERY_WINDOW_HOURS,
  LIVE_WINDOW_HOURS,
  RECOVERY_WINDOW_HOURS,
  windowSinceHours,
} from '../src/matching/matchWindows.js';
import {
  classifyPublisher,
  fetchGoogleNewsItems,
  recoveryQueriesFromKeywords,
} from '../src/matching/googleNewsRecoveryRadar.js';
import {
  discoveryStatus,
  resolveGoogleNewsUrls,
  type DiscoveryStatus,
} from '../src/matching/googleNewsUrlUnwind.js';
import { emptyBodyMatchingCounters } from '../src/matching/bodyMatchingMetrics.js';
import {
  buildRows,
  fetchEligibleNewsPaged,
  groupKeywordsByActiveClient,
  loadExistingKeys,
  RECOVERY_FETCH_CAP,
  type MasterNewsRow,
} from './mentions-master-fast-lane.js';
import { logger } from '../src/utils/logger.js';

const REPORT_CLIENTS = [
  'CLI-0001', 'CLI-0002', 'CLI-0003', 'CLI-MERY-TEST',
  'CLI-0004', 'CLI-0005', 'CLI-0006', 'CLI-0007',
  'CLI-0008', 'CLI-0009', 'CLI-0010', 'CLI-0011',
];
const ENTORNO_URL =
  'https://entornoinformativo.com.mx/plantea-fortalecer-presupuesto-a-universidades-publicas-la-rectora-de-unison-dena-maria-camarena/';
const MASTER_SHEET = '1T4-RLnBrK0lp3p-r23hRjrJAmI03QLzBavWM3ZpcmOA';
const MASTER_TAB = 'MENCIONES_MASTER';

const generalOpts = { masterBodyV2: true as const, bodyPolicy: 'general' as const, mode: 'body_v4' as const };
const signalOpts = { masterBodyV2: false as const, mode: 'current' as const };

type OutRow = Record<string, string | number | boolean | null>;

function isBodyCampo(campo: string): boolean {
  return /texto_cuerpo_nota|texto_nota_limpia/i.test(campo);
}

function memMb(): number {
  return Math.round(process.memoryUsage().rss / 1024 / 1024);
}

async function lookupPublisher(url: string) {
  const canon = canonicalizeUrl(url);
  const cols = 'noticia_id, titulo, url_original, medio_id';
  const sb = getSupabase();
  const { data: a } = await sb.from('noticias').select(cols).eq('url_original', url).limit(3);
  const { data: b } = await sb.from('noticias').select(cols).eq('url_original', canon).limit(3);
  let path = '';
  try { path = new URL(canon).pathname.replace(/\/$/, '').slice(-64); } catch { path = ''; }
  const { data: c } = path
    ? await sb.from('noticias').select(cols).ilike('url_original', `%${path}%`).limit(5)
    : { data: [] };
  const rows = [...(a ?? []), ...(b ?? []), ...(c ?? [])];
  const uniq = new Map(rows.map((r: any) => [r.noticia_id, r]));
  return [...uniq.values()];
}

function trustedFold(n: MasterNewsRow): string {
  return foldText([n.titulo, n.subtitulo, n.resumen, n.seccion, n.texto_cuerpo_nota, n.texto_nota_limpia]
    .filter((x): x is string => Boolean(x && x.trim()))
    .join('\n'));
}

function contextVerdict(kw: KeywordActivaRow, n: MasterNewsRow): 'valid' | 'invalid' | 'n/a' {
  const rule = toKeywordRule(kw);
  if (rule.tipo !== 'exacta_contextual' && !rule.contextoIncluir.length && !rule.contextoExcluir.length) {
    return 'n/a';
  }
  const folded = trustedFold(n);
  if (rule.contextoExcluir.length > 0 && anyWordPresent(rule.contextoExcluir, folded)) return 'invalid';
  if (rule.contextoIncluir.length > 0 && !anyWordPresent(rule.contextoIncluir, folded)) return 'invalid';
  return 'valid';
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const liveSince = windowSinceHours(LIVE_WINDOW_HOURS);
  const since24 = windowSinceHours(RECOVERY_WINDOW_HOURS);
  const since72 = windowSinceHours(DEEP_RECOVERY_WINDOW_HOURS);

  const [clients, keywords] = await Promise.all([getAllClientes(), getKeywordsActivas()]);
  const { keywordsByClient, clientNames } = groupKeywordsByActiveClient(clients, keywords);
  const kwById = new Map(keywords.map((k) => [k.keyword_id, k]));

  const tFetch = Date.now();
  const paged72 = await fetchEligibleNewsPaged(since72, undefined, RECOVERY_FETCH_CAP);
  const fetchMs = Date.now() - tFetch;
  const news72 = paged72.rows;
  const news24 = news72.filter((n) => (n.fecha_captura ?? '') >= since24);
  const capHit = paged72.capHit;
  const recoveryIncomplete = capHit;

  const metrics24 = emptyBodyMatchingCounters();
  const metrics72 = emptyBodyMatchingCounters();
  const signal24 = buildRows(news24, keywordsByClient, clientNames, signalOpts);
  const general24 = buildRows(news24, keywordsByClient, clientNames, { ...generalOpts, metrics: metrics24 });
  const general72 = buildRows(news72, keywordsByClient, clientNames, { ...generalOpts, metrics: metrics72 });

  const signalKeys = new Set(signal24.map((r) => String(r['dedupe_key']).toLowerCase()));
  const news24ById = new Map(news24.map((n) => [n.noticia_id, n]));

  let masterKeys = new Set<string>();
  let masterReadError: string | null = null;
  try {
    const doc = await getSpreadsheetById(MASTER_SHEET);
    const sheet = doc.sheetsByTitle[MASTER_TAB];
    if (!sheet) throw new Error(`missing tab ${MASTER_TAB}`);
    masterKeys = await loadExistingKeys(sheet);
  } catch (err) {
    masterReadError = err instanceof Error ? err.message : String(err);
    logger.warn({ masterReadError }, 'MASTER read failed; WOULD_APPEND uses empty existing set');
  }

  const split = (rows: OutRow[]) => {
    const would: OutRow[] = [];
    let skipped = 0;
    for (const r of rows) {
      const key = String(r['dedupe_key'] ?? '').trim().toLowerCase();
      if (!key || masterKeys.has(key)) { skipped += 1; continue; }
      would.push(r);
    }
    return { would, skipped };
  };
  const split24 = split(general24);
  const split72 = split(general72);

  const recovered = {
    RECOVERED_TITLE_NULL: 0,
    RECOVERED_SUMMARY_NULL: 0,
    RECOVERED_URL_NULL: 0,
    RECOVERED_BODY_ONLY: 0,
    RECOVERED_CRON_GAP: 0,
    RECOVERED_LATE_BODY: 0,
    NEW_KEYWORD_SCOPE: 0,
  };
  for (const r of split24.would) {
    const n = news24ById.get(String(r['NOTICIA'] ?? ''));
    if (!n) continue;
    if (!n.titulo?.trim()) recovered.RECOVERED_TITLE_NULL += 1;
    if (!n.resumen?.trim()) recovered.RECOVERED_SUMMARY_NULL += 1;
    if (!n.url_original?.trim()) recovered.RECOVERED_URL_NULL += 1;
    const key = String(r['dedupe_key']).toLowerCase();
    const bodyOnly = isBodyCampo(String(r['campo_match'] ?? '')) && !signalKeys.has(key);
    if (bodyOnly) recovered.RECOVERED_BODY_ONLY += 1;
    if ((n.fecha_captura ?? '') < liveSince) recovered.RECOVERED_CRON_GAP += 1;
    if (bodyOnly && n.titulo?.trim() && n.resumen?.trim()) recovered.RECOVERED_LATE_BODY += 1;
    const kid = String(r['keyword_id'] ?? '');
    const krow = kwById.get(kid);
    if (bodyOnly && krow && !['CLI-MERY-TEST'].includes(krow.cliente_id ?? '')) {
      recovered.NEW_KEYWORD_SCOPE += 1;
    }
  }

  const fpByKey = new Map<string, {
    cliente_id: string;
    keyword_id: string;
    tipo_keyword: string;
    body_only_matches: number;
    context_valid: number;
    context_invalid: number;
    sample_titles: string[];
    sample_snippets: string[];
  }>();
  let contextValid = 0;
  let contextInvalid = 0;
  for (const r of general24) {
    const key = String(r['dedupe_key']).toLowerCase();
    if (!isBodyCampo(String(r['campo_match'] ?? '')) || signalKeys.has(key)) continue;
    const kid = String(r['keyword_id'] ?? '');
    const cid = String(r['cliente_id'] ?? '');
    const krow = kwById.get(kid);
    const n = news24ById.get(String(r['NOTICIA'] ?? ''));
    const tipo = krow?.tipo_keyword ?? '';
    const mapKey = `${cid}|${kid}`;
    const rec = fpByKey.get(mapKey) ?? {
      cliente_id: cid,
      keyword_id: kid,
      tipo_keyword: tipo,
      body_only_matches: 0,
      context_valid: 0,
      context_invalid: 0,
      sample_titles: [],
      sample_snippets: [],
    };
    rec.body_only_matches += 1;
    if (krow && n) {
      const v = contextVerdict(krow, n);
      if (v === 'invalid') { rec.context_invalid += 1; contextInvalid += 1; }
      else if (v === 'valid') { rec.context_valid += 1; contextValid += 1; }
    }
    const title = String(r['titulo / titular'] ?? '');
    if (rec.sample_titles.length < 3 && title) rec.sample_titles.push(title.slice(0, 180));
    const snip = String(r['nota completa'] ?? '').replace(/\s+/g, ' ').slice(0, 220);
    if (rec.sample_snippets.length < 3 && snip) rec.sample_snippets.push(snip);
    fpByKey.set(mapKey, rec);
  }

  const perClient: Record<string, Record<string, number>> = {};
  for (const cid of REPORT_CLIENTS) {
    const rows = general24.filter((r) => String(r['cliente_id']).toUpperCase() === cid);
    const would = split24.would.filter((r) => String(r['cliente_id']).toUpperCase() === cid);
    const skipped = rows.length - would.length;
    perClient[cid] = {
      SIGNAL_MATCHES_24H: signal24.filter((r) => String(r['cliente_id']).toUpperCase() === cid).length,
      BODY_MATCHES_24H: rows.filter((r) => isBodyCampo(String(r['campo_match'] ?? ''))).length,
      BODY_ONLY_24H: rows.filter((r) => isBodyCampo(String(r['campo_match'] ?? '')) && !signalKeys.has(String(r['dedupe_key']).toLowerCase())).length,
      WOULD_APPEND: would.length,
      CONTEXT_REJECTED: [...fpByKey.values()].filter((x) => x.cliente_id.toUpperCase() === cid).reduce((a, b) => a + b.context_invalid, 0),
      DEDUPE_SKIPPED: skipped,
    };
  }

  const { data: medios } = await getSupabase().from('medios').select('medio_id,nombre_medio,url_base');
  const medioRows = (medios ?? []) as Array<{ medio_id: string; nombre_medio: string; url_base: string | null }>;

  const queries = recoveryQueriesFromKeywords(keywords, 16);
  const rssRaw = [];
  for (const q of queries) {
    try {
      const items = await fetchGoogleNewsItems(q.query, q.keyword_id, q.cliente_id);
      rssRaw.push(...items);
    } catch (err) {
      logger.warn({ query: q.query, err: err instanceof Error ? err.message : String(err) }, 'rss query failed');
    }
  }
  const seenG = new Set<string>();
  const uniqueRss = [];
  for (const it of rssRaw) {
    const u = it.google_item_url;
    if (!u || seenG.has(u)) continue;
    seenG.add(u);
    uniqueRss.push(it);
  }

  const resolvedList = await resolveGoogleNewsUrls(
    uniqueRss.map((it) => it.google_item_url),
    { timeoutMs: 10_000, concurrency: 3 },
  );
  const radar: Array<{
    cliente_id: string | null;
    keyword_id: string | null;
    google_title: string | null;
    google_url: string;
    publisher_final_url: string | null;
    hostname: string | null;
    known_source: boolean;
    medio_id: string | null;
    exists_news_lake: boolean;
    discovery_status: DiscoveryStatus;
    unwind_method: string;
    noticia_ids: string[];
  }> = [];
  for (let i = 0; i < uniqueRss.length; i++) {
    const it = uniqueRss[i]!;
    const resolved = resolvedList[i]!;
    const pub = resolved.publisher_final_url;
    const cls = classifyPublisher(pub, medioRows);
    const lake = pub ? await lookupPublisher(pub) : [];
    const status: DiscoveryStatus = discoveryStatus({
      resolved: resolved.status === 'GOOGLE_URL_RESOLVED',
      inLake: lake.length > 0,
      knownSource: cls.kind === 'known',
    });
    radar.push({
      cliente_id: it.cliente_id,
      keyword_id: it.keyword_id,
      google_title: it.title,
      google_url: it.google_item_url,
      publisher_final_url: pub,
      hostname: resolved.publisher_hostname ?? cls.hostname,
      known_source: cls.kind === 'known',
      medio_id: cls.medio_id,
      exists_news_lake: lake.length > 0,
      discovery_status: status,
      unwind_method: resolved.method,
      noticia_ids: lake.map((x: any) => x.noticia_id),
    });
  }

  const missingKnown = radar.filter((r) => r.discovery_status === 'MISSING_KNOWN_SOURCE');
  const agentA = {
    generated_at: new Date().toISOString(),
    for_agent: 'A',
    writes: 0,
    source_registry_touched: false,
    missing_known_source: missingKnown.map((r) => ({
      publisher_final_url: r.publisher_final_url,
      hostname: r.hostname,
      medio_id: r.medio_id,
      cliente_ids_interested: [...new Set(radar.filter((x) => x.publisher_final_url === r.publisher_final_url).map((x) => x.cliente_id).filter(Boolean))],
      keyword_ids: [...new Set(radar.filter((x) => x.publisher_final_url === r.publisher_final_url).map((x) => x.keyword_id).filter(Boolean))],
      google_discovered_at: new Date().toISOString(),
      google_title: r.google_title,
    })),
  };

  const key0005 = keywords.find((k) => k.keyword_id === 'KEY-0005') ?? null;
  const extract = await fetchAndExtract(ENTORNO_URL, { timeoutMs: 12_000, maxAttempts: 1 });
  const entornoNews: MasterNewsRow = {
    noticia_id: 'synthetic-entorno-v5',
    medio_id: 'MED-0441',
    medio_nombre: 'Entorno Informativo',
    titulo: extract.titulo,
    subtitulo: null,
    resumen: extract.resumen,
    url_original: extract.finalUrl ?? ENTORNO_URL,
    fecha_publicacion: null,
    fecha_captura: new Date().toISOString(),
    autor: extract.autor,
    seccion: extract.seccion,
    texto_extraido: null,
    texto_nota_limpia: extract.texto_nota_limpia,
    texto_cuerpo_nota: extract.texto_cuerpo_nota,
    tipo_nota: extract.tipo_nota,
    calidad_extraccion: extract.calidad_extraccion,
  };
  const entornoRows = buildRows([entornoNews], keywordsByClient, clientNames, generalOpts);
  const cli0003 = entornoRows.filter((r) => String(r['cliente_id']) === 'CLI-0003');
  let entornoMatch = null;
  if (key0005) {
    const packed = { campos: [] as { nombre: string; texto: string; peso: number }[] };
    packed.campos = [
      { nombre: 'titulo', texto: entornoNews.titulo ?? '', peso: 1 },
      { nombre: 'resumen', texto: entornoNews.resumen ?? '', peso: 0.6 },
      { nombre: 'texto_cuerpo_nota', texto: entornoNews.texto_cuerpo_nota ?? '', peso: 0.4 },
    ];
    const hit = matchKeyword(toKeywordRule(key0005), packed.campos);
    entornoMatch = {
      keyword: key0005.keyword,
      tipo_keyword: key0005.tipo_keyword,
      contexto_incluir: key0005.contexto_incluir,
      contexto_excluir: key0005.contexto_excluir,
      campo: hit?.campo ?? null,
      snippet: hit?.texto_match ?? null,
      score: hit?.score ?? null,
      body_contains_keyword: foldText(entornoNews.texto_cuerpo_nota ?? '').includes(foldText(key0005.keyword)),
      laboral_amplia_gate: ['trabajadores', 'trabajador', 'sindicato', 'sindicatos', 'derechos laborales', 'derecho laboral', 'reforma laboral'].includes(foldText(key0005.keyword).trim()),
    };
  }
  const entornoVerdict = entornoMatch?.campo
    ? (entornoMatch.laboral_amplia_gate ? 'RULE_BUG' : 'EXPECTED_MATCH')
    : 'NO_MATCH_NOW';

  const payload = {
    generated_at: new Date().toISOString(),
    production_writes: 0,
    alerts_sent: 0,
    master_read_error: masterReadError,
    master_existing_keys: masterKeys.size,
    performance: {
      duration_ms_total: Date.now() - t0,
      duration_ms_fetch_72h: fetchMs,
      rows_scanned_24h: news24.length,
      rows_scanned_72h: news72.length,
      db_pages: paged72.pagesScanned,
      memory_mb_rss: memMb(),
      matches_24h: general24.length,
      matches_72h: general72.length,
      dedupe_size: masterKeys.size,
      cap_hit: capHit,
    },
    google: {
      items: radar.length,
      resolved: radar.filter((r) => r.discovery_status !== 'UNRESOLVED_GOOGLE_URL').length,
      unresolved: radar.filter((r) => r.discovery_status === 'UNRESOLVED_GOOGLE_URL').length,
      already_in_lake: radar.filter((r) => r.discovery_status === 'ALREADY_IN_LAKE').length,
      missing_known: missingKnown.length,
      unknown_source: radar.filter((r) => r.discovery_status === 'UNKNOWN_SOURCE').length,
      unwind_methods: radar.reduce<Record<string, number>>((acc, r) => {
        acc[r.unwind_method] = (acc[r.unwind_method] ?? 0) + 1;
        return acc;
      }, {}),
      samples: radar.slice(0, 25),
    },
    matching_24h: {
      NEWS_SCANNED_24H: news24.length,
      title_null: news24.filter((n) => !n.titulo?.trim()).length,
      summary_null: news24.filter((n) => !n.resumen?.trim()).length,
      url_null: news24.filter((n) => !n.url_original?.trim()).length,
      trusted_body: news24.filter((n) => (n.texto_cuerpo_nota ?? '').trim().length > 0).length,
      signal_matches: signal24.length,
      general_matches: general24.length,
      body_matches: metrics24.body_matches,
      body_only_matches: metrics24.body_only_matches,
      WOULD_APPEND_24H: split24.would.length,
      DEDUPE_SKIPPED: split24.skipped,
      ...recovered,
      would_append_samples: split24.would.slice(0, 40).map((r) => ({
        cliente_id: r['cliente_id'],
        noticia_id: r['NOTICIA'],
        titulo: r['titulo / titular'],
        campo_match: r['campo_match'],
        keyword_id: r['keyword_id'],
        dedupe_key: r['dedupe_key'],
      })),
    },
    matching_72h: {
      NEWS_SCANNED_72H: news72.length,
      PAGES_SCANNED: paged72.pagesScanned,
      CLIENT_MATCHES: general72.length,
      WOULD_APPEND_72H: split72.would.length,
      DEDUPE_SKIPPED: split72.skipped,
      BODY_ONLY: metrics72.body_only_matches,
      LATE_RECOVERED: split72.would.filter((r) => {
        const cap = String(r['fecha_captura'] ?? '');
        return cap < liveSince && isBodyCampo(String(r['campo_match'] ?? ''));
      }).length,
      CAP_HIT: capHit,
      RECOVERY_INCOMPLETE: recoveryIncomplete,
    },
    false_positive_audit: [...fpByKey.values()].sort((a, b) => b.body_only_matches - a.body_only_matches),
    context_valid_total: contextValid,
    context_invalid_total: contextInvalid,
    per_client: perClient,
    cli0003_entorno: {
      keyword: entornoMatch,
      cli0003_rows: cli0003,
      extract_ok: extract.ok,
      titulo: extract.titulo,
      merilyn_in_body: /merilyn/i.test(extract.texto_cuerpo_nota ?? ''),
      verdict: entornoVerdict,
    },
    agent_a_capture_queue: agentA,
    matchable_sanity: {
      empty_trusted_rejected: news24.filter((n) => !hasTrustedSearchableText(n)).length,
    },
  };

  const dir = join(process.cwd(), 'artifacts');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const out = join(dir, `zero-loss-validation-v5-${stamp}.json`);
  const outA = join(dir, `agent-a-missing-known-source-v5-${stamp}.json`);
  writeFileSync(out, JSON.stringify(payload, null, 2));
  writeFileSync(outA, JSON.stringify(agentA, null, 2));
  console.log(JSON.stringify({
    out,
    outA,
    google_items: radar.length,
    google_resolved: payload.google.resolved,
    google_unresolved: payload.google.unresolved,
    google_missing_known: missingKnown.length,
    NEWS_SCANNED_24H: news24.length,
    WOULD_APPEND_24H: split24.would.length,
    NEWS_SCANNED_72H: news72.length,
    WOULD_APPEND_72H: split72.would.length,
    CAP_HIT: capHit,
    context_invalid: contextInvalid,
    cli0003_verdict: entornoVerdict,
    duration_ms: Date.now() - t0,
    memory_mb: memMb(),
  }, null, 2));
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
