/**
 * Unwind determinista de news.google.com/rss/articles/… → URL de publisher.
 * No scraping de sitios de medios. Un GET opcional al wrapper de Google
 * y, si hace falta, el RPC garturlreq de Google News.
 */
import { canonicalizeUrl } from '../normalizers/url.js';
import { hostnameOfArticleUrl } from '../extractors/transient403Retry.js';
import { USER_AGENT } from '../utils/http.js';

export const GOOGLE_URL_RESOLVED = 'GOOGLE_URL_RESOLVED' as const;
export const GOOGLE_URL_UNRESOLVED = 'GOOGLE_URL_UNRESOLVED' as const;
export type GoogleUrlResolveStatus = typeof GOOGLE_URL_RESOLVED | typeof GOOGLE_URL_UNRESOLVED;

export type GoogleUnwindMethod =
  | 'not_google'
  | 'query_param'
  | 'token_embedded_url'
  | 'http_redirect'
  | 'html_canonical'
  | 'google_garturl'
  | 'unresolved';

export interface GoogleUrlResolution {
  google_url: string;
  publisher_final_url: string | null;
  canonical_url: string | null;
  publisher_hostname: string | null;
  status: GoogleUrlResolveStatus;
  method: GoogleUnwindMethod;
}

const BATCH_EXECUTE = 'https://news.google.com/_/DotsSplashUi/data/batchexecute';

const unwindCache = new Map<string, GoogleUrlResolution>();

export function unwindCacheSize(): number {
  return unwindCache.size;
}

export function clearUnwindCache(): void {
  unwindCache.clear();
}

export function seedUnwindCache(articleId: string, resolution: GoogleUrlResolution): void {
  unwindCache.set(articleId, { ...resolution, method: resolution.method });
}

function cacheKey(url: string): string | null {
  return googleArticleId(url) ?? (isGoogleNewsHost(url) ? url : null);
}

export function isGoogleNewsHost(urlOrHost: string): boolean {
  try {
    const host = urlOrHost.includes('://')
      ? new URL(urlOrHost).hostname.toLowerCase()
      : urlOrHost.toLowerCase();
    return host === 'news.google.com' || host.endsWith('.news.google.com');
  } catch {
    return /news\.google\.com/i.test(urlOrHost);
  }
}

export function googleArticleId(url: string): string | null {
  try {
    const path = new URL(url).pathname;
    const m = path.match(/\/(?:rss\/)?articles\/([^/?#]+)/i) ?? path.match(/\/read\/([^/?#]+)/i);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

export function publisherUrlFromQueryParams(url: string): string | null {
  try {
    const u = new URL(url);
    for (const key of ['url', 'q', 'u']) {
      const v = u.searchParams.get(key);
      if (v && /^https?:\/\//i.test(v) && !isGoogleNewsHost(v)) return canonicalizeUrl(v);
    }
  } catch {
    return null;
  }
  return null;
}

function decodeBase64Url(token: string): Buffer | null {
  try {
    const pad = token.replace(/-/g, '+').replace(/_/g, '/');
    const padded = pad + '='.repeat((4 - (pad.length % 4)) % 4);
    return Buffer.from(padded, 'base64');
  } catch {
    return null;
  }
}

export function publisherUrlsFromGoogleToken(articleId: string): string[] {
  const buf = decodeBase64Url(articleId);
  if (!buf) return [];
  const blobs = [buf];
  const nested = buf.toString('latin1').match(/[A-Za-z0-9_\-]{40,}/g) ?? [];
  for (const n of nested.slice(0, 4)) {
    const inner = decodeBase64Url(n);
    if (inner && inner.length > 16) blobs.push(inner);
  }
  const found: string[] = [];
  const re = /https?:\/\/[A-Za-z0-9._~:/?#@!$&'()*+,;=%\-]+/g;
  for (const b of blobs) {
    const text = b.toString('utf8');
    for (const m of text.matchAll(re)) {
      const raw = m[0].replace(/[)\]>',"]+$/g, '');
      if (!isGoogleNewsHost(raw) && /^https?:\/\/[^/]+\.[^/]+/i.test(raw)) {
        found.push(canonicalizeUrl(raw));
      }
    }
  }
  return [...new Set(found)];
}

export function publisherUrlFromHtml(html: string): string | null {
  const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)
    ?? html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);
  if (canonical?.[1] && !isGoogleNewsHost(canonical[1])) return canonicalizeUrl(canonical[1]);

  const refresh = html.match(/http-equiv=["']refresh["'][^>]+url=([^"'>\s]+)/i)
    ?? html.match(/content=["'][^"']*url=([^"'>\s]+)["']/i);
  if (refresh?.[1] && /^https?:\/\//i.test(refresh[1]) && !isGoogleNewsHost(refresh[1])) {
    return canonicalizeUrl(refresh[1]);
  }

  const encoded = html.match(/[?&]url=(https?%3A%2F%2F[^"'&\s]+)/i);
  if (encoded?.[1]) {
    try {
      const decoded = decodeURIComponent(encoded[1]);
      if (!isGoogleNewsHost(decoded)) return canonicalizeUrl(decoded);
    } catch { /* ignore */ }
  }
  return null;
}

function resolutionOf(googleUrl: string, publisher: string, method: GoogleUnwindMethod): GoogleUrlResolution {
  const canonical = canonicalizeUrl(publisher);
  return {
    google_url: googleUrl,
    publisher_final_url: canonical,
    canonical_url: canonical,
    publisher_hostname: hostnameOfArticleUrl(canonical),
    status: GOOGLE_URL_RESOLVED,
    method,
  };
}

function unresolved(googleUrl: string): GoogleUrlResolution {
  return {
    google_url: googleUrl,
    publisher_final_url: null,
    canonical_url: null,
    publisher_hostname: null,
    status: GOOGLE_URL_UNRESOLVED,
    method: 'unresolved',
  };
}

async function fetchGoogleWrapper(url: string, timeoutMs: number): Promise<{ finalUrl: string; text: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    const finalUrl = typeof res.url === 'string' && res.url.length > 0 ? res.url : url;
    if (!res.ok) return { finalUrl, text: '' };
    const text = await res.text();
    return { finalUrl, text };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveViaGarturl(articleId: string, html: string, timeoutMs: number): Promise<string | null> {
  const sig = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
  const ts = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
  if (!sig || !ts) return null;
  const rpcInner = JSON.stringify([
    'garturlreq',
    [
      ['X', 'X', ['X', 'X'], null, null, 1, 1, 'US:en', null, 1, null, null, null, null, null, 0, 1],
      'X', 'X', 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0,
    ],
    articleId,
    Number.parseInt(ts, 10),
    sig,
  ]);
  const fReq = JSON.stringify([[['Fbv4je', rpcInner, null, 'generic']]]);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(BATCH_EXECUTE, {
      method: 'POST',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': USER_AGENT,
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        referer: 'https://news.google.com/',
        accept: '*/*',
      },
      body: new URLSearchParams({ 'f.req': fReq }).toString(),
    });
    if (!res.ok) return null;
    let body = await res.text();
    if (body.startsWith(")]}'")) body = body.split('\n').slice(1).join('\n');
    body = body.trim();
    const nl = body.indexOf('\n');
    if (nl > 0 && /^\d+$/.test(body.slice(0, nl).trim())) body = body.slice(nl + 1);
    const envelopes = JSON.parse(body) as unknown;
    if (!Array.isArray(envelopes)) return null;
    for (const env of envelopes) {
      if (!Array.isArray(env) || env[0] !== 'wrb.fr' || env[1] !== 'Fbv4je') continue;
      const payload = JSON.parse(String(env[2])) as unknown;
      if (Array.isArray(payload) && payload[0] === 'garturlres' && typeof payload[1] === 'string') {
        const url = payload[1];
        if (/^https?:\/\//i.test(url) && !isGoogleNewsHost(url)) return canonicalizeUrl(url);
      }
    }
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
  return null;
}

/** Resuelve una URL de Google News o la deja como publisher si ya lo es. */
export async function resolveGoogleNewsUrl(
  url: string,
  opts: { timeoutMs?: number; allowNetwork?: boolean } = {},
): Promise<GoogleUrlResolution> {
  const raw = url.trim();
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const allowNetwork = opts.allowNetwork !== false;

  if (!raw) return unresolved(raw);
  const cachedKey = cacheKey(raw);
  if (cachedKey && unwindCache.has(cachedKey)) {
    const hit = unwindCache.get(cachedKey)!;
    return { ...hit, google_url: raw };
  }
  if (!isGoogleNewsHost(raw)) {
    const canonical = canonicalizeUrl(raw);
    return {
      google_url: raw,
      publisher_final_url: canonical,
      canonical_url: canonical,
      publisher_hostname: hostnameOfArticleUrl(canonical),
      status: GOOGLE_URL_RESOLVED,
      method: 'not_google',
    };
  }

  const fromQuery = publisherUrlFromQueryParams(raw);
  if (fromQuery) {
    const r = resolutionOf(raw, fromQuery, 'query_param');
    if (cachedKey) unwindCache.set(cachedKey, r);
    return r;
  }

  const id = googleArticleId(raw);
  if (id) {
    const embedded = publisherUrlsFromGoogleToken(id);
    if (embedded[0]) {
      const r = resolutionOf(raw, embedded[0], 'token_embedded_url');
      unwindCache.set(id, r);
      return r;
    }
  }

  if (!allowNetwork) return unresolved(raw);

  const page = await fetchGoogleWrapper(raw, timeoutMs);
  if (page?.finalUrl && !isGoogleNewsHost(page.finalUrl)) {
    const r = resolutionOf(raw, page.finalUrl, 'http_redirect');
    if (cachedKey) unwindCache.set(cachedKey, r);
    return r;
  }
  if (page?.text) {
    const fromHtml = publisherUrlFromHtml(page.text);
    if (fromHtml) {
      const r = resolutionOf(raw, fromHtml, 'html_canonical');
      if (cachedKey) unwindCache.set(cachedKey, r);
      return r;
    }
    if (id) {
      const gart = await resolveViaGarturl(id, page.text, timeoutMs);
      if (gart) {
        const r = resolutionOf(raw, gart, 'google_garturl');
        unwindCache.set(id, r);
        return r;
      }
    }
  }
  const miss = unresolved(raw);
  return miss;
}

export async function resolveGoogleNewsUrls(
  urls: string[],
  opts: { timeoutMs?: number; concurrency?: number } = {},
): Promise<GoogleUrlResolution[]> {
  const concurrency = Math.max(1, Math.min(4, opts.concurrency ?? 3));
  const out: GoogleUrlResolution[] = new Array(urls.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= urls.length) return;
      out[i] = await resolveGoogleNewsUrl(urls[i]!, { timeoutMs: opts.timeoutMs });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, () => worker()));
  return out;
}

export type DiscoveryStatus =
  | 'ALREADY_IN_LAKE'
  | 'MISSING_KNOWN_SOURCE'
  | 'UNKNOWN_SOURCE'
  | 'UNRESOLVED_GOOGLE_URL';

export function discoveryStatus(opts: {
  resolved: boolean;
  inLake: boolean;
  knownSource: boolean;
}): DiscoveryStatus {
  if (!opts.resolved) return 'UNRESOLVED_GOOGLE_URL';
  if (opts.inLake) return 'ALREADY_IN_LAKE';
  if (opts.knownSource) return 'MISSING_KNOWN_SOURCE';
  return 'UNKNOWN_SOURCE';
}
