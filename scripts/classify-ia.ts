/**
 * Fase 7 — Clasificación de menciones con IA (controlada).
 *
 * Controles de costo (todos verificables antes de gastar):
 *   - Gate duro: solo corre si usar_ia = TRUE en 04_Configuracion.
 *   - Solo procesa menciones pendientes (ia_procesado = false).
 *   - Límite por corrida (max_ia_por_corrida, default 50; override con --limit).
 *   - Opcional: solo clientes de prioridad_ia alta (ia_solo_prioridad_alta).
 *   - Modelo configurable (ia_modelo, default claude-haiku-4-5).
 *   - --dry-run: muestra cuántas se procesarían SIN llamar a la IA.
 *   - Registra tokens usados por corrida en logs_ingesta.
 *
 * Uso:
 *   npm run classify-ia
 *   npm run classify-ia -- --limit=10
 *   npm run classify-ia -- --dry-run
 */
import {
  getConfigMap,
  getMencionesParaIa,
  updateMencionIa,
  type MencionIaRow,
} from '../src/supabase/repositories.js';
import {
  classifyMencion,
  computeRequiereAlerta,
  type ClassifyInput,
} from '../src/ai/classifier.js';
import { MODELO_IA_DEFAULT } from '../src/ai/client.js';
import { writeIngestaLog } from '../src/logs/ingestaLogger.js';
import { logger } from '../src/utils/logger.js';
import { parseBool, parseIntOrNull } from '../src/utils/parse.js';

function parseArgs(argv: string[]): { limit?: number; dryRun: boolean } {
  let limit: number | undefined;
  let dryRun = false;
  for (const arg of argv) {
    const m = /^--limit=(\d+)$/.exec(arg);
    if (m) limit = Number.parseInt(m[1]!, 10);
    if (arg === '--dry-run') dryRun = true;
  }
  return { limit, dryRun };
}

function toInput(m: MencionIaRow): ClassifyInput {
  return {
    titulo: m.titulo,
    resumen: m.resumen,
    medio: m.medio,
    keyword: m.keyword,
    cliente: m.cliente,
    industria: m.industria,
    marcas: m.marcas,
    competidores: m.competidores,
    temas_sensibles: m.temas_sensibles,
  };
}

async function main() {
  const started = Date.now();
  const { limit: limitArg, dryRun } = parseArgs(process.argv.slice(2));
  const config = await getConfigMap();

  // Gate duro: la IA solo corre si está habilitada explícitamente.
  if (!parseBool(config['usar_ia'], false)) {
    logger.warn('usar_ia = false en 04_Configuracion: clasificación IA omitida (sin costo).');
    return;
  }

  const limit = limitArg ?? parseIntOrNull(config['max_ia_por_corrida']) ?? 50;
  const soloPrioridadAlta = parseBool(config['ia_solo_prioridad_alta'], false);
  const modelo = config['ia_modelo']?.trim() || MODELO_IA_DEFAULT;

  const menciones = await getMencionesParaIa(limit, soloPrioridadAlta);
  logger.info(
    { pendientes: menciones.length, limite: limit, modelo, soloPrioridadAlta, dryRun },
    'Iniciando clasificación con IA',
  );

  if (dryRun) {
    logger.info(`[dry-run] Se clasificarían ${menciones.length} mención(es) con "${modelo}". Sin llamadas a la IA.`);
    return;
  }

  let clasificadas = 0;
  let errores = 0;
  let inTokens = 0;
  let outTokens = 0;

  for (const m of menciones) {
    try {
      const { clasificacion, uso } = await classifyMencion(toInput(m), { modelo });
      inTokens += uso.input_tokens;
      outTokens += uso.output_tokens;

      await updateMencionIa(m.mencion_id, {
        sentimiento: clasificacion.sentimiento,
        relevancia_ia: clasificacion.relevancia,
        tema: clasificacion.tema,
        subtema: clasificacion.subtema,
        resumen_ia: clasificacion.resumen_ejecutivo,
        riesgo_reputacional: clasificacion.riesgo_reputacional,
        recomendacion_pr: clasificacion.recomendacion_pr,
        requiere_alerta: computeRequiereAlerta(clasificacion, m.alerta_keyword),
        ia_modelo: modelo,
      });
      clasificadas += 1;
      logger.info(
        { mencion_id: m.mencion_id, sentimiento: clasificacion.sentimiento, riesgo: clasificacion.riesgo_reputacional },
        `Clasificada (${m.cliente ?? 's/cliente'} · ${m.keyword ?? ''})`,
      );
    } catch (err) {
      errores += 1;
      const msg = err instanceof Error ? err.message : String(err);
      // No la marcamos procesada: se reintenta en la próxima corrida.
      logger.error({ mencion_id: m.mencion_id, err: msg }, 'Fallo al clasificar mención');
    }
  }

  await writeIngestaLog({
    accion: 'classify_ia',
    nivel: errores > 0 ? 'warn' : 'info',
    mensaje: `${clasificadas} clasificadas, ${errores} errores · modelo ${modelo} · tokens in=${inTokens} out=${outTokens}`,
    notas_nuevas: clasificadas,
    errores,
    duracion_ms: Date.now() - started,
  });

  logger.info(
    { clasificadas, errores, modelo, tokens: { in: inTokens, out: outTokens } },
    'Clasificación con IA completada.',
  );
}

main().catch((err) => {
  logger.error(err, 'Error fatal en classify-ia.');
  process.exit(1);
});
