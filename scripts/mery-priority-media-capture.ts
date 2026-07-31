/**
 * Captura de medios prioritarios Mery Pozos.
 *
 * Wrapper que invoca crawl + enrich SOLO sobre los medios Jalisco priority
 * (MED-0201 a MED-0204, más los ACTIVAR_EN_CRON una vez confirmados).
 *
 * Nota: para los medios ACTIVAR_EN_CRON (UDG TV, Notisistema, Tráfico ZMG,
 * Vallarta Independiente, Partidero), ejecutar primero:
 *   npm run catalog-mery-jalisco-priority -- --upsert --patch-shadowmedia
 * para obtener sus IDs y agregarlos a MERY_JALISCO_CRON_IDS.
 *
 * Reporte: medio, capturadas, duplicadas, texto_ok, errores.
 *
 * NO activa envíos. NO modifica alertas_activas. Read-only para Mery.
 *
 * Uso:
 *   npm run mery:priority-media:capture -- --dry-run --max-notas=20
 *   npm run mery:priority-media:capture -- --max-notas=20
 */
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { logger } from '../src/utils/logger.js';
import { parseIntOrNull } from '../src/utils/parse.js';

/** IDs de los 4 medios nuevos Jalisco (siempre presentes tras catalog-mery-jalisco-priority --upsert). */
const MERY_JALISCO_NEW_IDS = ['MED-0201', 'MED-0202', 'MED-0203', 'MED-0204'] as const;

/**
 * IDs de medios ACTIVAR_EN_CRON (ya en Supabase).
 * Completar ejecutando:
 *   npm run catalog-mery-jalisco-priority -- --dry-run
 * y pegando los IDs descubiertos aquí.
 */
const MERY_JALISCO_ACTIVAR_IDS: string[] = [
  // Se completan tras ejecutar catalog-mery-jalisco-priority --dry-run
  // Ejemplos (sustituir por IDs reales de Supabase):
  // 'MED-XXXX', // UDG TV / Canal 44
  // 'MED-XXXX', // Notisistema
  // 'MED-XXXX', // Tráfico ZMG
  // 'MED-XXXX', // Vallarta Independiente
  // 'MED-XXXX', // Partidero
];

export function getCaptureIds(): string[] {
  return [...new Set([...MERY_JALISCO_NEW_IDS, ...MERY_JALISCO_ACTIVAR_IDS])];
}

interface CaptureArgs {
  dryRun: boolean;
  maxNotas: number;
  enrichLimit: number;
}

export function parseArgs(argv: string[]): CaptureArgs {
  const out: CaptureArgs = { dryRun: false, maxNotas: 20, enrichLimit: 50 };
  for (const arg of argv) {
    if (arg === '--dry-run') { out.dryRun = true; continue; }
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    const key = eq === -1 ? body : body.slice(0, eq);
    const val = eq === -1 ? '' : body.slice(eq + 1);
    if (key === 'max-notas') out.maxNotas = parseIntOrNull(val) ?? out.maxNotas;
    if (key === 'enrich-limit') out.enrichLimit = parseIntOrNull(val) ?? out.enrichLimit;
  }
  return out;
}

function spawnAsync(cmd: string, args: string[]): Promise<{ code: number }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: true });
    child.on('close', (code) => resolve({ code: code ?? 1 }));
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const ids = getCaptureIds();

  if (ids.length === 0) {
    logger.error({}, 'Sin medio_ids configurados. Ejecutar catalog-mery-jalisco-priority primero.');
    process.exit(1);
  }

  logger.info({ ids, dryRun: args.dryRun, maxNotas: args.maxNotas }, '=== Mery Priority Media Capture ===');

  if (args.dryRun) {
    logger.info({ ids, maxNotas: args.maxNotas }, 'DRY-RUN: se capturarían estos medios');
    return;
  }

  const medioIdsArg = `--medio-ids=${ids.join(',')}`;

  // ── Crawl ─────────────────────────────────────────────────────────────────
  logger.info({ ids }, '[1] Crawl de medios prioritarios…');
  const crawlResult = await spawnAsync('npx', [
    'tsx', 'scripts/crawl.ts',
    medioIdsArg,
    `--max-notas=${args.maxNotas}`,
    '--no-export-results',
    '--no-generate-xml',
  ]);
  if (crawlResult.code !== 0) {
    logger.error({ code: crawlResult.code }, 'Crawl falló — abortando');
    process.exit(crawlResult.code);
  }

  // ── Enrich ────────────────────────────────────────────────────────────────
  logger.info({ ids }, '[2] Enrich de notas capturadas…');
  const enrichResult = await spawnAsync('npx', [
    'tsx', 'scripts/enrich-news.ts',
    medioIdsArg,
    `--limit=${args.enrichLimit}`,
  ]);
  if (enrichResult.code !== 0) {
    logger.warn({ code: enrichResult.code }, 'Enrich finalizó con código distinto de 0');
  }

  logger.info({ ids }, '=== Mery Priority Media Capture completado ===');
}

function esEntrypointCli(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (esEntrypointCli()) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

export { main };
