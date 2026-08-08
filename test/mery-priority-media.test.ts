/**
 * Tests de la resolución de medios prioritarios de Mery Pozos.
 *
 * Cubren la regresión real: la lista estaba hardcodeada a MED-0201..MED-0204, así
 * que los 5 medios ACTIVAR_EN_CRON y AFmedios quedaban fuera de la captura.
 * También fijan que MURAL nunca se captura.
 */
import { describe, it, expect } from 'vitest';
import {
  MERY_PRIORITY_MEDIOS,
  MERY_EXCLUIDOS,
  resolverEnCatalogo,
  clasificarMedio,
  parseArgs,
  type CatalogoMedioRow,
} from '../scripts/mery-priority-media-capture.js';

function fila(over: Partial<CatalogoMedioRow> & { medio_id: string }): CatalogoMedioRow {
  return {
    nombre_medio: null,
    activo: true,
    metodo_extraccion: 'RSS',
    rss_url: 'https://example.com/feed/',
    sitemap_url: null,
    requiere_javascript: false,
    requiere_proxy: false,
    ultimo_estado: 'ok',
    ...over,
  };
}

const SIN_CRON = new Set<string>();

describe('MERY_PRIORITY_MEDIOS — cobertura de la lista', () => {
  it('cubre los 10 medios prioritarios', () => {
    expect(MERY_PRIORITY_MEDIOS).toHaveLength(10);
  });

  it('incluye los 5 ya catalogados (activar/validar)', () => {
    const nombres = MERY_PRIORITY_MEDIOS.map((m) => m.canonical);
    for (const esperado of [
      'UDG TV / Canal 44',
      'Notisistema',
      'Tráfico ZMG',
      'Vallarta Independiente',
      'Partidero',
    ]) {
      expect(nombres).toContain(esperado);
    }
  });

  it('incluye los 5 nuevos/validar, con AFmedios (antes ausente)', () => {
    const nombres = MERY_PRIORITY_MEDIOS.map((m) => m.canonical);
    for (const esperado of [
      'Semanario Conciencia Pública',
      'A Fondo Jalisco',
      'AFmedios',
      'Siker',
      'Página 24 Jalisco',
    ]) {
      expect(nombres).toContain(esperado);
    }
  });

  it('MURAL no está en la lista de captura, sino en excluidos', () => {
    expect(MERY_PRIORITY_MEDIOS.map((m) => m.canonical)).not.toContain('MURAL');
    expect(MERY_EXCLUIDOS.map((m) => m.canonical)).toContain('MURAL');
  });

  it('MURAL se clasifica siempre como D_PAGO_CONVENIO_API y nunca CAPTURAR', () => {
    const mural = MERY_EXCLUIDOS.find((m) => m.canonical === 'MURAL')!;
    // Incluso si existiera en catálogo, activo y con RSS.
    const catalogo = [fila({ medio_id: 'MED-0037', nombre_medio: 'Mural' })];
    const r = clasificarMedio(mural, catalogo, SIN_CRON);
    expect(r.accion).toBe('D_PAGO_CONVENIO_API');
  });
});

describe('resolverEnCatalogo', () => {
  it('prioriza el medio_id esperado sobre el nombre', () => {
    const partidero = MERY_PRIORITY_MEDIOS.find((m) => m.canonical === 'Partidero')!;
    const catalogo = [
      fila({ medio_id: 'MED-0042', nombre_medio: 'Partidero' }),
      fila({ medio_id: 'MED-0999', nombre_medio: 'Partidero Falso' }),
    ];
    expect(resolverEnCatalogo(partidero, catalogo)?.medio_id).toBe('MED-0042');
  });

  it('resuelve por nombre cuando no hay ID esperado (Tráfico ZMG)', () => {
    const trafico = MERY_PRIORITY_MEDIOS.find((m) => m.canonical === 'Tráfico ZMG')!;
    const catalogo = [fila({ medio_id: 'MED-0150', nombre_medio: 'Tráfico ZMG' })];
    expect(resolverEnCatalogo(trafico, catalogo)?.medio_id).toBe('MED-0150');
  });

  it('resuelve ignorando acentos y mayúsculas', () => {
    const pagina = MERY_PRIORITY_MEDIOS.find((m) => m.canonical === 'Página 24 Jalisco')!;
    const catalogo = [fila({ medio_id: 'MED-0204', nombre_medio: 'PAGINA 24 JALISCO' })];
    expect(resolverEnCatalogo(pagina, catalogo)?.medio_id).toBe('MED-0204');
  });

  it('resuelve AFmedios escrito como "AF Medios"', () => {
    const af = MERY_PRIORITY_MEDIOS.find((m) => m.canonical === 'AFmedios')!;
    const catalogo = [fila({ medio_id: 'MED-0187', nombre_medio: 'AF Medios' })];
    expect(resolverEnCatalogo(af, catalogo)?.medio_id).toBe('MED-0187');
  });

  it('devuelve null si no está en el catálogo', () => {
    const trafico = MERY_PRIORITY_MEDIOS.find((m) => m.canonical === 'Tráfico ZMG')!;
    expect(resolverEnCatalogo(trafico, [fila({ medio_id: 'MED-0001', nombre_medio: 'Otro' })])).toBeNull();
  });
});

describe('clasificarMedio', () => {
  const siker = MERY_PRIORITY_MEDIOS.find((m) => m.canonical === 'Siker')!;

  it('CAPTURAR cuando está en catálogo, activo y con RSS', () => {
    const r = clasificarMedio(siker, [fila({ medio_id: 'MED-0203', nombre_medio: 'Siker' })], SIN_CRON);
    expect(r.accion).toBe('CAPTURAR');
    expect(r.medio_id).toBe('MED-0203');
    expect(r.en_catalogo).toBe(true);
    expect(r.activo).toBe(true);
  });

  it('AGREGAR_A_CATALOGO cuando no existe en Supabase', () => {
    const r = clasificarMedio(siker, [], SIN_CRON);
    expect(r.accion).toBe('AGREGAR_A_CATALOGO');
    expect(r.medio_id).toBeNull();
    expect(r.en_catalogo).toBe(false);
  });

  it('ACTIVAR_EN_CATALOGO cuando activo=false', () => {
    const r = clasificarMedio(
      siker,
      [fila({ medio_id: 'MED-0203', nombre_medio: 'Siker', activo: false })],
      SIN_CRON,
    );
    expect(r.accion).toBe('ACTIVAR_EN_CATALOGO');
  });

  it('NECESITA_DIRECT_EXTRACTOR cuando requiere JS o proxy', () => {
    const js = clasificarMedio(
      siker,
      [fila({ medio_id: 'MED-0203', nombre_medio: 'Siker', requiere_javascript: true })],
      SIN_CRON,
    );
    expect(js.accion).toBe('NECESITA_DIRECT_EXTRACTOR');

    const proxy = clasificarMedio(
      siker,
      [fila({ medio_id: 'MED-0203', nombre_medio: 'Siker', requiere_proxy: true })],
      SIN_CRON,
    );
    expect(proxy.accion).toBe('NECESITA_DIRECT_EXTRACTOR');
  });

  it('NO_VIABLE cuando no hay rss ni sitemap ni método DIRECT', () => {
    const r = clasificarMedio(
      siker,
      [fila({ medio_id: 'MED-0203', nombre_medio: 'Siker', rss_url: null, sitemap_url: null, metodo_extraccion: 'RSS' })],
      SIN_CRON,
    );
    expect(r.accion).toBe('NO_VIABLE');
  });

  it('acepta método DIRECT sin rss ni sitemap', () => {
    const r = clasificarMedio(
      siker,
      [fila({ medio_id: 'MED-0203', nombre_medio: 'Siker', rss_url: null, sitemap_url: null, metodo_extraccion: 'DIRECT' })],
      SIN_CRON,
    );
    expect(r.accion).toBe('CAPTURAR');
  });

  it('refleja si el medio ya está en algún cron', () => {
    const r = clasificarMedio(
      siker,
      [fila({ medio_id: 'MED-0203', nombre_medio: 'Siker' })],
      new Set(['MED-0203']),
    );
    expect(r.en_cron).toBe(true);
  });
});

describe('parseArgs', () => {
  it('valores por defecto', () => {
    expect(parseArgs([])).toEqual({ dryRun: false, maxNotas: 20, enrichLimit: 50 });
  });

  it('lee --dry-run, --max-notas y --enrich-limit', () => {
    expect(parseArgs(['--dry-run', '--max-notas=5', '--enrich-limit=10'])).toEqual({
      dryRun: true,
      maxNotas: 5,
      enrichLimit: 10,
    });
  });

  it('ignora valores no numéricos y conserva el default', () => {
    expect(parseArgs(['--max-notas=abc']).maxNotas).toBe(20);
  });
});
