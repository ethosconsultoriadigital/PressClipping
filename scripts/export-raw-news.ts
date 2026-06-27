/**
 * Exportación RAW de noticias → 01_Noticias_Raw (base amplia de captura).
 *
 * Escribe TODAS las noticias recolectadas (tengan o no mención) en la Sheet de
 * SALIDA (GOOGLE_OUTPUT_SHEET_ID, o GOOGLE_SHEET_ID como fallback). Usa la
 * bandera `exportado_sheet_raw` para no duplicar entre corridas.
 *
 * Uso:
 *   npm run export-raw-news                       # solo no exportadas (default)
 *   npm run export-raw-news -- --limit=500        # tope de filas
 *   npm run export-raw-news -- --since=2026-06-01 # capturadas desde esa fecha
 *   npm run export-raw-news -- --only-new         # explícito: exportado_sheet_raw=false
 *   npm run export-raw-news -- --dry-run          # no escribe ni marca
 */
import { OUTPUT_TABS } from '../src/sheets/client.js';
import { appendOutputRows } from '../src/sheets/write.js';
import {
  getNoticiasParaExportRaw,
  markNoticiasExportadasRaw,
} from '../src/supabase/repositories.js';
import { exportRawNews, type ExportRawOpts } from '../src/exporters/rawNews.js';
import { writeIngestaLog } from '../src/logs/ingestaLogger.js';
import { logger } from '../src/utils/logger.js';
import { parseIntOrNull } from '../src/utils/parse.js';

function parseArgs(argv: string[]): ExportRawOpts {
  const out: ExportRawOpts = { onlyNew: true, dryRun: false };
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    const key = eq === -1 ? body : body.slice(0, eq);
    const value = eq === -1 ? '' : body.slice(eq + 1);

    switch (key) {
      case 'dry-run':
        out.dryRun = true;
        break;
      case 'only-new':
        out.onlyNew = true;
        break;
      case 'all':
        out.onlyNew = false;
        break;
      case 'limit':
        out.limit = parseIntOrNull(value) ?? undefined;
        break;
      case 'since':
        out.since = value || undefined;
        break;
      default:
        logger.warn({ flag: arg }, 'Flag desconocido ignorado');
    }
  }
  return out;
}

async function main() {
  const started = Date.now();
  const opts = parseArgs(process.argv.slice(2));
  logger.info({ ...opts }, 'Iniciando export-raw-news');

  const result = await exportRawNews(
    {
      fetchNoticias: getNoticiasParaExportRaw,
      appendRows: (rows) => appendOutputRows(OUTPUT_TABS.NOTICIAS_RAW, rows),
      markExportadas: markNoticiasExportadasRaw,
    },
    opts,
  );

  if (result.dryRun) {
    logger.info(
      { leidas: result.leidas },
      '[dry-run] Noticias que se exportarían a 01_Noticias_Raw (no se escribió ni marcó)',
    );
    return;
  }

  await writeIngestaLog({
    accion: 'export_raw_news',
    nivel: 'info',
    mensaje: `${result.escritas} noticias exportadas a 01_Noticias_Raw`,
    notas_nuevas: result.escritas,
    duracion_ms: Date.now() - started,
  });

  logger.info(
    { leidas: result.leidas, escritas: result.escritas, marcadas: result.marcadas },
    'Export raw de noticias completado.',
  );
}

main().catch((err) => {
  logger.error(err, 'Error fatal en export-raw-news.');
  process.exit(1);
});
