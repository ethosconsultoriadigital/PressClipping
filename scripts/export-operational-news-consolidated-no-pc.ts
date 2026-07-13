/**
 * Exportador CONSOLIDADO editorial (operación sin PressClipping) — tab 12.
 *
 * Lee las mismas fuentes que el staging (Supabase: menciones + noticias) pero,
 * en vez de una fila por mención (tab 11), produce una fila por NOTICIA
 * (cliente_id + url_norm), fusionando keywords y aplicando reglas editoriales
 * DETERMINÍSTICAS (relevancia, grupo_tema, sentimiento, valoración, fp_flags),
 * SIN classify-ia. Escribe en `12_Operacion_Consolidada_Sin_PressClipping` con
 * readback obligatorio. No usa export-results, no genera XML, no envía nada.
 *
 * Uso:
 *   npm run export-operational-news-consolidated-no-pc -- --clients=CLI-0001,CLI-0002 --window-days=7 --dry-run --max-rows=500
 *   npm run export-operational-news-consolidated-no-pc -- --clients=CLI-0001,CLI-0002 --window-days=7 --output=sheet --max-rows=500
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { getSupabase } from '../src/supabase/client.js';
import { ensureSheetTabAndHeaders, appendHistoryRows, replaceOutputRows, type OutRow } from '../src/sheets/write.js';
import { getOutputTab } from '../src/sheets/client.js';
import { canonicalizeUrl } from '../src/normalizers/url.js';
import { logger } from '../src/utils/logger.js';
import { parseIntOrNull } from '../src/utils/parse.js';
import { consolidar, type FilaCruda } from '../src/editorial/consolidation.js';

const TAB = '12_Operacion_Consolidada_Sin_PressClipping';
const HEADERS = [
  'fecha_export', 'run_id', 'cliente_id', 'cliente_nombre', 'estado_operativo',
  'medio', 'fecha_noticia', 'titulo', 'url', 'url_norm', 'keywords_detectadas',
  'keywords_count', 'grupo_tema', 'sentimiento', 'valoracion', 'relevancia_editorial',
  'requiere_alerta', 'prioridad', 'cluster_id', 'cluster_tipo', 'texto_limpio_chars',
  'texto_limpio_ok', 'fuente', 'medio_id', 'dedupe_key_consolidado', 'fp_flags',
  'estado_editorial', 'estado_export', 'razon_clasificacion', 'notas',
];

interface Args {
  clients: string[];
  windowHours?: number;
  windowDays?: number;
  output: 'console' | 'sheet';
  dryRun: boolean;
  maxRows: number;
  /** Reconstruye la tab 12 desde cero (clear + rewrite) en vez de append+dedupe.
   *  Útil tras cambiar reglas editoriales/keywords para reflejar clasificación fresca. */
  replace: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { clients: [], output: 'console', dryRun: false, maxRows: 500, replace: false };
  for (const arg of argv) {
    if (arg === '--dry-run') { out.dryRun = true; continue; }
    if (arg === '--replace') { out.replace = true; continue; }
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    const key = eq === -1 ? body : body.slice(0, eq);
    const val = eq === -1 ? '' : body.slice(eq + 1);
    if (key === 'clients') out.clients = val.split(',').map((s) => s.trim()).filter(Boolean);
    if (key === 'window-hours') out.windowHours = parseIntOrNull(val) ?? undefined;
    if (key === 'window-days') out.windowDays = parseIntOrNull(val) ?? undefined;
    if (key === 'output') out.output = (val as 'console' | 'sheet') || out.output;
    if (key === 'max-rows') out.maxRows = parseIntOrNull(val) ?? out.maxRows;
  }
  return out;
}

function windowMs(args: Args): number {
  if (args.windowHours != null) return args.windowHours * 60 * 60 * 1000;
  if (args.windowDays != null) return args.windowDays * 24 * 60 * 60 * 1000;
  return 7 * 24 * 60 * 60 * 1000;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.clients.length === 0) {
    console.error('Falta --clients=CLI-0001,CLI-0002. Abortando (nada leído/escrito).');
    process.exit(1);
  }

  const runId = `CONS-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const fechaExport = new Date().toISOString();
  const sb = getSupabase();

  logger.info(
    { clients: args.clients, windowHours: args.windowHours ?? null, windowDays: args.windowDays ?? null, output: args.output, dryRun: args.dryRun, maxRows: args.maxRows, runId },
    '=== Exportador CONSOLIDADO editorial (sin PressClipping) ===',
  );

  const isoDesde = new Date(Date.now() - windowMs(args)).toISOString();

  const { data: clientesRaw } = await sb.from('clientes').select('cliente_id, nombre_cliente').in('cliente_id', args.clients);
  const clientesMap = new Map((clientesRaw ?? []).map((c: any) => [c.cliente_id, c.nombre_cliente]));

  const { data: keywordsRaw } = await sb.from('keywords').select('keyword_id, prioridad');
  const prioridadPorKeyword = new Map((keywordsRaw ?? []).map((k: any) => [k.keyword_id, k.prioridad ?? '']));

  const { data: mencionesRaw, error: errMen } = await sb
    .from('menciones')
    .select(
      'mencion_id, cliente_id, keyword_id, keyword, requiere_alerta, created_at,' +
      ' noticias(noticia_id, medio_id, titulo, url_original, fecha_publicacion, texto_cuerpo_nota, texto_nota_limpia, texto_extraido, medios(nombre_medio))',
    )
    .in('cliente_id', args.clients)
    .gte('created_at', isoDesde)
    .order('created_at', { ascending: false })
    .limit(args.maxRows);
  if (errMen) { logger.error({ error: errMen.message }, 'Error leyendo menciones'); process.exit(1); }
  const menciones = (mencionesRaw ?? []) as any[];

  // ── Mapear a FilaCruda (equivalente a las filas de la tab 11) ──────────────
  const filasCrudas: FilaCruda[] = [];
  for (const m of menciones) {
    const n = m.noticias;
    if (!n) continue;
    const urlOriginal = n.url_original ?? '';
    const urlNorm = urlOriginal ? canonicalizeUrl(urlOriginal) : '';
    const textoEfectivo = n.texto_cuerpo_nota ?? n.texto_nota_limpia ?? n.texto_extraido ?? '';
    filasCrudas.push({
      cliente_id: m.cliente_id,
      cliente_nombre: clientesMap.get(m.cliente_id) ?? m.cliente_id,
      medio: n.medios?.nombre_medio ?? '(desconocido)',
      medio_id: n.medio_id ?? '',
      fecha_noticia: n.fecha_publicacion ?? '',
      titulo: n.titulo ?? '',
      url: urlOriginal,
      url_norm: urlNorm,
      keyword: m.keyword ?? '',
      requiere_alerta: m.requiere_alerta === true,
      prioridad: prioridadPorKeyword.get(m.keyword_id) ?? '',
      texto_limpio_chars: textoEfectivo.length,
      texto_limpio_ok: Boolean(n.texto_cuerpo_nota || n.texto_nota_limpia),
    fuente: 'ethos',
    });
  }

  // ── Consolidar (pura, determinística) ──────────────────────────────────────
  const consolidadas = consolidar(filasCrudas);

  // ── Resumen ────────────────────────────────────────────────────────────────
  const porCliente: Record<string, number> = {};
  const porRelevancia: Record<string, number> = {};
  const porGrupoTema: Record<string, number> = {};
  const porEstadoEditorial: Record<string, number> = {};
  let museoJumexExcluidos = 0;
  let posiblesFp = 0;
  for (const c of consolidadas) {
    porCliente[c.cliente_id] = (porCliente[c.cliente_id] ?? 0) + 1;
    porRelevancia[c.clasificacion.relevancia_editorial] = (porRelevancia[c.clasificacion.relevancia_editorial] ?? 0) + 1;
    porGrupoTema[c.clasificacion.grupo_tema] = (porGrupoTema[c.clasificacion.grupo_tema] ?? 0) + 1;
    porEstadoEditorial[c.clasificacion.estado_editorial] = (porEstadoEditorial[c.clasificacion.estado_editorial] ?? 0) + 1;
    if (c.clasificacion.estado_editorial === 'MUSEO_JUMEX_EXCLUIR') museoJumexExcluidos++;
    if (c.clasificacion.relevancia_editorial === 'POSIBLE_FP') posiblesFp++;
  }

  logger.info(
    {
      filas_raw_origen: filasCrudas.length,
      filas_consolidadas: consolidadas.length,
      reduccion: filasCrudas.length - consolidadas.length,
      por_cliente: porCliente,
      por_relevancia: porRelevancia,
      por_grupo_tema: porGrupoTema,
      por_estado_editorial: porEstadoEditorial,
      museo_jumex_excluidos: museoJumexExcluidos,
      posibles_fp: posiblesFp,
    },
    args.dryRun ? '[dry-run] Resumen consolidación — no se escribió nada' : 'Resumen consolidación',
  );

  // ── Construir filas de salida ──────────────────────────────────────────────
  const filas: OutRow[] = consolidadas.map((c) => ({
    fecha_export: fechaExport,
    run_id: runId,
    cliente_id: c.cliente_id,
    cliente_nombre: c.cliente_nombre,
    estado_operativo: 'OPERATIVO_INTERNO',
    medio: c.medio,
    fecha_noticia: c.fecha_noticia,
    titulo: c.titulo,
    url: c.url,
    url_norm: c.url_norm,
    keywords_detectadas: c.keywords_detectadas.join(' | '),
    keywords_count: c.keywords_count,
    grupo_tema: c.clasificacion.grupo_tema,
    sentimiento: c.clasificacion.sentimiento,
    valoracion: c.clasificacion.valoracion,
    relevancia_editorial: c.clasificacion.relevancia_editorial,
    requiere_alerta: c.requiere_alerta,
    prioridad: c.prioridad,
    cluster_id: c.dedupe_key_consolidado, // 1 noticia = 1 cluster editorial (por url_norm)
    cluster_tipo: c.keywords_count > 1 ? 'MULTI_KEYWORD' : 'SINGLE_KEYWORD',
    texto_limpio_chars: c.texto_limpio_chars,
    texto_limpio_ok: c.texto_limpio_ok,
    fuente: c.fuente,
    medio_id: c.medio_id,
    dedupe_key_consolidado: c.dedupe_key_consolidado,
    fp_flags: c.clasificacion.fp_flags.join(','),
    estado_editorial: c.clasificacion.estado_editorial,
    estado_export: c.clasificacion.estado_editorial === 'MUSEO_JUMEX_EXCLUIR' ? 'EXCLUIDO' : 'CONSOLIDADO',
    razon_clasificacion: c.clasificacion.razon_clasificacion,
    notas: '',
  }));

  // Ejemplos legibles para auditoría.
  for (const f of filas.slice(0, 12)) {
    logger.info(
      { cliente: f.cliente_id, medio: f.medio, titulo: String(f.titulo).slice(0, 80), kws: f.keywords_detectadas, rel: f.relevancia_editorial, grupo: f.grupo_tema, estado: f.estado_editorial, razon: f.razon_clasificacion },
      '[consolidada] fila',
    );
  }

  if (args.dryRun || args.output === 'console') {
    const patron = porCliente['CLI-0002'] ?? 0;
    const jumex = porCliente['CLI-0001'] ?? 0;
    logger.info(
      {
        listo_para_sheet: consolidadas.length > 0,
        patron_consolidadas: patron,
        jumex_consolidadas: jumex,
        museo_jumex_excluidos: museoJumexExcluidos,
      },
      '=== FIN dry-run — NADA ESCRITO EN SHEETS ===',
    );
    return;
  }

  // ── Escritura real ─────────────────────────────────────────────────────────
  const ensure = await ensureSheetTabAndHeaders(TAB, HEADERS);
  logger.info({ accion: ensure.accion, mismatch: ensure.mismatch, columnas_agregadas: ensure.columnas_agregadas }, 'ensureSheetTabAndHeaders (tab 12)');
  if (ensure.mismatch) { logger.error({}, 'MISMATCH en headers de la tab 12. Abortando antes de escribir filas.'); process.exit(1); }

  if (args.replace) {
    // Modo replace: reconstruye la tab desde cero (refleja clasificación fresca).
    const escritas = await replaceOutputRows(TAB, filas);
    const tab = await getOutputTab(TAB);
    const rowsDespues = await tab.getRows();
    logger.info(
      { modo: 'replace', filas_escritas: escritas, filas_totales_tab: rowsDespues.length, run_id: runId },
      '=== Export consolidado completado — tab 12 (REPLACE, sin envíos) ===',
    );
    return;
  }

  // Dedupe contra filas ya presentes por dedupe_key_consolidado (append por default).
  const existentes = new Set<string>();
  try {
    const tab = await getOutputTab(TAB);
    const rows = await tab.getRows();
    for (const r of rows) {
      const k = String(r.get('dedupe_key_consolidado') ?? '').trim();
      if (k) existentes.add(k);
    }
  } catch { /* recién creada */ }

  const nuevas = filas.filter((f) => !existentes.has(String(f.dedupe_key_consolidado)));
  const duplicados = filas.length - nuevas.length;
  const escritas = await appendHistoryRows(TAB, HEADERS, nuevas);

  const tab = await getOutputTab(TAB);
  const rowsDespues = await tab.getRows();
  logger.info(
    { filas_escritas: escritas, duplicados_omitidos: duplicados, filas_totales_tab: rowsDespues.length, run_id: runId },
    '=== Export consolidado completado — tab 12 (append, sin envíos) ===',
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
