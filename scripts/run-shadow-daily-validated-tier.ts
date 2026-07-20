/**
 * Cron sombra DAILY VALIDATED dedicado — no producción.
 *
 * Aísla TODO el pipeline por `medio_id` para el tier de medios validados
 * NET-NEW (no cubiertos por base/nacional B/crisis):
 *
 *   crawl dirigido  →  enrich aislado  →  detect dry-run (gate) →
 *   detect real (solo si gate pasa)  →  live-comparison 48h (import XML +
 *   compare + append 07)  →  update 08_Cobertura_Medios del ciclo.
 *
 * Fuerza modo sombra por código y bloquea flags de producción (export-results,
 * generate-xml, classify-ia, export-raw-news, envíos). NO toca 01/02/04. NO
 * procesa backlog global (todo va acotado por --medio-ids). NUNCA envía
 * WhatsApp/correo ni llama Twilio/Gmail/SMTP.
 *
 * Dedupe estructural: usa `mediosDailyNetNew()`, que excluye cualquier medio ya
 * cubierto por otro cron. Si no hay medios net-new, ABORTA (exit 2) sin escribir.
 *
 * Uso:
 *   npm run shadow-daily-validated-tier -- --window-hours=48 --max-notas=30 \
 *     --output=sheet --append-metrics-history --no-export-results \
 *     --no-generate-xml --no-send --no-whatsapp --no-email
 *   npm run shadow-daily-validated-tier -- --dry-run
 */
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { logger } from '../src/utils/logger.js';
import { verificarFlagsSombra } from '../src/utils/shadowGuard.js';
import { ventanaMovil } from '../src/utils/dateWindow.js';
import { mediosDailyNetNew, type ShadowMedioDaily } from '../src/config/shadowMedia.js';
import { evaluarGateDaily } from '../src/matching/shadowDailyGate.js';
import { mergeOutputRowsByKey } from '../src/sheets/write.js';
import { OUTPUT_TABS } from '../src/sheets/client.js';

const DEFAULT_XML_URL = 'https://tabla.ethosconsultoriadigital.workers.dev/read-xml';

interface DailyArgs {
  xmlUrl: string;
  windowHours: number;
  maxNotas: number;
  enrichLimit: number;
  detectLimit: number;
  output: 'console' | 'sheet';
  appendMetricsHistory: boolean;
  dryRun: boolean;
  /** Actualiza 08_Cobertura_Medios con el resultado del ciclo (default true). */
  update08: boolean;
}

function parseArgs(argv: string[]): DailyArgs {
  const out: DailyArgs = {
    xmlUrl: DEFAULT_XML_URL,
    windowHours: 48,
    maxNotas: 30,
    // Subido de 200 a 500 (2026-07-20, ETHOS 200 MEDIA NEWS LAKE segunda expansión):
    // el tier creció de 11 a 21 medios (hasta ~30 notas/medio = ~630 notas/ciclo
    // posibles); un cupo de 200 compartido dejaba la mayoría de los 10 medios
    // nuevos sin enriquecer en su primer ciclo real (confirmado en vivo: Alto
    // Nivel/Bloomberg/DPL News/Contralínea en 0% texto tras el primer crawl).
    enrichLimit: 500,
    detectLimit: 300,
    output: 'sheet',
    appendMetricsHistory: false,
    dryRun: false,
    update08: true,
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
      case 'max-notas': out.maxNotas = Number(val) || out.maxNotas; break;
      case 'enrich-limit': out.enrichLimit = Number(val) || out.enrichLimit; break;
      case 'detect-limit': out.detectLimit = Number(val) || out.detectLimit; break;
      case 'output': out.output = (val as 'console' | 'sheet') || out.output; break;
      case 'append-metrics-history': out.appendMetricsHistory = true; break;
      case 'dry-run': out.dryRun = true; break;
      case 'no-update-08': out.update08 = false; break;
      // Confirmaciones de seguridad (no habilitan nada):
      case 'no-alerts': case 'no-export-results': case 'no-generate-xml':
      case 'no-classify-ia': case 'no-export-raw-news': case 'no-whatsapp': case 'no-correos':
      case 'no-send': case 'no-email': case 'no-twilio': case 'no-gmail': case 'no-smtp':
        break;
    }
  }
  return out;
}

interface StepResult { code: number; jsonLines: Record<string, unknown>[]; }

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
    const handle = (chunk: Buffer, isErr: boolean): void => {
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

/** Actualiza 08 con la decisión del ciclo para los medios net-new (sin romper filas). */
async function actualizar08(
  medios: ShadowMedioDaily[],
  decision: string,
  fecha: string,
): Promise<void> {
  const updates = medios.map((m) => ({
    medio_id: m.medio_id,
    ultimo_lote: 'daily-validated',
    fecha_ultimo_lote: fecha,
    decision_detect: decision,
    recomendacion_cron: 'CANDIDATO_CRON_DIARIO_SHADOW',
  }));
  const resumen = await mergeOutputRowsByKey(
    OUTPUT_TABS.COBERTURA_MEDIOS,
    'medio_id',
    updates,
    ['ultimo_lote', 'fecha_ultimo_lote', 'decision_detect', 'recomendacion_cron'],
  );
  logger.info(
    {
      filas_antes: resumen.filas_antes,
      filas_despues: resumen.filas_despues,
      readback: resumen.readback_filas,
      mismatch: resumen.mismatch,
      filas_actualizadas: resumen.filas_actualizadas,
    },
    'Update 08_Cobertura_Medios (ciclo daily-validated) completado',
  );
}

async function main(): Promise<void> {
  const rawArgv = process.argv.slice(2);

  // Guarda dura: ningún flag puede habilitar producción/envíos.
  const guarda = verificarFlagsSombra(rawArgv);
  if (!guarda.ok) {
    logger.error({ violacion: guarda.violacion }, guarda.mensaje ?? 'Flag prohibido en modo sombra.');
    process.exit(2);
  }

  const args = parseArgs(rawArgv);

  // Dedupe estructural: solo medios net-new (no cubiertos por otro cron).
  const medios = mediosDailyNetNew();
  if (medios.length === 0) {
    logger.error({}, 'Tier daily-validated sin medios NET-NEW (todos ya cubiertos por otro cron). Abortando sin escribir.');
    process.exit(2);
  }
  const medioIds = medios.map((m) => m.medio_id).join(',');
  const maxNotas = Math.min(args.maxNotas, Math.max(...medios.map((m) => m.max_notas_shadow)));
  const fuentesForzadas = medios.filter((m) => m.fuente !== 'auto');
  const { desde, hasta } = ventanaMovil(args.windowHours);
  const FECHA = new Date().toISOString().slice(0, 10);

  logger.info(
    { modo: 'shadow_daily_validated', medios: medios.map((m) => `${m.medio_id}:${m.nombre}`), medioIds,
      maxNotas, windowHours: args.windowHours, fechaDesde: desde, fechaHasta: hasta, dryRun: args.dryRun },
    '=== Iniciando SHADOW DAILY VALIDATED TIER (no producción) ===',
  );

  let decisionDetect = 'DRY_RUN';

  if (!args.dryRun) {
    // 1. Crawl dirigido SOLO por medio_id del tier (fuente auto salvo forzada).
    const crawlArgs = [`--medio-ids=${medioIds}`, `--limit=${medios.length}`, `--max-notas=${maxNotas}`];
    // Si algún medio fuerza fuente específica y TODOS comparten la misma, se pasa.
    if (fuentesForzadas.length === medios.length && fuentesForzadas.length > 0) {
      const unica = new Set(fuentesForzadas.map((m) => m.fuente));
      if (unica.size === 1) crawlArgs.push(`--source=${[...unica][0]}`);
    }
    const crawl = await runStep('1. crawl dirigido', 'scripts/crawl.ts', crawlArgs);
    if (crawl.code !== 0) logger.warn({ code: crawl.code }, 'Crawl daily terminó con código no-cero (continuamos).');

    // 2. Enrich AISLADO por medio (no toca backlog global). --recent-first
    // prioriza notas recientes (ver fix equivalente en run-live-comparison.ts).
    await runStep('2. enrich aislado', 'scripts/enrich-news.ts',
      [`--medio-ids=${medioIds}`, `--limit=${args.enrichLimit}`, '--recent-first', '--only-pending-mentions', '--only-missing-clean-text']);

    // 3. Detect dry-run AISLADO (gate de seguridad).
    const dry = await runStep('3. detect dry-run aislado', 'scripts/detect-mentions.ts',
      [`--medio-ids=${medioIds}`, `--limit=${args.detectLimit}`, '--only-with-text', '--dry-run']);
    const sinTexto = findNum(dry.jsonLines, 'sinTexto');
    const potenciales = findNum(dry.jsonLines, 'menciones_potenciales') ?? 0;
    const gate = evaluarGateDaily({ detectCode: dry.code, sinTexto, potenciales });
    logger.info({ sinTexto, potenciales, gate_pasa: gate.pasa, gate_motivo: gate.motivo }, 'Resultado del gate detect dry-run');

    // 4. Detect real AISLADO (solo si el gate pasa).
    if (gate.pasa) {
      const real = await runStep('4. detect real aislado', 'scripts/detect-mentions.ts',
        [`--medio-ids=${medioIds}`, `--limit=${args.detectLimit}`, '--only-with-text']);
      logger.info({ menciones: findNum(real.jsonLines, 'menciones') ?? 0 }, 'Detect real aislado completado');
      decisionDetect = 'SHADOW_OK';
    } else {
      logger.warn({ motivo: gate.motivo }, 'Gate NO pasa: se OMITE detect real y comparativo.');
      decisionDetect = 'SKIP_GATE_FAILED';
    }
  } else {
    logger.info({}, 'Modo --dry-run: se omiten crawl/enrich/detect real.');
  }

  // 5. Comparativo 48h SOLO si el gate pasó (o dry-run de infraestructura).
  if (decisionDetect === 'SHADOW_OK' || args.dryRun) {
    const liveArgs = [
      '--shadow', '--no-export-results',
      `--xml-url=${args.xmlUrl}`,
      `--fecha-desde=${desde}`, `--fecha-hasta=${hasta}`,
      `--window-hours=${args.windowHours}`, `--medios-curados=${medios.length}`,
      `--output=${args.output}`, '--replace-window',
      '--workflow-label=shadow-daily-validated-tier',
      '--tier-label=daily_validated',
      `--notas-medios=${medioIds}`,
      '--fuente=auto',
      '--frecuencia=diaria',
    ];
    if (args.appendMetricsHistory) liveArgs.push('--append-metrics-history');
    if (args.dryRun) liveArgs.push('--dry-run');
    const comp = await runStep('5. live-comparison (import + compare + 07)', 'scripts/run-live-comparison.ts', liveArgs);
    if (comp.code !== 0) { logger.error({ code: comp.code }, 'live-comparison terminó con error.'); process.exit(comp.code); }
  } else {
    logger.warn({ decisionDetect }, 'Gate no pasó: se OMITE el comparativo (no se escribe 05/07 del ciclo).');
  }

  // 6. Update 08 con la decisión del ciclo (sin romper filas). No en dry-run.
  if (args.update08 && !args.dryRun) {
    await actualizar08(medios, decisionDetect, FECHA);
  }

  logger.info({ modo: 'shadow_daily_validated', decisionDetect }, '=== Shadow daily-validated tier completado ===');
}

export { main, actualizar08 };
export type { DailyArgs };
export { mediosDailyNetNew, type ShadowMedioDaily };

function esEntrypointCli(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (esEntrypointCli()) {
  main().catch((err) => {
    logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Error fatal en run-shadow-daily-validated-tier');
    process.exit(1);
  });
}
