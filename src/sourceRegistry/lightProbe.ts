import { fetchTextWithMeta, HttpRequestError } from '../utils/http.js';
import { urlsCandidatas } from '../validation/mediaAudit.js';
import { parseRssString } from '../parsers/rss.js';
import { parseSitemapString } from '../parsers/sitemap.js';
import { classifyLightHealth } from './health.js';
import type { CaptureStatus, HealthStatus, Platform } from './types.js';

export interface LightProbeInput {
  platform: Platform;
  url: string | null;
  rssUrl: string | null;
  sitemapUrl: string | null;
  consecutiveFailures: number;
  nowIso: string;
}

export interface LightProbeOutput {
  health: HealthStatus;
  capture: CaptureStatus;
  httpStatus: number | null;
  redirectFinalUrl: string | null;
  latestContentAt: string | null;
  consecutiveFailures: number;
  rssUrl: string | null;
  sitemapUrl: string | null;
  robotsObserved: boolean;
  notes: string;
}

function newestIso(dates: (string | null | undefined)[]): string | null {
  const parsed = dates
    .map((d) => (d ? Date.parse(d) : NaN))
    .filter((n) => Number.isFinite(n)) as number[];
  if (!parsed.length) return null;
  return new Date(Math.max(...parsed)).toISOString();
}

export async function lightProbeWeb(input: LightProbeInput): Promise<LightProbeOutput> {
  if (input.platform !== 'WEB') {
    const capture: CaptureStatus =
      input.platform === 'PETITION' ? 'SEARCH_ONLY' : 'API_REQUIRED';
    return {
      health: 'UNKNOWN',
      capture,
      httpStatus: null,
      redirectFinalUrl: null,
      latestContentAt: null,
      consecutiveFailures: input.consecutiveFailures,
      rssUrl: input.rssUrl,
      sitemapUrl: input.sitemapUrl,
      robotsObserved: false,
      notes: `social_or_nonweb platform=${input.platform} no_unauthorized_scrape`,
    };
  }

  const home = input.url;
  if (!home) {
    return {
      health: 'UNKNOWN',
      capture: 'UNKNOWN',
      httpStatus: null,
      redirectFinalUrl: null,
      latestContentAt: null,
      consecutiveFailures: input.consecutiveFailures,
      rssUrl: input.rssUrl,
      sitemapUrl: input.sitemapUrl,
      robotsObserved: false,
      notes: 'no_url',
    };
  }

  let httpStatus: number | null = null;
  let redirect: string | null = null;
  let timeout = false;
  let network = false;
  let nxdomain = false;
  let homepageOk = false;
  let robotsObserved = false;
  let rss = input.rssUrl;
  let sitemap = input.sitemapUrl;
  let latest: string | null = null;
  const notes: string[] = [];

  let homepageHtml = '';
  try {
    const r = await fetchTextWithMeta(home, { timeoutMs: 10000, retries: 0, maxAttempts: 1 });
    httpStatus = r.status;
    redirect = r.finalUrl;
    homepageHtml = r.text;
    homepageOk = r.status >= 200 && r.status < 400 && r.text.length > 200;
  } catch (e) {
    if (e instanceof HttpRequestError) {
      httpStatus = e.status;
      redirect = e.finalUrl;
      timeout = e.kind === 'timeout';
      network = e.kind === 'network';
      if (e.status === 404 || e.status === 410) notes.push('gone');
    } else {
      const msg = e instanceof Error ? e.message : String(e);
      timeout = /timeout|aborted/i.test(msg);
      nxdomain = /enotfound|nxdomain|getaddrinfo/i.test(msg);
      network = !timeout && !nxdomain;
    }
  }

  const cand = urlsCandidatas({ url_base: home, rss_url: rss, sitemap_url: sitemap });
  if (cand.robots) {
    try {
      const rob = await fetchTextWithMeta(cand.robots, { timeoutMs: 8000, retries: 0, maxAttempts: 1 });
      robotsObserved = rob.status === 200;
      for (const line of rob.text.split(/\r?\n/)) {
        const m = line.match(/^\s*sitemap:\s*(\S+)/i);
        if (m?.[1] && !sitemap) sitemap = m[1].trim();
      }
    } catch {
      /* observable fallo no es DEAD */
    }
  }

  const html = homepageHtml;
  const alt = html.match(/rel=["']alternate["'][^>]+type=["']application\/(rss|atom)\+xml["'][^>]+href=["']([^"']+)/i);
  if (alt?.[2] && !rss) {
    try {
      rss = new URL(alt[2], home).toString();
    } catch {
      rss = alt[2];
    }
  }

  for (const [kind, url] of [
    ['rss', rss],
    ['sitemap', sitemap],
  ] as const) {
    if (!url) continue;
    try {
      const r = await fetchTextWithMeta(url, { timeoutMs: 10000, retries: 0, maxAttempts: 1 });
      if (kind === 'rss') {
        const items = await parseRssString(r.text);
        latest = newestIso(items.map((i) => i.fecha)) ?? latest;
        notes.push(`rss_items=${items.length}`);
      } else {
        const sm = parseSitemapString(r.text);
        latest = newestIso(sm.items.map((i) => i.fecha)) ?? latest;
        notes.push(`sitemap_items=${sm.items.length} subs=${sm.subSitemaps.length}`);
      }
    } catch {
      notes.push(`${kind}_probe_fail`);
    }
  }

  const classified = classifyLightHealth({
    httpStatus,
    timeout,
    networkError: network,
    nxdomain,
    homepageOk,
    latestContentAt: latest,
    nowIso: input.nowIso,
    consecutiveFailuresBefore: input.consecutiveFailures,
  });

  let capture: CaptureStatus = 'UNKNOWN';
  if (rss || sitemap) capture = 'READY';
  else if (homepageOk) capture = 'PARTIAL';
  else if (classified.health === 'BLOCKED_EXTERNAL') capture = 'UNSUPPORTED';

  return {
    health: classified.health,
    capture,
    httpStatus,
    redirectFinalUrl: redirect,
    latestContentAt: latest,
    consecutiveFailures: classified.consecutiveFailures,
    rssUrl: rss,
    sitemapUrl: sitemap,
    robotsObserved,
    notes: notes.join(';'),
  };
}
