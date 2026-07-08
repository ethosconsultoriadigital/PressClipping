/**
 * Actualiza `08_Cobertura_Medios` con los resultados del lote
 * "Reenrich MED-0164 Tequila Crisis" (Periódico Correo): re-enrich acotado de
 * 216 notas crawleadas sin enriquecer + detect real acotado.
 *
 * Usa el writer seguro `mergeOutputRowsByKey` (merge por medio_id; agrega
 * columnas nuevas solo si faltan; NO inserta/borra/reordena; readback obligatorio).
 *
 * Uso:
 *   npm run update-media-coverage-med164 -- --dry-run
 *   npm run update-media-coverage-med164
 */
import { mergeOutputRowsByKey, type OutRow } from '../src/sheets/write.js';
import { OUTPUT_TABS } from '../src/sheets/client.js';
import { logger } from '../src/utils/logger.js';

const FECHA = '2026-07-08';
const LOTE = 'Reenrich MED-0164 Tequila Crisis';

const COLUMNAS_LOTE = [
  'ultimo_lote', 'fecha_ultimo_lote', 'clasificacion_extraccion', 'enrich_texto_ok_pct',
  'enrich_promedio_chars', 'detect_dry_run_potenciales', 'detect_real_insertadas',
  'fp_estimado', 'decision_detect', 'recomendacion_siguiente', 'recomendacion_cron', 'notas',
];

interface FilaLote extends OutRow { medio_id: string; }

const UPDATES: FilaLote[] = [
  {
    medio_id: 'MED-0164', // Periódico Correo
    ultimo_lote: LOTE,
    fecha_ultimo_lote: FECHA,
    clasificacion_extraccion: 'EXTRACCION_REPARADA',
    enrich_texto_ok_pct: 100,
    enrich_promedio_chars: 2758,
    detect_dry_run_potenciales: 9,
    detect_real_insertadas: 9,
    fp_estimado: '~0%',
    decision_detect: 'DETECT_REAL_OK',
    recomendacion_siguiente: 'cubre crisis bebidas Guanajuato (tequila Centenario/alcohol adulterado); evaluar alta a cron crisis en fase autorizada',
    recomendacion_cron: 'EVALUAR_ALTA_CRON_CRISIS',
    notas: 'CRAWLED_BUT_NOT_ENRICHED; html_article OK (calidad alta); 216/216 re-enriquecidas 0 fallidas; vacio 22%->0%; +9 menciones (tequila x2, alcohol/tequila adulterado P1); Centenario ahora MATCH_REAL en 48h',
  },
];

function parseArgs(argv: string[]): { dryRun: boolean } {
  return { dryRun: argv.includes('--dry-run') };
}

async function main(): Promise<void> {
  const { dryRun } = parseArgs(process.argv.slice(2));
  logger.info({ tab: OUTPUT_TABS.COBERTURA_MEDIOS, updates: UPDATES.length, dryRun }, 'Iniciando update-media-coverage-med164');

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
  logger.error({ error: e instanceof Error ? e.message : String(e) }, 'update-media-coverage-med164 falló');
  process.exit(1);
});
