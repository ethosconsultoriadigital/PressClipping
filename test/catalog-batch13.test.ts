/**
 * Tests del catálogo MEDIA EXPANSION BATCH 5 HISTORICAL PARITY (2026-09-30).
 * 24 medios MED-0488..MED-0512 (MED-0493 retirado: RSS OEM duplicado de Xalapa).
 */
import { describe, it, expect } from 'vitest';
import { MEDIOS_BATCH13 } from '../scripts/catalog-batch13.js';

describe('catalog-batch13 — media expansion batch 5 historical parity', () => {
  it('contiene exactamente 24 medios', () => {
    expect(MEDIOS_BATCH13).toHaveLength(24);
  });

  it('IDs empiezan en MED-0488, terminan en MED-0512, no reutilizan 0185/0204/0493', () => {
    const ids = MEDIOS_BATCH13.map((m) => m.medio_id);
    expect(ids[0]).toBe('MED-0488');
    expect(ids[ids.length - 1]).toBe('MED-0512');
    expect(ids).not.toContain('MED-0204');
    expect(ids).not.toContain('MED-0185');
    expect(ids).not.toContain('MED-0493');
    expect(ids.some((id) => Number(id.replace('MED-', '')) <= 487)).toBe(false);
    expect(new Set(ids).size).toBe(24);
  });

  it('todos activos, sin JS ni proxy, frecuencia 360, MX', () => {
    const estados = [
      'Nacional', 'Baja California', 'Puebla', 'San Luis Potosí',
      'Veracruz', 'Sonora', 'Tabasco',
    ];
    for (const m of MEDIOS_BATCH13) {
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
    const hosts = MEDIOS_BATCH13.map((m) => new URL(m.url_base!).hostname.replace(/^www\./, ''));
    const feeds = MEDIOS_BATCH13.map((m) => (m.rss_url ?? m.sitemap_url)!.replace(/\/+$/, '').toLowerCase());
    expect(new Set(hosts).size).toBe(24);
    expect(new Set(feeds).size).toBe(24);
  });

  it('no incluye Omnia sin fuente, MSN, Google News, radio no web, ni Uniradio Informa', () => {
    expect(MEDIOS_BATCH13.some((m) => /omnia/i.test(m.nombre_medio))).toBe(false);
    expect(MEDIOS_BATCH13.some((m) => (m.url_base ?? '').includes('omnia.com.mx'))).toBe(false);
    expect(MEDIOS_BATCH13.some((m) => (m.url_base ?? '').includes('msn.com'))).toBe(false);
    expect(MEDIOS_BATCH13.some((m) => (m.rss_url ?? '').includes('news.google'))).toBe(false);
    expect(MEDIOS_BATCH13.some((m) => (m.url_base ?? '').includes('wradio.com.mx'))).toBe(false);
    expect(MEDIOS_BATCH13.some((m) => (m.url_base ?? '').includes('radioformula.com.mx'))).toBe(false);
    expect(MEDIOS_BATCH13.some((m) => (m.url_base ?? '').includes('imagenradio.com.mx'))).toBe(false);
    expect(MEDIOS_BATCH13.some((m) => (m.url_base ?? '').includes('uniradioinforma.com'))).toBe(false);
    expect(MEDIOS_BATCH13.some((m) => (m.url_base ?? '') === 'https://oem.com.mx')).toBe(false);
  });

  it('incluye P2 históricos viables y pool canary, no P1 Omnia', () => {
    const names = MEDIOS_BATCH13.map((m) => m.nombre_medio);
    expect(names).toContain('Uniradio Baja California');
    expect(names).toContain('Municipios Puebla');
    expect(names).toContain('Diario de Xalapa');
    expect(names).toContain('T21');
    expect(names).toContain('Gourmet de México');
    expect(names.filter((n) => n.startsWith('Uniradio'))).toHaveLength(2);
  });
});
