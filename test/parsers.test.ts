import { describe, it, expect } from 'vitest';
import { parseRssString } from '../src/parsers/rss.js';
import { parseSitemapString } from '../src/parsers/sitemap.js';
import { normalizeNoticia } from '../src/normalizers/noticia.js';
import { mapMedioRow, mapKeywordRow } from '../src/types/schemas.js';

const RSS = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Medio Demo</title>
    <item>
      <title>Nota uno</title>
      <link>https://medio.com/nota-1?utm_source=rss</link>
      <pubDate>Mon, 01 Jun 2026 10:00:00 GMT</pubDate>
      <description>Resumen de la &lt;b&gt;nota&lt;/b&gt; uno.</description>
      <dc:creator xmlns:dc="http://purl.org/dc/elements/1.1/">Ana Pérez</dc:creator>
    </item>
    <item>
      <title>Nota dos</title>
      <link>https://medio.com/nota-2</link>
    </item>
  </channel>
</rss>`;

const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
  <url>
    <loc>https://medio.com/noticia-a</loc>
    <lastmod>2026-06-02</lastmod>
    <news:news>
      <news:title>Noticia A</news:title>
      <news:publication_date>2026-06-02T08:00:00Z</news:publication_date>
    </news:news>
  </url>
  <url>
    <loc>https://medio.com/noticia-b</loc>
  </url>
</urlset>`;

const SITEMAP_INDEX = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://medio.com/sitemap-news.xml</loc></sitemap>
  <sitemap><loc>https://medio.com/sitemap-2.xml</loc></sitemap>
</sitemapindex>`;

describe('parseRssString', () => {
  it('extrae items con título, link, fecha y autor', async () => {
    const items = await parseRssString(RSS);
    expect(items).toHaveLength(2);
    expect(items[0]!.titulo).toBe('Nota uno');
    expect(items[0]!.url).toBe('https://medio.com/nota-1?utm_source=rss');
    expect(items[0]!.autor).toBe('Ana Pérez');
    expect(items[0]!.fecha).toBeTruthy();
  });
});

describe('parseSitemapString', () => {
  it('extrae urls de un urlset con news', () => {
    const { items, subSitemaps } = parseSitemapString(SITEMAP);
    expect(subSitemaps).toHaveLength(0);
    expect(items).toHaveLength(2);
    expect(items[0]!.url).toBe('https://medio.com/noticia-a');
    expect(items[0]!.titulo).toBe('Noticia A');
    expect(items[0]!.fecha).toBe('2026-06-02T08:00:00Z');
  });
  it('detecta un índice de sitemaps', () => {
    const { items, subSitemaps } = parseSitemapString(SITEMAP_INDEX);
    expect(items).toHaveLength(0);
    expect(subSitemaps).toEqual([
      'https://medio.com/sitemap-news.xml',
      'https://medio.com/sitemap-2.xml',
    ]);
  });
});

describe('normalizeNoticia', () => {
  it('canoniza URL, limpia HTML del resumen y calcula hashes', async () => {
    const [item] = await parseRssString(RSS);
    const n = normalizeNoticia(item!, { medio_id: 'medio-demo', fuente: 'rss' });
    expect(n).not.toBeNull();
    expect(n!.url_canonica).toBe('https://medio.com/nota-1'); // quitó utm_source
    expect(n!.resumen).toBe('Resumen de la nota uno.'); // sin etiquetas
    expect(n!.texto_extraido).toBeNull(); // política MVP
    expect(n!.hash_url).toHaveLength(64);
    expect(n!.hash_contenido).toHaveLength(64);
    expect(n!.fuente_extraccion).toBe('rss');
  });
  it('devuelve null si el item no tiene URL', () => {
    const n = normalizeNoticia({ url: '', titulo: 'x' }, { medio_id: 'm', fuente: 'rss' });
    expect(n).toBeNull();
  });
});

describe('mappers de schemas', () => {
  it('mapMedioRow valida un medio mínimo y castea booleanos/enteros', () => {
    const res = mapMedioRow({
      medio_id: 'm1',
      nombre_medio: 'Medio 1',
      activo: 'TRUE',
      requiere_javascript: 'no',
      requiere_proxy: 'FALSE',
      frecuencia_minutos: '30',
      metodo_extraccion: 'rss',
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.activo).toBe(true);
      expect(res.data.requiere_javascript).toBe(false);
      expect(res.data.frecuencia_minutos).toBe(30);
    }
  });
  it('mapMedioRow falla si falta medio_id', () => {
    const res = mapMedioRow({ nombre_medio: 'Sin id' });
    expect(res.success).toBe(false);
  });
  it('mapKeywordRow normaliza tipo_keyword desconocido a "contiene"', () => {
    const res = mapKeywordRow({
      keyword_id: 'k1',
      keyword: 'tequila',
      tipo_keyword: 'inventado',
      activa: 'si',
    });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.tipo_keyword).toBe('contiene');
  });
});
