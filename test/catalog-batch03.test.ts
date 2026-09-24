/**
 * Tests del catálogo NEW SOURCE BATCH 03 (2026-09-24).
 * Verifica 25 medios MED-0235..MED-0259. No reutiliza MED-0204 ni Batch01/02.
 */
import { describe, it, expect } from 'vitest';
import { MEDIOS_BATCH03 } from '../scripts/catalog-batch03.js';

describe('catalog-batch03 — new source onboarding', () => {
  it('contiene exactamente 25 medios', () => {
    expect(MEDIOS_BATCH03).toHaveLength(25);
  });

  it('IDs son MED-0235..MED-0259 y no reutilizan 0204 ni Batch01/02', () => {
    const ids = MEDIOS_BATCH03.map((m) => m.medio_id);
    expect(ids[0]).toBe('MED-0235');
    expect(ids[ids.length - 1]).toBe('MED-0259');
    expect(ids).not.toContain('MED-0204');
    expect(ids.some((id) => Number(id.replace('MED-', '')) <= 234)).toBe(false);
    expect(new Set(ids).size).toBe(25);
    const nums = ids.map((id) => Number(id.replace('MED-', '')));
    expect(nums).toEqual(Array.from({ length: 25 }, (_, i) => 235 + i));
  });

  it('todos activos, RSS, sin JS ni proxy, frecuencia 360', () => {
    for (const m of MEDIOS_BATCH03) {
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
    const hosts = MEDIOS_BATCH03.map((m) => new URL(m.url_base!).hostname.replace(/^www\./, ''));
    const feeds = MEDIOS_BATCH03.map((m) => m.rss_url!.replace(/\/+$/, '').toLowerCase());
    expect(new Set(hosts).size).toBe(25);
    expect(new Set(feeds).size).toBe(25);
  });

  it('incluye leftover Batch02 Diario de Chiapas, Jornada BC y Juárez Noticias', () => {
    const names = MEDIOS_BATCH03.map((m) => m.nombre_medio);
    expect(names).toContain('Diario de Chiapas');
    expect(names).toContain('LA JORNADA BAJA CALIFORNIA');
    expect(names).toContain('Juárez Noticias');
    expect(names).not.toContain('El Siglo de Durango');
  });
});
