/**
 * Fase 4 — Detección de menciones (Control Plane scope V1).
 *
 * Detector GLOBAL: keywords activas de clientes activos del Control Plane.
 * Una noticia se evalúa una vez y se marca menciones_procesado (salvo --client).
 *
 *   npm run detect-mentions -- --limit=500 --only-with-text --fresh-lane --dry-run
 *   npm run detect-mentions -- --client=CLI-0001 --dry-run
 *
 * LIVE usa --fresh-lane (70% frescas / 30% backlog). Sin ese flag: oldest-first.
 */
import {
  getAllClientes,
  getConfigMap,
  getKeywordsActivas,
  getNoticiasPendientesConCola,
  insertMenciones,
  markNoticiasProcesadas,
} from '../src/supabase/repositories.js';
import { MentionQueueError, validateMentionQueueParams } from '../src/matching/mentionQueue.js';
import {
  MENTION_QUEUE_DEFAULTS,
  parseDetectArgs,
  runDetectMentions,
} from '../src/matching/detectMentionsCore.js';
import { writeIngestaLog } from '../src/logs/ingestaLogger.js';
import { logger } from '../src/utils/logger.js';
import { parseIntOrNull } from '../src/utils/parse.js';

async function main() {
  const args = parseDetectArgs(process.argv.slice(2));
  const started = Date.now();
  const config = await getConfigMap();
  const configLimit = parseIntOrNull(config['max_noticias_por_deteccion']) ?? 500;
  const limit = args.limit ?? configLimit;

  if (args.freshLane) {
    const freshHours = args.freshHours ?? MENTION_QUEUE_DEFAULTS.freshHours;
    const freshShare = args.freshShare ?? MENTION_QUEUE_DEFAULTS.freshShare;
    try {
      validateMentionQueueParams({ limit, freshHours, freshShare });
    } catch (err) {
      const msg = err instanceof MentionQueueError ? err.message : String(err);
      logger.error({ freshLane: true, limit, freshHours, freshShare, err: msg }, 'Fresh Lane: parámetros inválidos');
      process.exit(1);
    }
  }

  logger.info(
    {
      dryRun: args.dryRun,
      limit,
      onlyWithText: args.onlyWithText ?? false,
      clientIds: args.clientIds ?? null,
      freshLane: args.freshLane ?? false,
      freshHours: args.freshLane ? (args.freshHours ?? MENTION_QUEUE_DEFAULTS.freshHours) : null,
      freshShare: args.freshLane ? (args.freshShare ?? MENTION_QUEUE_DEFAULTS.freshShare) : null,
    },
    'Iniciando detección de menciones (control-plane scope)',
  );

  const result = await runDetectMentions(
    { ...args, limit },
    {
      getClientes: getAllClientes,
      getKeywordsActivas,
      getCola: getNoticiasPendientesConCola,
      insertMenciones,
      markNoticiasProcesadas,
    },
    limit,
  );

  logger.info(
    {
      clientes_activos: result.scope.detection_client_ids,
      keywords_activas: result.scope.detection_keywords.length,
      title_only_keywords: result.scope.title_only_keywords.length,
      noticias_candidatas: result.noticias,
      fresh_selected: result.fresh_selected,
      backlog_selected: result.backlog_selected,
      matches: result.matches,
      matches_by_client: result.matches_by_client,
      matches_by_keyword: result.matches_by_keyword,
      inserted: result.inserted,
      marked_processed: result.marked_processed,
      writes: result.writes,
      dry_run: result.dry_run,
      termination_reason: result.termination_reason,
    },
    result.dry_run ? '[dry-run] Detección — 0 writes' : 'Detección de menciones completada',
  );

  if (!args.dryRun && result.termination_reason !== 'INSERT_FAILED' && result.termination_reason !== 'NO_ACTIVE_CLIENTS' && result.termination_reason !== 'NO_ELIGIBLE_KEYWORDS') {
    await writeIngestaLog({
      accion: 'detect_mentions',
      nivel: 'info',
      mensaje: `${result.inserted} menciones de ${result.noticias} noticias analizadas`,
      urls_detectadas: result.noticias,
      notas_nuevas: result.inserted,
      duracion_ms: Date.now() - started,
    });
  }

  if (result.termination_reason === 'INSERT_FAILED') {
    logger.error(result, 'Inserción de menciones falló; no se marcaron noticias.');
    process.exit(1);
  }
}

main().catch((err) => {
  logger.error(err, 'Error fatal en detect-mentions.');
  process.exit(1);
});
