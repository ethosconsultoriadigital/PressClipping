/**
 * Tests del catálogo NEW SOURCE BATCH 05 (2026-09-25).
 * Verifica 20 medios MED-0288..MED-0307. No reutiliza MED-0204 ni batches previos.
 */
import { describe, it, expect } from 'vitest';
import { MEDIOS_BATCH05 } from '../scripts/catalog-batch05.js';

describe('catalog-batch05 — new source onboarding', () => {
  it('contiene exactamente 20 medios', () => {
    expect(MEDIOS_BATCH05).toHaveLength(20);
  });

  it('IDs son MED-0288..MED-0307 y no reutilizan 0204 ni Batch01-04', () => {
    const ids = MEDIOS_BATCH05.map((m) => m.medio_id);
    expect(ids[0]).toBe('MED-0288');
    expect(ids[ids.length - 1]).toBe('MED-0307');
    expect(ids).not.toContain('MED-0204');
    expect(ids.some((id) => Number(id.replace('MED-', '')) <= 287)).toBe(false);
    expect(new Set(ids).size).toBe(20);
    const nums = ids.map((id) => Number(id.replace('MED-', '')));
    expect(nums).toEqual(Array.from({ length: 20 }, (_, i) => 288 + i));
  });

  it('todos activos, RSS o SITEMAP, sin JS ni proxy, frecuencia 360', () => {
    for (const m of MEDIOS_BATCH05) {
      expect(m.activo).toBe(true);
      expect(['RSS', 'SITEMAP']).toContain(m.metodo_extraccion);
      if (m.metodo_extraccion === 'RSS') {
        expect(m.rss_url).toMatch(/^https:\/\//);
        expect(m.sitemap_url).toBeNull();
      } else {
        expect(m.sitemap_url).toMatch(/^https?:\/\//);
        expect(m.rss_url).toBeNull();
      }
      expect(m.requiere_javascript).toBe(false);
      expect(m.requiere_proxy).toBe(false);
      expect(m.frecuencia_minutos).toBe(360);
      expect(m.pais).toBe('MX');
    }
  });

  it('dominios y fuentes del lote son únicos', () => {
    const hosts = MEDIOS_BATCH05.map((m) => new URL(m.url_base!).hostname.replace(/^www\./, ''));
    const feeds = MEDIOS_BATCH05.map((m) => (m.rss_url ?? m.sitemap_url)!.replace(/\/+$/, '').toLowerCase());
    expect(new Set(hosts).size).toBe(20);
    expect(new Set(feeds).size).toBe(20);
  });

  it('incluye leftover HIGH4 El Mañana (sitemap) y Canal 44 (RSS, no udgtv)', () => {
    const byId = new Map(MEDIOS_BATCH05.map((m) => [m.medio_id, m]));
    expect(byId.get('MED-0300')?.nombre_medio).toBe('El Mañana de Nuevo Laredo');
    expect(byId.get('MED-0300')?.metodo_extraccion).toBe('SITEMAP');
    expect(byId.get('MED-0289')?.nombre_medio).toBe('Canal 44 El Canal de las Noticias');
    expect(byId.get('MED-0289')?.url_base).toContain('canal44.com');
    expect(byId.get('MED-0288')?.nombre_medio).toBe('El Siglo de Torreón');
  });
});
