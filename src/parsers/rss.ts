/**
 * Parser de feeds RSS/Atom → RawItem[].
 *
 * Descarga el feed con nuestro cliente HTTP responsable y lo parsea con
 * rss-parser. Es tolerante: si un campo falta, se omite sin romper el resto.
 */
import RssParser from 'rss-parser';
import { fetchText } from '../utils/http.js';
import type { RawItem } from '../normalizers/noticia.js';

const parser = new RssParser({
  timeout: 15000,
  customFields: {
    item: [['dc:creator', 'creator'], ['category', 'categories']],
  },
});

/** Parsea una cadena XML de RSS/Atom a RawItem[]. */
export async function parseRssString(xml: string): Promise<RawItem[]> {
  const feed = await parser.parseString(xml);
  return (feed.items ?? []).map((raw) => {
    const it = raw as typeof raw & {
      creator?: string;
      author?: string;
      summary?: string;
      categories?: string[];
    };
    return {
      url: (it.link ?? '').trim(),
      titulo: it.title ?? null,
      resumen: it.contentSnippet ?? it.summary ?? it.content ?? null,
      autor: it.creator ?? it.author ?? null,
      fecha: it.isoDate ?? it.pubDate ?? null,
      seccion: Array.isArray(it.categories) ? (it.categories[0] ?? null) : null,
    };
  });
}

/** Descarga y parsea un feed RSS desde su URL. */
export async function fetchRss(url: string): Promise<RawItem[]> {
  const xml = await fetchText(url);
  return parseRssString(xml);
}
