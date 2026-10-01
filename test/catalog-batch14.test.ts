/**
 * Tests del catálogo OVERNIGHT FACTORY V2 BATCH 6.
 */
import { describe, it, expect } from 'vitest';
import { MEDIOS_BATCH14 } from '../scripts/catalog-batch14.js';

describe('catalog-batch14 — overnight factory batch 6', () => {
  it('contiene exactamente 25 medios', () => {
    expect(MEDIOS_BATCH14).toHaveLength(25);
  });

  it('IDs MED-0513..MED-0537 consecutivos, sin 0185/0204', () => {
    const ids = MEDIOS_BATCH14.map((m) => m.medio_id);
    expect(ids[0]).toBe('MED-0513');
    expect(ids[ids.length - 1]).toBe('MED-0537');
    expect(ids).not.toContain('MED-0204');
    expect(ids).not.toContain('MED-0185');
    expect(new Set(ids).size).toBe(25);
    for (let i = 0; i < ids.length; i++) {
      expect(ids[i]).toBe(`MED-${String(513 + i).padStart(4, '0')}`);
    }
  });

  it('todos activos, MX, RSS o SITEMAP', () => {
    for (const m of MEDIOS_BATCH14) {
      expect(m.activo).toBe(true);
      expect(m.requiere_javascript).toBe(false);
      expect(m.requiere_proxy).toBe(false);
      expect(m.frecuencia_minutos).toBe(360);
      expect(m.pais).toBe('MX');
      expect(['RSS', 'SITEMAP']).toContain(m.metodo_extraccion);
    }
  });

  it('dominios y fuentes únicos; no agregadores', () => {
    const hosts = MEDIOS_BATCH14.map((m) => new URL(m.url_base!).hostname.replace(/^www\./, ''));
    const feeds = MEDIOS_BATCH14.map((m) => (m.rss_url ?? m.sitemap_url)!.replace(/\/+$/, '').toLowerCase());
    expect(new Set(hosts).size).toBe(25);
    expect(new Set(feeds).size).toBe(25);
    expect(MEDIOS_BATCH14.some((m) => /omnia|msn\.com|news\.google/i.test(`${m.nombre_medio} ${m.url_base}`))).toBe(false);
  });

  it('incluye históricos de mayor impacto y verticales PR', () => {
    const names = MEDIOS_BATCH14.map((m) => m.nombre_medio);
    expect(names).toContain('Quinta Fuerza');
    expect(names).toContain('Cluster Industrial');
    expect(names).toContain('e-Tlaxcala');
    expect(names).not.toContain('Omnia');
  });
});
