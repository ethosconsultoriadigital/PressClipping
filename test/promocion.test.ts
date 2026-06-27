import { describe, it, expect } from 'vitest';
import {
  clasificarIngesta,
  construirUpdatePromocion,
  esFuenteOrganica,
  type ExistenteNoticia,
} from '../src/crawlers/promocion.js';
import type { NoticiaInsert } from '../src/normalizers/noticia.js';

function noticia(over: Partial<NoticiaInsert>): NoticiaInsert {
  return {
    medio_id: over.medio_id ?? 'MED-0017',
    url_original: over.url_original ?? 'https://m.mx/nota',
    url_canonica: over.url_canonica ?? 'https://m.mx/nota',
    titulo: over.titulo ?? 'Título',
    subtitulo: null,
    autor: null,
    fecha_publicacion: over.fecha_publicacion ?? null,
    seccion: null,
    texto_extraido: null,
    resumen: null,
    imagen_principal: null,
    idioma: 'es',
    pais: 'MX',
    estado: null,
    municipio: null,
    hash_url: over.hash_url ?? 'hash-1',
    hash_contenido: null,
    cluster_id: null,
    fuente_extraccion: over.fuente_extraccion ?? 'rss',
    estado_extraccion: 'ok',
    error_extraccion: null,
  };
}

const existente = (over: Partial<ExistenteNoticia>): ExistenteNoticia => ({
  hash_url: over.hash_url ?? 'hash-1',
  origen_cobertura: over.origen_cobertura ?? 'ethos_organico',
  medio_id: over.medio_id ?? 'MED-0017',
  fecha_publicacion: over.fecha_publicacion ?? null,
  titulo: over.titulo ?? null,
});

describe('esFuenteOrganica', () => {
  it('acepta rss/sitemap/seccion/buscador (case-insensitive)', () => {
    expect(esFuenteOrganica('rss')).toBe(true);
    expect(esFuenteOrganica('SITEMAP')).toBe(true);
    expect(esFuenteOrganica('seccion')).toBe(true);
    expect(esFuenteOrganica('buscador')).toBe(true);
  });
  it('rechaza fuentes no orgánicas o vacías', () => {
    expect(esFuenteOrganica('pressclipping')).toBe(false);
    expect(esFuenteOrganica('diagnose-url')).toBe(false);
    expect(esFuenteOrganica(null)).toBe(false);
    expect(esFuenteOrganica(undefined)).toBe(false);
    expect(esFuenteOrganica('')).toBe(false);
  });
});

describe('clasificarIngesta', () => {
  it('1) URL duplicada con ethos_organico → se omite como duplicado normal', () => {
    const items = [noticia({ hash_url: 'h1', fuente_extraccion: 'rss' })];
    const ex = new Map([['h1', existente({ hash_url: 'h1', origen_cobertura: 'ethos_organico' })]]);
    const r = clasificarIngesta(items, ex);
    expect(r.nuevas).toHaveLength(0);
    expect(r.promociones).toHaveLength(0);
    expect(r.duplicados).toBe(1);
  });

  it('2) URL duplicada con pressclipping_diagnostico y fuente RSS → se promueve', () => {
    const items = [noticia({ hash_url: 'h1', fuente_extraccion: 'rss', medio_id: 'MED-0152' })];
    const ex = new Map([['h1', existente({ hash_url: 'h1', origen_cobertura: 'pressclipping_diagnostico', medio_id: null })]]);
    const r = clasificarIngesta(items, ex);
    expect(r.duplicados).toBe(0);
    expect(r.nuevas).toHaveLength(0);
    expect(r.promociones).toHaveLength(1);
    expect(r.promociones[0]).toMatchObject({ hash_url: 'h1', medio_id: 'MED-0152', fuente_extraccion: 'rss' });
  });

  it('2b) promueve también con SITEMAP', () => {
    const items = [noticia({ hash_url: 'h1', fuente_extraccion: 'sitemap' })];
    const ex = new Map([['h1', existente({ hash_url: 'h1', origen_cobertura: 'pressclipping_diagnostico' })]]);
    expect(clasificarIngesta(items, ex).promociones).toHaveLength(1);
  });

  it('3) URL duplicada con pressclipping_diagnostico pero fuente NO orgánica → no se promueve', () => {
    const items = [noticia({ hash_url: 'h1', fuente_extraccion: 'pressclipping' })];
    const ex = new Map([['h1', existente({ hash_url: 'h1', origen_cobertura: 'pressclipping_diagnostico' })]]);
    const r = clasificarIngesta(items, ex);
    expect(r.promociones).toHaveLength(0);
    expect(r.duplicados).toBe(1);
  });

  it('no promueve orígenes manuales aunque la fuente sea orgánica', () => {
    const items = [noticia({ hash_url: 'h1', fuente_extraccion: 'rss' })];
    const ex = new Map([['h1', existente({ hash_url: 'h1', origen_cobertura: 'manual' })]]);
    const r = clasificarIngesta(items, ex);
    expect(r.promociones).toHaveLength(0);
    expect(r.duplicados).toBe(1);
  });

  it('URL nueva (sin existente) → se inserta como nueva', () => {
    const items = [noticia({ hash_url: 'nuevo', fuente_extraccion: 'rss' })];
    const r = clasificarIngesta(items, new Map());
    expect(r.nuevas).toHaveLength(1);
    expect(r.promociones).toHaveLength(0);
    expect(r.duplicados).toBe(0);
  });

  it('al promover rellena fecha_publicacion/titulo solo si faltaban en la nota diagnóstica', () => {
    const items = [noticia({ hash_url: 'h1', fuente_extraccion: 'sitemap', fecha_publicacion: '2026-06-26T12:00:00Z', titulo: 'Título orgánico' })];
    const ex = new Map([['h1', existente({ hash_url: 'h1', origen_cobertura: 'pressclipping_diagnostico', fecha_publicacion: null, titulo: null })]]);
    const r = clasificarIngesta(items, ex);
    expect(r.promociones[0]!.backfill).toEqual({ fecha_publicacion: '2026-06-26T12:00:00Z', titulo: 'Título orgánico' });
  });

  it('al promover NO pisa fecha_publicacion/titulo ya presentes', () => {
    const items = [noticia({ hash_url: 'h1', fuente_extraccion: 'rss', fecha_publicacion: '2026-06-26T12:00:00Z', titulo: 'Nuevo' })];
    const ex = new Map([['h1', existente({ hash_url: 'h1', origen_cobertura: 'pressclipping_diagnostico', fecha_publicacion: '2026-06-20T00:00:00Z', titulo: 'Viejo' })]]);
    const r = clasificarIngesta(items, ex);
    expect(r.promociones[0]!.backfill).toEqual({});
  });
});

describe('construirUpdatePromocion', () => {
  it('4) al promover, menciones_procesado=false y origen ethos_organico', () => {
    const payload = construirUpdatePromocion({ hash_url: 'h1', medio_id: 'MED-0152', fuente_extraccion: 'rss', backfill: {} });
    expect(payload.menciones_procesado).toBe(false);
    expect(payload.origen_cobertura).toBe('ethos_organico');
    expect(payload.medio_id).toBe('MED-0152');
    expect(payload.fuente_extraccion).toBe('rss');
  });

  it('incluye el backfill en el payload de actualización', () => {
    const payload = construirUpdatePromocion({
      hash_url: 'h1', medio_id: 'MED-0152', fuente_extraccion: 'rss',
      backfill: { fecha_publicacion: '2026-06-26T12:00:00Z' },
    });
    expect(payload.fecha_publicacion).toBe('2026-06-26T12:00:00Z');
  });
});
