/**
 * Tests del catálogo NEW SOURCE BATCH 04 (2026-09-24).
 * Verifica 28 medios MED-0260..MED-0287. No reutiliza MED-0204 ni batches previos.
 */
import { describe, it, expect } from 'vitest';
import { MEDIOS_BATCH04 } from '../scripts/catalog-batch04.js';

describe('catalog-batch04 — new source onboarding', () => {
  it('contiene exactamente 28 medios', () => {
    expect(MEDIOS_BATCH04).toHaveLength(28);
  });

  it('IDs son MED-0260..MED-0287 y no reutilizan 0204 ni Batch01-03', () => {
    const ids = MEDIOS_BATCH04.map((m) => m.medio_id);
    expect(ids[0]).toBe('MED-0260');
    expect(ids[ids.length - 1]).toBe('MED-0287');
    expect(ids).not.toContain('MED-0204');
    expect(ids.some((id) => Number(id.replace('MED-', '')) <= 259)).toBe(false);
    expect(new Set(ids).size).toBe(28);
    const nums = ids.map((id) => Number(id.replace('MED-', '')));
    expect(nums).toEqual(Array.from({ length: 28 }, (_, i) => 260 + i));
  });

  it('todos activos, RSS o SITEMAP, sin JS ni proxy, frecuencia 360', () => {
    for (const m of MEDIOS_BATCH04) {
      expect(m.activo).toBe(true);
      expect(['RSS', 'SITEMAP']).toContain(m.metodo_extraccion);
      if (m.metodo_extraccion === 'RSS') {
        expect(m.rss_url).toMatch(/^https:\/\//);
        expect(m.sitemap_url).toBeNull();
      } else {
        expect(m.sitemap_url).toMatch(/^https:\/\//);
        expect(m.rss_url).toBeNull();
      }
      expect(m.requiere_javascript).toBe(false);
      expect(m.requiere_proxy).toBe(false);
      expect(m.frecuencia_minutos).toBe(360);
      expect(m.pais).toBe('MX');
    }
  });

  it('dominios y fuentes del lote son únicos', () => {
    const hosts = MEDIOS_BATCH04.map((m) => new URL(m.url_base!).hostname.replace(/^www\./, ''));
    const feeds = MEDIOS_BATCH04.map((m) => (m.rss_url ?? m.sitemap_url)!.replace(/\/+$/, '').toLowerCase());
    expect(new Set(hosts).size).toBe(28);
    expect(new Set(feeds).size).toBe(28);
  });

  it('incluye leftover Batch03 El Siglo de Durango como sitemap y 7 RSS leftover', () => {
    const byId = new Map(MEDIOS_BATCH04.map((m) => [m.medio_id, m]));
    expect(byId.get('MED-0260')?.nombre_medio).toBe('El Siglo de Durango');
    expect(byId.get('MED-0260')?.metodo_extraccion).toBe('SITEMAP');
    expect(byId.get('MED-0261')?.nombre_medio).toBe('Dereporteros');
    expect(byId.get('MED-0267')?.nombre_medio).toBe('EstamosAquí MX');
  });
});
