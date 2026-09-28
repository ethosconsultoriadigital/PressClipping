/**
 * Tests del catálogo NEW SOURCE BATCH 08 (2026-09-28).
 * Verifica 30 medios MED-0358..MED-0387. No reutiliza MED-0204 ni batches previos.
 */
import { describe, it, expect } from 'vitest';
import { MEDIOS_BATCH08 } from '../scripts/catalog-batch08.js';

describe('catalog-batch08 — new source onboarding', () => {
  it('contiene exactamente 30 medios', () => {
    expect(MEDIOS_BATCH08).toHaveLength(30);
  });

  it('IDs son MED-0358..MED-0387 y no reutilizan 0204 ni Batch01-07', () => {
    const ids = MEDIOS_BATCH08.map((m) => m.medio_id);
    expect(ids[0]).toBe('MED-0358');
    expect(ids[ids.length - 1]).toBe('MED-0387');
    expect(ids).not.toContain('MED-0204');
    expect(ids.some((id) => Number(id.replace('MED-', '')) <= 357)).toBe(false);
    expect(new Set(ids).size).toBe(30);
    const nums = ids.map((id) => Number(id.replace('MED-', '')));
    expect(nums).toEqual(Array.from({ length: 30 }, (_, i) => 358 + i));
  });

  it('todos activos, RSS, sin JS ni proxy, frecuencia 360', () => {
    for (const m of MEDIOS_BATCH08) {
      expect(m.activo).toBe(true);
      expect(m.metodo_extraccion).toBe('RSS');
      expect(m.rss_url).toMatch(/^https:\/\//);
      expect(m.sitemap_url).toBeNull();
      expect(m.requiere_javascript).toBe(false);
      expect(m.requiere_proxy).toBe(false);
      expect(m.frecuencia_minutos).toBe(360);
      expect(m.pais).toBe('MX');
    }
  });

  it('dominios y fuentes del lote son únicos', () => {
    const hosts = MEDIOS_BATCH08.map((m) => new URL(m.url_base!).hostname.replace(/^www\./, ''));
    const feeds = MEDIOS_BATCH08.map((m) => m.rss_url!.replace(/\/+$/, '').toLowerCase());
    expect(new Set(hosts).size).toBe(30);
    expect(new Set(feeds).size).toBe(30);
  });

  it('excluye CNN/OEM/Feedburner/Google News y usa dominio propio Heraldo Ags', () => {
    const byId = new Map(MEDIOS_BATCH08.map((m) => [m.medio_id, m]));
    expect(byId.get('MED-0361')?.url_base).toContain('heraldo.mx');
    expect(byId.get('MED-0381')?.url_base).toContain('24horaspuebla.com');
    expect(MEDIOS_BATCH08.some((m) => (m.url_base ?? '').includes('cnn.com'))).toBe(false);
    expect(MEDIOS_BATCH08.some((m) => (m.rss_url ?? '').includes('feedburner'))).toBe(false);
    expect(MEDIOS_BATCH08.some((m) => (m.url_base ?? '').includes('oem.com.mx'))).toBe(false);
    expect(MEDIOS_BATCH08.some((m) => (m.rss_url ?? '').includes('news.google'))).toBe(false);
  });
});
