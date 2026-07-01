/**
 * Cron sombra CRISIS dedicado — no producción.
 *
 * Aísla TODO el pipeline por `medio_id` para el tier crisis (hoy solo
 * UNO MAS UNO, MED-0170), usando SITEMAP como fuente (el RSS pierde las notas
 * de crisis antes de crawlear):
 *
 *   crawl dirigido (--source=sitemap)  →  enrich aislado  →
 *   detect dry-run aislado (gate)      →  detect real aislado  →
 *   live-comparison 48h (import XML + compare + append 07).
 *
 * Fuerza modo sombra por código y bloquea flags de producción (export-results,
 * alertas, generate-xml, classify-ia, export-raw-news). NO toca 01/02/04. NO
 * procesa backlog global (todo va acotado por --medio-ids). NO integra alertas.
 *
 * Uso:
 *   npm run shadow-crisis-tier -- --window-hours=48 --output=sheet \
 *     --append-metrics-history --no-alerts --no-export-results --no-generate-xml
 *   npm run shadow-crisis-tier -- --dry-run
 */
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { logger } from '../src/utils/logger.js';
import { verificarFlagsSombra } from '../src/utils/shadowGuard.js';
import { ventanaMovil } from '../src/utils/dateWindow.js';
import { mediosCrisisActivos, type ShadowMedioCrisis } from '../src/config/shadowMedia.js';

const DEFAULT_XML_URL = 'https://tabla.ethosconsultoriadigital.workers.dev/read-xml';

interface CrisisArgs {
  xmlUrl: string;
  windowHours: number;
  enrichLimit: number;
  detectLimit: number;
  sitemapMaxSubs: number;
  output: 'console' | 'sheet';
  appendMetricsHistory: boolean;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CrisisArgs {
  const out: CrisisArgs = {
    xmlUrl: DEFAULT_XML_URL,
    windowHours: 48,
    enrichLimit: 250,
    detectLimit: 250,
    sitemapMaxSubs: 40,
    output: 'sheet',
    appendMetricsHistory: false,
    dryRun: false,
  };
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    const key = eq === -1 ? body : body.slice(0, eq);
    const val = eq === -1 ? '' : body.slice(eq + 1);
    switch (key) {
      case 'xml-url': out.xmlUrl = val || out.xmlUrl; break;
      case 'window-hours': out.windowHours = Number(val) || out.windowHours; break;
      case 'enrich-limit': out.enrichLimit = Number(val) || out.enrichLimit; break;
      case 'detect-limit': out.detectLimit = Number(val) || out.detectLimit; break;
      case 'sitemap-max-subs': out.sitemapMaxSubs = Number(val) || out.sitemapMaxSubs; break;
      case 'output': out.output = (val as 'console' | 'sheet') || out.output; break;
      case 'append-metrics-history': out.appendMetricsHistory = true; break;
      case 'dry-run': out.dryRun = true; break;
      // Confirmaciones de seguridad (no habilitan nada):
      case 'no-alerts': case 'no-export-results': case 'no-generate-xml':
      case 'no-classify-ia': case 'no-export-raw-news': case 'no-whatsapp': case 'no-correos':
        break;
    }
  }
  return out;
}

interface StepResult { code: number; jsonLines: Record<string, unknown>[]; }

/** Ejecuta un script tsx como subproceso, tee de salida y captura de logs JSON. */
function runStep(label: string, script: string, args: string[]): Promise<StepResult> {
  return new Promise((resolve, reject) => {
    const bin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    logger.info({ label, cmd: `npx tsx ${script} ${args.join(' ')}` }, `▶ ${label}`);
    const child = spawn(bin, ['tsx', script, ...args], {
      env: { ...process.env, LOG_FORMAT: process.env['LOG_FORMAT'] ?? 'json' },
      shell: process.platform === 'win32',
    });
    const jsonLines: Record<string, unknown>[] = [];
    let buf = '';
    const handle = (chunk: Buffer, isErr: boolean) => {
      const text = chunk.toString();
      if (isErr) process.stderr.write(text); else process.stdout.write(text);
      buf += text;
      let nl: number;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line.startsWith('{')) { try { jsonLines.push(JSON.parse(line)); } catch { /* no-op */ } }
      }
    };
    child.stdout.on('data', (c) => handle(c, false));
    child.stderr.on('data', (c) => handle(c, true));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 0, jsonLines }));
  });
}

function findNum(lines: Record<string, unknown>[], field: string): number | undefined {
  for (const l of lines) if (typeof l[field] === 'number') return l[field] as number;
  return undefined;
}

async function main(): Promise<void> {
  const rawArgv = process.argv.slice(2);

  // Guarda dura: ningún flag puede habilitar producción.
  const guarda = verificarFlagsSombra(rawArgv);
  if (!guarda.ok) {
    logger.error({ violacion: guarda.violacion }, guarda.mensaje ?? 'Flag prohibido en modo sombra.');
    process.exit(2);
  }

  const args = parseArgs(rawArgv);
  const medios = mediosCrisisActivos();
  if (medios.length === 0) { logger.error('Tier crisis sin medios activos.'); process.exit(2); }
  const medioIds = medios.map((m) => m.medio_id).join(',');
  const fuente = medios[0]?.fuente_preferida ?? 'sitemap';
  const frecuencia = medios[0]?.frecuencia_shadow ?? '6h';
  const maxNotas = Math.max(...medios.map((m) => m.max_notas_shadow));
  const { desde, hasta } = ventanaMovil(args.windowHours);

  logger.info(
    { modo: 'shadow_crisis', medios: medios.map((m) => `${m.medio_id}:${m.nombre}`), medioIds,
      fuente, frecuencia, maxNotas, windowHours: args.windowHours, fechaDesde: desde, fechaHasta: hasta, dryRun: args.dryRun },
    '=== Iniciando SHADOW CRISIS TIER (no producción) ===',
  );

  if (!args.dryRun) {
    // 1. Crawl dirigido SOLO por medio_id del tier, forzando SITEMAP.
    const crawl = await runStep('1. crawl dirigido sitemap (crisis)', 'scripts/crawl.ts',
      [`--medio-ids=${medioIds}`, `--limit=${medios.length}`, `--source=${fuente}`,
       `--max-notas=${maxNotas}`, `--sitemap-max-subs=${args.sitemapMaxSubs}`]);
    if (crawl.code !== 0) logger.warn({ code: crawl.code }, 'Crawl crisis terminó con código no-cero (continuamos).');

    // 2. Enrich AISLADO por medio (no toca backlog global).
    await runStep('2. enrich aislado', 'scripts/enrich-news.ts',
      [`--medio-ids=${medioIds}`, `--limit=${args.enrichLimit}`, '--only-pending-mentions', '--only-missing-clean-text']);

    // 3. Detect dry-run AISLADO (gate de seguridad).
    const dry = await runStep('3. detect dry-run aislado', 'scripts/detect-mentions.ts',
      [`--medio-ids=${medioIds}`, `--limit=${args.detectLimit}`, '--only-with-text', '--dry-run']);
    const sinTexto = findNum(dry.jsonLines, 'sinTexto');
    const potenciales = findNum(dry.jsonLines, 'menciones_potenciales') ?? 0;
    const limpio = dry.code === 0 && (sinTexto === undefined || sinTexto === 0);
    logger.info({ sinTexto, potenciales, limpio }, 'Resultado del gate detect dry-run');

    // 4. Detect real AISLADO (solo si el dry-run está limpio).
    if (limpio) {
      const real = await runStep('4. detect real aislado', 'scripts/detect-mentions.ts',
        [`--medio-ids=${medioIds}`, `--limit=${args.detectLimit}`, '--only-with-text']);
      logger.info({ menciones: findNum(real.jsonLines, 'menciones') ?? 0 }, 'Detect real aislado completado');
    } else {
      logger.warn({ sinTexto }, 'Dry-run NO limpio: se OMITE detect real (no se insertan menciones).');
    }
  } else {
    logger.info({}, 'Modo --dry-run: se omiten crawl/enrich/detect real.');
  }

  // 5. Comparativo 48h vía run-live-comparison SIN crawl (solo import XML + compare + 07).
  const liveArgs = [
    '--shadow', '--no-export-results',
    `--xml-url=${args.xmlUrl}`,
    `--fecha-desde=${desde}`, `--fecha-hasta=${hasta}`,
    `--window-hours=${args.windowHours}`, `--medios-curados=${medios.length}`,
    `--output=${args.output}`, '--replace-window',
    // Trazabilidad crisis en 07.notas (tokens sin espacios):
    '--workflow-label=shadow-crisis-tier',
    '--tier-label=crisis',
    `--notas-medios=${medioIds}`,
    `--fuente=${fuente}`,
    `--frecuencia=${frecuencia}`,
  ];
  if (args.appendMetricsHistory) liveArgs.push('--append-metrics-history');
  if (args.dryRun) liveArgs.push('--dry-run');

  const comp = await runStep('5. live-comparison (import + compare + 07)', 'scripts/run-live-comparison.ts', liveArgs);
  if (comp.code !== 0) { logger.error({ code: comp.code }, 'live-comparison terminó con error.'); process.exit(comp.code); }

  logger.info({ modo: 'shadow_crisis' }, '=== Shadow crisis tier completado ===');
}

export { main };
export type { CrisisArgs };
// Reexport para tests de configuración.
export { mediosCrisisActivos, type ShadowMedioCrisis };

function esEntrypointCli(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (esEntrypointCli()) {
  main().catch((err) => {
    logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Error fatal en run-shadow-crisis-tier');
    process.exit(1);
  });
}
