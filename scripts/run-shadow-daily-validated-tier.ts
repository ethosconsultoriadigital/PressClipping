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
 * Dedupe estructural: usa `mediosDailyNetNew(shard)`, que para el shard A
 * excluye cualquier medio ya cubierto por otro cron. Shard default: A
 * (backward compatible). `--shard=B` corre el segundo shard. `--shard=C` corre
 * el tercer shard (C1, manual). Shard inválido: exit 2, sin writes.
 *
 * Uso:
 *   npm run shadow-daily-validated-tier -- --window-hours=48 --max-notas=30 \
 *     --output=sheet --append-metrics-history --no-export-results \
 *     --no-generate-xml --no-send --no-whatsapp --no-email
 *   npm run shadow-daily-validated-tier -- --shard=B --window-hours=48
 *   npm run shadow-daily-validated-tier -- --dry-run
 */
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { logger } from '../src/utils/logger.js';
import { verificarFlagsSombra } from '../src/utils/shadowGuard.js';
import { ventanaMovil } from '../src/utils/dateWindow.js';
import {
  mediosDailyNetNew,
  mediosDailyValidatedActivos,
  parseDailyValidatedShard,
  describirSolapeDailyShard,
  type DailyValidatedShard,
  type ShadowMedioDaily,
} from '../src/config/shadowMedia.js';
import { evaluarGateDaily } from '../src/matching/shadowDailyGate.js';
import { mergeOutputRowsByKey } from '../src/sheets/write.js';
import { OUTPUT_TABS } from '../src/sheets/client.js';
import {
  drainHabilitado,
  resolverJobStart,
  resolverTimeBudget,
  calcularDeadlineDrain,
  resolverOpcionesDrain,
} from '../src/config/enrichDrainConfig.js';
import type { CronConfiguredMedio } from '../src/config/cronCatalogIntegrity.js';
import {
  preflightCronCatalogo,
  ejecutarPasoEnrich,
  etiquetaDecisionEnrich,
} from '../src/enrichers/drainRunner.js';
import { runEnrichDrain } from '../src/enrichers/enrichDrain.js';
import { crearProcesadorDeArticulos } from '../src/enrichers/drainArticle.js';
import {
  articleEnrichBloqueado,
  particionarMediosParaEnrich,
} from '../src/config/cloudEnrichExclusions.js';
import {
  getCatalogoMediosPorIds,
  getNoticiasDrainPage,
  updateNoticiaDrain,
} from '../src/supabase/repositories.js';

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
  /**
   * Inicio real del JOB (ISO), no del script: el workflow lo registra antes
   * del setup pesado. Solo lo usa el deadline del drain.
   */
  jobStartedAt: string | null;
  /**
   * Valor crudo de `--shard`. `undefined` = flag ausente (default A).
   * Vacío u otro valor lo rechaza `parseDailyValidatedShard`.
   */
  shardRaw: string | undefined;
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
    jobStartedAt: null,
    shardRaw: undefined,
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
      case 'job-started-at': out.jobStartedAt = val || null; break;
      case 'shard': out.shardRaw = val; break;
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

/**
 * UNA sesión de drain, en ESTE proceso. No hay procesos hijos: el estado de la
 * sesión (attempted_this_run, cursores, fairness) solo tiene sentido si vive
 * en una sola memoria.
 */
async function ejecutarDrain(
  medioIds: readonly string[],
  jobStartedAt: string | null,
  shard: DailyValidatedShard,
) {
  const ahora = new Date();
  const jobStart = resolverJobStart({ explicito: jobStartedAt, now: ahora });
  const budget = resolverTimeBudget();
  const deadline = calcularDeadlineDrain({ jobStart: jobStart.at, now: ahora, budget });
  const opciones = resolverOpcionesDrain({ deadline, medioIds });

  logger.info(
    {
      job_start: jobStart.at.toISOString(),
      job_start_source: jobStart.source,
      deadline: deadline.toISOString(),
      budget,
      page_size: opciones.pageSize,
      fresh_share: opciones.freshShare,
      shard,
    },
    'ENRICH DRAIN V1 activo: iniciando sesión única',
  );

  const processArticle = crearProcesadorDeArticulos();
  return runEnrichDrain(
    {
      fetchPage: getNoticiasDrainPage,
      processArticle,
      persist: updateNoticiaDrain,
      now: () => new Date(),
      // Un 403 de un medio bloqueado en cloud no se reprograma a ciegas:
      // queda BLOCKED_REVIEW para que no vuelva a gastar intentos cada ciclo.
      isEnvironmentBlocked: (medioId) => articleEnrichBloqueado(medioId),
    },
    opciones,
  );
}

function labelsDelShard(shard: DailyValidatedShard): {
  workflowLabel: string;
  tierLabel: string;
  ultimoLote: string;
  modo: string;
} {
  switch (shard) {
    case 'A':
      return {
        workflowLabel: 'shadow-daily-validated-tier',
        tierLabel: 'daily_validated',
        ultimoLote: 'daily-validated',
        modo: 'shadow_daily_validated',
      };
    case 'B':
      return {
        workflowLabel: 'shadow-daily-validated-tier-b',
        tierLabel: 'daily_validated',
        ultimoLote: 'daily-validated-b',
        modo: 'shadow_daily_validated_b',
      };
    case 'C':
      return {
        workflowLabel: 'shadow-daily-validated-tier-c',
        tierLabel: 'daily_validated',
        ultimoLote: 'daily-validated-c',
        modo: 'shadow_daily_validated_c',
      };
    default: {
      const _exhaustivo: never = shard;
      throw new Error(`Shard daily-validated no soportado: ${String(_exhaustivo)}`);
    }
  }
}

/** Actualiza 08 con la decisión del ciclo para los medios net-new (sin romper filas). */
async function actualizar08(
  medios: ShadowMedioDaily[],
  decision: string,
  fecha: string,
  shard: DailyValidatedShard,
): Promise<void> {
  const labels = labelsDelShard(shard);
  const updates = medios.map((m) => ({
    medio_id: m.medio_id,
    ultimo_lote: labels.ultimoLote,
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
      shard,
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
  const shardParse = parseDailyValidatedShard(args.shardRaw);
  if (!shardParse.ok) {
    logger.error(
      { shard: args.shardRaw },
      `Shard daily-validated inválido: "${args.shardRaw}". Usa --shard=A, --shard=B o --shard=C. Abortando sin escribir.`,
    );
    process.exit(2);
  }
  const shard = shardParse.shard;
  const labels = labelsDelShard(shard);

  const solape = describirSolapeDailyShard(shard);
  if (solape) {
    logger.error({ shard, solape }, `Overlap de shard daily-validated: ${solape}. Abortando sin escribir.`);
    process.exit(2);
  }

  // Dedupe estructural: solo medios net-new del shard (A filtra vs otros crons).
  const medios = mediosDailyNetNew(shard);
  if (medios.length === 0) {
    logger.error({ shard }, 'Tier daily-validated sin medios NET-NEW (todos ya cubiertos por otro cron). Abortando sin escribir.');
    process.exit(2);
  }
  const medioIds = medios.map((m) => m.medio_id).join(',');
  const maxNotas = Math.min(args.maxNotas, Math.max(...medios.map((m) => m.max_notas_shadow)));
  const fuentesForzadas = medios.filter((m) => m.fuente !== 'auto');
  const { desde, hasta } = ventanaMovil(args.windowHours);
  const FECHA = new Date().toISOString().slice(0, 10);

  logger.info(
    { modo: labels.modo, shard, medios: medios.map((m) => `${m.medio_id}:${m.nombre}`), medioIds,
      maxNotas, windowHours: args.windowHours, fechaDesde: desde, fechaHasta: hasta, dryRun: args.dryRun },
    '=== Iniciando SHADOW DAILY VALIDATED TIER (no producción) ===',
  );

  let decisionDetect = 'DRY_RUN';

  if (!args.dryRun) {
    // 0. Preflight cron→catálogo: todo medio configurado DEBE existir en
    // `medios`. Antes esto era un log informativo ("48 pedidos / 47 hallados")
    // y por eso MED-0204 sobrevivió semanas en el cron sin fila en DB.
    const configured: CronConfiguredMedio[] = mediosDailyValidatedActivos(shard).map((m) => ({
      medio_id: m.medio_id,
      tier: 'daily_validated',
      nombre: m.nombre,
    }));
    const preflight = await preflightCronCatalogo({
      cargarCatalogo: getCatalogoMediosPorIds,
      configured,
    });
    if (!preflight.ok) {
      logger.error(
        {
          shard,
          status: preflight.report.status,
          configurados: preflight.report.configured_count,
          catalogo: preflight.report.catalog_count,
          huerfanos: preflight.report.orphan_ids,
          error: preflight.report.error,
        },
        preflight.mensaje,
      );
      process.exit(preflight.exitCode ?? 2);
    }
    logger.info(
      {
        shard,
        configurados: preflight.report.configured_count,
        catalogo: preflight.report.catalog_count,
        inactivos: preflight.report.inactive_ids,
      },
      preflight.mensaje,
    );

    // 1. Crawl dirigido SOLO por medio_id del tier (fuente auto salvo forzada).
    const crawlArgs = [`--medio-ids=${medioIds}`, `--limit=${medios.length}`, `--max-notas=${maxNotas}`];
    // Si algún medio fuerza fuente específica y TODOS comparten la misma, se pasa.
    if (fuentesForzadas.length === medios.length && fuentesForzadas.length > 0) {
      const unica = new Set(fuentesForzadas.map((m) => m.fuente));
      if (unica.size === 1) crawlArgs.push(`--source=${[...unica][0]}`);
    }
    const crawl = await runStep('1. crawl dirigido', 'scripts/crawl.ts', crawlArgs);
    if (crawl.code !== 0) logger.warn({ shard, code: crawl.code }, 'Crawl daily terminó con código no-cero (continuamos).');

    // 2. Enrich AISLADO por medio (no toca backlog global). Una sola
    // invocación por corrida: legacy mientras ENRICH_DRAIN_V1 esté OFF, drain
    // acotado cuando se active.
    //
    // La captura (paso 1) usa la lista COMPLETA; el enrich excluye los medios
    // con article enrich bloqueado en este entorno (hoy: MED-0029 en cloud).
    const enrichMedios = particionarMediosParaEnrich(medios.map((m) => m.medio_id));
    if (enrichMedios.excluidos.length > 0) {
      logger.warn(
        { excluidos: enrichMedios.excluidos, captura: 'ACTIVA' },
        'Article enrich bloqueado en este entorno para algunos medios (su captura sigue activa).',
      );
    }
    const enrichMedioIds = enrichMedios.permitidos.join(',');
    const enrich = await ejecutarPasoEnrich({
      drainEnabled: drainHabilitado(),
      runLegacyEnrich: async () => {
        // --recent-first prioriza notas recientes (ver fix equivalente en
        // run-live-comparison.ts).
        const r = await runStep('2. enrich aislado', 'scripts/enrich-news.ts',
          [`--medio-ids=${enrichMedioIds}`, `--limit=${args.enrichLimit}`, '--recent-first', '--only-pending-mentions', '--only-missing-clean-text']);
        return { code: r.code };
      },
      runDrain: () => ejecutarDrain(enrichMedios.permitidos, args.jobStartedAt, shard),
    });
    logger.info(
      {
        shard,
        modo: enrich.modo,
        invocaciones: enrich.invocaciones,
        decision: etiquetaDecisionEnrich(enrich),
        continuar: enrich.continuar,
        degradado: enrich.degradado,
        motivo: enrich.motivo,
        drain: enrich.drain,
      },
      `2. enrich (${enrich.modo}) completado`,
    );
    if (!enrich.continuar) {
      // Un drain fatal NO puede convertirse en SHADOW_OK: se corta aquí, sin
      // detect ni comparativo.
      logger.error({ shard, motivo: enrich.motivo }, 'Enrich fatal: se detiene el pipeline downstream.');
      if (args.update08) await actualizar08(medios, etiquetaDecisionEnrich(enrich), FECHA, shard);
      process.exit(enrich.exitCode ?? 1);
    }
    if (enrich.degradado) {
      logger.warn({ shard, motivo: enrich.motivo }, 'Enrich degradado: queda deuda de texto para el próximo ciclo.');
    }

    // 3. Detect dry-run AISLADO (gate de seguridad).
    const dry = await runStep('3. detect dry-run aislado', 'scripts/detect-mentions.ts',
      [`--medio-ids=${medioIds}`, `--limit=${args.detectLimit}`, '--only-with-text', '--dry-run']);
    const sinTexto = findNum(dry.jsonLines, 'sinTexto');
    const potenciales = findNum(dry.jsonLines, 'menciones_potenciales') ?? 0;
    const gate = evaluarGateDaily({ detectCode: dry.code, sinTexto, potenciales });
    logger.info({ shard, sinTexto, potenciales, gate_pasa: gate.pasa, gate_motivo: gate.motivo }, 'Resultado del gate detect dry-run');

    // 4. Detect real AISLADO (solo si el gate pasa).
    if (gate.pasa) {
      const real = await runStep('4. detect real aislado', 'scripts/detect-mentions.ts',
        [`--medio-ids=${medioIds}`, `--limit=${args.detectLimit}`, '--only-with-text']);
      logger.info({ shard, menciones: findNum(real.jsonLines, 'menciones') ?? 0 }, 'Detect real aislado completado');
      decisionDetect = 'SHADOW_OK';
    } else {
      logger.warn({ shard, motivo: gate.motivo }, 'Gate NO pasa: se OMITE detect real y comparativo.');
      decisionDetect = 'SKIP_GATE_FAILED';
    }
  } else {
    logger.info({ shard }, 'Modo --dry-run: se omiten crawl/enrich/detect real.');
  }

  // 5. Comparativo 48h SOLO si el gate pasó (o dry-run de infraestructura).
  if (decisionDetect === 'SHADOW_OK' || args.dryRun) {
    const liveArgs = [
      '--shadow', '--no-export-results',
      `--xml-url=${args.xmlUrl}`,
      `--fecha-desde=${desde}`, `--fecha-hasta=${hasta}`,
      `--window-hours=${args.windowHours}`, `--medios-curados=${medios.length}`,
      `--output=${args.output}`, '--replace-window',
      '--workflow-label=' + labels.workflowLabel,
      '--tier-label=' + labels.tierLabel,
      `--notas-medios=${medioIds}`,
      '--fuente=auto',
      '--frecuencia=diaria',
    ];
    if (args.appendMetricsHistory) liveArgs.push('--append-metrics-history');
    if (args.dryRun) liveArgs.push('--dry-run');
    const comp = await runStep('5. live-comparison (import + compare + 07)', 'scripts/run-live-comparison.ts', liveArgs);
    if (comp.code !== 0) { logger.error({ shard, code: comp.code }, 'live-comparison terminó con error.'); process.exit(comp.code); }
  } else {
    logger.warn({ shard, decisionDetect }, 'Gate no pasó: se OMITE el comparativo (no se escribe 05/07 del ciclo).');
  }

  // 6. Update 08 con la decisión del ciclo (sin romper filas). No en dry-run.
  if (args.update08 && !args.dryRun) {
    await actualizar08(medios, decisionDetect, FECHA, shard);
  }

  logger.info({ modo: labels.modo, shard, decisionDetect }, '=== Shadow daily-validated tier completado ===');
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
