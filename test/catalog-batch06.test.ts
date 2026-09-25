/**
 * Tests del catálogo NEW SOURCE BATCH 06 (2026-09-25).
 * Verifica 25 medios MED-0308..MED-0332. No reutiliza MED-0204 ni batches previos.
 */
import { describe, it, expect } from 'vitest';
import { MEDIOS_BATCH06 } from '../scripts/catalog-batch06.js';

describe('catalog-batch06 — new source onboarding', () => {
  it('contiene exactamente 25 medios', () => {
    expect(MEDIOS_BATCH06).toHaveLength(25);
  });

  it('IDs son MED-0308..MED-0332 y no reutilizan 0204 ni Batch01-05', () => {
    const ids = MEDIOS_BATCH06.map((m) => m.medio_id);
    expect(ids[0]).toBe('MED-0308');
    expect(ids[ids.length - 1]).toBe('MED-0332');
    expect(ids).not.toContain('MED-0204');
    expect(ids.some((id) => Number(id.replace('MED-', '')) <= 307)).toBe(false);
    expect(new Set(ids).size).toBe(25);
    const nums = ids.map((id) => Number(id.replace('MED-', '')));
    expect(nums).toEqual(Array.from({ length: 25 }, (_, i) => 308 + i));
  });

  it('todos activos, RSS o SITEMAP, sin JS ni proxy, frecuencia 360', () => {
    for (const m of MEDIOS_BATCH06) {
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
    const hosts = MEDIOS_BATCH06.map((m) => new URL(m.url_base!).hostname.replace(/^www\./, ''));
    const feeds = MEDIOS_BATCH06.map((m) => (m.rss_url ?? m.sitemap_url)!.replace(/\/+$/, '').toLowerCase());
    expect(new Set(hosts).size).toBe(25);
    expect(new Set(feeds).size).toBe(25);
  });

  it('incluye Jornada Maya propia y excluye Uniradio/OEM', () => {
    const byId = new Map(MEDIOS_BATCH06.map((m) => [m.medio_id, m]));
    expect(byId.get('MED-0332')?.nombre_medio).toBe('La Jornada Maya');
    expect(byId.get('MED-0332')?.url_base).toContain('lajornadamaya.mx');
    expect(byId.get('MED-0309')?.url_base).toContain('expreso.com.mx');
    expect(MEDIOS_BATCH06.some((m) => /uniradio/i.test(m.nombre_medio + (m.url_base ?? '')))).toBe(false);
    expect(MEDIOS_BATCH06.some((m) => (m.url_base ?? '').includes('oem.com.mx'))).toBe(false);
  });
});
