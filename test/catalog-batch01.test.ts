/**
 * Tests del catálogo NEW SOURCE BATCH 01 (2026-09-24).
 * Verifica 10 medios MED-0205..MED-0214. No reutiliza MED-0204.
 */
import { describe, it, expect } from 'vitest';
import { MEDIOS_BATCH01 } from '../scripts/catalog-batch01.js';

describe('catalog-batch01 — new source onboarding', () => {
  it('contiene exactamente 10 medios', () => {
    expect(MEDIOS_BATCH01).toHaveLength(10);
  });

  it('IDs son MED-0205..MED-0214 y no reutilizan MED-0204', () => {
    const ids = MEDIOS_BATCH01.map((m) => m.medio_id);
    expect(ids).toEqual([
      'MED-0205', 'MED-0206', 'MED-0207', 'MED-0208', 'MED-0209',
      'MED-0210', 'MED-0211', 'MED-0212', 'MED-0213', 'MED-0214',
    ]);
    expect(ids).not.toContain('MED-0204');
    expect(new Set(ids).size).toBe(10);
  });

  it('todos activos, RSS, sin JS ni proxy, frecuencia 360', () => {
    for (const m of MEDIOS_BATCH01) {
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

  it('dominios del lote son únicos', () => {
    const hosts = MEDIOS_BATCH01.map((m) => new URL(m.url_base!).hostname.replace(/^www\./, ''));
    expect(new Set(hosts).size).toBe(10);
  });
});
