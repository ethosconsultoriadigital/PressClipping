/**
 * Actualiza `08_Cobertura_Medios` con los resultados del lote
 * "Extraccion Cron Criticos" para los 4 medios que estaban en cron con cuerpo
 * vacío (crawleados desde RSS/sitemap pero nunca enriquecidos).
 *
 * Usa el writer seguro `mergeOutputRowsByKey`:
 *   - merge por `medio_id`
 *   - agrega columnas nuevas solo si faltan
 *   - actualiza únicamente las filas de los medios incluidos
 *   - NO inserta filas, NO borra filas, NO reordena columnas
 *   - readback obligatorio
 *
 * Uso:
 *   npm run update-media-coverage-cron-criticos -- --dry-run
 *   npm run update-media-coverage-cron-criticos
 */
import { mergeOutputRowsByKey, type OutRow } from '../src/sheets/write.js';
import { OUTPUT_TABS } from '../src/sheets/client.js';
import { logger } from '../src/utils/logger.js';

const FECHA = '2026-07-08';
const LOTE = 'Extraccion Cron Criticos';

/** Columnas que el lote actualiza/agrega en 08 (si aún no existen). */
const COLUMNAS_LOTE = [
  'ultimo_lote',
  'fecha_ultimo_lote',
  'clasificacion_extraccion',
  'enrich_texto_ok_pct',
  'enrich_promedio_chars',
  'detect_dry_run_potenciales',
  'detect_real_insertadas',
  'fp_estimado',
  'decision_detect',
  'recomendacion_siguiente',
  'recomendacion_cron',
  'notas',
];

interface FilaLote extends OutRow {
  medio_id: string;
}

const UPDATES: FilaLote[] = [
  {
    medio_id: 'MED-0001', // El Economista
    ultimo_lote: LOTE,
    fecha_ultimo_lote: FECHA,
    clasificacion_extraccion: 'EXTRACCION_REPARADA',
    enrich_texto_ok_pct: 100,
    enrich_promedio_chars: 2969,
    detect_dry_run_potenciales: 29,
    detect_real_insertadas: 29,
    fp_estimado: '~18%',
    decision_detect: 'DETECT_REAL_OK',
    recomendacion_siguiente: 'mantener; keywords amplias (trabajadores/salario minimo) vigilar',
    recomendacion_cron: 'MANTENER_CRON_EXISTENTE',
    notas: 'RSS crawleado sin enrich; extractor html_article OK; 419/420 re-enriquecidas (1 x HTTP 404)',
  },
  {
    medio_id: 'MED-0154', // La Cronica de Hoy
    ultimo_lote: LOTE,
    fecha_ultimo_lote: FECHA,
    clasificacion_extraccion: 'EXTRACCION_REPARADA',
    enrich_texto_ok_pct: 99,
    enrich_promedio_chars: 2331,
    detect_dry_run_potenciales: 12,
    detect_real_insertadas: 12,
    fp_estimado: '~20%',
    decision_detect: 'DETECT_REAL_OK',
    recomendacion_siguiente: 'mantener; cubre huelga/contrato colectivo reales',
    recomendacion_cron: 'MANTENER_CRON_EXISTENTE',
    notas: 'Sitemap crawleado sin enrich; html_article OK; 365/368 re-enriquecidas (2 x HTTP 404)',
  },
  {
    medio_id: 'MED-0157', // El Heraldo de Mexico
    ultimo_lote: LOTE,
    fecha_ultimo_lote: FECHA,
    clasificacion_extraccion: 'EXTRACCION_REPARADA',
    enrich_texto_ok_pct: 100,
    enrich_promedio_chars: 3180,
    detect_dry_run_potenciales: 4,
    detect_real_insertadas: 4,
    fp_estimado: '~25%',
    decision_detect: 'DETECT_REAL_OK',
    recomendacion_siguiente: 'mantener; peor caso previo (68% vacio) totalmente reparado',
    recomendacion_cron: 'MANTENER_CRON_EXISTENTE',
    notas: 'Sitemap crawleado sin enrich; html_article OK; 627/628 re-enriquecidas (1 x HTTP 404)',
  },
  {
    medio_id: 'MED-0158', // El Sol de Mexico
    ultimo_lote: LOTE,
    fecha_ultimo_lote: FECHA,
    clasificacion_extraccion: 'EXTRACCION_REPARADA',
    enrich_texto_ok_pct: 100,
    enrich_promedio_chars: 2876,
    detect_dry_run_potenciales: 12,
    detect_real_insertadas: 12,
    fp_estimado: '~10%',
    decision_detect: 'DETECT_REAL_OK',
    recomendacion_siguiente: 'mantener; oem_storyline (RSC) recupera cuerpo integro',
    recomendacion_cron: 'MANTENER_CRON_EXISTENTE',
    notas: 'RSS crawleado sin enrich; extractor oem_storyline OK; 221/221 re-enriquecidas',
  },
];

function parseArgs(argv: string[]): { dryRun: boolean } {
  return { dryRun: argv.includes('--dry-run') };
}

async function main(): Promise<void> {
  const { dryRun } = parseArgs(process.argv.slice(2));
  logger.info(
    { tab: OUTPUT_TABS.COBERTURA_MEDIOS, updates: UPDATES.length, dryRun },
    'Iniciando update-media-coverage-cron-criticos',
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
  logger.error({ error: e instanceof Error ? e.message : String(e) }, 'update-media-coverage-cron-criticos falló');
  process.exit(1);
});
