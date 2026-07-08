/**
 * Actualiza `08_Cobertura_Medios` con el impacto de la fase
 * "Afinacion Tequila CLI-0002" en los 2 medios donde se recuperó una mención
 * real de industria/comercio (Nivel B) por la nueva puerta contextual.
 *
 * Usa el writer seguro `mergeOutputRowsByKey` (merge por medio_id; agrega columna
 * nueva solo si falta; NO inserta/borra/reordena; readback obligatorio). No pisa
 * la columna `notas` existente: escribe en `tequila_tuning`.
 *
 * Uso:
 *   npm run update-media-coverage-tequila -- --dry-run
 *   npm run update-media-coverage-tequila
 */
import { mergeOutputRowsByKey, type OutRow } from '../src/sheets/write.js';
import { OUTPUT_TABS } from '../src/sheets/client.js';
import { logger } from '../src/utils/logger.js';

const FECHA = '2026-07-08';

const COLUMNAS_LOTE = ['tequila_tuning', 'fecha_tequila_tuning'];

interface FilaLote extends OutRow {
  medio_id: string;
}

const UPDATES: FilaLote[] = [
  {
    medio_id: 'MED-0158', // El Sol de Mexico
    tequila_tuning: '+1 mencion tequila Nivel B (exportacion Reino Unido, P2) via puerta contextual; 0 FP',
    fecha_tequila_tuning: FECHA,
  },
  {
    medio_id: 'MED-0154', // La Cronica de Hoy
    tequila_tuning: '+1 mencion tequila Nivel B (exportacion alimentos Reino Unido, P2) via puerta contextual; 0 FP',
    fecha_tequila_tuning: FECHA,
  },
];

function parseArgs(argv: string[]): { dryRun: boolean } {
  return { dryRun: argv.includes('--dry-run') };
}

async function main(): Promise<void> {
  const { dryRun } = parseArgs(process.argv.slice(2));
  logger.info(
    { tab: OUTPUT_TABS.COBERTURA_MEDIOS, updates: UPDATES.length, dryRun },
    'Iniciando update-media-coverage-tequila',
  );

  if (dryRun) {
    for (const u of UPDATES) logger.info(u, '[dry-run] fila a mergear');
    console.log(`[dry-run] updates=${UPDATES.length} columnas=${COLUMNAS_LOTE.length} (no se escribió la Sheet)`);
    return;
  }

  const resumen = await mergeOutputRowsByKey(
    OUTPUT_TABS.COBERTURA_MEDIOS,
    'medio_id',
    UPDATES as any,
    COLUMNAS_LOTE,
  );

  logger.info(resumen, 'Merge 08_Cobertura_Medios completado');
  console.log(
    `08_Cobertura_Medios: filas_antes=${resumen.filas_antes} filas_despues=${resumen.filas_despues} ` +
      `readback=${resumen.readback_filas} mismatch=${resumen.mismatch} ` +
      `columnas_agregadas=${resumen.columnas_agregadas.length} filas_actualizadas=${resumen.filas_actualizadas} ` +
      `claves_no_encontradas=${resumen.claves_no_encontradas.length}`,
  );
  if (resumen.claves_no_encontradas.length > 0) {
    console.log(`  claves_no_encontradas: ${resumen.claves_no_encontradas.join(', ')}`);
  }
  if (resumen.mismatch) {
    logger.error({}, 'MISMATCH: el número de filas cambió tras el merge. Revisar la hoja.');
    process.exit(1);
  }
}

main().catch((e) => {
  logger.error({ error: e instanceof Error ? e.message : String(e) }, 'update-media-coverage-tequila falló');
  process.exit(1);
});
