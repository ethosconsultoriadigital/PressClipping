/**
 * Tests del orquestador general del news lake (crawl → enrich por chunks).
 *
 * Cubren: defaults de parseArgs, que --dry-run (default true) NUNCA invoque
 * subprocesos, que el modo real invoque crawl→enrich por cada chunk con los
 * flags correctos (--window-days, --recent-first, --only-missing-clean-text),
 * y que nunca aparezcan flags de Sheets/alertas/email/etc.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MedioRow } from '../src/supabase/repositories.js';

interface SpawnCall {
  cmd: string;
  args: string[];
}

const spawnCalls: SpawnCall[] = [];

function medio(over: Partial<MedioRow> & { medio_id: string }): MedioRow {
  return {
    nombre_medio: over.medio_id,
    url_base: 'https://example.com',
    metodo_extraccion: 'RSS',
    rss_url: 'https://example.com/feed/',
    sitemap_url: null,
    secciones_urls: null,
    requiere_javascript: false,
    requiere_proxy: false,
    frecuencia_minutos: null,
    pais: 'MX',
    estado: null,
    municipio: null,
    region: null,
    prioridad: null,
    ultimo_estado: 'ok',
    ultimo_scrapeo: null,
    ...over,
  };
}

/** 7 medios activos y sanos (sin JS/proxy/duplicado) → todos elegibles por default. */
const CATALOGO_7: MedioRow[] = Array.from({ length: 7 }, (_, i) =>
  medio({ medio_id: `MED-000${i + 1}` }),
);

let catalogoActual: MedioRow[] = CATALOGO_7;

vi.mock('../src/supabase/repositories.js', () => ({
  getMediosActivos: () => Promise.resolve(catalogoActual),
  getConfigMap: () => Promise.resolve({}),
}));

vi.mock('../src/validation/diagnosticosSheet.js', () => ({
  readDiagnosticosMedios: () => Promise.resolve(new Map()),
}));

/** Índice (0-based) del N-ésimo crawl que debe fallar, o null si ninguno falla. */
let crawlFailAtIndex: number | null = null;
let crawlCallCount = 0;

vi.mock('node:child_process', () => ({
  spawn: (cmd: string, args: string[]) => {
    spawnCalls.push({ cmd, args });
    let code = 0;
    if (args.includes('scripts/crawl.ts')) {
      const idx = crawlCallCount++;
      if (crawlFailAtIndex !== null && idx === crawlFailAtIndex) code = 1;
    }
    return {
      on: (event: string, cb: (code: number) => void) => {
        if (event === 'close') setImmediate(() => cb(code));
      },
    };
  },
}));

import { parseArgs, main } from '../scripts/news-lake-capture.js';

describe('parseArgs', () => {
  it('valores por defecto (dry-run=true, sin medio-ids)', () => {
    expect(parseArgs([])).toEqual({
      dryRun: true,
      maxMedios: 20,
      maxNotas: 5,
      enrichLimit: 20,
      windowDays: 30,
      chunkSize: 5,
    });
  });

  it('parseArgs([]) → dryRun: true (default seguro)', () => {
    expect(parseArgs([]).dryRun).toBe(true);
  });

  it('parseArgs(["--dry-run"]) → dryRun: true', () => {
    expect(parseArgs(['--dry-run']).dryRun).toBe(true);
  });

  it('parseArgs(["--dry-run=true"]) → dryRun: true', () => {
    expect(parseArgs(['--dry-run=true']).dryRun).toBe(true);
  });

  it('parseArgs(["--dry-run=false"]) → dryRun: false (modo real explícito)', () => {
    expect(parseArgs(['--dry-run=false']).dryRun).toBe(false);
  });

  it('parseArgs(["--no-dry-run"]) → dryRun: false (alias explícito)', () => {
    expect(parseArgs(['--no-dry-run']).dryRun).toBe(false);
  });

  it('--medio-ids sobrescribe la selección automática', () => {
    const args = parseArgs(['--medio-ids=MED-0001,MED-0002']);
    expect(args.medioIds).toEqual(['MED-0001', 'MED-0002']);
  });

  it('--max-medios se respeta', () => {
    expect(parseArgs(['--max-medios=3']).maxMedios).toBe(3);
  });

  it('--chunk-size se respeta', () => {
    expect(parseArgs(['--chunk-size=2']).chunkSize).toBe(2);
  });

  it('--max-notas, --enrich-limit y --window-days se respetan', () => {
    const args = parseArgs(['--max-notas=8', '--enrich-limit=40', '--window-days=15']);
    expect(args.maxNotas).toBe(8);
    expect(args.enrichLimit).toBe(40);
    expect(args.windowDays).toBe(15);
  });

  it('ignora valores no numéricos y conserva el default', () => {
    expect(parseArgs(['--max-medios=abc']).maxMedios).toBe(20);
  });
});

describe('main() — orquestación crawl → enrich por chunk', () => {
  const ORIGINAL_ARGV = process.argv;

  beforeEach(() => {
    spawnCalls.length = 0;
    catalogoActual = CATALOGO_7;
    crawlFailAtIndex = null;
    crawlCallCount = 0;
  });

  function conArgv(extra: string[], fn: () => Promise<void>): Promise<void> {
    process.argv = [...ORIGINAL_ARGV.slice(0, 2), ...extra];
    return fn().finally(() => {
      process.argv = ORIGINAL_ARGV;
    });
  }

  it('sin flags: dryRun=true (default) no invoca spawn', async () => {
    await conArgv([], async () => {
      await main();
    });
    expect(spawnCalls).toHaveLength(0);
  });

  it('--dry-run explícito tampoco invoca nada', async () => {
    await conArgv(['--dry-run', '--max-medios=7'], async () => {
      await main();
    });
    expect(spawnCalls).toHaveLength(0);
  });

  it('--dry-run=true explícito (como lo envía el workflow) tampoco invoca nada', async () => {
    await conArgv(['--dry-run=true', '--max-medios=7'], async () => {
      await main();
    });
    expect(spawnCalls).toHaveLength(0);
  });

  it('--dry-run=false (como lo envía el workflow en modo real) sí invoca crawl → enrich', async () => {
    await conArgv(['--dry-run=false', '--max-medios=4', '--chunk-size=4'], async () => {
      await main();
    });
    // 4 medios / chunk-size=4 → 1 chunk → 2 llamadas (crawl + enrich)
    expect(spawnCalls).toHaveLength(2);
    expect(spawnCalls[0]!.args).toContain('scripts/crawl.ts');
    expect(spawnCalls[1]!.args).toContain('scripts/enrich-news.ts');
  });

  it('modo real invoca crawl→enrich por cada chunk, con los flags correctos', async () => {
    await conArgv(
      ['--no-dry-run', '--max-medios=7', '--chunk-size=3', '--max-notas=5', '--enrich-limit=20', '--window-days=30'],
      async () => {
        await main();
      },
    );

    // 7 medios / chunk-size=3 → 3 chunks (3,3,1) → 6 llamadas (crawl+enrich por chunk).
    expect(spawnCalls).toHaveLength(6);

    const crawls = spawnCalls.filter((c) => c.args.includes('scripts/crawl.ts'));
    const enriches = spawnCalls.filter((c) => c.args.includes('scripts/enrich-news.ts'));
    expect(crawls).toHaveLength(3);
    expect(enriches).toHaveLength(3);

    for (const c of crawls) {
      expect(c.args.some((a) => a.startsWith('--medio-ids='))).toBe(true);
      expect(c.args).toContain('--max-notas=5');
    }
    for (const e of enriches) {
      expect(e.args.some((a) => a.startsWith('--medio-ids='))).toBe(true);
      expect(e.args).toContain('--limit=20');
      expect(e.args).toContain('--window-days=30');
      expect(e.args).toContain('--recent-first');
      expect(e.args).toContain('--only-missing-clean-text');
    }

    // Orden por chunk: crawl antes que enrich, y ambos comparten el mismo --medio-ids.
    for (let i = 0; i < 3; i++) {
      const crawl = spawnCalls[i * 2]!;
      const enrich = spawnCalls[i * 2 + 1]!;
      expect(crawl.args).toContain('scripts/crawl.ts');
      expect(enrich.args).toContain('scripts/enrich-news.ts');
      const crawlIds = crawl.args.find((a) => a.startsWith('--medio-ids='));
      const enrichIds = enrich.args.find((a) => a.startsWith('--medio-ids='));
      expect(crawlIds).toBe(enrichIds);
    }
  });

  it('--medio-ids dirigido ignora --max-medios y procesa solo esos', async () => {
    await conArgv(
      ['--no-dry-run', '--medio-ids=MED-0002,MED-0005', '--max-medios=1', '--chunk-size=5'],
      async () => {
        await main();
      },
    );
    expect(spawnCalls).toHaveLength(2); // 1 chunk → crawl + enrich
    const crawl = spawnCalls[0]!;
    expect(crawl.args).toContain('--medio-ids=MED-0002,MED-0005');
  });

  it('si un chunk falla en crawl, continúa con el siguiente chunk', async () => {
    crawlFailAtIndex = 0; // el crawl del primer chunk falla

    await conArgv(['--no-dry-run', '--max-medios=7', '--chunk-size=3'], async () => {
      await main();
    });

    // chunk 1: crawl falla → NO se llama enrich de ese chunk, pero sí se sigue con chunk 2 y 3.
    const crawls = spawnCalls.filter((c) => c.args.includes('scripts/crawl.ts'));
    const enriches = spawnCalls.filter((c) => c.args.includes('scripts/enrich-news.ts'));
    expect(crawls).toHaveLength(3);
    expect(enriches).toHaveLength(2);
  });

  it('nunca invoca Sheets, export-results, generate-xml, classify-ia, alertas, email/whatsapp/smtp/twilio, ni detect-mentions', async () => {
    await conArgv(['--no-dry-run', '--max-medios=7', '--chunk-size=3'], async () => {
      await main();
    });
    const todosLosArgs = spawnCalls.flatMap((c) => c.args).join(' ').toLowerCase();
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
      'detect-mentions',
    ]) {
      expect(todosLosArgs).not.toContain(prohibido);
    }
  });
});
