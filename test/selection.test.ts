import { describe, it, expect } from 'vitest';
import {
  evaluarMedio,
  seleccionarMedios,
  normalizarEstado,
  fuenteDbValida,
  type MedioSeleccionable,
  type DiagnosticoMedio,
} from '../src/crawlers/selection.js';

function medio(over: Partial<MedioSeleccionable>): MedioSeleccionable {
  return {
    medio_id: over.medio_id ?? 'm1',
    nombre_medio: over.nombre_medio ?? 'Medio 1',
    url_base: over.url_base ?? 'https://m1.mx',
    metodo_extraccion: over.metodo_extraccion ?? 'rss',
    rss_url: over.rss_url ?? 'https://m1.mx/rss',
    sitemap_url: over.sitemap_url ?? null,
    secciones_urls: over.secciones_urls ?? null,
    requiere_javascript: over.requiere_javascript ?? false,
    requiere_proxy: over.requiere_proxy ?? false,
    prioridad: over.prioridad ?? null,
    estado: over.estado ?? null,
    region: over.region ?? null,
    ultimo_estado: over.ultimo_estado ?? null,
    activo: over.activo ?? true,
  };
}

const diag = (estado: string, especial = false): DiagnosticoMedio => ({
  estado_diagnostico: estado,
  es_especial: especial,
});

describe('normalizarEstado', () => {
  it('mapea sinónimos a la forma canónica', () => {
    expect(normalizarEstado('partial')).toBe('parcial');
    expect(normalizarEstado('PARCIAL')).toBe('parcial');
    expect(normalizarEstado('sin fuente')).toBe('sin_fuente');
    expect(normalizarEstado('OK')).toBe('ok');
  });
});

describe('evaluarMedio - filtros duros', () => {
  it('excluye medios que requieren JavaScript', () => {
    const d = evaluarMedio(medio({ requiere_javascript: true }), null, {});
    expect(d.incluir).toBe(false);
    expect(d.motivo).toBe('requiere_javascript');
  });

  it('excluye medios que requieren proxy', () => {
    const d = evaluarMedio(medio({ requiere_proxy: true }), null, {});
    expect(d.incluir).toBe(false);
  });

  it('excluye medios marcados como Duplicado', () => {
    const d = evaluarMedio(medio({ ultimo_estado: 'Duplicado' }), null, {});
    expect(d.incluir).toBe(false);
    expect(d.motivo).toBe('ultimo_estado=Duplicado');
  });

  it('excluye inactivos', () => {
    const d = evaluarMedio(medio({ activo: false }), null, {});
    expect(d.incluir).toBe(false);
  });
});

describe('evaluarMedio - política por defecto', () => {
  it('incluye un medio sin diagnóstico (no se sabe que sea malo)', () => {
    const d = evaluarMedio(medio({}), null, {});
    expect(d.incluir).toBe(true);
  });

  it('excluye por defecto diagnóstico error/sin_fuente/especial', () => {
    expect(evaluarMedio(medio({}), diag('error'), {}).incluir).toBe(false);
    expect(evaluarMedio(medio({}), diag('sin_fuente'), {}).incluir).toBe(false);
    expect(evaluarMedio(medio({}), diag('ok', true), {}).incluir).toBe(false);
  });

  it('incluye ok y parcial por defecto', () => {
    expect(evaluarMedio(medio({}), diag('ok'), {}).incluir).toBe(true);
    expect(evaluarMedio(medio({}), diag('parcial'), {}).incluir).toBe(true);
  });
});

describe('evaluarMedio - filtros explícitos', () => {
  it('--priority filtra por prioridad (case-insensitive)', () => {
    expect(evaluarMedio(medio({ prioridad: 'Alta' }), null, { priority: 'alta' }).incluir).toBe(true);
    expect(evaluarMedio(medio({ prioridad: 'Baja' }), null, { priority: 'Alta' }).incluir).toBe(false);
  });

  it('--estado filtra por estado o region (tolerante a acentos)', () => {
    expect(evaluarMedio(medio({ estado: 'Jalisco' }), null, { estado: 'jalisco' }).incluir).toBe(true);
    expect(evaluarMedio(medio({ region: 'Yucatán' }), null, { estado: 'yucatan' }).incluir).toBe(true);
    expect(evaluarMedio(medio({ estado: 'Sonora' }), null, { estado: 'Jalisco' }).incluir).toBe(false);
  });

  it('--only-status acepta "partial" como "parcial"', () => {
    const d = evaluarMedio(medio({}), diag('parcial'), { onlyStatus: ['partial'] });
    expect(d.incluir).toBe(true);
    const e = evaluarMedio(medio({}), diag('ok'), { onlyStatus: ['partial'] });
    expect(e.incluir).toBe(false);
  });

  it('--only-status sin diagnóstico excluye', () => {
    expect(evaluarMedio(medio({}), null, { onlyStatus: ['ok'] }).incluir).toBe(false);
  });

  it('--exclude-status permite incluir error si no se excluye', () => {
    const d = evaluarMedio(medio({}), diag('error'), { excludeStatus: ['sin_fuente'] });
    expect(d.incluir).toBe(true);
  });

  it('--solo-validados solo deja ok/parcial no especiales y con diagnóstico', () => {
    expect(evaluarMedio(medio({}), diag('ok'), { soloValidados: true }).incluir).toBe(true);
    expect(evaluarMedio(medio({}), diag('parcial'), { soloValidados: true }).incluir).toBe(true);
    expect(evaluarMedio(medio({}), diag('error'), { soloValidados: true }).incluir).toBe(false);
    expect(evaluarMedio(medio({}), diag('ok', true), { soloValidados: true }).incluir).toBe(false);
    expect(evaluarMedio(medio({}), null, { soloValidados: true }).incluir).toBe(false);
  });
});

describe('fuenteDbValida (fuente canónica DB)', () => {
  it('acepta RSS http válido', () => {
    expect(fuenteDbValida(medio({ metodo_extraccion: 'rss', rss_url: 'https://m.mx/rss' }))).toBe(true);
  });

  it('acepta sitemap http válido', () => {
    expect(
      fuenteDbValida(
        medio({ metodo_extraccion: 'sitemap', rss_url: null, sitemap_url: 'https://m.mx/sitemap.xml' }),
      ),
    ).toBe(true);
  });

  it('rechaza medio sin rss ni sitemap', () => {
    expect(fuenteDbValida(medio({ rss_url: '', sitemap_url: '' }))).toBe(false);
  });

  it('rechaza requiere_javascript / requiere_proxy / inactivo', () => {
    expect(fuenteDbValida(medio({ requiere_javascript: true }))).toBe(false);
    expect(fuenteDbValida(medio({ requiere_proxy: true }))).toBe(false);
    expect(fuenteDbValida(medio({ activo: false }))).toBe(false);
  });
});

describe('evaluarMedio - crawl dirigido (--medio-ids, DB canónica)', () => {
  it('un medio READY (fuente DB válida) NO se bloquea por diagnóstico viejo especial/sin_fuente', () => {
    const m = medio({ metodo_extraccion: 'rss', rss_url: 'https://m.mx/rss' });
    // Diagnóstico histórico viejo dice especial / sin_fuente:
    expect(evaluarMedio(m, diag('ok', true), { dirigido: true }).incluir).toBe(true);
    expect(evaluarMedio(m, diag('sin_fuente'), { dirigido: true }).incluir).toBe(true);
    // Sin --medio-ids (no dirigido) el diagnóstico viejo SÍ excluye (comportamiento por defecto):
    expect(evaluarMedio(m, diag('sin_fuente'), {}).incluir).toBe(false);
    expect(evaluarMedio(m, diag('ok', true), {}).incluir).toBe(false);
  });

  it('crawl dirigido respeta fuente DB: sin rss/sitemap sigue bloqueado', () => {
    const d = evaluarMedio(medio({ rss_url: '', sitemap_url: '' }), diag('ok'), { dirigido: true });
    expect(d.incluir).toBe(false);
    expect(d.motivo).toContain('sin fuente DB válida');
  });

  it('crawl dirigido: requiere_proxy sigue bloqueado', () => {
    const d = evaluarMedio(medio({ requiere_proxy: true, rss_url: 'https://m.mx/rss' }), diag('ok'), {
      dirigido: true,
    });
    expect(d.incluir).toBe(false);
    expect(d.motivo).toBe('requiere_proxy');
  });

  it('crawl dirigido: requiere_javascript sigue bloqueado', () => {
    const d = evaluarMedio(medio({ requiere_javascript: true, rss_url: 'https://m.mx/rss' }), diag('ok'), {
      dirigido: true,
    });
    expect(d.incluir).toBe(false);
    expect(d.motivo).toBe('requiere_javascript');
  });

  it('crawl dirigido: inactivo sigue bloqueado', () => {
    const d = evaluarMedio(medio({ activo: false, rss_url: 'https://m.mx/rss' }), diag('ok'), {
      dirigido: true,
    });
    expect(d.incluir).toBe(false);
    expect(d.motivo).toBe('inactivo');
  });
});

describe('seleccionarMedios', () => {
  it('separa incluidos de excluidos', () => {
    const medios = [
      medio({ medio_id: 'ok1' }),
      medio({ medio_id: 'js1', requiere_javascript: true }),
      medio({ medio_id: 'err1' }),
    ];
    const diags = new Map<string, DiagnosticoMedio>([
      ['ok1', diag('ok')],
      ['err1', diag('error')],
    ]);
    const { incluidos, excluidos } = seleccionarMedios(medios, diags, {});
    expect(incluidos.map((d) => d.medio.medio_id)).toEqual(['ok1']);
    expect(excluidos.map((d) => d.medio.medio_id).sort()).toEqual(['err1', 'js1']);
  });
});
