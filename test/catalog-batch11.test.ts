/**
 * Tests del catálogo MEDIA EXPANSION BATCH 3 P3 (2026-09-30).
 * Verifica 25 medios MED-0438..MED-0462. No reutiliza MED-0185 ni MED-0204.
 */
import { describe, it, expect } from 'vitest';
import { MEDIOS_BATCH11 } from '../scripts/catalog-batch11.js';

describe('catalog-batch11 — media expansion batch 3 P3', () => {
  it('contiene exactamente 25 medios', () => {
    expect(MEDIOS_BATCH11).toHaveLength(25);
  });

  it('IDs son MED-0438..MED-0462 y no reutilizan 0185/0204 ni batches previos', () => {
    const ids = MEDIOS_BATCH11.map((m) => m.medio_id);
    expect(ids[0]).toBe('MED-0438');
    expect(ids[ids.length - 1]).toBe('MED-0462');
    expect(ids).not.toContain('MED-0204');
    expect(ids).not.toContain('MED-0185');
    expect(ids.some((id) => Number(id.replace('MED-', '')) <= 437)).toBe(false);
    expect(new Set(ids).size).toBe(25);
    const nums = ids.map((id) => Number(id.replace('MED-', '')));
    expect(nums).toEqual(Array.from({ length: 25 }, (_, i) => 438 + i));
  });

  it('todos activos, P3, sin JS ni proxy, frecuencia 360', () => {
    for (const m of MEDIOS_BATCH11) {
      expect(m.activo).toBe(true);
      expect(m.requiere_javascript).toBe(false);
      expect(m.requiere_proxy).toBe(false);
      expect(m.frecuencia_minutos).toBe(360);
      expect(m.pais).toBe('MX');
      expect(m.prioridad).toBe('Alta');
      expect(['Sonora', 'Sinaloa', 'Quintana Roo', 'Yucatán', 'Coahuila']).toContain(m.estado);
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
    const hosts = MEDIOS_BATCH11.map((m) => new URL(m.url_base!).hostname.replace(/^www\./, ''));
    const feeds = MEDIOS_BATCH11.map((m) => (m.rss_url ?? m.sitemap_url)!.replace(/\/+$/, '').toLowerCase());
    expect(new Set(hosts).size).toBe(25);
    expect(new Set(feeds).size).toBe(25);
  });

  it('no incluye El CEO, OEM, SIPSE, Primeraplana Michoacán ni comments/feed', () => {
    expect(MEDIOS_BATCH11.some((m) => /el ceo/i.test(m.nombre_medio))).toBe(false);
    expect(MEDIOS_BATCH11.some((m) => (m.url_base ?? '').includes('elceo.com'))).toBe(false);
    expect(MEDIOS_BATCH11.some((m) => (m.url_base ?? '').includes('oem.com.mx'))).toBe(false);
    expect(MEDIOS_BATCH11.some((m) => (m.rss_url ?? '').includes('feedburner'))).toBe(false);
    expect(MEDIOS_BATCH11.some((m) => (m.rss_url ?? '').includes('news.google'))).toBe(false);
    expect(MEDIOS_BATCH11.some((m) => (m.url_base ?? '').includes('sipse.com'))).toBe(false);
    expect(MEDIOS_BATCH11.some((m) => (m.url_base ?? '').includes('primeraplana.mx'))).toBe(false);
    expect(MEDIOS_BATCH11.some((m) => (m.url_base ?? '').includes('criteriodiario.com'))).toBe(false);
    expect(MEDIOS_BATCH11.some((m) => (m.rss_url ?? '').includes('comments/feed'))).toBe(false);
    expect(MEDIOS_BATCH11.some((m) => (m.url_base ?? '').includes('vanguardia.com.mx'))).toBe(false);
    expect(MEDIOS_BATCH11.some((m) => (m.url_base ?? '').includes('diariocambio22.mx'))).toBe(false);
  });

  it('geo P3: Sonora 6, Yucatán 7, QRoo 7, Coahuila 4, Sinaloa 1', () => {
    expect(MEDIOS_BATCH11.filter((m) => m.estado === 'Sonora')).toHaveLength(6);
    expect(MEDIOS_BATCH11.filter((m) => m.estado === 'Yucatán')).toHaveLength(7);
    expect(MEDIOS_BATCH11.filter((m) => m.estado === 'Quintana Roo')).toHaveLength(7);
    expect(MEDIOS_BATCH11.filter((m) => m.estado === 'Coahuila')).toHaveLength(4);
    expect(MEDIOS_BATCH11.filter((m) => m.estado === 'Sinaloa')).toHaveLength(1);
    const byId = new Map(MEDIOS_BATCH11.map((m) => [m.medio_id, m]));
    expect(byId.get('MED-0443')?.metodo_extraccion).toBe('SITEMAP');
    expect(byId.get('MED-0443')?.url_base).toContain('diariodelyaqui.mx');
    expect(byId.get('MED-0456')?.rss_url).toBe('https://periodicoquequi.com/feed/');
  });
});
