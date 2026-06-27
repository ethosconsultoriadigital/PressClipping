import { describe, it, expect } from 'vitest';
import { resolverSitemap } from '../src/parsers/sitemap.js';

function urlset(urls: { loc: string; lastmod?: string }[]): string {
  const body = urls.map((u) =>
    `<url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('');
  return `<?xml version="1.0"?><urlset>${body}</urlset>`;
}

function index(locs: string[]): string {
  const body = locs.map((l) => `<sitemap><loc>${l}</loc></sitemap>`).join('');
  return `<?xml version="1.0"?><sitemapindex>${body}</sitemapindex>`;
}

function fetcherFrom(map: Record<string, string>, broken: string[] = []) {
  return async (url: string): Promise<string> => {
    if (broken.includes(url)) throw new Error('HTTP 403');
    const v = map[url];
    if (v === undefined) throw new Error('HTTP 404');
    return v;
  };
}

describe('resolverSitemap', () => {
  it('sitemap normal con URLs directas', async () => {
    const map = { 'https://x.mx/sitemap.xml': urlset([{ loc: 'https://x.mx/a' }, { loc: 'https://x.mx/b' }]) };
    const r = await resolverSitemap('https://x.mx/sitemap.xml', fetcherFrom(map));
    expect(r.esIndice).toBe(false);
    expect(r.items.map((i) => i.url).sort()).toEqual(['https://x.mx/a', 'https://x.mx/b']);
    expect(r.subsVisitados).toBe(0);
  });

  it('sitemap index con sub-sitemaps resuelve URLs', async () => {
    const map = {
      'https://x.mx/index.xml': index(['https://x.mx/s1.xml', 'https://x.mx/s2.xml']),
      'https://x.mx/s1.xml': urlset([{ loc: 'https://x.mx/1' }, { loc: 'https://x.mx/2' }]),
      'https://x.mx/s2.xml': urlset([{ loc: 'https://x.mx/3' }]),
    };
    const r = await resolverSitemap('https://x.mx/index.xml', fetcherFrom(map));
    expect(r.esIndice).toBe(true);
    expect(r.subsVisitados).toBe(2);
    expect(r.items.map((i) => i.url).sort()).toEqual(['https://x.mx/1', 'https://x.mx/2', 'https://x.mx/3']);
  });

  it('sitemap index vacío devuelve 0 items', async () => {
    const map = { 'https://x.mx/index.xml': index([]) };
    const r = await resolverSitemap('https://x.mx/index.xml', fetcherFrom(map));
    expect(r.items).toHaveLength(0);
  });

  it('sub-sitemap bloqueado no tumba la resolución', async () => {
    const map = {
      'https://x.mx/index.xml': index(['https://x.mx/ok.xml', 'https://x.mx/block.xml']),
      'https://x.mx/ok.xml': urlset([{ loc: 'https://x.mx/ok1' }]),
      'https://x.mx/block.xml': '',
    };
    const r = await resolverSitemap('https://x.mx/index.xml', fetcherFrom(map, ['https://x.mx/block.xml']));
    expect(r.items.map((i) => i.url)).toEqual(['https://x.mx/ok1']);
    expect(r.subsFallidos).toBe(1);
    expect(r.subsVisitados).toBe(2);
  });

  it('deduplica URLs repetidas entre sub-sitemaps', async () => {
    const map = {
      'https://x.mx/index.xml': index(['https://x.mx/s1.xml', 'https://x.mx/s2.xml']),
      'https://x.mx/s1.xml': urlset([{ loc: 'https://x.mx/dup' }, { loc: 'https://x.mx/a' }]),
      'https://x.mx/s2.xml': urlset([{ loc: 'https://x.mx/dup' }, { loc: 'https://x.mx/b' }]),
    };
    const r = await resolverSitemap('https://x.mx/index.xml', fetcherFrom(map));
    expect(r.items.map((i) => i.url).sort()).toEqual(['https://x.mx/a', 'https://x.mx/b', 'https://x.mx/dup']);
  });

  it('respeta el límite de sub-sitemaps (maxSubSitemaps)', async () => {
    const subs = Array.from({ length: 10 }, (_, i) => `https://x.mx/s${i}.xml`);
    const map: Record<string, string> = { 'https://x.mx/index.xml': index(subs) };
    subs.forEach((s, i) => { map[s] = urlset([{ loc: `https://x.mx/u${i}` }]); });
    const r = await resolverSitemap('https://x.mx/index.xml', fetcherFrom(map), { maxSubSitemaps: 4 });
    expect(r.subsVisitados).toBe(4);
    expect(r.items).toHaveLength(4);
  });

  it('respeta maxDepth en índices anidados', async () => {
    const map = {
      'https://x.mx/root.xml': index(['https://x.mx/lvl1.xml']),
      'https://x.mx/lvl1.xml': index(['https://x.mx/lvl2.xml']),
      'https://x.mx/lvl2.xml': urlset([{ loc: 'https://x.mx/deep' }]),
    };
    // maxDepth=2 → solo resuelve root → lvl1 (que es índice), no baja a lvl2.
    const shallow = await resolverSitemap('https://x.mx/root.xml', fetcherFrom(map), { maxDepth: 2 });
    expect(shallow.items).toHaveLength(0);
    // maxDepth=3 → baja hasta lvl2 y obtiene la URL profunda.
    const deep = await resolverSitemap('https://x.mx/root.xml', fetcherFrom(map), { maxDepth: 3 });
    expect(deep.items.map((i) => i.url)).toEqual(['https://x.mx/deep']);
  });

  it('ordena por fecha descendente y aplica limit', async () => {
    const map = {
      'https://x.mx/sitemap.xml': urlset([
        { loc: 'https://x.mx/viejo', lastmod: '2020-01-01' },
        { loc: 'https://x.mx/nuevo', lastmod: '2026-06-01' },
        { loc: 'https://x.mx/medio', lastmod: '2024-01-01' },
      ]),
    };
    const r = await resolverSitemap('https://x.mx/sitemap.xml', fetcherFrom(map), { limit: 2 });
    expect(r.items.map((i) => i.url)).toEqual(['https://x.mx/nuevo', 'https://x.mx/medio']);
  });
});
