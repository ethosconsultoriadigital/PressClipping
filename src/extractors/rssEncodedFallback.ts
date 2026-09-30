/**
 * Fallback host-scoped: si el HTML del artículo falla con 502 o timeout,
 * usar content:encoded del feed RSS oficial del mismo medio.
 *
 * Evidencia Energía Hoy (energiahoy.com): homepage y /feed/ responden 200;
 * permalinks de nota cuelgan o devuelven 502. El RSS trae el cuerpo completo.
 * No es bypass de paywall ni cambio de UA.
 */
import RssParser from 'rss-parser';
import { fetchTextWithMeta, HttpRequestError, type FetchOptions, type HttpFetchResult } from '../utils/http.js';
import { fetchHtmlRespectingTransient403, hostnameOfArticleUrl, type FetchHtmlFn } from './transient403Retry.js';

export const RSS_ENCODED_FALLBACK_FEEDS = new Map<string, string>([
  ['energiahoy.com', 'https://energiahoy.com/feed/'],
  ['diariocambio.com.mx', 'https://www.diariocambio.com.mx/feed/'],
  ['heraldoleon.mx', 'https://www.heraldoleon.mx/feed/'],
]);

const MIN_ENCODED_CHARS = 200;

const parser = new RssParser({
  timeout: 15000,
  customFields: {
    item: [['content:encoded', 'contentEncoded']],
  },
});

type RssEncodedItem = {
  link?: string;
  content?: string;
  contentEncoded?: string;
};

const feedCache = new Map<string, Promise<RssEncodedItem[]>>();

export function clearRssEncodedFallbackCache(): void {
  feedCache.clear();
}

export function shouldUseRssEncodedFallback(url: string, err: HttpRequestError): boolean {
  const host = hostnameOfArticleUrl(url);
  if (!RSS_ENCODED_FALLBACK_FEEDS.has(host)) return false;
  if (err.kind === 'timeout') return true;
  if (err.kind !== 'http_status') return false;
  return err.status === 502 || err.status === 403 || err.status === 307;
}

function slugOf(url: string): string {
  try {
    const segs = new URL(url).pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    return (segs[segs.length - 1] ?? '').toLowerCase();
  } catch {
    return '';
  }
}

function encodedHtmlOf(item: RssEncodedItem): string {
  return (item.contentEncoded ?? item.content ?? '').trim();
}

function wrapFragment(fragment: string): string {
  return `<html><head><meta charset="utf-8"></head><body><article>${fragment}</article></body></html>`;
}

async function loadFeedItems(feedUrl: string, fetchHtml: FetchHtmlFn, opts: FetchOptions): Promise<RssEncodedItem[]> {
  let pending = feedCache.get(feedUrl);
  if (!pending) {
    pending = (async () => {
      const r = await fetchHtml(feedUrl, opts);
      const feed = await parser.parseString(r.text);
      return (feed.items ?? []) as RssEncodedItem[];
    })();
    feedCache.set(feedUrl, pending);
  }
  try {
    return await pending;
  } catch (err) {
    feedCache.delete(feedUrl);
    throw err;
  }
}

export async function loadMatchingRssEncodedHtml(
  articleUrl: string,
  fetchHtml: FetchHtmlFn,
  opts: FetchOptions = {},
): Promise<string | null> {
  const host = hostnameOfArticleUrl(articleUrl);
  const feedUrl = RSS_ENCODED_FALLBACK_FEEDS.get(host);
  if (!feedUrl) return null;
  const slug = slugOf(articleUrl);
  if (!slug) return null;
  const items = await loadFeedItems(feedUrl, fetchHtml, opts);
  const hit = items.find((it) => slugOf(it.link ?? '') === slug);
  if (!hit) return null;
  const encoded = encodedHtmlOf(hit);
  if (encoded.length < MIN_ENCODED_CHARS) return null;
  return wrapFragment(encoded);
}

/**
 * GET del artículo; si el host está en la lista y el fallo es 502/timeout,
 * un GET extra al feed RSS para extraer content:encoded del ítem homólogo.
 */
export async function fetchHtmlRespectingRssEncodedFallback(
  url: string,
  opts: FetchOptions = {},
  fetchHtml: FetchHtmlFn = fetchTextWithMeta,
): Promise<HttpFetchResult> {
  try {
    return await fetchHtmlRespectingTransient403(url, opts, fetchHtml);
  } catch (err) {
    if (!(err instanceof HttpRequestError) || !shouldUseRssEncodedFallback(url, err)) {
      throw err;
    }
    let html: string | null = null;
    try {
      html = await loadMatchingRssEncodedHtml(url, fetchHtml, opts);
    } catch {
      html = null;
    }
    if (!html) throw err;
    return { text: html, status: 200, finalUrl: url };
  }
}
