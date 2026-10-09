import { fetchRss } from '../parsers/rss.js';
import { resolverSitemap } from '../parsers/sitemap.js';
import { fetchText } from '../utils/http.js';
import { rssWindowCompleteness } from './rssWindow.js';
import { applySitemapWindow } from './sitemapWindow.js';
import { sliceSitemapFromCursor, SITEMAP_CURSOR_PAGE_SIZE } from './sitemapCursor.js';
import { classifyProbedSurface, extractListingHrefs } from './surfaceProbe.js';
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

async function ingestSitemap(
  sitemapUrl: string,
  row: ChannelCatalogRow,
  window: { start: string; end: string },
  via: string,
  opts?: DiscoverOpts,
): Promise<{
  urls: DiscoveredUrl[];
  completeness: SourceDiscovery['sitemapSpanCovered'];
  capHit: boolean;
  invoked: boolean;
  cursor: string | null;
  pageExhausted: boolean;
  resumedFromCursor: string | null;
}> {
  const pageSize = opts?.sitemapPageSize ?? SITEMAP_CURSOR_PAGE_SIZE;
  const resolved = await resolverSitemap(sitemapUrl, fetchText, {
    limit: Math.max(pageSize * 4, pageSize),
    maxSubSitemaps: 15,
    maxDepth: 2,
  });
  const sliced = sliceSitemapFromCursor(
    resolved.items.filter((it) => it.url),
    opts?.resumeCursor,
    pageSize,
  );
  const sitemapCap = !sliced.pageExhausted || resolved.subsFallidos > 0;
  const windowed = applySitemapWindow({
    items: sliced.items,
    windowStart: window.start,
    windowEnd: window.end,
    paginationComplete: sliced.pageExhausted && resolved.subsFallidos === 0,
    indexFollowed: resolved.esIndice || resolved.subsVisitados > 0,
    capHit: sitemapCap,
  });
  return {
    urls: windowed.items
      .filter((it) => it.url)
      .map((it) =>
        toDiscovered(
          row,
          it.url,
          via,
          it.fecha ?? null,
          it.titulo ?? null,
          it.resumen ?? null,
          it.fecha ? 'IN_WINDOW' : 'WINDOW_MEMBERSHIP_UNKNOWN',
        ),
      ),
    completeness: windowed.completeness,
    capHit: windowed.capHit,
    invoked: windowed.sitemapRuntimeCompletenessInvoked,
    cursor: sliced.nextCursor,
    pageExhausted: sliced.pageExhausted,
    resumedFromCursor: sliced.resumedFrom,
  };
}

export async function discoverLiveSource(
  row: ChannelCatalogRow,
  window: { start: string; end: string },
  opts?: DiscoverOpts,
): Promise<SourceDiscovery> {
  const urls: DiscoveredUrl[] = [];
  const surfaces: string[] = [];
  let rssSpanCovered: SourceDiscovery['rssSpanCovered'] = 'UNKNOWN';
  let sitemapSpanCovered: SourceDiscovery['sitemapSpanCovered'] = 'UNKNOWN';
  let listingSpanCovered: SourceDiscovery['listingSpanCovered'] = 'UNKNOWN';
  let sitemapRuntimeCompletenessInvoked = false;
  let capHit = false;
  let cursor: string | null = null;
  let pageExhausted = true;
  let resumedFromCursor: string | null = null;
  let probedSurface: string | null = null;
  let probeEvaluated = false;

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
    } catch {
      rssSpanCovered = 'NO';
    }
  }

  if (row.sitemap_url && allowSurface('sitemap', opts)) {
    surfaces.push('sitemap');
    try {
      const ingested = await ingestSitemap(row.sitemap_url, row, window, 'sitemap', opts);
      sitemapRuntimeCompletenessInvoked = ingested.invoked;
      sitemapSpanCovered = ingested.completeness;
      capHit = ingested.capHit;
      cursor = ingested.cursor;
      pageExhausted = ingested.pageExhausted;
      resumedFromCursor = ingested.resumedFromCursor;
      urls.push(...ingested.urls);
    } catch {
      sitemapSpanCovered = 'NO';
      sitemapRuntimeCompletenessInvoked = true;
    }
  }

  if (!row.sitemap_url && row.url_base && allowSurface('sitemap', opts)) {
    try {
      const origin = new URL(row.url_base.startsWith('http') ? row.url_base : `https://${row.url_base}`).origin;
      const robots = await fetchText(`${origin}/robots.txt`);
      const declared = [...robots.matchAll(/^sitemap:\s*(\S+)/gim)].map((m) => m[1]).filter(Boolean) as string[];
      if (declared[0]) {
        surfaces.push('sitemap');
        const ingested = await ingestSitemap(declared[0], row, window, 'sitemap_robots', opts);
        sitemapRuntimeCompletenessInvoked = ingested.invoked;
        sitemapSpanCovered = ingested.completeness;
        capHit = ingested.capHit;
        cursor = ingested.cursor;
        pageExhausted = ingested.pageExhausted;
        resumedFromCursor = ingested.resumedFromCursor;
        urls.push(...ingested.urls);
      }
    } catch {
      /* robots ausente o no parseable: no inventar endpoint */
    }
  }

  if (row.secciones_urls && allowSurface('listing', opts) && !opts?.probeListing) {
    surfaces.push('listing');
  }

  if (opts?.probeListing) {
    probeEvaluated = true;
    const targets: string[] = [];
    if (row.url_base) {
      targets.push(row.url_base.startsWith('http') ? row.url_base : `https://${row.url_base}`);
    }
    if (row.secciones_urls) {
      targets.push(
        ...row.secciones_urls
          .split(/[\n,|]+/)
          .map((s) => s.trim())
          .filter(Boolean),
      );
    }
    for (const target of targets) {
      try {
        const html = await fetchText(target);
        const hrefs = extractListingHrefs(html, target);
        if (hrefs.length === 0) continue;
        const kind = classifyProbedSurface(target);
        probedSurface = probedSurface ?? kind;
        if (!surfaces.includes('listing')) surfaces.push('listing');
        listingSpanCovered = 'UNKNOWN';
        urls.push(
          ...hrefs.slice(0, 80).map((href) => toDiscovered(row, href, `surface_probe:${kind}`, null, null, null)),
        );
      } catch {
        /* probe target unreachable */
      }
    }
  }

  const noDiscoverySurface = surfaces.length === 0;
  if (noDiscoverySurface) surfaces.push('NO_DISCOVERY_SURFACE');

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
  };
}
