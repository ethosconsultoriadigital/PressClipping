/**
 * Fase 5 — Exportación a Google Sheets (base operativa de captura).
 *
 * Vuelca a `02_Menciones` las menciones aún no exportadas (vista operativa, NO
 * el histórico completo) y a `04_Logs` los logs de ingesta pendientes, en la
 * Sheet de SALIDA (GOOGLE_OUTPUT_SHEET_ID, o GOOGLE_SHEET_ID como fallback).
 * Marca lo exportado para no duplicar filas en corridas sucesivas.
 *
 * Uso histórico:
 *   npm run export-results
 *
 * Uso LIVE 48h (3 clientes):
 *   npm run export-results -- --mentions-only --clients=CLI-MERY-TEST,CLI-0001,CLI-0002 \
 *     --window-hours=48 --recent-first --limit=500 --dry-run
 */
import { OUTPUT_TABS } from '../src/sheets/client.js';
import {
  appendOutputRows,
  appendOutputRowsUniqueByKey,
  readOutputKeyIds,
} from '../src/sheets/write.js';
import { planUniqueAppendByKey } from '../src/sheets/uniqueAppendPlan.js';
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
import { pathToFileURL } from 'node:url';

export interface ExportResultsArgs {
  mentionsOnly: boolean;
  clients: string[] | null;
  windowHours: number | null;
  recentFirst: boolean;
  limit: number | null;
  dryRun: boolean;
}

export function parseExportResultsArgs(argv: string[]): ExportResultsArgs {
  const out: ExportResultsArgs = {
    mentionsOnly: false,
    clients: null,
    windowHours: null,
    recentFirst: false,
    limit: null,
    dryRun: false,
  };
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    const key = eq === -1 ? body : body.slice(0, eq);
    const val = eq === -1 ? '' : body.slice(eq + 1);
    switch (key) {
      case 'mentions-only':
        out.mentionsOnly = true;
        break;
      case 'clients':
        out.clients = val.split(',').map((s) => s.trim()).filter(Boolean);
        break;
      case 'window-hours':
        out.windowHours = Number(val) || null;
        break;
      case 'recent-first':
        out.recentFirst = true;
        break;
      case 'limit':
        out.limit = Number(val) || null;
        break;
      case 'dry-run':
        out.dryRun = true;
        break;
    }
  }
  return out;
}

async function exportarMenciones(
  limit: number,
  args: ExportResultsArgs,
): Promise<{ escritas: number; marcar: string[] }> {
  const since =
    args.windowHours != null
      ? new Date(Date.now() - args.windowHours * 3600e3).toISOString()
      : undefined;
  const menciones = await getMencionesPendientesExport({
    limit,
    clients: args.clients ?? undefined,
    since,
    recentFirst: args.recentFirst,
  });
  if (menciones.length === 0) {
    logger.info('No hay menciones nuevas para exportar.');
    return { escritas: 0, marcar: [] };
  }

  const rows = menciones.map(mencionToOutputRow);
  const peek = await readOutputKeyIds(OUTPUT_TABS.MENCIONES, 'mencion_id');
  const plan = planUniqueAppendByKey(peek.ids, rows, 'mencion_id');

  const byClient: Record<string, number> = {};
  for (const m of menciones) {
    const cid = m.cliente_id ?? '(sin_cliente)';
    byClient[cid] = (byClient[cid] ?? 0) + 1;
  }
  const created = menciones
    .map((m) => m.fecha_captura)
    .filter(Boolean)
    .sort();

  logger.info(
    {
      selected: menciones.length,
      unique_mencion_id: plan.selected_ids.length,
      already_in_sheet: plan.already_present_ids.length,
      would_append: plan.to_append.length,
      duplicates_in_batch: plan.duplicates_in_batch.length,
      preexisting_duplicate_ids: plan.preexisting_duplicate_ids,
      clients: byClient,
      oldest: created[0] ?? null,
      newest: created[created.length - 1] ?? null,
      sheet_rows: peek.filas,
      sheet_blank_ids: peek.blank,
      dry_run: args.dryRun,
    },
    args.dryRun ? '[dry-run] Plan export 02_Menciones' : 'Plan export 02_Menciones',
  );

  if (args.dryRun) {
    return { escritas: 0, marcar: [] };
  }

  const resumen = await appendOutputRowsUniqueByKey(OUTPUT_TABS.MENCIONES, rows, 'mencion_id');
  logger.info(
    {
      filas_antes: resumen.filas_antes,
      filas_despues: resumen.filas_despues,
      appended: resumen.appended,
      already_present: resumen.already_present,
      mismatch: resumen.mismatch,
      missing_ids: resumen.missing_ids,
      duplicate_ids_after: resumen.duplicate_ids_after,
      preexisting_duplicate_ids: resumen.preexisting_duplicate_ids,
    },
    'Append 02_Menciones (unique mencion_id) completado',
  );

  if (resumen.mismatch) {
    logger.error(
      { missing_ids: resumen.missing_ids },
      'Readback mismatch: NO se marca exportado_sheets.',
    );
    return { escritas: resumen.appended, marcar: [] };
  }

  const marcar = [...resumen.already_present_ids, ...resumen.appended_ids].filter(Boolean);
  if (marcar.length > 0) {
    await markMencionesExportadas(marcar);
  }
  logger.info({ escritas: resumen.appended, marcadas: marcar.length }, 'Menciones exportadas a 02_Menciones');
  return { escritas: resumen.appended, marcar };
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

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const started = Date.now();
  const args = parseExportResultsArgs(argv);
  const config = await getConfigMap();
  const limitMenciones = args.limit ?? parseIntOrNull(config['max_export_menciones']) ?? 1000;
  const limitLogs = parseIntOrNull(config['max_export_logs']) ?? 1000;

  const menciones = await exportarMenciones(limitMenciones, args);
  const logs = args.mentionsOnly || args.dryRun ? 0 : await exportarLogs(limitLogs);

  if (!args.dryRun) {
    await writeIngestaLog({
      accion: 'export_sheets',
      nivel: 'info',
      mensaje: `${menciones.escritas} menciones y ${logs} logs exportados`,
      notas_nuevas: menciones.escritas,
      duracion_ms: Date.now() - started,
    });
  }

  logger.info({ menciones: menciones.escritas, logs, dry_run: args.dryRun }, 'Exportación a Sheets completada.');
}

function esEntrypointCli(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (esEntrypointCli()) {
  main().catch((err) => {
    logger.error(err, 'Error fatal en export-results-to-sheets.');
    process.exit(1);
  });
}
