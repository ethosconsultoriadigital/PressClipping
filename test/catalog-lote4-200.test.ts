/**
 * Tests del catálogo lote4 — 200 MEDIA MILESTONE (2026-07-22).
 * Verifica los 9 medios: MED-0192 a MED-0200.
 */
import { describe, it, expect } from 'vitest';
import { MEDIOS_LOTE4 } from '../scripts/catalog-lote4-200.js';

describe('catalog-lote4-200 — hito 200 medios', () => {
  it('contiene exactamente 9 medios', () => {
    expect(MEDIOS_LOTE4).toHaveLength(9);
  });

  it('IDs van de MED-0192 a MED-0200', () => {
    const ids = MEDIOS_LOTE4.map((m) => m.medio_id).sort();
    expect(ids).toEqual(['MED-0192', 'MED-0193', 'MED-0194', 'MED-0195', 'MED-0196', 'MED-0197', 'MED-0198', 'MED-0199', 'MED-0200']);
  });

  it('todos activos', () => {
    for (const m of MEDIOS_LOTE4) expect(m.activo).toBe(true);
  });

  it('ninguno requiere proxy ni JS', () => {
    for (const m of MEDIOS_LOTE4) {
      expect(m.requiere_proxy).toBe(false);
      expect(m.requiere_javascript).toBe(false);
    }
  });

  it('todos son MX', () => {
    for (const m of MEDIOS_LOTE4) expect(m.pais).toBe('MX');
  });

  it('8 son RSS, 1 es SITEMAP (Eje Central)', () => {
    const rss = MEDIOS_LOTE4.filter((m) => m.metodo_extraccion === 'RSS');
    const sitemap = MEDIOS_LOTE4.filter((m) => m.metodo_extraccion === 'SITEMAP');
    expect(rss).toHaveLength(8);
    expect(sitemap).toHaveLength(1);
    const sitemapMedio = sitemap[0];
    expect(sitemapMedio?.medio_id).toBe('MED-0200');
    expect(sitemapMedio?.nombre_medio).toBe('Eje Central');
  });

  it('los 8 RSS tienen rss_url presente', () => {
    for (const m of MEDIOS_LOTE4.filter((x) => x.metodo_extraccion === 'RSS')) {
      expect(m.rss_url).toBeTruthy();
      expect(m.rss_url).toMatch(/^https:\/\//);
    }
  });

  it('Eje Central tiene sitemap_url y NO rss_url', () => {
    const ec = MEDIOS_LOTE4.find((m) => m.medio_id === 'MED-0200')!;
    expect(ec.sitemap_url).toBe('https://www.ejecentral.com.mx/sitemap.xml');
    expect(ec.rss_url).toBeNull();
  });

  it('Eje Central es prioridad Alta (alto valor editorial)', () => {
    const ec = MEDIOS_LOTE4.find((m) => m.medio_id === 'MED-0200')!;
    expect(ec.prioridad).toBe('Alta');
  });
});
