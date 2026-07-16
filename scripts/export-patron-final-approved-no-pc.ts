/**
 * Escritura final APROBADA a la hoja real `NoticiasPatron` (CLI-0002 / Patrón).
 *
 * Lee `13_Patron_Final_Preview` (propio, ya validado), clasifica cada fila con
 * el dictamen editorial GPT fijo (`src/editorial/patronApproval.ts`): 6
 * APROBADO, 3 REVISION_HUMANA (ninguna se infiere, es una lista explícita).
 * Solo las APROBADAS avanzan hacia `NoticiasPatron`; requieren además "nota
 * completa" (texto limpio ≥600 chars) desde Supabase — si falta, la fila NO
 * se escribe y queda marcada SIN_NOTA_COMPLETA.
 *
 * `NoticiasPatron` es una hoja EXTERNA real (no del Output Sheet propio). Por
 * eso escribir ahí requiere el flag explícito --allow-final-sheet=true (sin
 * él, --output=sheet solo previsualiza, nunca escribe fuera). Si el service
 * account no tiene acceso a esa hoja, aborta con mensaje claro (no crashea).
 *
 * NUNCA borra ni reemplaza filas de NoticiasPatron (solo append + dedupe).
 * NUNCA cambia headers. NO usa export-results/classify-ia/generate-xml.
 *
 * Uso:
 *   npm run export-patron-final-approved-no-pc -- --target-sheet-id=... --target-tab="NoticiasPatron" --allow-final-sheet=true --dry-run --max-rows=300
 *   npm run export-patron-final-approved-no-pc -- --target-sheet-id=... --target-tab="NoticiasPatron" --allow-final-sheet=true --output=sheet --max-rows=300
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { getSupabase } from '../src/supabase/client.js';
import { getOutputTab, getTabById, withSheetsRetry } from '../src/sheets/client.js';
import { ensureSheetTabAndHeaders, appendHistoryRows, type OutRow } from '../src/sheets/write.js';
import { logger } from '../src/utils/logger.js';
import { parseIntOrNull } from '../src/utils/parse.js';
import { clasificarAprobacion } from '../src/editorial/patronApproval.js';

const SOURCE_TAB_DEFAULT = '13_Patron_Final_Preview';
const REVISION_HUMANA_TAB = '15_Patron_Revision_Humana';
const MIN_CHARS_NOTA_COMPLETA = 600;
const REVISION_HUMANA_HEADERS = [
  'fecha_export', 'run_id', 'cliente_id', 'cliente_nombre', 'fecha_noticia', 'medio',
  'titulo', 'url', 'keywords_detectadas', 'grupo_tema', 'relevancia_editorial',
  'estado_editorial', 'razon_revision', 'dedupe_key_final',
];

/** Columnas críticas mínimas que DEBEN existir en NoticiasPatron. */
const COLUMNAS_CRITICAS = ['idnoticia', 'fecha_publicacion', 'medio', 'url'];
/** Headers completos esperados (para reportar faltantes/extra, no para escribir todas obligatoriamente). */
const HEADERS_ESPERADOS = [
  'idnoticia', 'estanteria', 'palabra', 'fecha_publicacion', 'medio', 'hora captura',
  'titulo', 'titular', 'nota completa', 'url', 'sentimiento', 'tema', 'hora_local',
  'ID Envio', 'Valoracion', 'FechaCaptura', 'HoraCaptura',
];

interface Args {
  sourceTab: string;
  targetSheetId?: string;
  targetTab?: string;
  output: 'console' | 'sheet';
  dryRun: boolean;
  maxRows: number;
  allowFinalSheet: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { sourceTab: SOURCE_TAB_DEFAULT, output: 'console', dryRun: false, maxRows: 300, allowFinalSheet: false };
  for (const arg of argv) {
    if (arg === '--dry-run') { out.dryRun = true; continue; }
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    const key = eq === -1 ? body : body.slice(0, eq);
    const val = eq === -1 ? '' : body.slice(eq + 1);
    if (key === 'source-tab') out.sourceTab = val || out.sourceTab;
    if (key === 'target-sheet-id') out.targetSheetId = val || undefined;
    if (key === 'target-tab') out.targetTab = val || undefined;
    if (key === 'output') out.output = (val as 'console' | 'sheet') || out.output;
    if (key === 'max-rows') out.maxRows = parseIntOrNull(val) ?? out.maxRows;
    if (key === 'allow-final-sheet') out.allowFinalSheet = /^(true|1|yes|si)$/i.test(val);
  }
  return out;
}

const txt = (v: unknown): string => String(v ?? '').trim();

function horaMexico(): { hora: string; fecha: string } {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const fmtFecha = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }); // YYYY-MM-DD
  return { hora: fmt.format(now), fecha: fmtFecha.format(now) };
}

/** estado_editorial que autoriza envío a NoticiasPatron (mismo criterio que tab 12→13). */
const ESTADO_GO = new Set(['GO_ALTA', 'GO_MEDIA']);

interface FilaTab13 {
  cliente_id: string; cliente_nombre: string; fecha_noticia: string; medio: string; titulo: string;
  url: string; keywords_detectadas: string; grupo_tema: string; sentimiento: string; valoracion: string;
  relevancia_editorial: string; estado_editorial: string; prioridad: string; requiere_alerta: string; cluster_id: string;
  cluster_tipo: string; texto_limpio_chars: string; medio_id: string; fuente: string; dedupe_key_final: string;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runId = `PATRON-APPROVED-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const fechaExport = new Date().toISOString();

  logger.info(
    { sourceTab: args.sourceTab, targetSheetId: args.targetSheetId ?? null, targetTab: args.targetTab ?? null, output: args.output, dryRun: args.dryRun, allowFinalSheet: args.allowFinalSheet, maxRows: args.maxRows },
    '=== Escritura final aprobada a NoticiasPatron (CLI-0002) ===',
  );

  // ── Guarda dura: escritura externa requiere --allow-final-sheet=true explícito ──
  const intentaEscribirExterno = args.output === 'sheet' && !args.dryRun;
  if (intentaEscribirExterno && !args.allowFinalSheet) {
    logger.error({}, 'Escribir en la hoja final externa requiere --allow-final-sheet=true explícito. Abortando (nada escrito).');
    process.exit(2);
  }
  if (intentaEscribirExterno && (!args.targetSheetId || !args.targetTab)) {
    logger.error({}, 'Faltan --target-sheet-id y/o --target-tab. Abortando (nada escrito).');
    process.exit(2);
  }

  // ── FASE 1: leer headers reales de NoticiasPatron (si hay destino configurado) ──
  let targetHeaders: string[] = [];
  let filasExistentesTarget: any[] = [];
  let accesoTargetOk = false;
  if (args.targetSheetId && args.targetTab) {
    try {
      const targetTab = await getTabById(args.targetSheetId, args.targetTab);
      await withSheetsRetry(() => targetTab.loadHeaderRow(), 'loadHeaderRow NoticiasPatron');
      targetHeaders = [...targetTab.headerValues];
      filasExistentesTarget = await withSheetsRetry(() => targetTab.getRows(), 'getRows NoticiasPatron');
      accesoTargetOk = true;
      logger.info({ headers: targetHeaders, filas_existentes: filasExistentesTarget.length }, 'Headers reales de NoticiasPatron leídos');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error({ error: msg, sheetId: args.targetSheetId, tab: args.targetTab }, 'NO SE PUDO LEER la hoja final NoticiasPatron (permiso/ID/tab). Abortando: no se escribirá nada.');
      if (intentaEscribirExterno) process.exit(2);
      // En dry-run seguimos para reportar el resto del diagnóstico, pero marcamos el bloqueo.
    }
  } else {
    logger.warn({}, 'No se especificó --target-sheet-id/--target-tab: solo se reportará clasificación, sin validar la hoja final.');
  }

  const columnasFaltantes = COLUMNAS_CRITICAS.filter(
    (c) => !targetHeaders.some((h) => h.trim().toLowerCase() === c.toLowerCase()),
  );
  const headersExtra = HEADERS_ESPERADOS.filter((h) => {
    const hLower = h.trim().toLowerCase();
    return !targetHeaders.some((th) => {
      const thLower = th.trim().toLowerCase();
      return thLower === hLower || thLower.split(/[/,]/).map((p) => p.trim()).includes(hLower);
    });
  });

  // ── Leer tab 13 (fuente propia) ─────────────────────────────────────────────
  const source = await getOutputTab(args.sourceTab);
  await source.loadHeaderRow();
  const rows = await source.getRows();
  const filas: FilaTab13[] = rows.map((r) => ({
    cliente_id: txt(r.get('cliente_id')),
    cliente_nombre: txt(r.get('cliente_nombre')),
    fecha_noticia: txt(r.get('fecha_noticia')),
    medio: txt(r.get('medio')),
    titulo: txt(r.get('titulo')),
    url: txt(r.get('url')),
    keywords_detectadas: txt(r.get('keywords_detectadas')),
    grupo_tema: txt(r.get('grupo_tema')),
    sentimiento: txt(r.get('sentimiento')),
    valoracion: txt(r.get('valoracion')),
    relevancia_editorial: txt(r.get('relevancia_editorial')),
    estado_editorial: txt(r.get('estado_editorial')),
    prioridad: txt(r.get('prioridad')),
    requiere_alerta: txt(r.get('requiere_alerta')),
    cluster_id: txt(r.get('cluster_id')),
    cluster_tipo: txt(r.get('cluster_tipo')),
    texto_limpio_chars: txt(r.get('texto_limpio_chars')),
    medio_id: txt(r.get('medio_id')),
    fuente: txt(r.get('fuente')),
    dedupe_key_final: txt(r.get('dedupe_key_final')),
  }));

  logger.info({ source_rows: filas.length }, 'Filas leídas de tab 13');

  // ── Clasificar: estado_editorial (reglas deterministas, repetible para notas
  // nuevas) con fallback a la lista fija del dictamen GPT (2026-07-13) solo para
  // filas legacy que no tienen la columna estado_editorial poblada. ──────────────
  const jumex = filas.filter((f) => f.cliente_id !== 'CLI-0002');
  const cli0002 = filas.filter((f) => f.cliente_id === 'CLI-0002');
  const aprobadas: FilaTab13[] = [];
  const revisionHumana: FilaTab13[] = [];
  for (const f of cli0002) {
    const aprobado = f.estado_editorial
      ? ESTADO_GO.has(f.estado_editorial)
      : clasificarAprobacion(f.titulo) === 'APROBADO'; // fallback legacy (sin estado_editorial)
    if (aprobado) aprobadas.push(f);
    else revisionHumana.push(f);
  }

  if (jumex.length > 0) {
    logger.warn({ jumex_omitidas: jumex.length }, 'Filas Jumex encontradas en tab 13 — omitidas (nunca se exportan a NoticiasPatron)');
  }

  // ── Obtener "nota completa" desde Supabase para las aprobadas ───────────────
  const sb = getSupabase();
  interface Preparada extends FilaTab13 { notaCompleta: string; notaCompletaOk: boolean; }
  const preparadas: Preparada[] = [];
  const sinNotaCompleta: FilaTab13[] = [];

  for (const f of aprobadas) {
    const { data } = await sb
      .from('noticias')
      .select('texto_cuerpo_nota, texto_nota_limpia, texto_extraido')
      .eq('url_original', f.url)
      .limit(1);
    const n = (data ?? [])[0];
    const nota = n?.texto_cuerpo_nota ?? n?.texto_nota_limpia ?? n?.texto_extraido ?? '';
    const ok = nota.length >= MIN_CHARS_NOTA_COMPLETA;
    if (ok) preparadas.push({ ...f, notaCompleta: nota, notaCompletaOk: true });
    else sinNotaCompleta.push(f);
  }

  // ── Dedupe contra filas existentes en NoticiasPatron ────────────────────────
  const urlsExistentes = new Set(filasExistentesTarget.map((r) => txt(r.get('url'))).filter(Boolean));
  const idsExistentes = new Set(filasExistentesTarget.map((r) => txt(r.get('idnoticia'))).filter(Boolean));

  function dedupeKeyFinal(f: Preparada): string {
    return `PATRON::${f.url}`;
  }

  const nuevas = preparadas.filter((f) => !urlsExistentes.has(f.url) && !idsExistentes.has(dedupeKeyFinal(f)));
  const duplicadosExistentes = preparadas.length - nuevas.length;

  const gate = {
    approved_rows: aprobadas.length,
    human_review_rows: revisionHumana.length,
    rows_with_full_text: preparadas.length,
    rows_missing_full_text: sinNotaCompleta.length,
    duplicates_existing: duplicadosExistentes,
    new_rows: nuevas.length,
    jumex_rows: jumex.length,
    missing_critical_columns: columnasFaltantes,
    target_headers: targetHeaders,
    acceso_target_ok: accesoTargetOk,
  };
  // NOTA: human_review_rows > 0 es NORMAL y esperado (3 filas retenidas a
  // propósito) — el gate NO exige que sea 0 globalmente. Lo que garantiza que
  // nunca se cuelen es que `nuevas` se construye exclusivamente a partir de
  // `aprobadas` (nunca de `revisionHumana`), verificado además explícitamente
  // aquí por seguridad (defensa en profundidad, no solo por construcción).
  const revisionHumanaEnEscritura = nuevas.some((f) => revisionHumana.some((r) => r.url === f.url));
  const readyToWrite =
    accesoTargetOk &&
    columnasFaltantes.length === 0 &&
    !revisionHumanaEnEscritura &&
    gate.jumex_rows === 0 &&
    gate.rows_missing_full_text === 0 &&
    gate.new_rows > 0;

  logger.info(
    { ...gate, headers_extra_faltantes_no_criticas: headersExtra, ready_to_write: readyToWrite },
    args.dryRun ? '[dry-run] Gate de escritura NoticiasPatron — no se escribió nada' : 'Gate de escritura NoticiasPatron',
  );

  for (const f of sinNotaCompleta) {
    logger.warn({ titulo: f.titulo.slice(0, 80), url: f.url, razon: 'SIN_NOTA_COMPLETA' }, '[bloqueada] fila aprobada sin nota completa suficiente');
  }
  for (const f of revisionHumana) {
    logger.info({ titulo: f.titulo.slice(0, 80) }, '[revisión humana] fila retenida (no va a NoticiasPatron)');
  }
  for (const f of nuevas.slice(0, 10)) {
    logger.info({ titulo: f.titulo.slice(0, 80), medio: f.medio, url: f.url, nota_chars: f.notaCompleta.length }, '[preview] fila lista para NoticiasPatron');
  }

  if (args.dryRun || args.output === 'console') {
    logger.info({ ready_to_write: readyToWrite }, '=== FIN dry-run — NADA ESCRITO EN NoticiasPatron ===');
    return;
  }

  // ── Revisión humana: escribir SIEMPRE en tab interna propia (Output Sheet),
  // independiente del gate de la hoja externa (nunca se escriben en NoticiasPatron). ──
  if (revisionHumana.length > 0) {
    const filasRevision: OutRow[] = revisionHumana.map((f) => ({
      fecha_export: fechaExport,
      run_id: runId,
      cliente_id: f.cliente_id,
      cliente_nombre: f.cliente_nombre,
      fecha_noticia: f.fecha_noticia,
      medio: f.medio,
      titulo: f.titulo,
      url: f.url,
      keywords_detectadas: f.keywords_detectadas,
      grupo_tema: f.grupo_tema,
      relevancia_editorial: f.relevancia_editorial,
      estado_editorial: f.estado_editorial || '(sin estado_editorial — clasificado por lista legacy)',
      razon_revision: f.estado_editorial === 'REVISAR'
        ? 'crisis/keyword sin confirmar en título — requiere revisión humana'
        : 'no aprobado por reglas editoriales (relevancia/estado no GO)',
      dedupe_key_final: f.dedupe_key_final,
    }));
    const ensureRevision = await ensureSheetTabAndHeaders(REVISION_HUMANA_TAB, REVISION_HUMANA_HEADERS);
    const existentesRevision = new Set<string>();
    try {
      const tabRevision = await getOutputTab(REVISION_HUMANA_TAB);
      const rowsRevision = await tabRevision.getRows();
      for (const r of rowsRevision) { const k = txt(r.get('dedupe_key_final')); if (k) existentesRevision.add(k); }
    } catch { /* recién creada */ }
    const nuevasRevision = filasRevision.filter((f) => !existentesRevision.has(String(f.dedupe_key_final)));
    const escritasRevision = await appendHistoryRows(REVISION_HUMANA_TAB, REVISION_HUMANA_HEADERS, nuevasRevision);
    logger.info(
      { accion: ensureRevision.accion, filas_escritas: escritasRevision, duplicados_omitidos: filasRevision.length - nuevasRevision.length },
      `Revisión humana escrita en ${REVISION_HUMANA_TAB} (tab interna, nunca en NoticiasPatron)`,
    );
  }

  if (!readyToWrite) {
    logger.error({ ...gate }, 'Gate NO cumplido. Abortando escritura a NoticiasPatron (nada escrito).');
    process.exit(1);
  }

  // ── Escritura real (append únicamente, nunca clear/replace, nunca headers) ──
  const targetTab = await getTabById(args.targetSheetId!, args.targetTab!);
  const { hora, fecha } = horaMexico();
  // Coincidencia exacta primero; si no, busca headers combinados por "/" o "," que
  // contengan el nombre como palabra completa (p.ej. real "titulo / titular"
  // cubre tanto set('titulo', …) como set('titular', …) sin duplicar columnas).
  const mapaCol = (nombreLower: string): string | undefined => {
    const exacto = targetHeaders.find((h) => h.trim().toLowerCase() === nombreLower);
    if (exacto) return exacto;
    return targetHeaders.find((h) =>
      h.toLowerCase().split(/[/,]/).map((p) => p.trim()).includes(nombreLower),
    );
  };

  const filasSalida = nuevas.map((f) => {
    const row: Record<string, string> = {};
    const set = (headerLower: string, valor: string) => {
      const real = mapaCol(headerLower);
      if (real) row[real] = valor;
    };
    set('idnoticia', dedupeKeyFinal(f));
    set('estanteria', f.grupo_tema);
    set('palabra', f.keywords_detectadas);
    set('fecha_publicacion', f.fecha_noticia);
    set('medio', f.medio);
    set('hora captura', hora);
    set('titulo', f.titulo);
    set('titular', f.titulo);
    set('nota completa', f.notaCompleta);
    set('url', f.url);
    set('sentimiento', f.sentimiento);
    set('tema', f.grupo_tema);
    set('hora_local', f.fecha_noticia || hora);
    set('id envio', `RUN-${Date.now()}`);
    set('valoracion', f.valoracion);
    set('fechacaptura', fecha);
    set('horacaptura', hora);
    return row;
  });

  await withSheetsRetry(() => targetTab.addRows(filasSalida), 'addRows NoticiasPatron');

  // Readback obligatorio.
  const targetTabReadback = await getTabById(args.targetSheetId!, args.targetTab!);
  await withSheetsRetry(() => targetTabReadback.loadHeaderRow(), 'loadHeaderRow(readback) NoticiasPatron');
  const filasDespues = await withSheetsRetry(() => targetTabReadback.getRows(), 'getRows(readback) NoticiasPatron');
  const headersDespues = [...targetTabReadback.headerValues];
  const mismatchHeaders = JSON.stringify(headersDespues) !== JSON.stringify(targetHeaders);

  logger.info(
    {
      filas_escritas: filasSalida.length,
      duplicados_omitidos: duplicadosExistentes,
      filas_totales_target_antes: filasExistentesTarget.length,
      filas_totales_target_despues: filasDespues.length,
      headers_mismatch: mismatchHeaders,
    },
    '=== Escritura final completada — NoticiasPatron (append, sin envíos) ===',
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

export { parseArgs, horaMexico };
