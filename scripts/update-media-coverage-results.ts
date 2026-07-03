/**
 * Actualiza `08_Cobertura_Medios` con los RESULTADOS por medio de cada lote de
 * extracción/detección (crawl, enrich, detect), SIN romper las filas de
 * auditoría existentes.
 *
 * Usa el writer seguro `mergeOutputRowsByKey`:
 *   - merge por `medio_id`
 *   - agrega columnas nuevas solo si faltan
 *   - actualiza únicamente las filas de los medios incluidos
 *   - NO inserta filas, NO borra filas, NO reordena columnas
 *   - readback obligatorio
 *
 * Uso:
 *   npm run update-media-coverage-results -- --dry-run   # muestra el plan, no escribe
 *   npm run update-media-coverage-results                # aplica el merge
 *
 * Los resultados por medio se declaran abajo como datos (source of truth de la
 * corrida). La lógica de merge es genérica y está cubierta por tests.
 */
import { mergeOutputRowsByKey, type OutRow } from '../src/sheets/write.js';
import { planMergeByKey } from '../src/sheets/mergePlan.js';
import { OUTPUT_TABS } from '../src/sheets/client.js';
import { logger } from '../src/utils/logger.js';

const FECHA = '2026-07-03';

/** Columnas nuevas que el lote agrega a 08 (si aún no existen). */
const COLUMNAS_LOTE = [
  'ultimo_lote',
  'fecha_ultimo_lote',
  'crawl_nuevas_lote',
  'crawl_duplicadas_lote',
  'crawl_errores_lote',
  'enrich_texto_ok_pct',
  'enrich_promedio_chars',
  'detect_dry_run_potenciales',
  'detect_real_insertadas',
  'fp_estimado',
  'decision_detect',
  'recomendacion_siguiente',
  'recomendacion_cron',
];

/**
 * Recomendación de cron por medio tras el dedupe de cobertura (FASE dedupe):
 *   MANTENER_CRON_EXISTENTE     → ya cubierto por base/nacional B/crisis.
 *   CANDIDATO_CRON_DIARIO_SHADOW→ net-new validado (Zeta, Revista Espejo).
 *   EXCLUIR_BOILERPLATE         → MED-0118 El Respetable (extractor a reparar).
 *   REVISAR_MANUAL              → sin detección estable / fuera de cron por ahora.
 */
const RECOMENDACION_CRON: Record<string, string> = {
  'MED-0148': 'MANTENER_CRON_EXISTENTE', 'MED-0153': 'MANTENER_CRON_EXISTENTE',
  'MED-0154': 'MANTENER_CRON_EXISTENTE', 'MED-0155': 'MANTENER_CRON_EXISTENTE',
  'MED-0160': 'MANTENER_CRON_EXISTENTE', 'MED-0166': 'MANTENER_CRON_EXISTENTE',
  'MED-0167': 'MANTENER_CRON_EXISTENTE',
  'MED-0083': 'CANDIDATO_CRON_DIARIO_SHADOW', 'MED-0066': 'CANDIDATO_CRON_DIARIO_SHADOW',
  'MED-0118': 'EXCLUIR_BOILERPLATE',
  'MED-0014': 'REVISAR_MANUAL', 'MED-0026': 'REVISAR_MANUAL', 'MED-0039': 'REVISAR_MANUAL',
  'MED-0041': 'REVISAR_MANUAL', 'MED-0086': 'REVISAR_MANUAL', 'MED-0099': 'REVISAR_MANUAL',
  'MED-0106': 'REVISAR_MANUAL', 'MED-0142': 'REVISAR_MANUAL', 'MED-0146': 'REVISAR_MANUAL',
  'MED-0149': 'REVISAR_MANUAL',
};

// ---------------------------------------------------------------------------
// Lote B — detalle por medio (medido en esta sesión)
// ---------------------------------------------------------------------------
interface FilaLote extends OutRow {
  medio_id: string;
  ultimo_lote: string;
  fecha_ultimo_lote: string;
}

const LOTE_B: FilaLote[] = [
  row('MED-0014', 30, 0, 0, 100, 2520, 0, 0, '0%', 'DETECT_REAL', 'mantener'),
  row('MED-0026', 30, 0, 0, 100, 2005, 0, 0, '0%', 'DETECT_REAL', 'mantener'),
  row('MED-0039', 30, 0, 0, 100, 1266, 0, 0, '0%', 'DETECT_REAL', 'mantener'),
  row('MED-0041', 30, 0, 0, 100, 1669, 0, 0, '0%', 'DETECT_REAL', 'mantener'),
  row('MED-0066', 30, 0, 0, 100, 3288, 2, 2, '~12%', 'DETECT_REAL', 'candidato_cron_diario_shadow'),
  row('MED-0083', 30, 0, 0, 100, 2614, 4, 4, '~12%', 'DETECT_REAL', 'candidato_cron_diario_shadow'),
  row('MED-0086', 30, 0, 0, 100, 1231, 0, 0, '0%', 'DETECT_REAL', 'mejorar_extraccion'),
  row('MED-0099', 30, 0, 0, 93, 1676, 0, 0, '0%', 'DETECT_REAL', 'mantener'),
  row('MED-0106', 30, 0, 0, 100, 919, 0, 0, '0%', 'DETECT_REAL', 'mantener'),
  row('MED-0118', 30, 0, 0, 100, 431, 0, 0, '0%', 'EXCLUIR_BOILERPLATE', 'revisar_extraccion_boilerplate'),
  row('MED-0142', 29, 1, 0, 92, 3113, 0, 0, '0%', 'DETECT_REAL', 'mantener_vigilar_bebidas'),
  row('MED-0146', 2, 8, 0, 100, 7427, 0, 0, '0%', 'DETECT_REAL', 'mantener'),
  row('MED-0148', 0, 10, 0, 98, 3486, 2, 2, '~12%', 'DETECT_REAL', 'candidato_cron_diario_shadow'),
  row('MED-0149', 10, 0, 0, 100, 5230, 0, 0, '0%', 'DETECT_REAL', 'mantener'),
  row('MED-0153', 10, 20, 0, 100, 2253, 4, 4, '~12%', 'DETECT_REAL', 'candidato_cron_diario_shadow'),
  row('MED-0154', 13, 17, 0, 98, 2407, 9, 9, '~12%', 'DETECT_REAL', 'candidato_cron_diario_shadow'),
  row('MED-0155', 6, 24, 0, 100, 3737, 1, 1, '~12%', 'DETECT_REAL', 'candidato_cron_diario_shadow'),
  row('MED-0160', 9, 21, 0, 95, 1571, 0, 0, '0%', 'DETECT_REAL', 'mantener'),
  row('MED-0166', 10, 20, 0, 97, 2321, 5, 5, '~12%', 'DETECT_REAL', 'candidato_cron_diario_shadow'),
  row('MED-0167', 0, 10, 0, 97, 2955, 0, 0, '0%', 'DETECT_REAL', 'mantener'),
];

function row(
  medio_id: string,
  nuevas: number,
  dups: number,
  errores: number,
  enrichPct: number,
  promChars: number,
  dryRun: number,
  real: number,
  fp: string,
  decision: string,
  recomendacion: string,
): FilaLote {
  return {
    medio_id,
    ultimo_lote: 'B',
    fecha_ultimo_lote: FECHA,
    crawl_nuevas_lote: nuevas,
    crawl_duplicadas_lote: dups,
    crawl_errores_lote: errores,
    enrich_texto_ok_pct: enrichPct,
    enrich_promedio_chars: promChars,
    detect_dry_run_potenciales: dryRun,
    detect_real_insertadas: real,
    fp_estimado: fp,
    decision_detect: decision,
    recomendacion_siguiente: recomendacion,
    recomendacion_cron: RECOMENDACION_CRON[medio_id] ?? 'REVISAR_MANUAL',
  };
}

// ---------------------------------------------------------------------------
// Lote A — metadata + agregado (446 analizadas, 15 potenciales, 15 real, ~20% FP).
// No se declaran cifras por-medio de crawl/enrich porque no se midieron por medio
// en aquel lote; el merge deja intactas las columnas no provistas.
// ---------------------------------------------------------------------------
const LOTE_A_IDS = [
  'MED-0001', 'MED-0005', 'MED-0008', 'MED-0017', 'MED-0020', 'MED-0030', 'MED-0031',
  'MED-0034', 'MED-0055', 'MED-0145', 'MED-0156', 'MED-0157', 'MED-0158', 'MED-0159',
  'MED-0161', 'MED-0162', 'MED-0163', 'MED-0164', 'MED-0165', 'MED-0168',
];
const LOTE_A: FilaLote[] = LOTE_A_IDS.map((medio_id) => ({
  medio_id,
  ultimo_lote: 'A',
  fecha_ultimo_lote: FECHA,
  fp_estimado: '~20%',
  decision_detect: 'DETECT_REAL',
  recomendacion_siguiente: 'mantener',
}));

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function parseArgs(argv: string[]): { dryRun: boolean } {
  return { dryRun: argv.includes('--dry-run') };
}

async function main(): Promise<void> {
  const { dryRun } = parseArgs(process.argv.slice(2));
  // Lote B pisa a Lote A si algún medio estuviera en ambos (no debería): B es más reciente.
  const updates: FilaLote[] = [...LOTE_A, ...LOTE_B];

  logger.info(
    { tab: OUTPUT_TABS.COBERTURA_MEDIOS, lote_a: LOTE_A.length, lote_b: LOTE_B.length, total: updates.length, dryRun },
    'Iniciando update-media-coverage-results',
  );

  if (dryRun) {
    // Plan sobre un esquema hipotético (headers reales se validan al escribir).
    // Aquí solo mostramos columnas nuevas candidatas y conteo de updates.
    const plan = planMergeByKey(['medio_id'], 'medio_id', updates as any, updates.map((u) => u.medio_id), COLUMNAS_LOTE);
    logger.info(
      { columnas_nuevas_sugeridas: COLUMNAS_LOTE, columnas_agregadas_vs_min: plan.columnas_agregadas.length, updates: updates.length },
      '[dry-run] No se escribió la Sheet. Plan calculado.',
    );
    console.log(`[dry-run] updates=${updates.length} (LoteA=${LOTE_A.length}, LoteB=${LOTE_B.length}) columnas_nuevas=${COLUMNAS_LOTE.length}`);
    return;
  }

  const resumen = await mergeOutputRowsByKey(
    OUTPUT_TABS.COBERTURA_MEDIOS,
    'medio_id',
    updates as any,
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
  logger.error({ error: e instanceof Error ? e.message : String(e) }, 'update-media-coverage-results falló');
  process.exit(1);
});
