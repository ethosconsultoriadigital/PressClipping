/**
 * Tests del buscador ad-hoc de solo lectura sobre el news lake.
 *
 * Cubren: parseArgs (query/exact/contains/window-days/format/full-text),
 * fallback automático fts→ilike, precedencia query > exact > contains,
 * matching en memoria para --exact/--contains, y que nunca se invoque
 * ninguna función de escritura (el módulo mockeado de repositories solo
 * expone `getNoticiasEnVentana`, de solo lectura).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NoticiaLakeRow } from '../src/supabase/repositories.js';

interface Llamada {
  opts: any;
}

const llamadas: Llamada[] = [];
let ftsDebeFallar = false;
let filasSimuladas: NoticiaLakeRow[] = [];

vi.mock('../src/supabase/repositories.js', () => ({
  getNoticiasEnVentana: (opts: any) => {
    llamadas.push({ opts });
    if (opts?.textFilter?.modo === 'fts' && ftsDebeFallar) {
      return Promise.reject(new Error('fts no disponible (columna/índice)'));
    }
    return Promise.resolve(filasSimuladas);
  },
}));

import { parseArgs, buscarNewsLake, proyectarSalida } from '../scripts/search-news-lake.js';

function fila(over: Partial<NoticiaLakeRow> & { noticia_id: string }): NoticiaLakeRow {
  return {
    medio_id: 'MED-0001',
    medio_nombre: 'Medio de prueba',
    titulo: null,
    resumen: null,
    url_original: 'https://example.com/nota',
    fecha_publicacion: '2026-08-01T00:00:00.000Z',
    texto_extraido: null,
    texto_nota_limpia: null,
    texto_cuerpo_nota: null,
    ...over,
  };
}

describe('parseArgs', () => {
  it('valores por defecto', () => {
    expect(parseArgs([])).toEqual({
      windowDays: 30,
      limit: 20,
      format: 'table',
      fullText: true,
    });
  });

  it('lee --query, --exact y --contains', () => {
    expect(parseArgs(['--query=Mery Pozos']).query).toBe('Mery Pozos');
    expect(parseArgs(['--exact=Bacardí México']).exact).toBe('Bacardí México');
    expect(parseArgs(['--contains=Jumex']).contains).toBe('Jumex');
  });

  it('respeta comillas si vinieran incluidas en el token', () => {
    expect(parseArgs(['--query="SIAPA plomo mercurio"']).query).toBe('SIAPA plomo mercurio');
  });

  it('--window-days, --medio-ids y --limit', () => {
    const args = parseArgs(['--window-days=7', '--medio-ids=MED-0001,MED-0002', '--limit=50']);
    expect(args.windowDays).toBe(7);
    expect(args.medioIds).toEqual(['MED-0001', 'MED-0002']);
    expect(args.limit).toBe(50);
  });

  it('--format acepta solo table|json (default table)', () => {
    expect(parseArgs(['--format=json']).format).toBe('json');
    expect(parseArgs(['--format=otro']).format).toBe('table');
    expect(parseArgs([]).format).toBe('table');
  });

  it('--full-text=false apaga el full-text; sin flag queda true', () => {
    expect(parseArgs(['--full-text=false']).fullText).toBe(false);
    expect(parseArgs([]).fullText).toBe(true);
    expect(parseArgs(['--full-text']).fullText).toBe(true);
  });
});

describe('buscarNewsLake — estrategias', () => {
  beforeEach(() => {
    llamadas.length = 0;
    ftsDebeFallar = false;
    filasSimuladas = [];
  });

  it('--query con full-text OK usa fts y una sola llamada', async () => {
    filasSimuladas = [fila({ noticia_id: 'N1', titulo: 'Algo de Mery Pozos' })];
    const r = await buscarNewsLake(parseArgs(['--query=Mery Pozos']));
    expect(r.estrategia).toBe('fts');
    expect(r.ftsFallback).toBe(false);
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]!.opts.textFilter).toEqual({ modo: 'fts', query: 'Mery Pozos' });
    expect(r.rows).toHaveLength(1);
  });

  it('--query con fts fallando cae a ilike (fallback automático)', async () => {
    ftsDebeFallar = true;
    filasSimuladas = [fila({ noticia_id: 'N1' })];
    const r = await buscarNewsLake(parseArgs(['--query=Jumex']));
    expect(r.estrategia).toBe('ilike');
    expect(r.ftsFallback).toBe(true);
    expect(llamadas).toHaveLength(2);
    expect(llamadas[0]!.opts.textFilter.modo).toBe('fts');
    expect(llamadas[1]!.opts.textFilter).toEqual({ modo: 'ilike', term: 'Jumex' });
  });

  it('--full-text=false salta directo a ilike (no intenta fts)', async () => {
    const r = await buscarNewsLake(parseArgs(['--query=Jumex', '--full-text=false']));
    expect(r.estrategia).toBe('ilike');
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]!.opts.textFilter).toEqual({ modo: 'ilike', term: 'Jumex' });
  });

  it('--exact matchea frase exacta en memoria (límite de palabra)', async () => {
    filasSimuladas = [
      fila({ noticia_id: 'N1', titulo: 'Bacardí México anuncia inversión' }),
      fila({ noticia_id: 'N2', titulo: 'Bacardí Mexicano lanza producto' }), // NO debe matchear (frase distinta)
      fila({ noticia_id: 'N3', resumen: 'Nada relevante aquí' }),
    ];
    const r = await buscarNewsLake(parseArgs(['--exact=Bacardí México']));
    expect(r.estrategia).toBe('exact');
    // La query a Supabase no debe llevar textFilter: el match es en memoria.
    expect(llamadas[0]!.opts.textFilter).toBeUndefined();
    expect(r.rows.map((x) => x.noticia_id)).toEqual(['N1']);
  });

  it('--contains matchea substring en memoria', async () => {
    filasSimuladas = [
      fila({ noticia_id: 'N1', texto_cuerpo_nota: 'La empresa Jumex reportó...' }),
      fila({ noticia_id: 'N2', titulo: 'Sin relación' }),
    ];
    const r = await buscarNewsLake(parseArgs(['--contains=Jumex']));
    expect(r.estrategia).toBe('contains');
    expect(r.rows.map((x) => x.noticia_id)).toEqual(['N1']);
  });

  it('precedencia query > exact > contains cuando se combinan', async () => {
    filasSimuladas = [fila({ noticia_id: 'N1' })];
    const r = await buscarNewsLake(parseArgs(['--query=A', '--exact=B', '--contains=C']));
    expect(r.estrategia).toBe('fts');
    expect(llamadas[0]!.opts.textFilter).toEqual({ modo: 'fts', query: 'A' });
  });

  it('sin query/exact/contains: modo browse (más reciente de la ventana)', async () => {
    filasSimuladas = [fila({ noticia_id: 'N1' })];
    const r = await buscarNewsLake(parseArgs(['--window-days=30']));
    expect(r.estrategia).toBe('browse');
    expect(llamadas[0]!.opts.textFilter).toBeUndefined();
    expect(llamadas[0]!.opts.windowDays).toBe(30);
  });

  it('respeta --window-days=30 como default también en --exact (ventana de escaneo)', async () => {
    filasSimuladas = [];
    await buscarNewsLake(parseArgs(['--exact=Algo']));
    expect(llamadas[0]!.opts.windowDays).toBe(30);
  });
});

describe('proyectarSalida', () => {
  it('usa texto_cuerpo_nota ?? texto_nota_limpia ?? texto_extraido ?? resumen', () => {
    expect(proyectarSalida(fila({ noticia_id: 'N1', texto_cuerpo_nota: 'cuerpo', texto_nota_limpia: 'limpio', resumen: 'r' })).texto).toBe('cuerpo');
    expect(proyectarSalida(fila({ noticia_id: 'N2', texto_nota_limpia: 'limpio', resumen: 'r' })).texto).toBe('limpio');
    expect(proyectarSalida(fila({ noticia_id: 'N3', texto_extraido: 'extraido', resumen: 'r' })).texto).toBe('extraido');
    expect(proyectarSalida(fila({ noticia_id: 'N4', resumen: 'r' })).texto).toBe('r');
    expect(proyectarSalida(fila({ noticia_id: 'N5' })).texto).toBe('');
  });

  it('incluye todos los campos requeridos por el diseño', () => {
    const out = proyectarSalida(
      fila({ noticia_id: 'N1', titulo: 't', resumen: 'r', url_original: 'u', fecha_publicacion: 'f', medio_id: 'MED-0009', medio_nombre: 'M' }),
    );
    expect(out).toMatchObject({
      noticia_id: 'N1',
      titulo: 't',
      resumen: 'r',
      url_original: 'u',
      fecha_publicacion: 'f',
      medio_id: 'MED-0009',
      medio_nombre: 'M',
    });
  });
});

describe('el módulo no expone ni usa funciones de escritura', () => {
  it('el mock de repositories solo define getNoticiasEnVentana (solo lectura)', async () => {
    const mod = await import('../src/supabase/repositories.js');
    expect(Object.keys(mod)).toEqual(['getNoticiasEnVentana']);
  });
});
