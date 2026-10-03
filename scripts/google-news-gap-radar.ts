/**
 * Google News gap radar. Discovery only. 0 News Lake / MASTER / Registry writes.
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getSupabase } from '../src/supabase/client.js';
import { getKeywordsActivas } from '../src/supabase/repositories.js';
import { canonicalizeUrl } from '../src/normalizers/url.js';
import { fetchGoogleNewsItems } from '../src/matching/googleNewsRecoveryRadar.js';
import { buildGoogleRecoveryQueryPlan, sliceQueryPlan } from '../src/matching/googleQueryPlan.js';
import { aggregatePublisherArticles } from '../src/matching/publisherIdentity.js';
import { resolveGoogleNewsUrl } from '../src/matching/googleNewsUrlUnwind.js';
import { newsLakeUrlKeys, matchLakeRowsToPublisher, type NewsLakeHit } from '../src/matching/newsLakeUrlLookup.js';
import { registryLoadFromQueryResult, classifyWithRegistry } from '../src/matching/sourceRegistryIdentity.js';
import {
  FileRadarCursorStore,
  SupabaseRadarCursorStore,
  afterSlice,
  reconcileCursor,
  toSliceCursor,
} from '../src/matching/radarCursorStore.js';
import { ArtifactGapCandidateSink, type GapCandidate } from '../src/matching/gapCandidateSink.js';
import { parseIntOrNull } from '../src/utils/parse.js';
import { logger } from '../src/utils/logger.js';

const FILE_CURSOR = join(process.cwd(), 'artifacts', 'google-query-plan-cursor.json');

async function loadRegistry() {
  const sb = getSupabase();
  const page = 1000;
  const rows: unknown[] = [];
  let errorMsg: string | null = null;
  for (let from = 0; from < 20_000; from += page) {
    const { data, error } = await sb
      .from('fuente_canales')
      .select('fuente_id,canonical_url,canonical_domain,hostname,platform,activo')
      .range(from, from + page - 1);
    if (error) {
      errorMsg = error.message;
      break;
    }
    rows.push(...(data ?? []));
    if (!data || data.length < page) break;
  }
  return registryLoadFromQueryResult({
    error: errorMsg,
    rows,
  });
}

async function lookupLake(url: string): Promise<{ rows: NewsLakeHit[]; error: string | null }> {
  const keys = newsLakeUrlKeys(url);
  const sb = getSupabase();
  const cols = 'noticia_id,url_original,url_canonica,hash_url';
  const hashes = [...new Set([keys.hash_url, ...keys.variants.map((v) => newsLakeUrlKeys(v).hash_url)])].slice(0, 4);
  const { data: byHash, error: hashErr } = await sb.from('noticias').select(cols).in('hash_url', hashes).limit(10);
  if (hashErr) return { rows: [], error: hashErr.message };
  if (byHash && byHash.length > 0) return { rows: byHash as NewsLakeHit[], error: null };
  const { data: byCanon, error: canonErr } = await sb.from('noticias').select(cols).in('url_canonica', keys.variants).limit(10);
  if (canonErr) return { rows: [], error: canonErr.message };
  if (byCanon && byCanon.length > 0) return { rows: byCanon as NewsLakeHit[], error: null };
  const { data: byOrig, error: origErr } = await sb.from('noticias').select(cols).in('url_original', keys.variants).limit(10);
  if (origErr) return { rows: [], error: origErr.message };
  return { rows: (byOrig ?? []) as NewsLakeHit[], error: null };
}

export async function runGoogleGapRadar(opts: { batchSize: number; persistCursor: boolean }): Promise<Record<string, unknown>> {
  const keywords = await getKeywordsActivas();
  const plan = buildGoogleRecoveryQueryPlan(keywords);
  const backend = String(process.env.GOOGLE_RADAR_CURSOR_BACKEND ?? 'file').toLowerCase();
  let cursorDurable = backend === 'file';
  let cursorError: string | null = null;
  const fileStore = new FileRadarCursorStore(FILE_CURSOR);
  let stored = await fileStore.load();
  if (backend === 'supabase') {
    try {
      stored = await new SupabaseRadarCursorStore(getSupabase()).load();
      cursorDurable = true;
    } catch (err) {
      cursorDurable = false;
      cursorError = err instanceof Error ? err.message : String(err);
      stored = await fileStore.load();
    }
  }
  const reconciled = reconcileCursor(plan, stored);
  const sliced = sliceQueryPlan(plan, toSliceCursor(reconciled), opts.batchSize);
  const { data: medios } = await getSupabase().from('medios').select('medio_id,nombre_medio,url_base');
  const registry = await loadRegistry();

  const rawItems = [];
  for (const q of sliced.processed) {
    try {
      const items = await fetchGoogleNewsItems(q.query, q.keyword_ids[0] ?? null, q.cliente_ids[0] ?? null);
      for (const it of items) {
        rawItems.push({ ...it, keyword_ids: q.keyword_ids, cliente_ids: q.cliente_ids, query: q.query });
      }
    } catch (err) {
      logger.warn({ query: q.query, err: err instanceof Error ? err.message : String(err) }, 'radar query failed');
    }
  }

  const resolved = [];
  for (const it of rawItems) {
    const r = await resolveGoogleNewsUrl(it.google_item_url, { timeoutMs: 10_000 });
    resolved.push({
      ...it,
      publisher_final_url: r.publisher_final_url ? canonicalizeUrl(r.publisher_final_url) : null,
      unwind_method: r.method,
      unwind_status: r.status,
    });
  }

  const unique = aggregatePublisherArticles(resolved.filter((x) => x.publisher_final_url));
  const articles: Array<Record<string, unknown>> = [];
  let registryMatches = 0;
  const lakeLookupErrors: string[] = [];
  for (const [canon, group] of unique.entries()) {
    const ident = classifyWithRegistry(canon, medios ?? [], registry);
    if (ident.registry_used && ident.candidate_fuente_ids.length > 0) registryMatches += 1;
    const lake = await lookupLake(canon);
    if (lake.error) lakeLookupErrors.push(lake.error);
    const hit = matchLakeRowsToPublisher(newsLakeUrlKeys(canon), lake.rows);
    let discovery_status = 'UNKNOWN_SOURCE';
    if (hit) {
      discovery_status = 'ALREADY_IN_LAKE';
    } else if (ident.kind === 'KNOWN_AMBIGUOUS') {
      discovery_status = 'KNOWN_AMBIGUOUS';
    } else if (ident.kind === 'KNOWN_UNIQUE') {
      discovery_status = 'MISSING_KNOWN_SOURCE';
    } else {
      discovery_status = 'UNKNOWN_SOURCE';
    }
    articles.push({
      publisher_final_url: canon,
      canonical_hash: newsLakeUrlKeys(canon).hash_url,
      hostname: ident.hostname,
      identity: ident.kind,
      candidate_medio_ids: ident.candidate_medio_ids,
      candidate_fuente_ids: ident.candidate_fuente_ids,
      medio_id: ident.kind === 'KNOWN_UNIQUE' ? ident.medio_id : null,
      fuente_id: ident.kind === 'KNOWN_UNIQUE' && ident.candidate_fuente_ids.length === 1 ? ident.candidate_fuente_ids[0] : null,
      cliente_ids: [...new Set(group.flatMap((g) => g.cliente_ids ?? []))],
      keyword_ids: [...new Set(group.flatMap((g) => g.keyword_ids ?? []))],
      queries: [...new Set(group.map((g) => g.query))],
      google_item_urls: [...new Set(group.map((g) => g.google_item_url))],
      first_discovered_at: new Date().toISOString(),
      last_discovered_at: new Date().toISOString(),
      google_title: group[0]?.title ?? null,
      exists_news_lake: Boolean(hit),
      noticia_id: hit?.noticia_id ?? null,
      discovery_status,
    });
  }

  const unresolved = resolved.filter((r) => !r.publisher_final_url || r.unwind_status === 'GOOGLE_URL_UNRESOLVED');
  for (const u of unresolved.filter((r) => !r.publisher_final_url)) {
    articles.push({
      publisher_final_url: '',
      canonical_hash: '',
      hostname: null,
      identity: 'UNKNOWN',
      candidate_medio_ids: [],
      candidate_fuente_ids: [],
      medio_id: null,
      fuente_id: null,
      cliente_ids: u.cliente_ids ?? [],
      keyword_ids: u.keyword_ids ?? [],
      queries: [u.query],
      google_item_urls: [u.google_item_url],
      first_discovered_at: new Date().toISOString(),
      last_discovered_at: new Date().toISOString(),
      google_title: u.title ?? null,
      exists_news_lake: false,
      noticia_id: null,
      discovery_status: 'UNRESOLVED_GOOGLE_URL',
    });
  }
  const nextCursor = afterSlice(
    plan,
    reconciled,
    sliced.next.offset,
    sliced.processed[sliced.processed.length - 1]?.normalized ?? null,
  );
  if (opts.persistCursor) {
    await fileStore.save(nextCursor);
    if (backend === 'supabase' && cursorDurable) {
      try {
        await new SupabaseRadarCursorStore(getSupabase()).save(nextCursor);
      } catch (err) {
        cursorError = err instanceof Error ? err.message : String(err);
        cursorDurable = false;
      }
    }
  }

  const candidates: GapCandidate[] = articles
    .filter((a) => a.discovery_status !== 'ALREADY_IN_LAKE')
    .map((a) => ({
      publisher_final_url: String(a.publisher_final_url ?? ''),
      canonical_hash: String(a.canonical_hash ?? ''),
      hostname: (a.hostname as string | null) ?? null,
      medio_id: (a.medio_id as string | null) ?? null,
      candidate_medio_ids: (a.candidate_medio_ids as string[]) ?? [],
      fuente_id: (a.fuente_id as string | null) ?? null,
      candidate_fuente_ids: (a.candidate_fuente_ids as string[]) ?? [],
      cliente_ids: (a.cliente_ids as string[]) ?? [],
      keyword_ids: (a.keyword_ids as string[]) ?? [],
      queries: (a.queries as string[]) ?? [],
      google_item_urls: (a.google_item_urls as string[]) ?? [],
      first_discovered_at: String(a.first_discovered_at ?? ''),
      last_discovered_at: String(a.last_discovered_at ?? ''),
      discovered_via: 'GOOGLE_NEWS_RADAR',
      discovery_status: String(a.discovery_status ?? ''),
    }));

  registry.REGISTRY_IDENTITY_MATCHES = registryMatches;

  return {
    production_writes: 0,
    QUERY_TOTAL: plan.QUERY_TOTAL,
    QUERY_PROCESSED: sliced.QUERY_PROCESSED,
    QUERY_PENDING: sliced.QUERY_PENDING,
    cursor: nextCursor,
    QUERY_CURSOR_DURABLE: cursorDurable,
    cursor_error: cursorError,
    GOOGLE_RAW_ITEMS: rawItems.length,
    GOOGLE_UNIQUE_PUBLISHER_ARTICLES: articles.length,
    GOOGLE_UNRESOLVED: articles.filter((a) => a.discovery_status === 'UNRESOLVED_GOOGLE_URL').length,
    GOOGLE_ALREADY_IN_LAKE: articles.filter((a) => a.discovery_status === 'ALREADY_IN_LAKE').length,
    GOOGLE_MISSING_KNOWN: articles.filter((a) => a.discovery_status === 'MISSING_KNOWN_SOURCE').length,
    GOOGLE_AMBIGUOUS: articles.filter((a) => a.discovery_status === 'KNOWN_AMBIGUOUS').length,
    GOOGLE_UNKNOWN: articles.filter((a) => a.discovery_status === 'UNKNOWN_SOURCE').length,
    SOURCE_REGISTRY_READY: registry.SOURCE_REGISTRY_READY,
    SOURCE_REGISTRY_FALLBACK: registry.SOURCE_REGISTRY_FALLBACK,
    REGISTRY_CHANNELS_READ: registry.REGISTRY_CHANNELS_READ,
    REGISTRY_IDENTITY_MATCHES: registryMatches,
    registry_error: registry.error,
    lake_lookup_errors: [...new Set(lakeLookupErrors)].slice(0, 5),
    articles,
    unresolved_samples: unresolved.slice(0, 10).map((u) => u.google_item_url),
    gap_candidates: candidates,
  };
}

async function main(): Promise<void> {
  const batch = parseIntOrNull(process.argv.find((a) => a.startsWith('--batch='))?.split('=')[1] ?? process.env.GOOGLE_RADAR_BATCH ?? '') ?? 12;
  const payload = await runGoogleGapRadar({ batchSize: batch, persistCursor: true });
  const dir = join(process.cwd(), 'artifacts');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const out = join(dir, `google-news-gap-radar-${stamp}.json`);
  writeFileSync(out, JSON.stringify(payload, null, 2));
  const sink = new ArtifactGapCandidateSink((body) => {
    writeFileSync(join(dir, `agent-a-gap-handoff-v7-${stamp}.json`), JSON.stringify(body, null, 2));
  });
  await sink.emit((payload.gap_candidates ?? []) as GapCandidate[]);
  console.log(JSON.stringify({
    out,
    QUERY_TOTAL: payload.QUERY_TOTAL,
    QUERY_PROCESSED: payload.QUERY_PROCESSED,
    unique: payload.GOOGLE_UNIQUE_PUBLISHER_ARTICLES,
    already: payload.GOOGLE_ALREADY_IN_LAKE,
    missing: payload.GOOGLE_MISSING_KNOWN,
    SOURCE_REGISTRY_READY: payload.SOURCE_REGISTRY_READY,
    SOURCE_REGISTRY_FALLBACK: payload.SOURCE_REGISTRY_FALLBACK,
    QUERY_CURSOR_DURABLE: payload.QUERY_CURSOR_DURABLE,
  }, null, 2));
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
