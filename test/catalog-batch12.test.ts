/**
 * Tests del catálogo MEDIA EXPANSION BATCH 4 P4 (2026-09-30).
 * Verifica 25 medios MED-0463..MED-0487.
 */
import { describe, it, expect } from 'vitest';
import { MEDIOS_BATCH12 } from '../scripts/catalog-batch12.js';

describe('catalog-batch12 — media expansion batch 4 P4', () => {
  it('contiene exactamente 25 medios', () => {
    expect(MEDIOS_BATCH12).toHaveLength(25);
  });

  it('IDs son MED-0463..MED-0487 y no reutilizan 0185/0204 ni batches previos', () => {
    const ids = MEDIOS_BATCH12.map((m) => m.medio_id);
    expect(ids[0]).toBe('MED-0463');
    expect(ids[ids.length - 1]).toBe('MED-0487');
    expect(ids).not.toContain('MED-0204');
    expect(ids).not.toContain('MED-0185');
    expect(ids.some((id) => Number(id.replace('MED-', '')) <= 462)).toBe(false);
    expect(new Set(ids).size).toBe(25);
    const nums = ids.map((id) => Number(id.replace('MED-', '')));
    expect(nums).toEqual(Array.from({ length: 25 }, (_, i) => 463 + i));
  });

  it('todos activos, P4, sin JS ni proxy, frecuencia 360', () => {
    const estados = [
      'Guerrero', 'Zacatecas', 'Tlaxcala', 'Tamaulipas', 'Oaxaca',
      'Nayarit', 'Chiapas', 'Tabasco', 'Michoacán', 'Morelos',
    ];
    for (const m of MEDIOS_BATCH12) {
      expect(m.activo).toBe(true);
      expect(m.requiere_javascript).toBe(false);
      expect(m.requiere_proxy).toBe(false);
      expect(m.frecuencia_minutos).toBe(360);
      expect(m.pais).toBe('MX');
      expect(m.prioridad).toBe('Alta');
      expect(estados).toContain(m.estado);
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
    const hosts = MEDIOS_BATCH12.map((m) => new URL(m.url_base!).hostname.replace(/^www\./, ''));
    const feeds = MEDIOS_BATCH12.map((m) => (m.rss_url ?? m.sitemap_url)!.replace(/\/+$/, '').toLowerCase());
    expect(new Set(hosts).size).toBe(25);
    expect(new Set(feeds).size).toBe(25);
  });

  it('no incluye El CEO, OEM, Amapola ya catalogada, mill clones ni comments/feed', () => {
    expect(MEDIOS_BATCH12.some((m) => /el ceo/i.test(m.nombre_medio))).toBe(false);
    expect(MEDIOS_BATCH12.some((m) => (m.url_base ?? '').includes('elceo.com'))).toBe(false);
    expect(MEDIOS_BATCH12.some((m) => (m.url_base ?? '').includes('oem.com.mx'))).toBe(false);
    expect(MEDIOS_BATCH12.some((m) => (m.rss_url ?? '').includes('feedburner'))).toBe(false);
    expect(MEDIOS_BATCH12.some((m) => (m.rss_url ?? '').includes('news.google'))).toBe(false);
    expect(MEDIOS_BATCH12.some((m) => (m.url_base ?? '').includes('amapolaperiodismo.com'))).toBe(false);
    expect(MEDIOS_BATCH12.some((m) => (m.url_base ?? '').includes('colimadigital.mx'))).toBe(false);
    expect(MEDIOS_BATCH12.some((m) => (m.url_base ?? '').includes('campechedigital.mx'))).toBe(false);
    expect(MEDIOS_BATCH12.some((m) => (m.rss_url ?? '').includes('comments/feed'))).toBe(false);
    expect(MEDIOS_BATCH12.some((m) => (m.url_base ?? '').includes('chiapashoy.com'))).toBe(false);
    expect(MEDIOS_BATCH12.some((m) => (m.url_base ?? '').includes('ljz.mx'))).toBe(false);
  });

  it('geo P4: Guerrero 4, Zacatecas 4, Tamaulipas 5, Tlaxcala 2, huecos restantes fill', () => {
    expect(MEDIOS_BATCH12.filter((m) => m.estado === 'Guerrero')).toHaveLength(4);
    expect(MEDIOS_BATCH12.filter((m) => m.estado === 'Zacatecas')).toHaveLength(4);
    expect(MEDIOS_BATCH12.filter((m) => m.estado === 'Tamaulipas')).toHaveLength(5);
    expect(MEDIOS_BATCH12.filter((m) => m.estado === 'Tlaxcala')).toHaveLength(2);
    expect(MEDIOS_BATCH12.filter((m) => m.estado === 'Oaxaca')).toHaveLength(2);
    expect(MEDIOS_BATCH12.filter((m) => m.estado === 'Nayarit')).toHaveLength(1);
    expect(MEDIOS_BATCH12.filter((m) => m.estado === 'Chiapas')).toHaveLength(2);
    expect(MEDIOS_BATCH12.filter((m) => m.estado === 'Tabasco')).toHaveLength(2);
    expect(MEDIOS_BATCH12.filter((m) => m.estado === 'Michoacán')).toHaveLength(2);
    expect(MEDIOS_BATCH12.filter((m) => m.estado === 'Morelos')).toHaveLength(1);
    const byId = new Map(MEDIOS_BATCH12.map((m) => [m.medio_id, m]));
    expect(byId.get('MED-0473')?.metodo_extraccion).toBe('SITEMAP');
    expect(byId.get('MED-0477')?.sitemap_url).toContain('eldiariomx.com');
    expect(byId.get('MED-0486')?.url_base).toContain('primeraplana.mx');
    expect(byId.get('MED-0487')?.rss_url).toContain('elregional.com.mx');
  });
});
