/**
 * Tests del catálogo lote3 — NEWS LAKE 200 FINAL PUSH (2026-07-22).
 * Verifica los 3 medios: PorEsto (MED-0189), LatinUS (MED-0190), La Silla Rota (MED-0191).
 */
import { describe, it, expect } from 'vitest';
import { NUEVOS_MEDIOS_LOTE3 } from '../scripts/catalog-direct-lote3.js';

describe('catalog-direct-lote3 — definición de medios', () => {
  it('contiene exactamente 3 medios', () => {
    expect(NUEVOS_MEDIOS_LOTE3).toHaveLength(3);
  });

  it('IDs únicos y en rango esperado', () => {
    const ids = NUEVOS_MEDIOS_LOTE3.map((m) => m.medio_id);
    expect(ids).toContain('MED-0189');
    expect(ids).toContain('MED-0190');
    expect(ids).toContain('MED-0191');
    expect(new Set(ids).size).toBe(3);
  });

  describe('PorEsto (MED-0189)', () => {
    const m = NUEVOS_MEDIOS_LOTE3.find((x) => x.medio_id === 'MED-0189')!;

    it('nombre correcto', () => expect(m.nombre_medio).toBe('PorEsto'));
    it('A_PUBLICO_FACIL: metodo_extraccion RSS', () => expect(m.metodo_extraccion).toBe('RSS'));
    it('rss_url presente y correcto', () => expect(m.rss_url).toBe('https://www.poresto.com/rss/portada.xml'));
    it('url_base correcto', () => expect(m.url_base).toBe('https://www.poresto.com'));
    it('pais MX, estado Yucatán', () => { expect(m.pais).toBe('MX'); expect(m.estado).toBe('Yucatán'); });
    it('sin proxy, sin JS', () => { expect(m.requiere_proxy).toBe(false); expect(m.requiere_javascript).toBe(false); });
    it('activo', () => expect(m.activo).toBe(true));
  });

  describe('LatinUS (MED-0190)', () => {
    const m = NUEVOS_MEDIOS_LOTE3.find((x) => x.medio_id === 'MED-0190')!;

    it('nombre correcto', () => expect(m.nombre_medio).toBe('LatinUS'));
    it('B_PUBLICO_DIRECT: metodo_extraccion DIRECT', () => expect(m.metodo_extraccion).toBe('DIRECT'));
    it('sin RSS ni sitemap', () => { expect(m.rss_url).toBeNull(); expect(m.sitemap_url).toBeNull(); });
    it('secciones_urls apunta a homepage', () => expect(m.secciones_urls).toBe('https://latinus.us/'));
    it('url_base correcto', () => expect(m.url_base).toBe('https://latinus.us'));
    it('pais MX, nacional', () => { expect(m.pais).toBe('MX'); expect(m.estado).toBe('Nacional'); });
    it('sin proxy, sin JS', () => { expect(m.requiere_proxy).toBe(false); expect(m.requiere_javascript).toBe(false); });
    it('activo', () => expect(m.activo).toBe(true));
  });

  describe('La Silla Rota (MED-0191)', () => {
    const m = NUEVOS_MEDIOS_LOTE3.find((x) => x.medio_id === 'MED-0191')!;

    it('nombre correcto', () => expect(m.nombre_medio).toBe('La Silla Rota'));
    it('B_PUBLICO_DIRECT: metodo_extraccion DIRECT', () => expect(m.metodo_extraccion).toBe('DIRECT'));
    it('prioridad Alta (P2 en readiness report)', () => expect(m.prioridad).toBe('Alta'));
    it('sin RSS ni sitemap', () => { expect(m.rss_url).toBeNull(); expect(m.sitemap_url).toBeNull(); });
    it('secciones_urls apunta a homepage', () => expect(m.secciones_urls).toBe('https://lasillarota.com/'));
    it('url_base correcto', () => expect(m.url_base).toBe('https://lasillarota.com'));
    it('pais MX, nacional', () => { expect(m.pais).toBe('MX'); expect(m.estado).toBe('Nacional'); });
    it('sin proxy, sin JS', () => { expect(m.requiere_proxy).toBe(false); expect(m.requiere_javascript).toBe(false); });
    it('activo', () => expect(m.activo).toBe(true));
  });
});
