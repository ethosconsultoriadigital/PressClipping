import { fetchRss } from '../parsers/rss.js';
import { resolverSitemap } from '../parsers/sitemap.js';
import { fetchText } from '../utils/http.js';
import { rssWindowCompleteness } from './rssWindow.js';
import { applySitemapWindow } from './sitemapWindow.js';
import { captureCanonicalUrl, hostOf, primaryHash } from './urlIndex.js';
import type { ChannelCatalogRow, DiscoveredUrl } from './types.js';
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

export async function discoverLiveSource(
  row: ChannelCatalogRow,
  window: { start: string; end: string },
): Promise<SourceDiscovery> {
  const urls: DiscoveredUrl[] = [];
  const surfaces: string[] = [];
  let rssSpanCovered: SourceDiscovery['rssSpanCovered'] = 'UNKNOWN';
  let sitemapSpanCovered: SourceDiscovery['sitemapSpanCovered'] = 'UNKNOWN';
  let sitemapRuntimeCompletenessInvoked = false;
  let capHit = false;

  if (row.rss_url) {
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

  if (row.sitemap_url) {
    surfaces.push('sitemap');
    try {
      const limit = 400;
      const resolved = await resolverSitemap(row.sitemap_url, fetchText, {
        limit,
        maxSubSitemaps: 15,
        maxDepth: 2,
      });
      const sitemapCap = resolved.items.length >= limit || resolved.subsFallidos > 0;
      const windowed = applySitemapWindow({
        items: resolved.items,
        windowStart: window.start,
        windowEnd: window.end,
        paginationComplete: !sitemapCap,
        indexFollowed: resolved.esIndice || resolved.subsVisitados > 0,
        capHit: sitemapCap,
      });
      sitemapRuntimeCompletenessInvoked = windowed.sitemapRuntimeCompletenessInvoked;
      sitemapSpanCovered = windowed.completeness;
      capHit = windowed.capHit;
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
    } catch {
      sitemapSpanCovered = 'NO';
      sitemapRuntimeCompletenessInvoked = true;
    }
  }

  if (!row.sitemap_url && row.url_base) {
    try {
      const origin = new URL(row.url_base.startsWith('http') ? row.url_base : `https://${row.url_base}`).origin;
      const robots = await fetchText(`${origin}/robots.txt`);
      const declared = [...robots.matchAll(/^sitemap:\s*(\S+)/gim)].map((m) => m[1]).filter(Boolean) as string[];
      if (declared[0]) {
        surfaces.push('sitemap');
        const limit = 400;
        const resolved = await resolverSitemap(declared[0], fetchText, {
          limit,
          maxSubSitemaps: 15,
          maxDepth: 2,
        });
        const sitemapCap = resolved.items.length >= limit || resolved.subsFallidos > 0;
        const windowed = applySitemapWindow({
          items: resolved.items,
          windowStart: window.start,
          windowEnd: window.end,
          paginationComplete: !sitemapCap,
          indexFollowed: resolved.esIndice || resolved.subsVisitados > 0,
          capHit: sitemapCap,
        });
        sitemapRuntimeCompletenessInvoked = windowed.sitemapRuntimeCompletenessInvoked;
        sitemapSpanCovered = windowed.completeness;
        capHit = windowed.capHit;
        urls.push(
          ...windowed.items
            .filter((it) => it.url)
            .map((it) =>
              toDiscovered(
                row,
                it.url,
                'sitemap_robots',
                it.fecha ?? null,
                it.titulo ?? null,
                it.resumen ?? null,
                it.fecha ? 'IN_WINDOW' : 'WINDOW_MEMBERSHIP_UNKNOWN',
              ),
            ),
        );
      }
    } catch {
      /* robots ausente o no parseable: no inventar endpoint */
    }
  }
  if (row.secciones_urls) {
    surfaces.push('listing');
  }

  const noDiscoverySurface = surfaces.length === 0;
  if (noDiscoverySurface) surfaces.push('NO_DISCOVERY_SURFACE');

  return {
    urls,
    surfaces,
    rssSpanCovered,
    sitemapSpanCovered,
    listingSpanCovered: 'UNKNOWN',
    sitemapRuntimeCompletenessInvoked,
    capHit,
    noDiscoverySurface,
  };
}
