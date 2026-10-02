import { canonicalizeUrl } from '../normalizers/url.js';
import { fetchRss } from '../parsers/rss.js';
import { fetchTextWithMeta } from '../utils/http.js';
import { hostnameOfArticleUrl } from '../extractors/transient403Retry.js';
import type { KeywordActivaRow } from '../supabase/repositories.js';

export const GOOGLE_NEWS_RSS_SEARCH =
  'https://news.google.com/rss/search?hl=es-419&gl=MX&ceid=MX:es-419&q=';

export interface GoogleRssItem {
  query: string;
  keyword_id: string | null;
  cliente_id: string | null;
  google_item_url: string;
  title: string | null;
  published: string | null;
  publisher_final_url: string | null;
  hostname: string | null;
}

export function googleNewsSearchUrl(query: string): string {
  return `${GOOGLE_NEWS_RSS_SEARCH}${encodeURIComponent(`${query} when:1d`)}`;
}

export function recoveryQueriesFromKeywords(keywords: KeywordActivaRow[], maxQueries = 24): Array<{
  query: string;
  keyword_id: string | null;
  cliente_id: string | null;
}> {
  const out: Array<{ query: string; keyword_id: string | null; cliente_id: string | null }> = [];
  const seen = new Set<string>();
  for (const kw of keywords) {
    const tipo = String(kw.tipo_keyword ?? '').toLowerCase();
    if (tipo !== 'frase_exacta') continue;
    const q = kw.keyword.trim();
    if (q.length < 6) continue;
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ query: q, keyword_id: kw.keyword_id, cliente_id: kw.cliente_id });
    if (out.length >= maxQueries) break;
  }
  return out;
}

export async function resolvePublisherUrl(googleOrPublisherUrl: string): Promise<string> {
  const raw = googleOrPublisherUrl.trim();
  if (!raw) return raw;
  try {
    const host = new URL(raw).hostname.toLowerCase();
    if (!host.includes('news.google.com')) return canonicalizeUrl(raw);
  } catch {
    return raw;
  }
  try {
    const meta = await fetchTextWithMeta(raw, { timeoutMs: 12000, retries: 0, maxAttempts: 1 });
    return canonicalizeUrl(meta.finalUrl || raw);
  } catch {
    return canonicalizeUrl(raw);
  }
}

export function classifyPublisher(
  publisherUrl: string | null,
  medios: Array<{ medio_id: string; nombre_medio: string; url_base: string | null }>,
): { kind: 'known' | 'unknown'; medio_id: string | null; hostname: string | null } {
  if (!publisherUrl) return { kind: 'unknown', medio_id: null, hostname: null };
  const hostname = hostnameOfArticleUrl(publisherUrl);
  if (!hostname) return { kind: 'unknown', medio_id: null, hostname: null };
  const hit = medios.find((m) => {
    const base = hostnameOfArticleUrl(m.url_base ?? '');
    return Boolean(base) && (hostname === base || hostname.endsWith(`.${base}`));
  });
  return hit
    ? { kind: 'known', medio_id: hit.medio_id, hostname }
    : { kind: 'unknown', medio_id: null, hostname };
}

export async function fetchGoogleNewsItems(query: string, keyword_id: string | null, cliente_id: string | null): Promise<GoogleRssItem[]> {
  const items = await fetchRss(googleNewsSearchUrl(query));
  const out: GoogleRssItem[] = [];
  for (const it of items) {
    const googleUrl = (it.url ?? '').trim();
    if (!googleUrl) continue;
    out.push({
      query,
      keyword_id,
      cliente_id,
      google_item_url: googleUrl,
      title: it.titulo ?? null,
      published: it.fecha ?? null,
      publisher_final_url: null,
      hostname: null,
    });
  }
  return out;
}
