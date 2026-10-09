import { fetchRss } from '../parsers/rss.js';
import { fetchText } from '../utils/http.js';
import { rssWindowCompleteness } from './rssWindow.js';
import { applySitemapWindow } from './sitemapWindow.js';
import { SITEMAP_CURSOR_PAGE_SIZE } from './sitemapCursor.js';
import { paginateSitemap } from './sitemapPager.js';
import { classifyProbedSurface, fetchAndParseListingTargets, listingTargetsFromCatalog } from './surfaceProbe.js';
import { followUpForProbedSurface } from './surfaceResult.js';
import type { SurfaceAttemptResult } from './surfaceResult.js';
import { captureCanonicalUrl, hostOf, primaryHash } from './urlIndex.js';
import type { ChannelCatalogRow, DiscoverOpts, DiscoveredUrl } from './types.js';
import type { SourceDiscovery } from './engine.js';

function toDiscovered(
  row: ChannelCatalogRow,
  url: string,
  via: string,
  publishedAt: string | null,
  titulo: string | null,
  resumen: string | null,
  membership?: DiscoveredUrl['windowMembership'],
): DiscoveredUrl {
  return {
    url,
    canonicalUrl: captureCanonicalUrl(url),
    hashUrl: primaryHash(url),
    medioId: row.medio_id,
    fuenteId: null,
    hostname: hostOf(url) || row.hostname || '',
    discoveredVia: via,
    publishedAt,
    titulo,
    resumen,
    body: null,
    windowMembership: membership ?? (publishedAt ? 'IN_WINDOW' : 'WINDOW_MEMBERSHIP_UNKNOWN'),
  };
}

function allowSurface(kind: string, opts?: DiscoverOpts): boolean {
  if (opts?.onlySurfaces?.length && !opts.onlySurfaces.includes(kind)) return false;
  if (opts?.skipSurfaces?.includes(kind)) return false;
  return true;
}

export async function discoverLiveSource(
  row: ChannelCatalogRow,
  window: { start: string; end: string },
  opts?: DiscoverOpts,
): Promise<SourceDiscovery> {
  const urls: DiscoveredUrl[] = [];
  const surfaces: string[] = [];
  const fetchFn = opts?.fetchTextFn ?? fetchText;
  let rssSpanCovered: SourceDiscovery['rssSpanCovered'] = 'UNKNOWN';
  let sitemapSpanCovered: SourceDiscovery['sitemapSpanCovered'] = 'UNKNOWN';
  let listingSpanCovered: SourceDiscovery['listingSpanCovered'] = 'UNKNOWN';
  let sitemapRuntimeCompletenessInvoked = false;
  let capHit = false;
  let cursor: string | null = null;
  let pageExhausted = false;
  let resumedFromCursor: string | null = null;
  let probedSurface: string | null = null;
  let probeEvaluated = false;
  let surfaceResult: SurfaceAttemptResult | undefined;
  let cursorNotFound = false;
  let pendingSubs = 0;
  let subsFallidos = 0;
  let truncated = false;
  let nextFollowUp: SourceDiscovery['nextFollowUp'] = null;

  if (row.rss_url && allowSurface('rss', opts)) {
    surfaces.push('rss');
    try {
      const items = await fetchRss(row.rss_url);
      const mapped = items
        .filter((it) => it.url)
        .map((it) => toDiscovered(row, it.url, 'rss', it.fecha ?? null, it.titulo ?? null, it.resumen ?? null));
      const win = rssWindowCompleteness(
        mapped.map((x) => ({ publishedAt: x.publishedAt })),
        window.start,
        window.end,
      );
      rssSpanCovered = win.flag;
      urls.push(
        ...mapped.filter((x) => !x.publishedAt || Date.parse(x.publishedAt) >= Date.parse(window.start)),
      );
      surfaceResult = surfaceResult ?? (win.flag === 'YES' ? 'SUCCESS' : 'PARTIAL');
    } catch {
      rssSpanCovered = 'NO';
      surfaceResult = 'FAILED';
    }
  }

  const wantSitemap = allowSurface('sitemap', opts) && Boolean(row.sitemap_url);
  if (wantSitemap && row.sitemap_url) {
    try {
      const page = await paginateSitemap({
        rootUrl: row.sitemap_url,
        fetcher: fetchFn,
        cursor: opts?.resumeCursor,
        pageSize: opts?.sitemapPageSize ?? SITEMAP_CURSOR_PAGE_SIZE,
        maxSubsPerRun: 15,
      });
      surfaces.push('sitemap');
      sitemapRuntimeCompletenessInvoked = true;
      cursor = page.nextCursor;
      pageExhausted = page.exhausted;
      resumedFromCursor = page.resumedFrom;
      cursorNotFound = page.cursorNotFound;
      pendingSubs = page.pendingSubs;
      subsFallidos = page.subsFallidos;
      truncated = page.truncated;
      capHit = page.truncated || page.subsFallidos > 0 || page.surfaceResult === 'PARTIAL';
      surfaceResult = page.surfaceResult;
      if (page.failed || page.cursorNotFound) {
        sitemapSpanCovered = 'NO';
        pageExhausted = false;
        surfaceResult = 'FAILED';
      } else {
        const windowed = applySitemapWindow({
          items: page.items,
          windowStart: window.start,
          windowEnd: window.end,
          paginationComplete: page.exhausted && page.subsFallidos === 0 && !page.truncated,
          indexFollowed: page.pendingSubs === 0 || Boolean(opts?.resumeCursor),
          capHit,
        });
        sitemapSpanCovered = windowed.completeness;
        urls.push(
          ...windowed.items
            .filter((it) => it.url)
            .map((it) =>
              toDiscovered(
                row,
                it.url,
                'sitemap',
                it.fecha ?? null,
                it.titulo ?? null,
                it.resumen ?? null,
                it.fecha ? 'IN_WINDOW' : 'WINDOW_MEMBERSHIP_UNKNOWN',
              ),
            ),
        );
      }
    } catch {
      surfaces.push('sitemap');
      sitemapSpanCovered = 'NO';
      sitemapRuntimeCompletenessInvoked = true;
      pageExhausted = false;
      surfaceResult = 'FAILED';
    }
  }

  if (!row.sitemap_url && row.url_base && allowSurface('sitemap', opts) && !opts?.probeListing) {
    try {
      const origin = new URL(row.url_base.startsWith('http') ? row.url_base : `https://${row.url_base}`).origin;
      const robots = await fetchFn(`${origin}/robots.txt`);
      const declared = [...robots.matchAll(/^sitemap:\s*(\S+)/gim)].map((m) => m[1]).filter(Boolean) as string[];
      if (declared[0]) {
        const page = await paginateSitemap({
          rootUrl: declared[0],
          fetcher: fetchFn,
          cursor: opts?.resumeCursor,
          pageSize: opts?.sitemapPageSize ?? SITEMAP_CURSOR_PAGE_SIZE,
          maxSubsPerRun: 15,
        });
        surfaces.push('sitemap');
        sitemapRuntimeCompletenessInvoked = true;
        cursor = page.nextCursor;
        pageExhausted = page.exhausted && !page.failed;
        surfaceResult = page.failed ? 'FAILED' : page.surfaceResult;
        pendingSubs = page.pendingSubs;
        subsFallidos = page.subsFallidos;
        truncated = page.truncated;
        if (!page.failed) {
          const windowed = applySitemapWindow({
            items: page.items,
            windowStart: window.start,
            windowEnd: window.end,
            paginationComplete: page.exhausted && page.subsFallidos === 0,
            indexFollowed: true,
            capHit: page.truncated || page.subsFallidos > 0,
          });
          sitemapSpanCovered = windowed.completeness;
          urls.push(
            ...windowed.items
              .filter((it) => it.url)
              .map((it) =>
                toDiscovered(row, it.url, 'sitemap_robots', it.fecha ?? null, it.titulo ?? null, it.resumen ?? null),
              ),
          );
        }
      }
    } catch {
      /* robots ausente: no inventar endpoint */
    }
  }

  const wantListing = allowSurface('listing', opts) && Boolean(opts?.onlySurfaces?.includes('listing') || opts?.probeListing);
  if (wantListing && !opts?.probeListing) {
    const targets = listingTargetsFromCatalog(row);
    if (targets.length === 0) {
      surfaceResult = surfaceResult ?? 'UNAVAILABLE';
    } else {
      const listing = await fetchAndParseListingTargets(targets, fetchFn);
      if (listing.analyzed === 0) {
        surfaceResult = 'FAILED';
      } else {
        surfaces.push('listing');
        listingSpanCovered = 'UNKNOWN';
        surfaceResult = 'SUCCESS';
        urls.push(
          ...listing.urls.slice(0, 80).map((href) => toDiscovered(row, href, 'listing', null, null, null)),
        );
      }
    }
  }

  if (opts?.probeListing) {
    const targets = listingTargetsFromCatalog(row);
    const listing = await fetchAndParseListingTargets(targets, fetchFn);
    probeEvaluated = listing.analyzed > 0;
    if (listing.analyzed === 0) {
      surfaceResult = 'FAILED';
      probeEvaluated = false;
    } else {
      probedSurface = listing.foundKind ?? classifyProbedSurface(targets[0] ?? row.url_base ?? '');
      surfaces.push(probedSurface);
      listingSpanCovered = 'UNKNOWN';
      surfaceResult = 'SUCCESS';
      nextFollowUp = followUpForProbedSurface(probedSurface);
      urls.push(
        ...listing.urls.slice(0, 80).map((href) =>
          toDiscovered(row, href, `surface_probe:${probedSurface}`, null, null, null),
        ),
      );
    }
  }

  const noDiscoverySurface = surfaces.length === 0;
  if (noDiscoverySurface) {
    surfaces.push('NO_DISCOVERY_SURFACE');
    surfaceResult = surfaceResult ?? 'UNAVAILABLE';
  }

  return {
    urls,
    surfaces,
    rssSpanCovered,
    sitemapSpanCovered,
    listingSpanCovered,
    sitemapRuntimeCompletenessInvoked,
    capHit,
    noDiscoverySurface,
    cursor,
    pageExhausted,
    probedSurface,
    probeEvaluated,
    resumedFromCursor,
    surfaceResult,
    cursorNotFound,
    pendingSubs,
    subsFallidos,
    truncated,
    nextFollowUp,
  };
}
