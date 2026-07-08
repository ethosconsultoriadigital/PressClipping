/**
 * Actualiza `08_Cobertura_Medios` con el resultado de la fase
 * "Cierre Top FUENTE_NO_CUBIERTA / Window Limited":
 *   - MED-0164 Periódico Correo → alta al TIER CRISIS SHADOW (config-only, 6h,
 *     sitemap). El resto del top gap resultó bajo valor / precision-tradeoff /
 *     fuera de catálogo (documentado en el reporte, sin acción destructiva).
 *
 * Writer seguro `mergeOutputRowsByKey` (merge por medio_id; readback; sin
 * insertar/borrar/reordenar filas).
 *
 * Uso:
 *   npm run update-media-coverage-gaps -- --dry-run
 *   npm run update-media-coverage-gaps
 */
import { mergeOutputRowsByKey, type OutRow } from '../src/sheets/write.js';
import { OUTPUT_TABS } from '../src/sheets/client.js';
import { logger } from '../src/utils/logger.js';

const FECHA = '2026-07-08';
const LOTE = 'Cierre FUENTE_NO_CUBIERTA / alta cron crisis';

const COLUMNAS_LOTE = [
  'ultimo_lote', 'fecha_ultimo_lote', 'decision_detect', 'recomendacion_cron',
  'recomendacion_siguiente', 'notas',
];

interface FilaLote extends OutRow { medio_id: string; }

const UPDATES: FilaLote[] = [
  {
    medio_id: 'MED-0164', // Periódico Correo → tier crisis shadow
    ultimo_lote: LOTE,
    fecha_ultimo_lote: FECHA,
    decision_detect: 'DETECT_REAL_OK',
    recomendacion_cron: 'AGREGADO_CRON_CRISIS_SHADOW',
    recomendacion_siguiente: 'observar 1ra corrida crisis 6h programada (shadow, sin envios); ya estaba en base daily',
    notas: 'Alta a SHADOW_MEDIOS_CRISIS (fuente=sitemap, 6h, max 60). Gate OK: EXTRACCION_REPARADA, FP~0%, Centenario MATCH_REAL, 9 menciones. Config-only (shadowMedia.ts), sin tocar .yml.',
  },
];

function parseArgs(argv: string[]): { dryRun: boolean } {
  return { dryRun: argv.includes('--dry-run') };
}

async function main(): Promise<void> {
  const { dryRun } = parseArgs(process.argv.slice(2));
  logger.info({ tab: OUTPUT_TABS.COBERTURA_MEDIOS, updates: UPDATES.length, dryRun }, 'Iniciando update-media-coverage-gaps');

  if (dryRun) {
    for (const u of UPDATES) logger.info(u, '[dry-run] fila a mergear');
    console.log(`[dry-run] updates=${UPDATES.length} columnas=${COLUMNAS_LOTE.length} (no se escribió la Sheet)`);
    return;
  }

  const resumen = await mergeOutputRowsByKey(OUTPUT_TABS.COBERTURA_MEDIOS, 'medio_id', UPDATES as any, COLUMNAS_LOTE);
  logger.info(resumen, 'Merge 08_Cobertura_Medios completado');
  console.log(
    `08_Cobertura_Medios: filas_antes=${resumen.filas_antes} filas_despues=${resumen.filas_despues} ` +
      `readback=${resumen.readback_filas} mismatch=${resumen.mismatch} ` +
      `columnas_agregadas=${resumen.columnas_agregadas.length} filas_actualizadas=${resumen.filas_actualizadas} ` +
      `claves_no_encontradas=${resumen.claves_no_encontradas.length}`,
  );
  if (resumen.claves_no_encontradas.length > 0) console.log(`  claves_no_encontradas: ${resumen.claves_no_encontradas.join(', ')}`);
  if (resumen.mismatch) {
    logger.error({}, 'MISMATCH: el número de filas cambió tras el merge. Revisar la hoja.');
    process.exit(1);
  }
}

main().catch((e) => {
  logger.error({ error: e instanceof Error ? e.message : String(e) }, 'update-media-coverage-gaps falló');
  process.exit(1);
});
