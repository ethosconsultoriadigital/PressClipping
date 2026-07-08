/**
 * Actualiza `08_Cobertura_Medios` con el resultado de la fase
 * "Cobertura Corporativo-Regulatoria CLI-0001 Jumex":
 *   - MED-0029 La Jornada  → fuente reparada (sitemap high-confidence) pero el
 *     crawl real devuelve HTTP 403 (bloqueo bot). Sin proxy/bypass permitido →
 *     NO viable para alta a cron. Documentado como fuente bloqueada en crawl.
 *   - MED-0149 Líderes Mexicanos → auditado READY, extracción EXCELENTE, pero es
 *     revista lujo/negocios-lifestyle SIN señal CLI-0001 (0 Jumex/regulatorio).
 *     Gate bloquea el ruido (FP 0%). Se deja como candidato documentado, sin alta.
 *
 * Writer seguro `mergeOutputRowsByKey` (merge por medio_id; readback; sin
 * insertar/borrar/reordenar filas). Preserva las 162 filas de la hoja.
 *
 * Uso:
 *   npm run update-media-coverage-jumex-cov -- --dry-run
 *   npm run update-media-coverage-jumex-cov
 */
import { mergeOutputRowsByKey, type OutRow } from '../src/sheets/write.js';
import { OUTPUT_TABS } from '../src/sheets/client.js';
import { logger } from '../src/utils/logger.js';

const FECHA = '2026-07-08';
const LOTE = 'Cobertura corporativo-regulatoria CLI-0001 Jumex';

const COLUMNAS_LOTE = [
  'ultimo_lote', 'fecha_ultimo_lote', 'decision_detect', 'recomendacion_cron',
  'recomendacion_siguiente', 'notas',
];

interface FilaLote extends OutRow { medio_id: string; }

const UPDATES: FilaLote[] = [
  {
    medio_id: 'MED-0029', // La Jornada
    ultimo_lote: LOTE,
    fecha_ultimo_lote: FECHA,
    decision_detect: 'DESCARTAR_BLOQUEADO',
    recomendacion_cron: 'NO_AGREGAR_403_CRAWL',
    recomendacion_siguiente: 'fuente sitemap reparada (URL validada) pero crawl real da HTTP 403; requeriria proxy (no permitido). Revisar si abre acceso publico.',
    notas: 'Auditoria REPAIRABLE_SITEMAP_HIGH_CONFIDENCE (conf 1.0, gap 9). --update-db fijo sitemap https://www.jornada.com.mx/sitemap.xml. Crawl dirigido acotado: HTTP 403 (bloqueo bot). Top fuente del gap accionable CLI-0001 (evento mango) pero NO ingerible sin proxy.',
  },
  {
    medio_id: 'MED-0149', // Líderes Mexicanos
    ultimo_lote: LOTE,
    fecha_ultimo_lote: FECHA,
    decision_detect: 'DESCARTAR_BAJO_VALOR',
    recomendacion_cron: 'NO_AGREGAR_SIN_SENAL_CLI0001',
    recomendacion_siguiente: 'candidato documentado; RSS sano y extraccion EXCELENTE pero contenido lujo/negocios-lifestyle sin señal Jumex/regulatoria. No agregar a cron para CLI-0001.',
    notas: 'READY_KEEP_CURRENT (conf 1.0). Crawl RSS acotado 10 notas, enrich 10/10 (cuerpo 1.4k-10k ch). 0 notas con señal CLI-0001; 3 hits espurios de "nectar" (autos) bloqueados por gate (FP 0%).',
  },
];

function parseArgs(argv: string[]): { dryRun: boolean } {
  return { dryRun: argv.includes('--dry-run') };
}

async function main(): Promise<void> {
  const { dryRun } = parseArgs(process.argv.slice(2));
  logger.info({ tab: OUTPUT_TABS.COBERTURA_MEDIOS, updates: UPDATES.length, dryRun }, 'Iniciando update-media-coverage-jumex-cov');

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
  logger.error({ error: e instanceof Error ? e.message : String(e) }, 'update-media-coverage-jumex-cov falló');
  process.exit(1);
});
