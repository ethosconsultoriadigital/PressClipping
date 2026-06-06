/**
 * Fase 5 — Exportación a Google Sheets.
 *
 * Vuelca a 06_Resultados las menciones aún no exportadas (vista operativa, NO
 * el histórico completo) y a 05_Logs los logs de ingesta pendientes. Marca lo
 * exportado para no duplicar filas en corridas sucesivas.
 *
 * Uso:  npm run export-results
 */
import { SHEET_TABS } from '../src/sheets/client.js';
import { appendRows, type OutRow } from '../src/sheets/write.js';
import {
  getConfigMap,
  getMencionesPendientesExport,
  markMencionesExportadas,
  getLogsPendientesExport,
  markLogsExportados,
} from '../src/supabase/repositories.js';
import { writeIngestaLog } from '../src/logs/ingestaLogger.js';
import { logger } from '../src/utils/logger.js';
import { parseIntOrNull } from '../src/utils/parse.js';

async function exportarMenciones(limit: number): Promise<number> {
  const menciones = await getMencionesPendientesExport(limit);
  if (menciones.length === 0) {
    logger.info('No hay menciones nuevas para exportar.');
    return 0;
  }

  const rows: OutRow[] = menciones.map((m) => ({
    mencion_id: m.mencion_id,
    noticia_id: m.noticia_id,
    fecha_publicacion: m.fecha_publicacion,
    fecha_captura: m.fecha_captura,
    cliente: m.cliente,
    keyword: m.keyword,
    medio: m.medio,
    estado: m.estado,
    region: m.region,
    titulo: m.titulo,
    url_original: m.url_original,
    resumen: m.resumen,
    texto_match: m.texto_match,
    sentimiento: m.sentimiento,
    relevancia: m.relevancia,
    tema: m.tema,
    subtema: m.subtema,
    requiere_alerta: m.requiere_alerta,
    estado_revision: m.estado_revision,
    exportado_xml: m.exportado_xml,
  }));

  const escritas = await appendRows(SHEET_TABS.RESULTADOS, rows);
  await markMencionesExportadas(menciones.map((m) => m.mencion_id));
  logger.info({ escritas }, 'Menciones exportadas a 06_Resultados');
  return escritas;
}

async function exportarLogs(limit: number): Promise<number> {
  const logs = await getLogsPendientesExport(limit);
  if (logs.length === 0) {
    logger.info('No hay logs nuevos para exportar.');
    return 0;
  }

  const rows: OutRow[] = logs.map((l) => ({
    fecha_hora: l.fecha_hora,
    fuente_id: l.fuente_id,
    medio_id: l.medio_id,
    accion: l.accion,
    nivel: l.nivel,
    mensaje: l.mensaje,
    urls_detectadas: l.urls_detectadas,
    notas_nuevas: l.notas_nuevas,
    duplicados: l.duplicados,
    errores: l.errores,
    duracion_ms: l.duracion_ms,
    ejecutado_por: l.ejecutado_por,
  }));

  const escritas = await appendRows(SHEET_TABS.LOGS, rows);
  await markLogsExportados(logs.map((l) => l.log_id));
  logger.info({ escritas }, 'Logs exportados a 05_Logs');
  return escritas;
}

async function main() {
  const started = Date.now();
  const config = await getConfigMap();
  const limitMenciones = parseIntOrNull(config['max_export_menciones']) ?? 1000;
  const limitLogs = parseIntOrNull(config['max_export_logs']) ?? 1000;

  const menciones = await exportarMenciones(limitMenciones);
  const logs = await exportarLogs(limitLogs);

  // Este log se exportará a 05_Logs en la SIGUIENTE corrida (ya marcamos los previos).
  await writeIngestaLog({
    accion: 'export_sheets',
    nivel: 'info',
    mensaje: `${menciones} menciones y ${logs} logs exportados`,
    notas_nuevas: menciones,
    duracion_ms: Date.now() - started,
  });

  logger.info({ menciones, logs }, 'Exportación a Sheets completada.');
}

main().catch((err) => {
  logger.error(err, 'Error fatal en export-results-to-sheets.');
  process.exit(1);
});
