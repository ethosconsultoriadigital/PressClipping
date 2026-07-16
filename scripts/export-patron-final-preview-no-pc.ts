/**
 * Puente Patrón: tab 12 consolidada → tab 13 preview final (CLI-0002).
 *
 * Lee la tab consolidada (`12_Operacion_Consolidada_Sin_PressClipping`), filtra
 * SOLO CLI-0002 con relevancia editorial GO (ALTA/MEDIA), excluye
 * POSIBLE_FP/EXCLUIR/BAJA, deduplica por (cliente_id + url_norm) y escribe en
 * `13_Patron_Final_Preview` con readback obligatorio. NO conecta a hoja externa
 * (no hay ID final autorizado): default es preview en el Output Sheet.
 *
 * NO usa export-results, classify-ia, generate-xml, SMTP, Twilio, email/WhatsApp.
 *
 * Uso:
 *   npm run export-patron-final-preview-no-pc -- --window-days=7 --dry-run --max-rows=300
 *   npm run export-patron-final-preview-no-pc -- --window-days=7 --output=sheet --max-rows=300
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { ensureSheetTabAndHeaders, appendHistoryRows, type OutRow } from '../src/sheets/write.js';
import { getOutputTab } from '../src/sheets/client.js';
import { logger } from '../src/utils/logger.js';
import { parseIntOrNull } from '../src/utils/parse.js';

const SOURCE_TAB_DEFAULT = '12_Operacion_Consolidada_Sin_PressClipping';
const TARGET_TAB_DEFAULT = '13_Patron_Final_Preview';
const CLIENTE = 'CLI-0002';

const HEADERS = [
  'fecha_export', 'run_id', 'cliente_id', 'cliente_nombre', 'fecha_noticia', 'medio',
  'titulo', 'url', 'keywords_detectadas', 'grupo_tema', 'sentimiento', 'valoracion',
  'relevancia_editorial', 'estado_editorial', 'prioridad', 'requiere_alerta', 'cluster_id', 'cluster_tipo',
  'texto_limpio_chars', 'medio_id', 'fuente', 'dedupe_key_final', 'estado_export', 'notas_editoriales',
];

const RELEVANCIA_GO = new Set(['ALTA_RELEVANCIA', 'MEDIA_RELEVANCIA']);
const ESTADO_GO = new Set(['GO_ALTA', 'GO_MEDIA']);

interface Args {
  sourceTab: string;
  targetTab: string;
  windowHours?: number;
  windowDays?: number;
  output: 'console' | 'sheet';
  dryRun: boolean;
  maxRows: number;
  allowFinalSheet: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    sourceTab: SOURCE_TAB_DEFAULT, targetTab: TARGET_TAB_DEFAULT,
    output: 'console', dryRun: false, maxRows: 300, allowFinalSheet: false,
  };
  for (const arg of argv) {
    if (arg === '--dry-run') { out.dryRun = true; continue; }
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    const key = eq === -1 ? body : body.slice(0, eq);
    const val = eq === -1 ? '' : body.slice(eq + 1);
    if (key === 'source-tab') out.sourceTab = val || out.sourceTab;
    if (key === 'target-tab') out.targetTab = val || out.targetTab;
    if (key === 'window-hours') out.windowHours = parseIntOrNull(val) ?? undefined;
    if (key === 'window-days') out.windowDays = parseIntOrNull(val) ?? undefined;
    if (key === 'output') out.output = (val as 'console' | 'sheet') || out.output;
    if (key === 'max-rows') out.maxRows = parseIntOrNull(val) ?? out.maxRows;
    if (key === 'allow-final-sheet') out.allowFinalSheet = /^(true|1|yes|si)$/i.test(val);
  }
  return out;
}

function windowMs(args: Args): number | null {
  if (args.windowHours != null) return args.windowHours * 60 * 60 * 1000;
  if (args.windowDays != null) return args.windowDays * 24 * 60 * 60 * 1000;
  return null;
}

const txt = (v: unknown): string => String(v ?? '').trim();

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Guarda: no hay hoja final externa autorizada. --allow-final-sheet no habilita
  // ningún destino externo (no hay ID configurado): siempre preview en Output Sheet.
  if (args.allowFinalSheet) {
    logger.error({}, 'No hay ID de hoja final Patrón autorizado/configurado. Aborta: usa el preview (default). No se inventa destino externo.');
    process.exit(2);
  }

  const runId = `PATRON-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const fechaExport = new Date().toISOString();

  logger.info(
    { sourceTab: args.sourceTab, targetTab: args.targetTab, cliente: CLIENTE, windowDays: args.windowDays ?? null, windowHours: args.windowHours ?? null, output: args.output, dryRun: args.dryRun, maxRows: args.maxRows },
    '=== Puente Patrón: tab 12 → tab 13 preview (solo CLI-0002 GO) ===',
  );

  // ── Leer tab 12 consolidada ─────────────────────────────────────────────────
  const source = await getOutputTab(args.sourceTab);
  await source.loadHeaderRow();
  const rows = await source.getRows();
  logger.info({ filas_origen: rows.length, tab: args.sourceTab }, 'Filas leídas de la tab consolidada');

  const ventana = windowMs(args);
  const isoDesde = ventana != null ? new Date(Date.now() - ventana).toISOString() : null;

  const seen = new Set<string>();
  const filas: OutRow[] = [];
  let noCli0002 = 0, excluidasRelevancia = 0, fueraVentana = 0, duplicados = 0;
  const porRelevancia: Record<string, number> = {};
  const porGrupoTema: Record<string, number> = {};
  const porMedio: Record<string, number> = {};

  for (const r of rows) {
    if (txt(r.get('cliente_id')) !== CLIENTE) { noCli0002++; continue; }

    const relevancia = txt(r.get('relevancia_editorial'));
    const estadoEditorial = txt(r.get('estado_editorial'));
    // Filtro GO: si hay estado_editorial, MANDA (excluye REVISAR/EXCLUIR aunque la
    // relevancia sea MEDIA/ALTA — p.ej. crisis solo confirmada por keyword, no por
    // título, queda REVISAR y no debe pasar). Sin estado_editorial (filas legacy
    // sin esa columna), cae al fallback por relevancia_editorial solamente.
    const esGo = estadoEditorial ? ESTADO_GO.has(estadoEditorial) : RELEVANCIA_GO.has(relevancia);
    if (!esGo) { excluidasRelevancia++; continue; }

    const fechaNoticia = txt(r.get('fecha_noticia'));
    if (isoDesde && fechaNoticia && fechaNoticia < isoDesde) { fueraVentana++; continue; }

    const urlNorm = txt(r.get('url_norm'));
    const dedupeFinal = `${CLIENTE}::${urlNorm}`;
    if (seen.has(dedupeFinal)) { duplicados++; continue; }
    seen.add(dedupeFinal);

    porRelevancia[relevancia] = (porRelevancia[relevancia] ?? 0) + 1;
    const grupo = txt(r.get('grupo_tema'));
    porGrupoTema[grupo] = (porGrupoTema[grupo] ?? 0) + 1;
    const medio = txt(r.get('medio'));
    porMedio[medio] = (porMedio[medio] ?? 0) + 1;

    filas.push({
      fecha_export: fechaExport,
      run_id: runId,
      cliente_id: CLIENTE,
      cliente_nombre: txt(r.get('cliente_nombre')),
      fecha_noticia: fechaNoticia,
      medio,
      titulo: txt(r.get('titulo')),
      url: txt(r.get('url')),
      keywords_detectadas: txt(r.get('keywords_detectadas')),
      grupo_tema: grupo,
      sentimiento: txt(r.get('sentimiento')),
      valoracion: txt(r.get('valoracion')),
      relevancia_editorial: relevancia,
      estado_editorial: estadoEditorial,
      prioridad: txt(r.get('prioridad')),
      requiere_alerta: txt(r.get('requiere_alerta')),
      cluster_id: txt(r.get('cluster_id')),
      cluster_tipo: txt(r.get('cluster_tipo')),
      texto_limpio_chars: txt(r.get('texto_limpio_chars')),
      medio_id: txt(r.get('medio_id')),
      fuente: txt(r.get('fuente')) || 'ethos',
      dedupe_key_final: dedupeFinal,
      estado_export: 'PREVIEW_PATRON',
      notas_editoriales: txt(r.get('razon_clasificacion')),
    });
    if (filas.length >= args.maxRows) break;
  }

  // Gate: verificar que no se cuele nada indebido y campos completos.
  const sinTitulo = filas.filter((f) => !txt(f.titulo)).length;
  const sinUrl = filas.filter((f) => !txt(f.url)).length;
  const camposIncompletos = filas.filter((f) => !txt(f.grupo_tema) || !txt(f.sentimiento) || !txt(f.valoracion)).length;

  logger.info(
    {
      candidatas_preview: filas.length,
      no_cli0002_omitidas: noCli0002,
      excluidas_por_relevancia: excluidasRelevancia,
      fuera_de_ventana: fueraVentana,
      duplicados_omitidos: duplicados,
      por_relevancia: porRelevancia,
      por_grupo_tema: porGrupoTema,
      top_medios: porMedio,
      gate_sin_titulo: sinTitulo,
      gate_sin_url: sinUrl,
      gate_campos_incompletos: camposIncompletos,
    },
    args.dryRun ? '[dry-run] Resumen preview Patrón — no se escribió nada' : 'Resumen preview Patrón',
  );

  for (const f of filas.slice(0, 12)) {
    logger.info({ medio: f.medio, titulo: String(f.titulo).slice(0, 80), rel: f.relevancia_editorial, grupo: f.grupo_tema, sent: f.sentimiento, val: f.valoracion }, '[preview] fila Patrón');
  }

  if (args.dryRun || args.output === 'console') {
    logger.info(
      { listo_para_preview: filas.length > 0 && sinTitulo === 0 && sinUrl === 0 },
      '=== FIN dry-run — NADA ESCRITO EN SHEETS ===',
    );
    return;
  }

  // ── Escritura real a tab 13 ─────────────────────────────────────────────────
  const ensure = await ensureSheetTabAndHeaders(args.targetTab, HEADERS);
  logger.info({ accion: ensure.accion, mismatch: ensure.mismatch }, 'ensureSheetTabAndHeaders (tab 13)');
  if (ensure.mismatch) { logger.error({}, 'MISMATCH en headers de la tab 13. Abortando.'); process.exit(1); }

  // Dedupe contra filas ya presentes en tab 13.
  const existentes = new Set<string>();
  try {
    const tab = await getOutputTab(args.targetTab);
    const prev = await tab.getRows();
    for (const r of prev) { const k = txt(r.get('dedupe_key_final')); if (k) existentes.add(k); }
  } catch { /* recién creada */ }

  const nuevas = filas.filter((f) => !existentes.has(txt(f.dedupe_key_final)));
  const dupTab = filas.length - nuevas.length;
  const escritas = await appendHistoryRows(args.targetTab, HEADERS, nuevas);

  const tab = await getOutputTab(args.targetTab);
  const despues = await tab.getRows();
  logger.info(
    { filas_escritas: escritas, duplicados_omitidos_tab: dupTab, filas_totales_tab: despues.length, run_id: runId },
    '=== Preview Patrón completado — tab 13 (append, sin envíos, sin hoja externa) ===',
  );
}

function esEntrypointCli(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (esEntrypointCli()) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

export { parseArgs };
