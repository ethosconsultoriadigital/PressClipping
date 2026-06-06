/**
 * Fase 3 — Ingesta RSS / Sitemap.
 *
 * Lee los medios activos desde Supabase, los recorre (RSS → sitemap),
 * normaliza, deduplica por hash_url e inserta noticias nuevas en la base
 * histórica. Respeta `max_notas_por_medio_por_corrida` y `modo_mvp`, escribe
 * un log por medio y actualiza su estado de scraping.
 *
 * Uso:  npm run crawl
 */
import {
  getConfigMap,
  getMediosActivos,
  ingestNoticias,
  updateMedioEstado,
} from '../src/supabase/repositories.js';
import { crawlMedio } from '../src/crawlers/index.js';
import { writeIngestaLog } from '../src/logs/ingestaLogger.js';
import { logger } from '../src/utils/logger.js';
import { parseBool, parseIntOrNull } from '../src/utils/parse.js';

async function main() {
  const config = await getConfigMap();
  const modoMvp = parseBool(config['modo_mvp'], true);
  const maxNotas = parseIntOrNull(config['max_notas_por_medio_por_corrida']) ?? 25;

  const medios = await getMediosActivos();
  logger.info({ medios: medios.length, maxNotas, modoMvp }, 'Iniciando corrida de ingesta');

  let totalNuevas = 0;
  let totalDuplicados = 0;
  let totalErrores = 0;

  for (const medio of medios) {
    const started = Date.now();
    const result = await crawlMedio(medio, maxNotas);

    let insertadas = 0;
    let duplicados = 0;
    let estadoFinal = result.estado as string;
    let errorFinal = result.error;

    if (result.estado === 'ok' && result.items.length > 0) {
      try {
        const ingest = await ingestNoticias(result.items);
        insertadas = ingest.insertadas;
        duplicados = ingest.duplicados;
        totalNuevas += insertadas;
        totalDuplicados += duplicados;
      } catch (err) {
        estadoFinal = 'error';
        errorFinal = err instanceof Error ? err.message : String(err);
        totalErrores += 1;
      }
    } else if (result.estado === 'error') {
      totalErrores += 1;
    }

    await updateMedioEstado(medio.medio_id, estadoFinal, errorFinal);
    await writeIngestaLog({
      medio_id: medio.medio_id,
      fuente_id: result.fuente,
      accion: 'crawl',
      nivel: estadoFinal === 'error' ? 'error' : 'info',
      mensaje: `${estadoFinal} via ${result.fuente ?? 'n/a'}${errorFinal ? `: ${errorFinal}` : ''}`,
      urls_detectadas: result.urls_detectadas,
      notas_nuevas: insertadas,
      duplicados,
      errores: estadoFinal === 'error' ? 1 : 0,
      duracion_ms: Date.now() - started,
    });

    logger.info(
      { medio_id: medio.medio_id, estado: estadoFinal, insertadas, duplicados },
      `Medio procesado: ${medio.nombre_medio}`,
    );
  }

  logger.info(
    { totalNuevas, totalDuplicados, totalErrores },
    'Corrida de ingesta completada.',
  );
}

main().catch((err) => {
  logger.error(err, 'Error fatal en crawl.');
  process.exit(1);
});
