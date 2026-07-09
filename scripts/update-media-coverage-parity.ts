/**
 * Actualiza `08_Cobertura_Medios` con el resultado de la fase
 * "Paridad de Medios PressClipping vs Ethos + Ruta Rápida a Producción":
 *   - MED-0005 lado.mx           → ALTA a daily shadow (gap PC 28, READY, texto 100%).
 *   - MED-0049 Telediario Mty    → ALTA a daily shadow (gap PC 14, READY, texto 100%).
 *   - MED-0055 Noroeste          → candidato siguiente lote (READY pero texto 58%).
 *
 * Writer seguro `mergeOutputRowsByKey` (merge por medio_id; readback; sin
 * insertar/borrar/reordenar filas). Preserva las 162 filas de la hoja.
 *
 * Uso:
 *   npm run update-media-coverage-parity -- --dry-run
 *   npm run update-media-coverage-parity
 */
import { mergeOutputRowsByKey, type OutRow } from '../src/sheets/write.js';
import { OUTPUT_TABS } from '../src/sheets/client.js';
import { logger } from '../src/utils/logger.js';

const FECHA = '2026-07-08';
const LOTE = 'Paridad de medios PC vs Ethos + ruta a produccion';

const COLUMNAS_LOTE = [
  'ultimo_lote', 'fecha_ultimo_lote', 'decision_detect', 'recomendacion_cron',
  'recomendacion_siguiente', 'notas',
];

interface FilaLote extends OutRow { medio_id: string; }

const UPDATES: FilaLote[] = [
  {
    medio_id: 'MED-0005', // lado.mx
    ultimo_lote: LOTE,
    fecha_ultimo_lote: FECHA,
    decision_detect: 'ALTA_DAILY_SHADOW',
    recomendacion_cron: 'AGREGADO_CRON_DAILY_SHADOW',
    recomendacion_siguiente: 'observar corridas daily shadow (sin envios); captura forward de contenido de cliente (CLI-0002).',
    notas: 'EN_CATALOGO_NO_CRON, mayor gap PC (28 notas, 3 clientes). Audit READY_KEEP_CURRENT conf 1.0 (RSS). Extraccion 102/102 con texto (100%). Detect dry-run limpio (0 FP cliente real, 1 CLI-PRUEBA, sin flood). Config-only (shadowMedia.ts), sin tocar .yml.',
  },
  {
    medio_id: 'MED-0049', // Telediario Monterrey
    ultimo_lote: LOTE,
    fecha_ultimo_lote: FECHA,
    decision_detect: 'ALTA_DAILY_SHADOW',
    recomendacion_cron: 'AGREGADO_CRON_DAILY_SHADOW',
    recomendacion_siguiente: 'observar corridas daily shadow (sin envios); captura forward de contenido de cliente.',
    notas: 'EN_CATALOGO_NO_CRON, 2o gap PC (14 notas, 3 clientes). Audit READY_SITEMAP_INDEX conf 1.0. Extraccion 70/70 con texto (100%). Detect dry-run limpio (sin flood, sin FP cliente real). Config-only, sin tocar .yml.',
  },
  {
    medio_id: 'MED-0055', // Noroeste
    ultimo_lote: LOTE,
    fecha_ultimo_lote: FECHA,
    decision_detect: 'CANDIDATO_SIGUIENTE_LOTE',
    recomendacion_cron: 'NO_AGREGAR_TODAVIA',
    recomendacion_siguiente: 'READY conf 1.0 pero texto 58% (28/48); re-enrich acotado antes de considerar alta.',
    notas: 'EN_CATALOGO_NO_CRON, gap PC 4. Audit READY_KEEP_CURRENT. Extraccion parcial (58%). Se deja documentado para siguiente lote.',
  },
];

function parseArgs(argv: string[]): { dryRun: boolean } {
  return { dryRun: argv.includes('--dry-run') };
}

async function main(): Promise<void> {
  const { dryRun } = parseArgs(process.argv.slice(2));
  logger.info({ tab: OUTPUT_TABS.COBERTURA_MEDIOS, updates: UPDATES.length, dryRun }, 'Iniciando update-media-coverage-parity');

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
  logger.error({ error: e instanceof Error ? e.message : String(e) }, 'update-media-coverage-parity falló');
  process.exit(1);
});
