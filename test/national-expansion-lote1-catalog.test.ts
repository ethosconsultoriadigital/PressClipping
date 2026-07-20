/**
 * Tests del alta de catálogo de 12 medios nacionales — lote ETHOS 200 MEDIA
 * NEWS LAKE (2026-07-20). Módulo puro (sin DB).
 */
import { describe, it, expect } from 'vitest';
import { NUEVOS_MEDIOS } from '../scripts/catalog-national-expansion-lote1.js';
import { medioSchema } from '../src/types/schemas.js';

describe('catalog-national-expansion-lote1 — NUEVOS_MEDIOS', () => {
  it('contiene exactamente 12 medios (MED-0174..MED-0185)', () => {
    const ids = NUEVOS_MEDIOS.map((m) => m.medio_id).sort();
    expect(ids).toEqual([
      'MED-0174', 'MED-0175', 'MED-0176', 'MED-0177', 'MED-0178', 'MED-0179',
      'MED-0180', 'MED-0181', 'MED-0182', 'MED-0183', 'MED-0184', 'MED-0185',
    ]);
  });

  it('cada fila valida contra el esquema real de la tabla medios', () => {
    for (const m of NUEVOS_MEDIOS) {
      const r = medioSchema.safeParse(m);
      expect(r.success, r.success ? '' : `${m.medio_id}: ${JSON.stringify(r.error?.issues)}`).toBe(true);
    }
  });

  it('ninguno requiere proxy ni JavaScript', () => {
    for (const m of NUEVOS_MEDIOS) {
      expect(m.requiere_proxy).toBe(false);
      expect(m.requiere_javascript).toBe(false);
    }
  });

  it('Bloomberg Línea México (MED-0176) usa RSS, no SITEMAP — regresión del bug real 2026-07-20', () => {
    const bloomberg = NUEVOS_MEDIOS.find((m) => m.medio_id === 'MED-0176')!;
    expect(bloomberg.metodo_extraccion).toBe('RSS');
    expect(bloomberg.rss_url).toBe('https://www.bloomberglinea.com/arc/outboundfeeds/google-news-feed-latam/?outputType=xml');
    expect(bloomberg.sitemap_url).toBeNull();
  });

  it('los demás 11 medios usan SITEMAP con sitemap_url https absoluto', () => {
    for (const m of NUEVOS_MEDIOS) {
      if (m.medio_id === 'MED-0176') continue;
      expect(m.metodo_extraccion).toBe('SITEMAP');
      expect(m.sitemap_url).toMatch(/^https:\/\//);
    }
  });
});
