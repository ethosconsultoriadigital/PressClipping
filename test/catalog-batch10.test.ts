/**
 * Tests del catálogo MEDIA EXPANSION BATCH 2 P2 (2026-09-30).
 * Verifica 25 medios MED-0413..MED-0437. No reutiliza MED-0185 ni MED-0204.
 */
import { describe, it, expect } from 'vitest';
import { MEDIOS_BATCH10 } from '../scripts/catalog-batch10.js';

describe('catalog-batch10 — media expansion batch 2 P2', () => {
  it('contiene exactamente 25 medios', () => {
    expect(MEDIOS_BATCH10).toHaveLength(25);
  });

  it('IDs son MED-0413..MED-0437 y no reutilizan 0185/0204 ni batch 1', () => {
    const ids = MEDIOS_BATCH10.map((m) => m.medio_id);
    expect(ids[0]).toBe('MED-0413');
    expect(ids[ids.length - 1]).toBe('MED-0437');
    expect(ids).not.toContain('MED-0204');
    expect(ids).not.toContain('MED-0185');
    expect(ids.some((id) => Number(id.replace('MED-', '')) <= 412)).toBe(false);
    expect(new Set(ids).size).toBe(25);
    const nums = ids.map((id) => Number(id.replace('MED-', '')));
    expect(nums).toEqual(Array.from({ length: 25 }, (_, i) => 413 + i));
  });

  it('todos activos, P2, sin JS ni proxy, frecuencia 360', () => {
    for (const m of MEDIOS_BATCH10) {
      expect(m.activo).toBe(true);
      expect(m.requiere_javascript).toBe(false);
      expect(m.requiere_proxy).toBe(false);
      expect(m.frecuencia_minutos).toBe(360);
      expect(m.pais).toBe('MX');
      expect(m.prioridad).toBe('Alta');
      expect(['Puebla', 'Guanajuato', 'Querétaro', 'Veracruz', 'Chihuahua', 'Baja California']).toContain(m.estado);
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
    const hosts = MEDIOS_BATCH10.map((m) => new URL(m.url_base!).hostname.replace(/^www\./, ''));
    const feeds = MEDIOS_BATCH10.map((m) => (m.rss_url ?? m.sitemap_url)!.replace(/\/+$/, '').toLowerCase());
    expect(new Set(hosts).size).toBe(25);
    expect(new Set(feeds).size).toBe(25);
  });

  it('no incluye El CEO, OEM, CNN, Feedburner, Google News ni duplicados P2 conocidos', () => {
    expect(MEDIOS_BATCH10.some((m) => /el ceo/i.test(m.nombre_medio))).toBe(false);
    expect(MEDIOS_BATCH10.some((m) => (m.url_base ?? '').includes('elceo.com'))).toBe(false);
    expect(MEDIOS_BATCH10.some((m) => (m.url_base ?? '').includes('cnn.com'))).toBe(false);
    expect(MEDIOS_BATCH10.some((m) => (m.rss_url ?? '').includes('feedburner'))).toBe(false);
    expect(MEDIOS_BATCH10.some((m) => (m.url_base ?? '').includes('oem.com.mx'))).toBe(false);
    expect(MEDIOS_BATCH10.some((m) => (m.rss_url ?? '').includes('news.google'))).toBe(false);
    expect(MEDIOS_BATCH10.some((m) => (m.url_base ?? '').includes('e-consulta.com'))).toBe(false);
    expect(MEDIOS_BATCH10.some((m) => (m.url_base ?? '').includes('am.com.mx'))).toBe(false);
    expect(MEDIOS_BATCH10.some((m) => (m.url_base ?? '').includes('periodicocorreo.com.mx'))).toBe(false);
    expect(MEDIOS_BATCH10.some((m) => (m.url_base ?? '').includes('zetatijuana.com'))).toBe(false);
  });

  it('Al Diálogo es SITEMAP en aldialogo.mx; geo P2 sin fingir BC denso', () => {
    const byId = new Map(MEDIOS_BATCH10.map((m) => [m.medio_id, m]));
    expect(byId.get('MED-0425')?.metodo_extraccion).toBe('SITEMAP');
    expect(byId.get('MED-0425')?.url_base).toContain('aldialogo.mx');
    expect(byId.get('MED-0425')?.nombre_medio).toBe('Al Diálogo');
    expect(MEDIOS_BATCH10.filter((m) => m.estado === 'Veracruz')).toHaveLength(8);
    expect(MEDIOS_BATCH10.filter((m) => m.estado === 'Querétaro')).toHaveLength(5);
    expect(MEDIOS_BATCH10.filter((m) => m.estado === 'Puebla')).toHaveLength(6);
    expect(MEDIOS_BATCH10.filter((m) => m.estado === 'Guanajuato')).toHaveLength(1);
    expect(MEDIOS_BATCH10.filter((m) => m.estado === 'Chihuahua')).toHaveLength(4);
    expect(MEDIOS_BATCH10.filter((m) => m.estado === 'Baja California')).toHaveLength(1);
  });
});
