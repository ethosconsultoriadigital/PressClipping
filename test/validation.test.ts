import { describe, it, expect } from 'vitest';
import {
  particionarMedios,
  filtrarPorPrioridad,
  recomendarMetodo,
  estadoDiagnostico,
  clasificarMedio,
  type MedioInput,
  type ProbeResult,
} from '../src/validation/diagnostics.js';

function medio(over: Partial<MedioInput>): MedioInput {
  return {
    medio_id: over.medio_id ?? 'm1',
    nombre_medio: over.nombre_medio ?? 'Medio 1',
    activo: over.activo ?? true,
    prioridad: over.prioridad ?? null,
    metodo_extraccion: over.metodo_extraccion ?? null,
    rss_url: over.rss_url ?? null,
    sitemap_url: over.sitemap_url ?? null,
    secciones_urls: over.secciones_urls ?? null,
    buscador_url: over.buscador_url ?? null,
    requiere_javascript: over.requiere_javascript ?? false,
    requiere_proxy: over.requiere_proxy ?? false,
    url_base: over.url_base ?? null,
  };
}

function probe(over: Partial<ProbeResult>): ProbeResult {
  return {
    rss_ok: over.rss_ok ?? false,
    rss_items: over.rss_items ?? 0,
    sitemap_ok: over.sitemap_ok ?? false,
    sitemap_items: over.sitemap_items ?? 0,
    error: over.error ?? null,
  };
}

describe('particionarMedios', () => {
  it('separa activos, inactivos y duplicados (por id y url_base)', () => {
    const lista = [
      medio({ medio_id: 'a', activo: true, url_base: 'https://a.com' }),
      medio({ medio_id: 'a', activo: true, url_base: 'https://x.com' }), // dup id
      medio({ medio_id: 'b', activo: false, url_base: 'https://b.com' }), // inactivo
      medio({ medio_id: 'c', activo: true, url_base: 'https://a.com/' }), // dup url_base de 'a'
      medio({ medio_id: 'd', activo: true, url_base: 'https://d.com' }),
    ];
    const p = particionarMedios(lista);
    expect(p.procesables.map((m) => m.medio_id)).toEqual(['a', 'd']);
    expect(p.inactivos.map((m) => m.medio_id)).toEqual(['b']);
    expect(p.duplicados.map((m) => m.medio_id)).toEqual(['a', 'c']);
  });
});

describe('filtrarPorPrioridad', () => {
  it('filtra case-insensitive por prioridad exacta', () => {
    const lista = [medio({ medio_id: 'a', prioridad: 'Alta' }), medio({ medio_id: 'b', prioridad: 'Baja' })];
    expect(filtrarPorPrioridad(lista, 'alta').map((m) => m.medio_id)).toEqual(['a']);
    expect(filtrarPorPrioridad(lista).length).toBe(2); // sin filtro
  });
});

describe('recomendarMetodo', () => {
  it('recomienda rss si el feed respondió con items', () => {
    expect(recomendarMetodo(medio({ rss_url: 'x' }), probe({ rss_ok: true, rss_items: 5 }))).toBe('rss');
  });
  it('recomienda sitemap si rss no dio pero sitemap sí', () => {
    expect(
      recomendarMetodo(medio({ sitemap_url: 'x' }), probe({ sitemap_ok: true, sitemap_items: 3 })),
    ).toBe('sitemap');
  });
  it('marca revisar si rss estaba configurado pero falló', () => {
    expect(recomendarMetodo(medio({ rss_url: 'x' }), probe({ rss_ok: false }))).toContain('revisar');
  });
  it('sugiere headless si requiere javascript y no hay fuente', () => {
    expect(recomendarMetodo(medio({ requiere_javascript: true }), probe({}))).toContain('headless');
  });
  it('sin_metodo_viable si no hay nada', () => {
    expect(recomendarMetodo(medio({}), probe({}))).toBe('sin_metodo_viable');
  });
});

describe('estadoDiagnostico', () => {
  it('ok cuando ambas fuentes responden', () => {
    expect(estadoDiagnostico(probe({ rss_ok: true, rss_items: 1, sitemap_ok: true, sitemap_items: 1 }))).toBe('ok');
  });
  it('parcial cuando solo una responde', () => {
    expect(estadoDiagnostico(probe({ rss_ok: true, rss_items: 1 }))).toBe('parcial');
  });
  it('error cuando hubo error y nada respondió', () => {
    expect(estadoDiagnostico(probe({ error: 'timeout' }))).toBe('error');
  });
  it('sin_fuente cuando no hay fuentes ni error', () => {
    expect(estadoDiagnostico(probe({}))).toBe('sin_fuente');
  });
});

describe('clasificarMedio', () => {
  it('no especial cuando hay fuente y no requiere JS/proxy', () => {
    const c = clasificarMedio(medio({ rss_url: 'x' }), probe({ rss_ok: true, rss_items: 2 }));
    expect(c.es_especial).toBe(false);
  });
  it('especial si requiere javascript', () => {
    const c = clasificarMedio(medio({ requiere_javascript: true }), probe({ rss_ok: true, rss_items: 1 }));
    expect(c.es_especial).toBe(true);
    expect(c.motivo).toContain('requiere_javascript');
  });
  it('especial si no hay fuente accesible', () => {
    const c = clasificarMedio(medio({}), probe({}));
    expect(c.es_especial).toBe(true);
    expect(c.motivo).toContain('sin fuente');
  });
});
