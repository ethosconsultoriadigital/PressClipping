/**
 * Tests del catálogo MEDIA EXPANSION BATCH 1 P1 (2026-09-29).
 * Verifica 25 medios MED-0388..MED-0412. No reutiliza MED-0185 ni MED-0204.
 */
import { describe, it, expect } from 'vitest';
import { MEDIOS_BATCH09 } from '../scripts/catalog-batch09.js';

describe('catalog-batch09 — media expansion batch 1 P1', () => {
  it('contiene exactamente 25 medios', () => {
    expect(MEDIOS_BATCH09).toHaveLength(25);
  });

  it('IDs son MED-0388..MED-0412 y no reutilizan 0185/0204 ni batches previos', () => {
    const ids = MEDIOS_BATCH09.map((m) => m.medio_id);
    expect(ids[0]).toBe('MED-0388');
    expect(ids[ids.length - 1]).toBe('MED-0412');
    expect(ids).not.toContain('MED-0204');
    expect(ids).not.toContain('MED-0185');
    expect(ids.some((id) => Number(id.replace('MED-', '')) <= 387)).toBe(false);
    expect(new Set(ids).size).toBe(25);
    const nums = ids.map((id) => Number(id.replace('MED-', '')));
    expect(nums).toEqual(Array.from({ length: 25 }, (_, i) => 388 + i));
  });

  it('todos activos, P1, sin JS ni proxy, frecuencia 360', () => {
    for (const m of MEDIOS_BATCH09) {
      expect(m.activo).toBe(true);
      expect(m.requiere_javascript).toBe(false);
      expect(m.requiere_proxy).toBe(false);
      expect(m.frecuencia_minutos).toBe(360);
      expect(m.pais).toBe('MX');
      expect(m.prioridad).toBe('Alta');
      expect(['CDMX', 'Jalisco', 'Estado de México']).toContain(m.estado);
      expect(['RSS', 'SITEMAP']).toContain(m.metodo_extraccion);
      if (m.metodo_extraccion === 'RSS') {
        expect(m.rss_url).toMatch(/^https:\/\//);
        expect(m.sitemap_url).toBeNull();
      } else {
        expect(m.sitemap_url).toMatch(/^https:\/\//);
        expect(m.rss_url).toBeNull();
      }
    }
  });

  it('dominios y fuentes del lote son únicos', () => {
    const hosts = MEDIOS_BATCH09.map((m) => new URL(m.url_base!).hostname.replace(/^www\./, ''));
    const feeds = MEDIOS_BATCH09.map((m) => (m.rss_url ?? m.sitemap_url)!.replace(/\/+$/, '').toLowerCase());
    expect(new Set(hosts).size).toBe(25);
    expect(new Set(feeds).size).toBe(25);
  });

  it('no incluye El CEO, OEM, CNN, Feedburner ni Google News', () => {
    expect(MEDIOS_BATCH09.some((m) => /el ceo/i.test(m.nombre_medio))).toBe(false);
    expect(MEDIOS_BATCH09.some((m) => (m.url_base ?? '').includes('elceo.com'))).toBe(false);
    expect(MEDIOS_BATCH09.some((m) => (m.url_base ?? '').includes('cnn.com'))).toBe(false);
    expect(MEDIOS_BATCH09.some((m) => (m.rss_url ?? '').includes('feedburner'))).toBe(false);
    expect(MEDIOS_BATCH09.some((m) => (m.url_base ?? '').includes('oem.com.mx'))).toBe(false);
    expect(MEDIOS_BATCH09.some((m) => (m.rss_url ?? '').includes('news.google'))).toBe(false);
  });

  it('Capital 21 es SITEMAP y el resto RSS; geo P1 sin fingir NL', () => {
    const byId = new Map(MEDIOS_BATCH09.map((m) => [m.medio_id, m]));
    expect(byId.get('MED-0401')?.metodo_extraccion).toBe('SITEMAP');
    expect(byId.get('MED-0401')?.url_base).toContain('capital21.cdmx.gob.mx');
    expect(MEDIOS_BATCH09.filter((m) => m.estado === 'CDMX')).toHaveLength(17);
    expect(MEDIOS_BATCH09.filter((m) => m.estado === 'Jalisco')).toHaveLength(3);
    expect(MEDIOS_BATCH09.filter((m) => m.estado === 'Estado de México')).toHaveLength(5);
    expect(MEDIOS_BATCH09.filter((m) => m.estado === 'Nuevo León')).toHaveLength(0);
  });
});
