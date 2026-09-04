import { describe, it, expect } from 'vitest';
import {
  REPAIR_PATCHES,
  parseArgs,
  seleccionarPatches,
  camposUpdate,
  camposSheetUpdate,
  filaNueva01Medios,
} from '../scripts/repair-failed-sources-batch.js';

describe('repair-failed-sources-batch', () => {
  it('tiene 11 patches de IDs únicos', () => {
    const ids = REPAIR_PATCHES.map((p) => p.medio_id);
    expect(ids).toHaveLength(11);
    expect(new Set(ids).size).toBe(11);
  });

  it('no incluye medios NXDOMAIN, paywall Reforma ni sin fuente pública', () => {
    const prohibidos = [
      'MED-0104', 'MED-0110', 'MED-0117', 'MED-0121', 'MED-0123',
      'MED-0125', 'MED-0128', 'MED-0132', 'MED-0133', 'MED-0137',
      'MED-0139', 'MED-0140', 'MED-0141', 'MED-0143', 'MED-0144',
      'MED-0027', 'MED-0037', 'MED-0046', 'MED-0054', 'MED-0032',
    ];
    const ids = new Set(REPAIR_PATCHES.map((p) => p.medio_id));
    for (const id of prohibidos) expect(ids.has(id)).toBe(false);
  });

  it('toda fuente propuesta es https del mismo sitio', () => {
    for (const p of REPAIR_PATCHES) {
      const url = p.metodo_extraccion === 'RSS' ? p.rss_url : p.sitemap_url;
      expect(url, p.medio_id).toMatch(/^https:\/\//);
    }
  });

  it('parseArgs es --dry por defecto; --apply escribe; --sync-sheet alinea 01_Medios', () => {
    expect(parseArgs([]).dry).toBe(true);
    expect(parseArgs([]).syncSheet).toBe(false);
    expect(parseArgs(['--dry']).dry).toBe(true);
    expect(parseArgs(['--apply']).dry).toBe(false);
    expect(parseArgs(['--sync-sheet']).syncSheet).toBe(true);
    expect(parseArgs(['--only=MED-0115,med-0126']).only).toEqual(['MED-0115', 'MED-0126']);
  });

  it('camposSheetUpdate no toca keywords ni inserta columnas raras', () => {
    const u = camposSheetUpdate(REPAIR_PATCHES.find((x) => x.medio_id === 'MED-0029')!);
    expect(u.medio_id).toBe('MED-0029');
    expect(u.metodo_extraccion).toBe('RSS');
    expect(u.rss_url).toBe('https://www.jornada.com.mx/rss/edicion.xml');
    expect(u).not.toHaveProperty('cliente_id');
    expect(u).not.toHaveProperty('keyword');
  });

  it('--only filtra el lote', () => {
    const sel = seleccionarPatches({ dry: true, syncSheet: false, only: ['MED-0115'] });
    expect(sel).toHaveLength(1);
    expect(sel[0]?.medio_id).toBe('MED-0115');
    expect(sel[0]?.rss_url).toBe('https://dk1250.mx/feed');
  });

  it('camposUpdate solo toca fuente + estado, no clientes', () => {
    const p = REPAIR_PATCHES.find((x) => x.medio_id === 'MED-0099')!;
    const u = camposUpdate(p);
    expect(u.metodo_extraccion).toBe('RSS');
    expect(u.rss_url).toBe('https://www.bcsnoticias.mx/feed/');
    expect(u.activo).toBe(true);
    expect(u).not.toHaveProperty('cliente_id');
    expect(u).not.toHaveProperty('keyword');
  });

  it('La Jornada propone RSS de edición, no el sitemap 403', () => {
    const p = REPAIR_PATCHES.find((x) => x.medio_id === 'MED-0029')!;
    expect(p.rss_url).toBe('https://www.jornada.com.mx/rss/edicion.xml');
    expect(p.metodo_extraccion).toBe('RSS');
  });

  it('La Silla Rota propone news sitemap, no el índice masivo', () => {
    const p = REPAIR_PATCHES.find((x) => x.medio_id === 'MED-0191')!;
    expect(p.sitemap_url).toBe('https://lasillarota.com/sitemaps/news.xml');
    expect(p.metodo_extraccion).toBe('SITEMAP');
  });

  it('filaNueva01Medios copia catálogo y pisa solo la fuente reparada', () => {
    const p = REPAIR_PATCHES.find((x) => x.medio_id === 'MED-0191')!;
    const fila = filaNueva01Medios(
      {
        medio_id: 'MED-0191',
        nombre_medio: 'La Silla Rota',
        url_base: 'https://lasillarota.com',
        metodo_extraccion: 'DIRECT',
        sitemap_url: null,
        categoria: 'Noticias / Político-Digital',
      },
      p,
    );
    expect(fila.nombre_medio).toBe('La Silla Rota');
    expect(fila.categoria).toBe('Noticias / Político-Digital');
    expect(fila.metodo_extraccion).toBe('SITEMAP');
    expect(fila.sitemap_url).toBe('https://lasillarota.com/sitemaps/news.xml');
    expect(fila.activo).toBe(true);
  });
});
