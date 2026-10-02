/**
 * Google News gap radar. Dry-run: JSON artifacts only. 0 DB writes.
 */
import 'dotenv/config';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getSupabase } from '../src/supabase/client.js';
import { getKeywordsActivas } from '../src/supabase/repositories.js';
import { canonicalizeUrl } from '../src/normalizers/url.js';
import { fetchGoogleNewsItems } from '../src/matching/googleNewsRecoveryRadar.js';
import {
  buildGoogleRecoveryQueryPlan,
  sliceQueryPlan,
  type GoogleQueryCursor,
} from '../src/matching/googleQueryPlan.js';
import { classifyPublisherIdentity, aggregatePublisherArticles } from '../src/matching/publisherIdentity.js';
import { resolveGoogleNewsUrl } from '../src/matching/googleNewsUrlUnwind.js';
import { parseIntOrNull } from '../src/utils/parse.js';
import { logger } from '../src/utils/logger.js';

const CURSOR_PATH = join(process.cwd(), 'artifacts', 'google-query-plan-cursor.json');

function loadCursor(): GoogleQueryCursor | null {
  try {
    return JSON.parse(readFileSync(CURSOR_PATH, 'utf8')) as GoogleQueryCursor;
  } catch {
    return null;
  }
}

export async function runGoogleGapRadar(opts: { batchSize: number; persistCursor: boolean }): Promise<Record<string, unknown>> {
  const keywords = await getKeywordsActivas();
  const plan = buildGoogleRecoveryQueryPlan(keywords);
  const sliced = sliceQueryPlan(plan, loadCursor(), opts.batchSize);
  const { data: medios } = await getSupabase().from('medios').select('medio_id,nombre_medio,url_base');
  let fuentes: Array<{ fuente_id: string; url_base?: string | null }> = [];
  try {
    const { data, error } = await getSupabase().from('fuentes').select('fuente_id,url_base').limit(5000);
    if (!error && data) fuentes = data as typeof fuentes;
  } catch { /* Source Registry optional */ }

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
  const articles = [];
  for (const [canon, group] of unique.entries()) {
    const first = group[0]!;
    const ident = classifyPublisherIdentity(canon, medios ?? [], fuentes);
    articles.push({
      publisher_final_url: canon,
      hostname: ident.hostname,
      identity: ident.kind,
      candidate_medio_ids: ident.candidate_medio_ids,
      candidate_fuente_ids: ident.candidate_fuente_ids,
      medio_id: ident.medio_id,
      cliente_ids_interested: [...new Set(group.flatMap((g) => g.cliente_ids ?? []))],
      keyword_ids: [...new Set(group.flatMap((g) => g.keyword_ids ?? []))],
      queries: [...new Set(group.map((g) => g.query))],
      google_item_urls: [...new Set(group.map((g) => g.google_item_url))],
      first_discovered_at: new Date().toISOString(),
      last_discovered_at: new Date().toISOString(),
      google_title: first.title,
    });
  }

  if (opts.persistCursor) {
    mkdirSync(join(process.cwd(), 'artifacts'), { recursive: true });
    writeFileSync(CURSOR_PATH, JSON.stringify(sliced.next, null, 2));
  }

  return {
    production_writes: 0,
    QUERY_TOTAL: plan.QUERY_TOTAL,
    QUERY_PROCESSED: sliced.QUERY_PROCESSED,
    QUERY_PENDING: sliced.QUERY_PENDING,
    cursor: sliced.next,
    GOOGLE_RAW_ITEMS: rawItems.length,
    GOOGLE_UNIQUE_PUBLISHER_ARTICLES: articles.length,
    GOOGLE_UNRESOLVED: resolved.filter((r) => r.unwind_status === 'GOOGLE_URL_UNRESOLVED').length,
    identity_counts: {
      KNOWN_UNIQUE: articles.filter((a) => a.identity === 'KNOWN_UNIQUE').length,
      KNOWN_AMBIGUOUS: articles.filter((a) => a.identity === 'KNOWN_AMBIGUOUS').length,
      UNKNOWN: articles.filter((a) => a.identity === 'UNKNOWN').length,
    },
    articles: articles.slice(0, 80),
  };
}

async function main(): Promise<void> {
  const batch = parseIntOrNull(process.argv.find((a) => a.startsWith('--batch='))?.split('=')[1] ?? '') ?? 12;
  const payload = await runGoogleGapRadar({ batchSize: batch, persistCursor: true });
  const dir = join(process.cwd(), 'artifacts');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `google-news-gap-radar-${new Date().toISOString().slice(0, 10)}.json`);
  writeFileSync(out, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify({ out, QUERY_TOTAL: payload.QUERY_TOTAL, QUERY_PROCESSED: payload.QUERY_PROCESSED, unique: payload.GOOGLE_UNIQUE_PUBLISHER_ARTICLES }, null, 2));
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
