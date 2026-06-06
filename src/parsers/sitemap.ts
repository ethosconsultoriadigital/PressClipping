/**
 * Parser de sitemaps XML → RawItem[].
 *
 * Soporta:
 *  - urlset (sitemap normal): <url><loc>, <lastmod>
 *  - sitemap de noticias: <news:news><news:title>, <news:publication_date>
 *  - sitemapindex: lista de sub-sitemaps; se resuelven hasta `maxIndexFollow`.
 */
import { XMLParser } from 'fast-xml-parser';
import { fetchText } from '../utils/http.js';
import type { RawItem } from '../normalizers/noticia.js';

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true, // news:title -> title, news:news -> news
  isArray: (name) => name === 'url' || name === 'sitemap',
});

interface SitemapUrl {
  loc?: string;
  lastmod?: string;
  news?: {
    title?: string;
    publication_date?: string;
    publication?: { name?: string };
  };
}

function asText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return String(v).trim() || null;
}

/** Parsea una cadena XML de sitemap. Devuelve items y/o sub-sitemaps. */
export function parseSitemapString(xml: string): {
  items: RawItem[];
  subSitemaps: string[];
} {
  const doc = parser.parse(xml) as Record<string, any>;

  // Índice de sitemaps
  if (doc.sitemapindex?.sitemap) {
    const subs: string[] = [];
    for (const s of doc.sitemapindex.sitemap as { loc?: string }[]) {
      const loc = asText(s.loc);
      if (loc) subs.push(loc);
    }
    return { items: [], subSitemaps: subs };
  }

  // Sitemap normal
  const urls: SitemapUrl[] = doc.urlset?.url ?? [];
  const items: RawItem[] = [];
  for (const u of urls) {
    const loc = asText(u.loc);
    if (!loc) continue;
    items.push({
      url: loc,
      titulo: asText(u.news?.title),
      fecha: asText(u.news?.publication_date) ?? asText(u.lastmod),
      resumen: null,
    });
  }
  return { items, subSitemaps: [] };
}

/**
 * Descarga y parsea un sitemap, resolviendo índices hasta `maxIndexFollow`
 * sub-sitemaps y deteniéndose al alcanzar `limit` items.
 */
export async function fetchSitemap(
  url: string,
  opts: { limit?: number; maxIndexFollow?: number } = {},
): Promise<RawItem[]> {
  const { limit = 200, maxIndexFollow = 3 } = opts;
  const xml = await fetchText(url);
  const { items, subSitemaps } = parseSitemapString(xml);

  if (items.length > 0 || subSitemaps.length === 0) {
    return items.slice(0, limit);
  }

  // Resolver sub-sitemaps (limitado) y acumular hasta `limit`.
  const acumulado: RawItem[] = [];
  for (const sub of subSitemaps.slice(0, maxIndexFollow)) {
    if (acumulado.length >= limit) break;
    try {
      const subXml = await fetchText(sub);
      const parsed = parseSitemapString(subXml);
      acumulado.push(...parsed.items);
    } catch {
      // un sub-sitemap roto no debe tumbar la corrida
    }
  }
  return acumulado.slice(0, limit);
}
