/**
 * Orquestador del ciclo vivo Ethos vs PressClipping.
 *
 * Ejecuta, en orden y con gates de seguridad, el ciclo completo:
 *   1. import-pressclipping desde XML URL
 *   2. crawl dirigido (solo si se pasan --crawl-medio-ids)
 *   3. enrich pendientes (solo si hubo crawl)
 *   4. detect dry-run (solo si hubo crawl)
 *   5. detect real (solo si el dry-run está limpio: sinTexto === 0)
 *   6. export-results (solo si detect real insertó menciones)
 *   7. compare-mentions --output=sheet --replace-window
 *   8. resumen final
 *
 * Si NO se pasan medios para crawl, solo corre: import XML + compare + resumen.
 * Esto permite correr el comparativo cada 2 horas aunque no haya crawl nuevo.
 *
 * NUNCA corre: generate-xml, classify-ia, alertas, WhatsApp/correos,
 * export-raw-news. NO toca 01_Noticias_Raw. NO hace crawl masivo.
 *
 * Uso:
 *   npm run live-comparison -- --fecha-desde=2026-06-25 --fecha-hasta=2026-06-26 \
 *     --xml-url=https://tabla.ethosconsultoriadigital.workers.dev/read-xml \
 *     --output=sheet --replace-window
 *
 *   npm run live-comparison -- --fecha-desde=2026-06-25 --fecha-hasta=2026-06-26 \
 *     --crawl-medio-ids=MED-0145,MED-0148 --crawl-limit=30 --output=sheet --replace-window
 */
import { spawn } from 'node:child_process';
import { logger } from '../src/utils/logger.js';
import { appendHistoryRow } from '../src/sheets/write.js';
import { OUTPUT_TABS } from '../src/sheets/client.js';
import {
  estadoCicloSombra,
  modoMetrica,
  notasShadow,
  notasTrazabilidadWorkflow,
} from '../src/utils/shadowGuard.js';

interface LiveArgs {
  xmlUrl?: string;
  fechaDesde?: string;
  fechaHasta?: string;
  crawlMedioIds?: string;
  crawlLimit: number;
  enrichLimit: number;
  detectLimit: number;
  dryRun: boolean;
  output: 'console' | 'sheet';
  replaceWindow: boolean;
  appendMetricsHistory: boolean;
  /** Modo sombra: nunca exporta resultados al cliente; marca modo=shadow. */
  shadow: boolean;
  /** Omite el paso 6 (export-results) aunque haya menciones nuevas. */
  noExportResults: boolean;
  /** Trazabilidad sombra: tamaño de la ventana móvil (horas). */
  windowHours?: number;
  /** Trazabilidad sombra: número de medios curados en la lista. */
  mediosCurados?: number;
  /** Trazabilidad de workflow (p.ej. shadow-national-tier). Token sin espacios. */
  workflowLabel?: string;
  /** Trazabilidad de tier (p.ej. nacional_b). Token sin espacios. */
  tierLabel?: string;
  /** Trazabilidad de medios del tier (CSV, p.ej. MED-0025,MED-0053). */
  notasMedios?: string;
  /** Trazabilidad de frecuencia del tier (p.ej. 6h). */
  frecuencia?: string;
  /** Trazabilidad de fuente preferida del tier (p.ej. sitemap). */
  fuenteLabel?: string;
}

function parseArgs(argv: string[]): LiveArgs {
  const out: LiveArgs = {
    crawlLimit: 30,
    enrichLimit: 250,
    detectLimit: 250,
    dryRun: false,
    output: 'console',
    replaceWindow: false,
    appendMetricsHistory: false,
    shadow: false,
    noExportResults: false,
  };
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    const key = eq === -1 ? body : body.slice(0, eq);
    const val = eq === -1 ? '' : body.slice(eq + 1);
    switch (key) {
      case 'xml-url':         out.xmlUrl = val; break;
      case 'fecha-desde':     out.fechaDesde = val; break;
      case 'fecha-hasta':     out.fechaHasta = val; break;
      case 'crawl-medio-ids': out.crawlMedioIds = val || undefined; break;
      case 'crawl-limit':     out.crawlLimit = Number(val) || out.crawlLimit; break;
      case 'enrich-limit':    out.enrichLimit = Number(val) || out.enrichLimit; break;
      case 'detect-limit':    out.detectLimit = Number(val) || out.detectLimit; break;
      case 'dry-run':         out.dryRun = true; break;
      case 'output':          out.output = (val as 'console' | 'sheet') || 'console'; break;
      case 'replace-window':  out.replaceWindow = true; break;
      case 'append-metrics-history': out.appendMetricsHistory = true; break;
      case 'shadow':          out.shadow = true; out.noExportResults = true; break;
      case 'no-export-results': out.noExportResults = true; break;
      case 'window-hours':    out.windowHours = Number(val) || out.windowHours; break;
      case 'medios-curados':  out.mediosCurados = Number(val) || out.mediosCurados; break;
      case 'workflow-label':  out.workflowLabel = val || undefined; break;
      case 'tier-label':      out.tierLabel = val || undefined; break;
      case 'notas-medios':    out.notasMedios = val || undefined; break;
      case 'frecuencia':      out.frecuencia = val || undefined; break;
      case 'fuente':          out.fuenteLabel = val || undefined; break;
      // Flags de confirmación de modo sombra (no habilitan nada; se aceptan):
      case 'no-alerts': case 'no-generate-xml': case 'no-classify-ia': break;
    }
  }
  return out;
}

/** Cabeceras (A1:AG1) del histórico acumulativo 07_Metricas_Live. */
const METRICS_HISTORY_HEADERS = [
  'run_id', 'fecha_ejecucion', 'fecha_desde', 'fecha_hasta', 'modo',
  'xml_nuevas', 'xml_duplicadas', 'pressclipping_registros', 'pressclipping_clusters',
  'ethos_menciones', 'match', 'match_probable', 'solo_pressclipping', 'solo_ethos',
  'pc_false_positives', 'pc_syndicated_low_value', 'clusters_actionable_gap',
  'clusters_precision_tradeoff', 'clusters_revisar_humano', 'cobertura_bruta',
  'cobertura_ajustada', 'cobertura_ajustada_clusters', 'precision_bruta',
  'precision_ajustada', 'medios_crawleados', 'noticias_nuevas', 'enrich_actualizadas',
  'detect_menciones', 'export_menciones', 'filas_05_escritas', 'estado_ciclo',
  'siguiente_accion', 'notas',
];

interface StepResult {
  code: number;
  /** Líneas JSON (pino) parseadas de stdout/stderr para evaluar gates. */
  jsonLines: Record<string, unknown>[];
}

/** Ejecuta un script tsx como subproceso, tee de salida y captura de logs JSON. */
function runStep(label: string, script: string, args: string[]): Promise<StepResult> {
  return new Promise((resolve, reject) => {
    const bin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    logger.info({ label, cmd: `npx tsx ${script} ${args.join(' ')}` }, `▶ ${label}`);

    const child = spawn(bin, ['tsx', script, ...args], {
      env: { ...process.env, LOG_FORMAT: 'json' },
      shell: process.platform === 'win32',
    });

    const jsonLines: Record<string, unknown>[] = [];
    let buf = '';

    const handle = (chunk: Buffer, isErr: boolean) => {
      const text = chunk.toString();
      if (isErr) process.stderr.write(text);
      else process.stdout.write(text);
      buf += text;
      let nl: number;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line.startsWith('{')) {
          try { jsonLines.push(JSON.parse(line) as Record<string, unknown>); } catch { /* no-op */ }
        }
      }
    };

    child.stdout.on('data', c => handle(c, false));
    child.stderr.on('data', c => handle(c, true));
    child.on('error', reject);
    child.on('close', code => resolve({ code: code ?? 0, jsonLines }));
  });
}

/** Busca el primer valor numérico de un campo en las líneas JSON capturadas. */
function findNum(lines: Record<string, unknown>[], field: string): number | undefined {
  for (const l of lines) {
    if (typeof l[field] === 'number') return l[field] as number;
  }
  return undefined;
}

/**
 * Busca el ÚLTIMO valor numérico de un campo. Útil para campos que aparecen
 * tanto por-medio como en la línea de resumen (el total está al final).
 */
function findLastNum(lines: Record<string, unknown>[], field: string): number | undefined {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (typeof lines[i]![field] === 'number') return lines[i]![field] as number;
  }
  return undefined;
}

/** Busca el primer valor (número o string) de un campo en las líneas JSON. */
function findVal(lines: Record<string, unknown>[], field: string): number | string | undefined {
  for (const l of lines) {
    const v = l[field];
    if (typeof v === 'number' || typeof v === 'string') return v;
  }
  return undefined;
}

/** Busca el primer valor booleano de un campo en las líneas JSON. */
function findBool(lines: Record<string, unknown>[], field: string): boolean | undefined {
  for (const l of lines) {
    if (typeof l[field] === 'boolean') return l[field] as boolean;
  }
  return undefined;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const haraCrawl = !!args.crawlMedioIds;

  logger.info(
    {
      xmlUrl: args.xmlUrl,
      fechaDesde: args.fechaDesde,
      fechaHasta: args.fechaHasta,
      crawlMedioIds: args.crawlMedioIds ?? '(ninguno → solo import + compare)',
      dryRun: args.dryRun,
      output: args.output,
      replaceWindow: args.replaceWindow,
    },
    '=== Iniciando ciclo vivo de comparación ===',
  );

  const resumen: Record<string, unknown> = { crawl: false, enrich: false, detect: false, export: false };

  // ── 1. Import PressClipping XML ───────────────────────────────────────────
  if (args.xmlUrl) {
    const importArgs = ['--fuente=xml', `--url=${args.xmlUrl}`];
    if (args.dryRun) importArgs.push('--dry-run');
    const r = await runStep('1. import-pressclipping', 'scripts/import-pressclipping.ts', importArgs);
    if (r.code !== 0) { logger.error({}, 'Import falló; abortando ciclo.'); process.exit(1); }
    resumen['import_nuevas'] = findNum(r.jsonLines, 'nuevas') ?? 0;
    resumen['import_omitidas'] = findNum(r.jsonLines, 'omitidas_duplicadas') ?? 0;
  } else {
    logger.warn({}, 'Sin --xml-url: se omite import de PressClipping.');
  }

  // ── 2-6. Pipeline de captura (solo si hay medios para crawl) ──────────────
  if (haraCrawl && !args.dryRun) {
    // 2. Crawl dirigido. --exclude-status=duplicado evita que un medio
    //    reparado con diagnóstico viejo (error/sin_fuente en 08_Validacion_Medios)
    //    quede excluido pese a estar en la lista curada de --medio-ids.
    const crawl = await runStep('2. crawl dirigido', 'scripts/crawl.ts',
      [`--limit=${args.crawlLimit}`, `--medio-ids=${args.crawlMedioIds}`, '--exclude-status=duplicado']);
    resumen['crawl'] = crawl.code === 0;
    resumen['crawl_nuevas'] = findNum(crawl.jsonLines, 'noticias_nuevas') ?? findNum(crawl.jsonLines, 'nuevas');
    resumen['crawl_procesados'] = findNum(crawl.jsonLines, 'procesados');
    resumen['promovidas_diagnostico'] = findLastNum(crawl.jsonLines, 'promovidas_diagnostico') ?? 0;

    // 3. Enrich pendientes
    const enrich = await runStep('3. enrich-news', 'scripts/enrich-news.ts',
      [`--limit=${args.enrichLimit}`, '--only-pending-mentions', '--only-missing-clean-text']);
    resumen['enrich'] = enrich.code === 0;
    resumen['enrich_actualizadas'] = findNum(enrich.jsonLines, 'actualizadas');

    // 4. Detect dry-run (gate)
    const dry = await runStep('4. detect dry-run', 'scripts/detect-mentions.ts',
      [`--limit=${args.detectLimit}`, '--only-with-text', '--dry-run']);
    const sinTexto = findNum(dry.jsonLines, 'sinTexto');
    const potenciales = findNum(dry.jsonLines, 'menciones_potenciales') ?? 0;
    resumen['detect_dryrun_sinTexto'] = sinTexto;
    resumen['detect_dryrun_potenciales'] = potenciales;

    const limpio = dry.code === 0 && (sinTexto === undefined || sinTexto === 0);
    if (!limpio) {
      logger.warn({ sinTexto }, 'Dry-run NO limpio (sinTexto>0). Se omite detect real y export.');
    } else {
      // 5. Detect real
      const real = await runStep('5. detect real', 'scripts/detect-mentions.ts',
        [`--limit=${args.detectLimit}`, '--only-with-text']);
      resumen['detect'] = real.code === 0;
      const insertadas = findNum(real.jsonLines, 'menciones') ?? 0;
      resumen['detect_insertadas'] = insertadas;

      // 6. Export-results (solo si hubo menciones nuevas Y no estamos en sombra)
      if (args.noExportResults) {
        logger.info(
          { shadow: args.shadow, insertadas },
          'Modo sombra / --no-export-results: se OMITE export-results (no se tocan 02_Menciones/04_Logs).',
        );
        resumen['export'] = false;
        resumen['export_omitido_sombra'] = true;
      } else if (insertadas > 0) {
        const exp = await runStep('6. export-results', 'scripts/export-results-to-sheets.ts', []);
        resumen['export'] = exp.code === 0;
      } else {
        logger.info({}, 'Sin menciones nuevas: se omite export-results.');
      }
    }
  } else if (haraCrawl && args.dryRun) {
    logger.info({}, 'Modo --dry-run: se omiten crawl/enrich/detect real/export (solo preview).');
  } else {
    logger.info({}, 'Sin medios de crawl: ciclo de solo comparación (import + compare).');
  }

  // ── 7. Comparativo ────────────────────────────────────────────────────────
  const compArgs: string[] = [];
  if (args.fechaDesde) compArgs.push(`--fecha-desde=${args.fechaDesde}`);
  if (args.fechaHasta) compArgs.push(`--fecha-hasta=${args.fechaHasta}`);
  compArgs.push(`--output=${args.output}`);
  if (args.replaceWindow) compArgs.push('--replace-window');
  if (args.dryRun) compArgs.push('--dry-run');
  const comp = await runStep('7. compare-mentions', 'scripts/compare-mentions.ts', compArgs);
  resumen['compare'] = comp.code === 0;
  for (const f of [
    'menciones_ethos', 'menciones_pressclipping', 'cobertura_bruta', 'cobertura_ajustada',
    'precision_bruta', 'precision_ajustada', 'pc_false_positives',
    'solo_pressclipping_accionables', 'solo_pressclipping_no_accionables', 'solo_ethos_validos',
  ]) {
    const v = findVal(comp.jsonLines, f);
    if (v !== undefined) resumen[f] = v;
  }

  // ── Integridad de escritura de 05 (read-back confirmado en compare-mentions) ─
  const sheetsWriteFailed = comp.code !== 0;
  const sheetsWriteMismatch = findBool(comp.jsonLines, 'sheets_write_mismatch') === true;
  const sheets429 = comp.jsonLines.some((l) => {
    const m = `${String(l['error'] ?? '')} ${String(l['msg'] ?? '')}`.toLowerCase();
    return m.includes('quota') || m.includes('429') || m.includes('ratelimit');
  });
  // filas_05_escritas SIEMPRE numérico: read-back si OK; 0 si falló la escritura.
  const filas05 = sheetsWriteFailed ? 0 : (findNum(comp.jsonLines, 'escritas') ?? 0);
  resumen['filas_05_escritas'] = filas05;
  resumen['sheets_write_failed'] = sheetsWriteFailed;
  resumen['sheets_write_mismatch'] = sheetsWriteMismatch;
  resumen['sheets_429'] = sheets429;
  if (sheetsWriteFailed || sheetsWriteMismatch) {
    logger.warn(
      { sheetsWriteFailed, sheetsWriteMismatch, sheets429, filas_05_escritas: filas05 },
      'Integridad 05↔07: escritura de 05 no confirmada; el ciclo NO será shadow_ok.',
    );
  }

  // ── 7b. Append histórico a 07_Metricas_Live (acumulativo, sin replace) ─────
  if (args.appendMetricsHistory && args.output === 'sheet' && !args.dryRun) {
    try {
      const escritas = await appendMetricsHistory(args, resumen, comp.jsonLines, filas05);
      resumen['metrics_history_escritas'] = escritas;
    } catch (err) {
      logger.error(
        { error: err instanceof Error ? err.message : String(err) },
        'No se pudo escribir histórico en 07_Metricas_Live (no bloquea el ciclo).',
      );
    }
  }

  // ── 8. Resumen final ──────────────────────────────────────────────────────
  logger.info(resumen, '=== Resumen del ciclo vivo ===');
}

/** Construye y agrega la fila histórica a 07_Metricas_Live. */
async function appendMetricsHistory(
  args: LiveArgs,
  resumen: Record<string, unknown>,
  compLines: Record<string, unknown>[],
  filas05: number | undefined,
): Promise<number> {
  const haraCrawl = !!args.crawlMedioIds;
  const detectMenciones = (resumen['detect_insertadas'] as number) ?? 0;
  const exportMenciones = resumen['export'] === true ? detectMenciones : 0;
  const writeFailed = resumen['sheets_write_failed'] === true;
  // Consistencia 05↔07: 07 reporta lo CONFIRMADO por read-back de 05 (no lo
  // generado en memoria). Si la escritura falló, 05 no tiene datos → 0.
  const rbMatch = writeFailed ? 0 : (findVal(compLines, 'readback_match') ?? findVal(compLines, 'matches') ?? 0);
  const rbSoloPC = writeFailed ? 0 : (findVal(compLines, 'readback_solo_pressclipping') ?? findVal(compLines, 'soloPC') ?? '');
  const rbSoloEthos = writeFailed ? 0 : (findVal(compLines, 'readback_solo_ethos') ?? findVal(compLines, 'soloEthos') ?? '');
  const coberturaClusters = findVal(compLines, 'cobertura_ajustada_clusters');
  const actionableGap = findNum(compLines, 'clusters_actionable_gap') ?? 0;

  const estadoCiclo = args.shadow
    ? estadoCicloSombra({
        compareOk: resumen['compare'] === true,
        dryRunSinTexto: (resumen['detect_dryrun_sinTexto'] as number) ?? 0,
        potenciales: (resumen['detect_dryrun_potenciales'] as number) ?? 0,
        sheetsWriteFailed: resumen['sheets_write_failed'] === true,
        sheetsWriteMismatch: resumen['sheets_write_mismatch'] === true,
      })
    : resumen['compare'] === true && (resumen['detect_dryrun_sinTexto'] ?? 0) === 0
      ? 'estable'
      : 'revisar';

  const siguienteAccion =
    actionableGap > 0
      ? `Atacar ${actionableGap} clusters ETHOS_ACTIONABLE_GAP (reparar/alta de medios).`
      : 'Sin gaps accionables; mantener monitoreo.';

  const promovidas = (resumen['promovidas_diagnostico'] as number) ?? 0;
  const precisionAjustada = findVal(compLines, 'precision_ajustada');
  const notasExtra = notasTrazabilidadWorkflow({
    workflow: args.workflowLabel,
    tier: args.tierLabel,
    medios: args.notasMedios,
    fuente: args.fuenteLabel,
    frecuencia: args.frecuencia,
  });
  const notasModo = args.shadow
    ? notasShadow({
        windowHours: args.windowHours,
        mediosCurados: args.mediosCurados,
        promovidasDiagnostico: promovidas,
        precisionAjustada: precisionAjustada as string | number | undefined,
        sheets429: resumen['sheets_429'] === true,
        sheetsWriteFailed: resumen['sheets_write_failed'] === true,
        sheetsWriteMismatch: resumen['sheets_write_mismatch'] === true,
        notasExtra,
      })
    : `promovidas_diagnostico=${promovidas}`;

  const row = {
    run_id: `RUN-${new Date().toISOString().replace(/[:.]/g, '-')}`,
    fecha_ejecucion: new Date().toISOString(),
    fecha_desde: args.fechaDesde ?? '',
    fecha_hasta: args.fechaHasta ?? '',
    modo: modoMetrica(args.shadow, haraCrawl),
    xml_nuevas: (resumen['import_nuevas'] as number) ?? 0,
    xml_duplicadas: (resumen['import_omitidas'] as number) ?? 0,
    pressclipping_registros: findVal(compLines, 'pressclipping_registros') ?? '',
    pressclipping_clusters: findVal(compLines, 'pressclipping_clusters') ?? '',
    ethos_menciones: findVal(compLines, 'menciones_ethos') ?? '',
    match: rbMatch,
    match_probable: findVal(compLines, 'matchProbables') ?? 0,
    solo_pressclipping: rbSoloPC,
    solo_ethos: rbSoloEthos,
    pc_false_positives: findVal(compLines, 'pc_false_positives') ?? 0,
    pc_syndicated_low_value: findVal(compLines, 'clusters_syndicated_low_value') ?? 0,
    clusters_actionable_gap: actionableGap,
    clusters_precision_tradeoff: findVal(compLines, 'clusters_precision_tradeoff') ?? 0,
    clusters_revisar_humano: findVal(compLines, 'clusters_revisar_humano') ?? 0,
    cobertura_bruta: findVal(compLines, 'cobertura_bruta') ?? '',
    cobertura_ajustada: findVal(compLines, 'cobertura_ajustada') ?? '',
    cobertura_ajustada_clusters: coberturaClusters ?? '',
    precision_bruta: findVal(compLines, 'precision_bruta') ?? '',
    precision_ajustada: findVal(compLines, 'precision_ajustada') ?? '',
    medios_crawleados: haraCrawl ? ((resumen['crawl_procesados'] as number) ?? '') : 0,
    noticias_nuevas: (resumen['crawl_nuevas'] as number) ?? 0,
    enrich_actualizadas: (resumen['enrich_actualizadas'] as number) ?? 0,
    detect_menciones: detectMenciones,
    export_menciones: exportMenciones,
    filas_05_escritas: filas05 ?? 0,
    estado_ciclo: estadoCiclo,
    siguiente_accion: siguienteAccion,
    notas: notasModo,
  };

  const escritas = await appendHistoryRow(OUTPUT_TABS.METRICAS_LIVE, METRICS_HISTORY_HEADERS, row);
  logger.info({ escritas, tab: OUTPUT_TABS.METRICAS_LIVE }, 'Histórico de métricas agregado.');
  return escritas;
}

main().catch(err => {
  logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Error fatal en run-live-comparison');
  process.exit(1);
});
