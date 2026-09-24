/**
 * Tests del catálogo NEW SOURCE BATCH 02 (2026-09-24).
 * Verifica 20 medios MED-0215..MED-0234. No reutiliza MED-0204 ni MED-0205..0214.
 */
import { describe, it, expect } from 'vitest';
import { MEDIOS_BATCH02 } from '../scripts/catalog-batch02.js';

describe('catalog-batch02 — new source onboarding', () => {
  it('contiene exactamente 20 medios', () => {
    expect(MEDIOS_BATCH02).toHaveLength(20);
  });

  it('IDs son MED-0215..MED-0234 y no reutilizan 0204 ni Batch01', () => {
    const ids = MEDIOS_BATCH02.map((m) => m.medio_id);
    expect(ids[0]).toBe('MED-0215');
    expect(ids[ids.length - 1]).toBe('MED-0234');
    expect(ids).not.toContain('MED-0204');
    expect(ids.some((id) => Number(id.replace('MED-', '')) <= 214)).toBe(false);
    expect(new Set(ids).size).toBe(20);
    const nums = ids.map((id) => Number(id.replace('MED-', '')));
    expect(nums).toEqual(Array.from({ length: 20 }, (_, i) => 215 + i));
  });

  it('todos activos, RSS, sin JS ni proxy, frecuencia 360', () => {
    for (const m of MEDIOS_BATCH02) {
      expect(m.activo).toBe(true);
      expect(m.metodo_extraccion).toBe('RSS');
      expect(m.rss_url).toMatch(/^https:\/\//);
      expect(m.requiere_javascript).toBe(false);
      expect(m.requiere_proxy).toBe(false);
      expect(m.frecuencia_minutos).toBe(360);
      expect(m.pais).toBe('MX');
      expect(m.estado).toBeNull();
      expect(m.region).toBeNull();
    }
  });

  it('dominios y feeds del lote son únicos', () => {
    const hosts = MEDIOS_BATCH02.map((m) => new URL(m.url_base!).hostname.replace(/^www\./, ''));
    const feeds = MEDIOS_BATCH02.map((m) => m.rss_url!.replace(/\/+$/, '').toLowerCase());
    expect(new Set(hosts).size).toBe(20);
    expect(new Set(feeds).size).toBe(20);
  });
});
