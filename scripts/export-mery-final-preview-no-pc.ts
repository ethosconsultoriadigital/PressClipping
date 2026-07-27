/**
 * Exportador controlado Mery Pozos: `menciones` CLI-MERY-TEST → tabs 16/17/18.
 *
 * Lee directamente de la tabla `menciones` de Supabase para CLI-MERY-TEST,
 * clasifica editorialmente (sin IA), deduplica por `noticia_id` y escribe en
 * tres tabs de la Output Sheet:
 *   16_Mery_Final_Preview   — MENCION_DIRECTA + CONTEXTO_POLITICO
 *   17_Mery_Revision_Humana — TEMA_RELACIONADO + POSIBLE_FP
 *   18_Mery_Excluidas       — EXCLUIR
 *
 * NO usa export-results, classify-ia, generate-xml, SMTP, Twilio, email/WhatsApp.
 * `alertas_activas=false` NO se modifica — solo lectura de menciones.
 *
 * Uso:
 *   npm run mery:no-pc:capture -- --window-days=30 --dry-run
 *   npm run mery:no-pc:capture -- --window-days=30 --output=sheet --max-rows=200
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { getSupabase } from '../src/supabase/client.js';
import { ensureSheetTabAndHeaders, appendHistoryRows, type OutRow } from '../src/sheets/write.js';
import { getOutputTab } from '../src/sheets/client.js';
import { normalizeUrl } from '../src/comparators/mentionMatcher.js';
import { logger } from '../src/utils/logger.js';
import { parseIntOrNull } from '../src/utils/parse.js';
import {
  clasificarMery,
  estadoEditorialMery,
  tabDestinoMery,
  razonClasificacionMery,
  detectGrupoTemaMery,
  PRIORIDAD_CAT,
  type CategoriaEditorialMery,
} from '../src/editorial/meryCriteria.js';

const CLI_ID = 'CLI-MERY-TEST';
const CLI_NOMBRE = 'Mery Pozos / Merilyn Gómez Pozos';

const PREVIEW_TAB = '16_Mery_Final_Preview';
const REVISION_TAB = '17_Mery_Revision_Humana';
const EXCLUIDAS_TAB = '18_Mery_Excluidas';

const NOTA_MAX_CHARS = 4000;
const EXTRACTO_MAX_CHARS = 600;

// ─────────────────────────────────────────────────────────────────────────────
// Patrones de boilerplate que se eliminan del cuerpo de la nota
// ─────────────────────────────────────────────────────────────────────────────

const BOILERPLATE_PATTERNS: RegExp[] = [
  /M[AÁ]S SOBRE ESTE TEMA[^\n]*/gi,
  /Ver m[aá]s en[^\n]*/gi,
  /[ÚU]nete a nuestro canal[^\n]*/gi,
  /Suscr[íi]bete[^\n]*/gi,
  /SUSCR[ÍI]BETE[^\n]*/gi,
  /Publicidad[^\n]*/gi,
  /PUBLICIDAD[^\n]*/gi,
  /Seguir leyendo[^\n]*/gi,
  /SEGUIR LEYENDO[^\n]*/gi,
  /Leer m[aá]s[^\n]*/gi,
  /LEE[R]? M[AÁ]S[^\n]*/gi,
  /TAMBI[EÉ]N TE PUEDE INTERESAR[^\n]*/gi,
  /Tambi[eé]n te puede interesar[^\n]*/gi,
  /NOTICIAS RELACIONADAS[^\n]*/gi,
  /Noticias relacionadas[^\n]*/gi,
  /Lee tambi[eé]n[^\n]*/gi,
  /Comparte este art[íi]culo[^\n]*/gi,
  /COMPARTE[^\n]*/gi,
  /Compartir[^\n]*/gi,
  /Comentarios[^\n]*/gi,
  /Haz clic[^\n]*/gi,
  /Facebook[^\n]*/gi,
  /Twitter[^\n]*/gi,
  /WhatsApp[^\n]*/gi,
  /Telegram[^\n]*/gi,
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de limpieza de texto (exportados para tests)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Limpieza determinística base: normaliza espacios, saltos y caracteres raros.
 * Preserva párrafos (máximo 2 saltos de línea consecutivos).
 */
export function cleanTextForSheet(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(/\t/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ ]{2,}/g, ' ')
    .trim();
}

/**
 * Elimina boilerplate del cuerpo de nota y limpia párrafos resultantes.
 * Sin IA — solo patrones determinísticos.
 */
export function buildNotaCompletaLimpia(
  raw: string | null | undefined,
  maxChars = NOTA_MAX_CHARS,
): { texto: string; truncada: boolean } {
  if (!raw) return { texto: '', truncada: false };
  let text = cleanTextForSheet(raw);
  for (const re of BOILERPLATE_PATTERNS) {
    text = text.replace(re, '');
  }
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  if (text.length <= maxChars) return { texto: text, truncada: false };
  const cortado = text.slice(0, maxChars).replace(/\s+\S*$/, '') + '…';
  return { texto: cortado, truncada: true };
}

/**
 * Extracto de una sola línea, centrado en la primera aparición del keyword.
 * Máximo `maxChars` caracteres, sin saltos de línea.
 */
export function buildExtractLimpio(
  raw: string | null | undefined,
  keyword: string,
  maxChars = EXTRACTO_MAX_CHARS,
): string {
  if (!raw) return '';
  const oneLine = cleanTextForSheet(raw)
    .replace(/\n+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (oneLine.length <= maxChars) return oneLine;

  const kwLower = (keyword ?? '').toLowerCase();
  const pos = kwLower ? oneLine.toLowerCase().indexOf(kwLower) : -1;
  if (pos === -1) return oneLine.slice(0, maxChars) + '…';

  const half = Math.floor(maxChars / 2);
  const start = Math.max(0, pos - half);
  const end = Math.min(oneLine.length, start + maxChars);
  const extract = oneLine.slice(start, end);
  return (start > 0 ? '…' : '') + extract + (end < oneLine.length ? '…' : '');
}

/**
 * Selecciona el mejor texto completo disponible para una noticia, siguiendo
 * la prioridad: texto_nota_limpia > texto_cuerpo_nota > texto_extraido > resumen > texto_match.
 */
export function selectBestText(n: {
  texto_nota_limpia?: string | null;
  texto_cuerpo_nota?: string | null;
  texto_extraido?: string | null;
  resumen?: string | null;
}, textoMatch: string): string {
  return (
    n?.texto_nota_limpia ||
    n?.texto_cuerpo_nota ||
    n?.texto_extraido ||
    n?.resumen ||
    textoMatch ||
    ''
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Headers — orden operativo para revisión humana
// ─────────────────────────────────────────────────────────────────────────────

export const HEADERS = [
  'fecha_export', 'run_id', 'cliente_id', 'cliente_nombre', 'medio', 'fecha_noticia',
  'titulo', 'url',
  'categoria_editorial', 'estado_editorial', 'keyword', 'keywords_detectadas', 'grupo_tema',
  'extracto_limpio', 'nota_completa_limpia', 'nota_completa_chars', 'nota_completa_truncada',
  'texto_limpio_chars', 'texto_limpio_ok',
  'razon_clasificacion', 'dedupe_key',
  // campos legacy — mantenidos para compatibilidad con filas anteriores
  'url_norm', 'sentimiento', 'valoracion', 'extracto_match',
];

export interface Args {
  windowDays: number;
  output: 'console' | 'sheet';
  dryRun: boolean;
  maxRows: number;
}

export function parseArgs(argv: string[]): Args {
  const out: Args = { windowDays: 30, output: 'console', dryRun: false, maxRows: 200 };
  for (const arg of argv) {
    if (arg === '--dry-run') { out.dryRun = true; continue; }
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    const key = eq === -1 ? body : body.slice(0, eq);
    const val = eq === -1 ? '' : body.slice(eq + 1);
    if (key === 'window-days') out.windowDays = parseIntOrNull(val) ?? out.windowDays;
    if (key === 'output') out.output = (val as 'console' | 'sheet') || out.output;
    if (key === 'max-rows') out.maxRows = parseIntOrNull(val) ?? out.maxRows;
  }
  return out;
}

const txt = (v: unknown): string => String(v ?? '').trim();

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sb = getSupabase();

  const runId = `MERY-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const fechaExport = new Date().toISOString();
  const isoDesde = new Date(Date.now() - args.windowDays * 24 * 60 * 60 * 1000).toISOString();

  logger.info(
    { cli: CLI_ID, windowDays: args.windowDays, output: args.output, dryRun: args.dryRun, maxRows: args.maxRows, isoDesde },
    '=== Exportador Mery Pozos → tabs 16/17/18 (sin envíos, alertas_activas intacto) ===',
  );

  // ── Leer menciones CLI-MERY-TEST ─────────────────────────────────────────
  const { data: raw, error } = await sb
    .from('menciones')
    .select(
      `mencion_id, noticia_id, keyword_id, keyword, texto_match, score_relevancia, sentimiento, tema,
       noticias!inner(titulo, url_original, resumen, fecha_publicacion,
                      texto_nota_limpia, texto_cuerpo_nota, texto_extraido,
                      medios(nombre_medio))`,
    )
    .eq('cliente_id', CLI_ID)
    .gte('created_at', isoDesde)
    .order('created_at', { ascending: false })
    .limit(args.maxRows * 10);

  if (error) { logger.error({ error: error.message }, 'Error leyendo menciones'); process.exit(1); }

  const menciones = (raw ?? []) as any[];
  logger.info({ total_menciones: menciones.length, desde: isoDesde }, 'Menciones cargadas desde DB');

  // ── Dedupe por noticia_id ─────────────────────────────────────────────────
  type Grupo = {
    noticia_id: string;
    titulo: string;
    url: string;
    url_norm: string;
    medio: string;
    fecha_noticia: string;
    texto_raw: string;           // mejor texto completo disponible
    texto_limpio_chars: number;
    texto_limpio_ok: boolean;
    sentimiento: string;
    tema: string;
    keywords_ids: string[];
    best_keyword: string;
    best_keyword_id: string;
    best_extracto_raw: string;  // texto_match original del mejor match
    categoria: CategoriaEditorialMery;
  };

  const grupos = new Map<string, Grupo>();

  for (const m of menciones) {
    const n = m.noticias;
    const titulo = txt(n?.titulo);
    const url = txt(n?.url_original);
    const urlNorm = normalizeUrl(url);
    const medio = txt(n?.medios?.nombre_medio);
    const fechaNoticia = txt(n?.fecha_publicacion);
    const textoMatch = txt(m.texto_match);
    const textoRaw = selectBestText(n, textoMatch);
    const keywordId = txt(m.keyword_id);
    const keyword = txt(m.keyword);
    const cat = clasificarMery(titulo, keywordId);

    if (!grupos.has(m.noticia_id)) {
      grupos.set(m.noticia_id, {
        noticia_id: m.noticia_id,
        titulo, url, url_norm: urlNorm, medio, fecha_noticia: fechaNoticia,
        texto_raw: textoRaw,
        texto_limpio_chars: textoRaw.length,
        texto_limpio_ok: textoRaw.length > 100,
        sentimiento: txt(m.sentimiento),
        tema: txt(m.tema),
        keywords_ids: [keywordId],
        best_keyword: keyword,
        best_keyword_id: keywordId,
        best_extracto_raw: textoMatch,
        categoria: cat,
      });
    } else {
      const g = grupos.get(m.noticia_id)!;
      if (!g.keywords_ids.includes(keywordId)) g.keywords_ids.push(keywordId);
      if (PRIORIDAD_CAT[cat] > PRIORIDAD_CAT[g.categoria]) {
        g.categoria = cat;
        g.best_keyword = keyword;
        g.best_keyword_id = keywordId;
        g.best_extracto_raw = textoMatch;
      }
      // Use the richest text available across all mentions of the same article
      if (textoRaw.length > g.texto_raw.length) g.texto_raw = textoRaw;
      if (!g.sentimiento && m.sentimiento) g.sentimiento = txt(m.sentimiento);
      if (!g.tema && m.tema) g.tema = txt(m.tema);
    }
  }

  const articulos = Array.from(grupos.values()).slice(0, args.maxRows);
  logger.info({ articulos: articulos.length, menciones_raw: menciones.length }, 'Deduplicación por noticia_id');

  // ── Construir filas ───────────────────────────────────────────────────────
  const porTab = new Map<string, OutRow[]>([
    [PREVIEW_TAB, []],
    [REVISION_TAB, []],
    [EXCLUIDAS_TAB, []],
  ]);

  const statsCat: Record<string, number> = {};
  let conNota = 0, sinNota = 0;

  for (const g of articulos) {
    statsCat[g.categoria] = (statsCat[g.categoria] ?? 0) + 1;
    const grupoTema = g.tema || detectGrupoTemaMery(g.titulo);
    const estado = estadoEditorialMery(g.categoria);
    const razon = razonClasificacionMery(g.categoria, g.titulo, g.best_keyword_id);
    const dedupeKey = `${CLI_ID}::${g.url_norm}`;

    // Texto limpio para salida
    const extractoLimpio = buildExtractLimpio(g.texto_raw || g.best_extracto_raw, g.best_keyword);
    const { texto: notaLimpia, truncada } = buildNotaCompletaLimpia(g.texto_raw);

    if (notaLimpia.length > 100) conNota++; else sinNota++;

    const fila: OutRow = {
      fecha_export: fechaExport,
      run_id: runId,
      cliente_id: CLI_ID,
      cliente_nombre: CLI_NOMBRE,
      medio: g.medio,
      fecha_noticia: g.fecha_noticia,
      titulo: g.titulo,
      url: g.url,
      categoria_editorial: g.categoria,
      estado_editorial: estado,
      keyword: g.best_keyword,
      keywords_detectadas: g.keywords_ids.join(', '),
      grupo_tema: grupoTema,
      extracto_limpio: extractoLimpio,
      nota_completa_limpia: notaLimpia,
      nota_completa_chars: String(notaLimpia.length),
      nota_completa_truncada: String(truncada),
      texto_limpio_chars: String(g.texto_limpio_chars),
      texto_limpio_ok: String(g.texto_limpio_ok),
      razon_clasificacion: razon,
      dedupe_key: dedupeKey,
      // legacy
      url_norm: g.url_norm,
      sentimiento: g.sentimiento,
      valoracion: '',
      extracto_match: g.best_extracto_raw.slice(0, 300),
    };

    const tab = tabDestinoMery(g.categoria);
    porTab.get(tab)!.push(fila);
  }

  logger.info(
    {
      articulos_total: articulos.length,
      por_categoria: statsCat,
      preview_tab: porTab.get(PREVIEW_TAB)!.length,
      revision_tab: porTab.get(REVISION_TAB)!.length,
      excluidas_tab: porTab.get(EXCLUIDAS_TAB)!.length,
      con_nota_completa: conNota,
      sin_nota_completa: sinNota,
    },
    args.dryRun ? '[dry-run] Clasificación Mery — nada escrito' : 'Clasificación Mery',
  );

  for (const f of [...porTab.get(PREVIEW_TAB)!, ...porTab.get(REVISION_TAB)!].slice(0, 12)) {
    logger.info(
      {
        medio: f.medio,
        titulo: String(f.titulo).slice(0, 70),
        cat: f.categoria_editorial,
        estado: f.estado_editorial,
        extracto_limpio_chars: String(f.extracto_limpio ?? '').length,
        nota_completa_chars: f.nota_completa_chars,
        nota_truncada: f.nota_completa_truncada,
      },
      '[preview] fila Mery',
    );
  }

  if (args.dryRun || args.output === 'console') {
    logger.info({ listo: articulos.length > 0, con_nota_completa: conNota }, '=== FIN dry-run — NADA ESCRITO EN SHEETS ===');
    return;
  }

  // ── Escritura a Sheets ────────────────────────────────────────────────────
  for (const [tabName, filas] of porTab.entries()) {
    const ensure = await ensureSheetTabAndHeaders(tabName, HEADERS);
    logger.info({ tab: tabName, accion: ensure.accion, mismatch: ensure.mismatch }, 'ensureSheetTabAndHeaders');
    if (ensure.mismatch) { logger.error({ tab: tabName }, 'MISMATCH headers. Abortando.'); process.exit(1); }

    const existentes = new Set<string>();
    try {
      const tab = await getOutputTab(tabName);
      const prev = await tab.getRows();
      for (const r of prev) { const k = txt(r.get('dedupe_key')); if (k) existentes.add(k); }
    } catch { /* tab recién creada */ }

    const nuevas = filas.filter((f) => !existentes.has(txt(f.dedupe_key)));
    const dupTab = filas.length - nuevas.length;

    if (nuevas.length > 0) {
      const escritas = await appendHistoryRows(tabName, HEADERS, nuevas);
      const tab = await getOutputTab(tabName);
      const despues = await tab.getRows();
      logger.info({ tab: tabName, escritas, dup_omitidos: dupTab, filas_totales: despues.length }, `Tab escrita`);
    } else {
      logger.info({ tab: tabName, dup_omitidos: dupTab }, `Tab sin filas nuevas`);
    }
  }

  logger.info({ run_id: runId }, '=== Mery Pozos export completado — sin envíos, alertas_activas intacto ===');
}

function esEntrypointCli(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (esEntrypointCli()) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

export { main };
