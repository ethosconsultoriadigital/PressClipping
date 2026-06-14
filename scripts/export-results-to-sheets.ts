/**
 * Fase 5 — Exportación a Google Sheets (base operativa de captura).
 *
 * Vuelca a `02_Menciones` las menciones aún no exportadas (vista operativa, NO
 * el histórico completo) y a `04_Logs` los logs de ingesta pendientes, en la
 * Sheet de SALIDA (GOOGLE_OUTPUT_SHEET_ID, o GOOGLE_SHEET_ID como fallback).
 * Marca lo exportado para no duplicar filas en corridas sucesivas.
 *
 * Uso:  npm run export-results
 */
import { OUTPUT_TABS } from '../src/sheets/client.js';
import { appendOutputRows } from '../src/sheets/write.js';
import {
  getConfigMap,
  getMencionesPendientesExport,
  markMencionesExportadas,
  getLogsPendientesExport,
  markLogsExportados,
} from '../src/supabase/repositories.js';
import { mencionToOutputRow, logToOutputRow } from '../src/exporters/sheetRows.js';
import { writeIngestaLog } from '../src/logs/ingestaLogger.js';
import { logger } from '../src/utils/logger.js';
import { parseIntOrNull } from '../src/utils/parse.js';

async function exportarMenciones(limit: number): Promise<number> {
  const menciones = await getMencionesPendientesExport(limit);
  if (menciones.length === 0) {
    logger.info('No hay menciones nuevas para exportar.');
    return 0;
  }

  const rows = menciones.map(mencionToOutputRow);
  const escritas = await appendOutputRows(OUTPUT_TABS.MENCIONES, rows);
  await markMencionesExportadas(menciones.map((m) => m.mencion_id));
  logger.info({ escritas }, 'Menciones exportadas a 02_Menciones');
  return escritas;
}

async function exportarLogs(limit: number): Promise<number> {
  const logs = await getLogsPendientesExport(limit);
  if (logs.length === 0) {
    logger.info('No hay logs nuevos para exportar.');
    return 0;
  }

  const rows = logs.map(logToOutputRow);
  const escritas = await appendOutputRows(OUTPUT_TABS.LOGS, rows);
  await markLogsExportados(logs.map((l) => l.log_id));
  logger.info({ escritas }, 'Logs exportados a 04_Logs');
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
