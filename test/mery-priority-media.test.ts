/**
 * Tests de la resolución de medios prioritarios de Mery Pozos.
 *
 * Cubren la regresión real: la lista estaba hardcodeada a MED-0201..MED-0204, así
 * que los 5 medios ACTIVAR_EN_CRON y AFmedios quedaban fuera de la captura.
 * También fijan que MURAL nunca se captura, y que el pipeline crawl+enrich+detect
 * (agregado para que mery-test-pressclipping deje de ver 0 menciones) solo toca
 * CLI-MERY-TEST, nunca Sheets/export-results/generate-xml/classify-ia/alertas.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

interface SpawnCall {
  cmd: string;
  args: string[];
}

const spawnCalls: SpawnCall[] = [];

/** Catálogo mínimo con un solo medio CAPTURABLE (Siker) para que main() avance. */
const CATALOGO_UN_CAPTURABLE = [
  {
    medio_id: 'MED-0203',
    nombre_medio: 'Siker',
    activo: true,
    metodo_extraccion: 'RSS',
    rss_url: 'https://example.com/feed/',
    sitemap_url: null,
    requiere_javascript: false,
    requiere_proxy: false,
    ultimo_estado: 'ok',
  },
];

vi.mock('../src/supabase/client.js', () => ({
  getSupabase: () => ({
    from: () => ({
      select: () => ({
        order: () => Promise.resolve({ data: CATALOGO_UN_CAPTURABLE, error: null }),
      }),
    }),
  }),
}));

vi.mock('../src/config/shadowMedia.js', () => ({
  mediosEnCualquierCron: () => new Set<string>(),
}));

vi.mock('node:child_process', () => ({
  spawn: (cmd: string, args: string[]) => {
    spawnCalls.push({ cmd, args });
    return {
      on: (event: string, cb: (code: number) => void) => {
        if (event === 'close') setImmediate(() => cb(0));
      },
    };
  },
}));

import {
  MERY_PRIORITY_MEDIOS,
  MERY_EXCLUIDOS,
  resolverEnCatalogo,
  clasificarMedio,
  parseArgs,
  main,
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
    expect(parseArgs([])).toEqual({
      dryRun: false,
      maxNotas: 20,
      enrichLimit: 50,
      detectLimit: 100,
      maxInserts: 50,
      onlyWithText: true,
    });
  });

  it('lee --dry-run, --max-notas y --enrich-limit', () => {
    expect(parseArgs(['--dry-run', '--max-notas=5', '--enrich-limit=10'])).toEqual({
      dryRun: true,
      maxNotas: 5,
      enrichLimit: 10,
      detectLimit: 100,
      maxInserts: 50,
      onlyWithText: true,
    });
  });

  it('ignora valores no numéricos y conserva el default', () => {
    expect(parseArgs(['--max-notas=abc']).maxNotas).toBe(20);
  });

  it('reconoce --detect-limit y --max-inserts', () => {
    const args = parseArgs(['--detect-limit=200', '--max-inserts=15']);
    expect(args.detectLimit).toBe(200);
    expect(args.maxInserts).toBe(15);
  });

  it('--only-with-text default true; se puede apagar con =false', () => {
    expect(parseArgs([]).onlyWithText).toBe(true);
    expect(parseArgs(['--only-with-text']).onlyWithText).toBe(true);
    expect(parseArgs(['--only-with-text=true']).onlyWithText).toBe(true);
    expect(parseArgs(['--only-with-text=false']).onlyWithText).toBe(false);
  });
});

describe('main() — pipeline crawl + enrich + detect (CLI-MERY-TEST)', () => {
  const ORIGINAL_ARGV = process.argv;

  beforeEach(() => {
    spawnCalls.length = 0;
  });

  function conArgv(extra: string[], fn: () => Promise<void>): Promise<void> {
    process.argv = [...ORIGINAL_ARGV.slice(0, 2), ...extra];
    return fn().finally(() => {
      process.argv = ORIGINAL_ARGV;
    });
  }

  it('--dry-run no invoca crawl, enrich ni detect-mentions', async () => {
    await conArgv(['--dry-run'], async () => {
      await main();
    });
    expect(spawnCalls).toHaveLength(0);
  });

  it('modo real invoca crawl, enrich y detect-mentions en orden, acotado a CLI-MERY-TEST', async () => {
    await conArgv(['--max-notas=5', '--enrich-limit=20', '--detect-limit=100', '--max-inserts=50'], async () => {
      await main();
    });

    expect(spawnCalls).toHaveLength(3);

    const [crawl, enrich, detect] = spawnCalls;
    expect(crawl!.args).toContain('scripts/crawl.ts');
    expect(crawl!.args).toContain('--medio-ids=MED-0203');
    expect(crawl!.args).toContain('--max-notas=5');

    expect(enrich!.args).toContain('scripts/enrich-news.ts');
    expect(enrich!.args).toContain('--medio-ids=MED-0203');
    expect(enrich!.args).toContain('--limit=20');

    expect(detect!.args).toContain('scripts/detect-mentions.ts');
    expect(detect!.args).toContain('--client=CLI-MERY-TEST');
    expect(detect!.args).toContain('--medio-ids=MED-0203');
    expect(detect!.args).toContain('--limit=100');
    expect(detect!.args).toContain('--max-inserts=50');
    expect(detect!.args).toContain('--only-with-text');
  });

  it('--only-with-text=false no agrega el flag a detect-mentions', async () => {
    await conArgv(['--only-with-text=false'], async () => {
      await main();
    });
    const detect = spawnCalls.find((c) => c.args.includes('scripts/detect-mentions.ts'))!;
    expect(detect.args).not.toContain('--only-with-text');
  });

  it('nunca invoca Sheets, export-results, generate-xml, classify-ia ni alertas', async () => {
    await conArgv(['--max-notas=5'], async () => {
      await main();
    });
    const todosLosArgs = spawnCalls.flatMap((c) => c.args).join(' ');
    for (const prohibido of [
      'export-results',
      'export-raw-news',
      'generate-xml',
      'classify-ia',
      'alertas_activas',
      'sheet',
      'email',
      'whatsapp',
      'smtp',
      'twilio',
    ]) {
      expect(todosLosArgs.toLowerCase()).not.toContain(prohibido);
    }
  });
});
