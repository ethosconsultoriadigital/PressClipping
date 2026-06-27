/**
 * Scheduler en MODO SOMBRA (no producción).
 *
 * Orquesta una ventana móvil del ciclo Ethos vs PressClipping acumulando
 * histórico orgánico y comparativo, SIN entregar nada al cliente. Es un wrapper
 * delgado sobre `run-live-comparison.ts` que:
 *
 *   1. Calcula una ventana móvil (por default 48h terminando "ahora" MX).
 *   2. Resuelve la lista curada de medios estables (SHADOW_MEDIOS).
 *   3. Fuerza modo sombra: --shadow --no-export-results.
 *   4. Bloquea por código cualquier flag que intente habilitar acciones de
 *      producción (export-results, alertas, generate-xml, classify-ia, etc.).
 *
 * Permitido en sombra:
 *   import XML · crawl dirigido · enrich · detect real (inserta menciones DB) ·
 *   compare/live-comparison · escribir 05_Comparativo_PressClipping ·
 *   append en 07_Metricas_Live (modo=shadow).
 *
 * NO permitido (impuesto por código):
 *   export-results (02_Menciones/04_Logs) · generate-xml · classify-ia ·
 *   alertas · WhatsApp/correos · export-raw-news · tocar 01_Noticias_Raw.
 *
 * Uso:
 *   npm run shadow-scheduler -- --window-hours=48 --crawl-limit=50 \
 *     --output=sheet --append-metrics-history \
 *     --no-alerts --no-export-results --no-generate-xml
 */
import { spawn } from 'node:child_process';
import { logger } from '../src/utils/logger.js';
import { verificarFlagsSombra } from '../src/utils/shadowGuard.js';
import { ventanaMovil } from '../src/utils/dateWindow.js';

/** XML PressClipping de producción (solo lectura del feed; nunca se genera XML). */
const DEFAULT_XML_URL = 'https://tabla.ethosconsultoriadigital.workers.dev/read-xml';

/**
 * Lista curada de medios ESTABLES y ya probados para el primer modo sombra.
 * No incluye Reforma (paywall), 24 Horas / El Siglo de Torreón (403),
 * ni medios DIRECT_EXTRACTION_ONLY / NO_FEED / BLOCKED / TIMEOUT.
 */
export const SHADOW_MEDIOS: string[] = [
  'MED-0001', // El Economista
  'MED-0017', // El Informador
  'MED-0145', // Forbes Mexico
  'MED-0148', // EdoMex Al Día
  'MED-0151', // Hospitalitas
  'MED-0152', // Xataka México
  'MED-0153', // Zócalo
  'MED-0154', // La Crónica de Hoy
  'MED-0155', // Vanguardia
  'MED-0156', // El Financiero
  'MED-0157', // El Heraldo de México
  'MED-0158', // El Sol de México
  'MED-0159', // Expansión
  'MED-0160', // El Diario de Chihuahua
  'MED-0161', // Amexi
  'MED-0162', // ContraRéplica
  'MED-0163', // Líder Empresarial
  'MED-0164', // Periódico Correo
  'MED-0165', // Notus Noticias
  'MED-0166', // Hidrocálido Digital
  'MED-0167', // Food And Pleasure
  'MED-0020', // El Imparcial
  'MED-0031', // Proceso
  'MED-0034', // La Razón
  'MED-0060', // Los Noticieristas
];

interface ShadowArgs {
  xmlUrl: string;
  windowHours: number;
  crawlLimit: number;
  medioIds: string;
  output: 'console' | 'sheet';
  appendMetricsHistory: boolean;
  dryRun: boolean;
}

function parseArgs(argv: string[]): ShadowArgs {
  const out: ShadowArgs = {
    xmlUrl: DEFAULT_XML_URL,
    windowHours: 48,
    crawlLimit: 50,
    medioIds: SHADOW_MEDIOS.join(','),
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
      case 'xml-url':        out.xmlUrl = val || out.xmlUrl; break;
      case 'window-hours':   out.windowHours = Number(val) || out.windowHours; break;
      case 'crawl-limit':    out.crawlLimit = Number(val) || out.crawlLimit; break;
      case 'medio-ids':      out.medioIds = val || out.medioIds; break;
      case 'output':         out.output = (val as 'console' | 'sheet') || out.output; break;
      case 'append-metrics-history': out.appendMetricsHistory = true; break;
      case 'dry-run':        out.dryRun = true; break;
      // Flags de confirmación de sombra (no habilitan nada; se aceptan tal cual).
      case 'no-alerts': case 'no-export-results': case 'no-generate-xml':
      case 'no-classify-ia': case 'no-whatsapp': case 'no-correos':
        break;
    }
  }
  return out;
}

function runChild(script: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const bin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const child = spawn(bin, ['tsx', script, ...args], {
      env: { ...process.env, LOG_FORMAT: process.env['LOG_FORMAT'] ?? 'json' },
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.on('error', reject);
    child.on('close', code => resolve(code ?? 0));
  });
}

async function main(): Promise<void> {
  const rawArgv = process.argv.slice(2);

  // ── Guarda dura de modo sombra ───────────────────────────────────────────
  const guarda = verificarFlagsSombra(rawArgv);
  if (!guarda.ok) {
    logger.error({ violacion: guarda.violacion }, guarda.mensaje ?? 'Flag prohibido en modo sombra.');
    process.exit(2);
  }

  const args = parseArgs(rawArgv);
  const { desde, hasta } = ventanaMovil(args.windowHours);

  logger.info(
    {
      modo: 'shadow',
      windowHours: args.windowHours,
      fechaDesde: desde,
      fechaHasta: hasta,
      crawlLimit: args.crawlLimit,
      medios: args.medioIds.split(',').length,
      output: args.output,
      appendMetricsHistory: args.appendMetricsHistory,
      dryRun: args.dryRun,
    },
    '=== Iniciando SHADOW SCHEDULER (no producción) ===',
  );

  const mediosCurados = args.medioIds.split(',').filter(Boolean).length;
  const liveArgs = [
    '--shadow',
    '--no-export-results',
    `--xml-url=${args.xmlUrl}`,
    `--fecha-desde=${desde}`,
    `--fecha-hasta=${hasta}`,
    `--crawl-medio-ids=${args.medioIds}`,
    `--crawl-limit=${args.crawlLimit}`,
    `--window-hours=${args.windowHours}`,
    `--medios-curados=${mediosCurados}`,
    `--output=${args.output}`,
    '--replace-window',
  ];
  if (args.appendMetricsHistory) liveArgs.push('--append-metrics-history');
  if (args.dryRun) liveArgs.push('--dry-run');

  const code = await runChild('scripts/run-live-comparison.ts', liveArgs);
  if (code !== 0) {
    logger.error({ code }, 'Shadow scheduler: el ciclo vivo terminó con error.');
    process.exit(code);
  }
  logger.info({ modo: 'shadow' }, '=== Shadow scheduler completado ===');
}

main().catch(err => {
  logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Error fatal en run-shadow-scheduler');
  process.exit(1);
});
