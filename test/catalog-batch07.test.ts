/**
 * Tests del catálogo NEW SOURCE BATCH 07 (2026-09-25).
 * Verifica 25 medios MED-0333..MED-0357. No reutiliza MED-0204 ni batches previos.
 */
import { describe, it, expect } from 'vitest';
import { MEDIOS_BATCH07 } from '../scripts/catalog-batch07.js';

describe('catalog-batch07 — new source onboarding', () => {
  it('contiene exactamente 25 medios', () => {
    expect(MEDIOS_BATCH07).toHaveLength(25);
  });

  it('IDs son MED-0333..MED-0357 y no reutilizan 0204 ni Batch01-06', () => {
    const ids = MEDIOS_BATCH07.map((m) => m.medio_id);
    expect(ids[0]).toBe('MED-0333');
    expect(ids[ids.length - 1]).toBe('MED-0357');
    expect(ids).not.toContain('MED-0204');
    expect(ids.some((id) => Number(id.replace('MED-', '')) <= 332)).toBe(false);
    expect(new Set(ids).size).toBe(25);
    const nums = ids.map((id) => Number(id.replace('MED-', '')));
    expect(nums).toEqual(Array.from({ length: 25 }, (_, i) => 333 + i));
  });

  it('todos activos, RSS, sin JS ni proxy, frecuencia 360', () => {
    for (const m of MEDIOS_BATCH07) {
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
    const hosts = MEDIOS_BATCH07.map((m) => new URL(m.url_base!).hostname.replace(/^www\./, ''));
    const feeds = MEDIOS_BATCH07.map((m) => m.rss_url!.replace(/\/+$/, '').toLowerCase());
    expect(new Set(hosts).size).toBe(25);
    expect(new Set(feeds).size).toBe(25);
  });

  it('ediciones El Momento propias y excluye Marca/OEM/Feedburner', () => {
    const byId = new Map(MEDIOS_BATCH07.map((m) => [m.medio_id, m]));
    expect(byId.get('MED-0352')?.url_base).toContain('elmomentobcs.mx');
    expect(byId.get('MED-0353')?.url_base).toContain('elmomentocampeche.mx');
    expect(byId.get('MED-0354')?.url_base).toContain('elmomentoveracruz.mx');
    expect(MEDIOS_BATCH07.some((m) => (m.url_base ?? '').includes('marca.com'))).toBe(false);
    expect(MEDIOS_BATCH07.some((m) => (m.rss_url ?? '').includes('feedburner'))).toBe(false);
    expect(MEDIOS_BATCH07.some((m) => (m.url_base ?? '').includes('oem.com.mx'))).toBe(false);
    expect(MEDIOS_BATCH07.some((m) => (m.rss_url ?? '').includes('news.google'))).toBe(false);
  });
});
