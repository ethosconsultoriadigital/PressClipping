/**
 * Exportador Mery Pozos → tab test_pressclipping (formato legacy A-I).
 *
 * Lee menciones CLI-MERY-TEST de Supabase, mapea al formato de 9 columnas
 * que usa la alerta Google RSS legacy (A=title … I=tema de la nota) y hace
 * append-only a la pestaña `test_pressclipping` del Google Sheet destino.
 *
 * NUNCA toca la pestaña NOTAS ENVIADAS MERYPOZOS.
 * NUNCA borra ni reescribe filas manuales existentes.
 * NUNCA activa alertas_activas, envíos, email, WhatsApp, Twilio, SMTP.
 * Dedupe doble: por `guid` Y por `link` contra filas ya escritas.
 * Readback obligatorio: reporta filas_nuevas, duplicados, mismatch.
 *
 * Prerrequisito: compartir el Google Sheet con el email de la cuenta de
 * servicio (GOOGLE_SERVICE_ACCOUNT_EMAIL) como Editor.
 *
 * Uso:
 *   npm run mery:export:test-pressclipping -- --window-hours=24 --dry-run
 *   npm run mery:export:test-pressclipping -- --window-hours=24 --output=sheet
 *   npm run mery:export:test-pressclipping -- --window-days=30 --output=sheet
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { getSupabase } from '../src/supabase/client.js';
import {
  retryPostgrest,
  describeSupabaseError,
  hintForSupabaseError,
} from '../src/supabase/errors.js';
import { getSpreadsheetById, getTabById, withSheetsRetry } from '../src/sheets/client.js';
import { appendRowsById, type OutRow } from '../src/sheets/write.js';
import { normalizeUrl } from '../src/comparators/mentionMatcher.js';
import { normalizeHeader } from '../src/utils/parse.js';
import { logger } from '../src/utils/logger.js';
import { parseIntOrNull } from '../src/utils/parse.js';
import {
  clasificarMery,
  estadoEditorialMery,
  detectGrupoTemaMery,
  razonClasificacionMery,
} from '../src/editorial/meryCriteria.js';
import {
  buildNotaCompletaLimpia,
  buildExtractLimpio,
  selectBestText,
} from './export-mery-final-preview-no-pc.js';

const CLI_ID = 'CLI-MERY-TEST';
const TAB_NOTAS_ENVIADAS = 'NOTAS ENVIADAS MERYPOZOS'; // NUNCA TOCAR
const DEFAULT_SPREADSHEET_ID = '1rWl-yDibT91AiELV-bkzaFiMTm6HY4JUSlBxiq-eNq8';
const DEFAULT_TAB = 'test_pressclipping';

/** Columnas exactas que debe tener test_pressclipping (orden legacy A-I). */
export const HEADERS_TEST_PRESSCLIPPING: string[] = [
  'title',
  'description',
  'link',
  'pubDate',
  'source',
  'guid',
  'status',
  'sentimiento',
  'tema de la nota',
];

// ─────────────────────────────────────────────────────────────────────────────
// Args
// ─────────────────────────────────────────────────────────────────────────────

export interface Args {
  spreadsheetId: string;
  tabName: string;
  windowDays: number;
  windowHours?: number;
  output: 'console' | 'sheet';
  dryRun: boolean;
  maxRows: number;
}

export function parseArgs(argv: string[]): Args {
  const out: Args = {
    spreadsheetId: DEFAULT_SPREADSHEET_ID,
    tabName: DEFAULT_TAB,
    windowDays: 30,
    output: 'console',
    dryRun: false,
    maxRows: 500,
  };
  for (const arg of argv) {
    if (arg === '--dry-run') { out.dryRun = true; continue; }
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    const key = eq === -1 ? body : body.slice(0, eq);
    const val = eq === -1 ? '' : body.slice(eq + 1);
    if (key === 'spreadsheet-id') out.spreadsheetId = val || out.spreadsheetId;
    if (key === 'tab-name') out.tabName = val || out.tabName;
    if (key === 'window-days') out.windowDays = parseIntOrNull(val) ?? out.windowDays;
    if (key === 'window-hours') out.windowHours = parseIntOrNull(val) ?? undefined;
    if (key === 'output') out.output = (val as 'console' | 'sheet') || out.output;
    if (key === 'max-rows') out.maxRows = parseIntOrNull(val) ?? out.maxRows;
  }
  // Safety: never activar envíos ni tocar tabs protegidas
  const safeStr = JSON.stringify(out);
  if (/email|smtp|twilio|whatsapp|alertas_activas/i.test(safeStr)) {
    throw new Error('Arg inválido detectado: email/smtp/twilio/whatsapp/alertas_activas no permitidos');
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapeo mencion → fila legacy A-I
// ─────────────────────────────────────────────────────────────────────────────

export interface MencionGrupo {
  noticia_id: string;
  titulo: string;
  url: string;
  url_norm: string;
  medio: string;
  fecha_noticia: string;
  texto_raw: string;
  extracto_limpio: string;
  sentimiento: string;
  tema: string;
  keyword: string;
  categoria_editorial: string;
  grupo_tema: string;
  razon_clasificacion: string;
}

/** Mapea un grupo de menciones al formato legacy A-I de test_pressclipping. */
export function mapToLegacyRow(g: MencionGrupo): OutRow {
  const status = ['MENCION_DIRECTA', 'CONTEXTO_POLITICO'].includes(g.categoria_editorial)
    ? 'ETHOS_TEST'
    : 'REVISION';
  const temaFinal = g.grupo_tema || g.razon_clasificacion || g.tema || '';
  return {
    title: g.titulo,
    description: g.extracto_limpio,
    link: g.url,
    pubDate: g.fecha_noticia ? g.fecha_noticia.slice(0, 10) : '',
    source: g.medio,
    guid: `MERY-ETHOS::${g.url_norm || g.url}`,
    status,
    sentimiento: g.sentimiento || 'Nota Neutral ⚪️',
    'tema de la nota': temaFinal,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Verificación de headers
// ─────────────────────────────────────────────────────────────────────────────

export interface HeadersResult {
  ok: boolean;
  headers_actuales: string[];
  faltantes: string[];
  extra: string[];
}

export async function verificarHeaders(spreadsheetId: string, tabName: string): Promise<HeadersResult> {
  const sheet = await getTabById(spreadsheetId, tabName);
  await withSheetsRetry(() => sheet.loadHeaderRow(), `loadHeaderRow ${tabName}`);
  const actuales = sheet.headerValues && sheet.headerValues.length > 0 ? [...sheet.headerValues] : [];
  const actualesNorm = new Set(actuales.map((h) => normalizeHeader(h)));
  const faltantes = HEADERS_TEST_PRESSCLIPPING.filter((h) => !actualesNorm.has(normalizeHeader(h)));
  const requeridasNorm = new Set(HEADERS_TEST_PRESSCLIPPING.map((h) => normalizeHeader(h)));
  const extra = actuales.filter((h) => !requeridasNorm.has(normalizeHeader(h)));
  return { ok: faltantes.length === 0, headers_actuales: actuales, faltantes, extra };
}

// ─────────────────────────────────────────────────────────────────────────────
// Carga de deduplicación desde la pestaña existente
// ─────────────────────────────────────────────────────────────────────────────

async function cargarDedupeKeys(spreadsheetId: string, tabName: string): Promise<{ guids: Set<string>; links: Set<string> }> {
  const guids = new Set<string>();
  const links = new Set<string>();
  try {
    const sheet = await getTabById(spreadsheetId, tabName);
    await withSheetsRetry(() => sheet.loadHeaderRow(), `loadHeaderRow(dedup) ${tabName}`);
    const rows = await withSheetsRetry(() => sheet.getRows(), `getRows(dedup) ${tabName}`);
    for (const r of rows) {
      const g = String(r.get('guid') ?? r.get('GUID') ?? '').trim();
      const l = String(r.get('link') ?? r.get('Link') ?? '').trim();
      if (g) guids.add(g);
      if (l) links.add(l);
    }
  } catch {
    // Pestaña vacía o sin filas → empezar desde cero
  }
  return { guids, links };
}

// ─────────────────────────────────────────────────────────────────────────────
// Lectura de menciones CLI-MERY-TEST desde Supabase
// ─────────────────────────────────────────────────────────────────────────────

async function cargarMenciones(isoDesde: string, maxRows: number): Promise<MencionGrupo[]> {
  const { data: raw, error } = await retryPostgrest('mery:cargarMenciones', () =>
    getSupabase()
      .from('menciones')
      .select(
        `mencion_id, noticia_id, keyword_id, keyword, texto_match, sentimiento, tema,
         noticias!inner(titulo, url_original, resumen, fecha_publicacion,
                        texto_nota_limpia, texto_cuerpo_nota, texto_extraido,
                        medios(nombre_medio))`,
      )
      .eq('cliente_id', CLI_ID)
      .gte('created_at', isoDesde)
      .order('created_at', { ascending: false })
      .limit(maxRows * 10),
  );

  // Reintenta solo lo transitorio (PGRST002/conexión); tabla/columna faltante o
  // permisos fallan de inmediato — reintentarlos solo esconde el bug real.
  if (error) {
    throw new Error(
      `Error leyendo menciones CLI-MERY-TEST: ${describeSupabaseError(error)}. ${hintForSupabaseError(error)}`,
    );
  }

  const grupos = new Map<string, MencionGrupo>();
  for (const m of (raw ?? []) as any[]) {
    if (grupos.has(m.noticia_id)) continue;
    const n = m.noticias ?? {};
    const titulo = String(n.titulo ?? '').trim();
    const url = String(n.url_original ?? '').trim();
    const medio = String(n.medios?.nombre_medio ?? '').trim();
    const textoMatch = String(m.texto_match ?? '').trim();
    const textoRaw = selectBestText(n, textoMatch);
    const keyword = String(m.keyword ?? '').trim();
    const keywordId = String(m.keyword_id ?? '').trim();
    const cat = clasificarMery(titulo, keywordId, textoRaw || undefined);
    if (cat === 'EXCLUIR') continue; // no exportar EXCLUIDAS
    const estado = estadoEditorialMery(cat);
    const grupoTema = detectGrupoTemaMery(titulo);
    const razon = razonClasificacionMery(cat, titulo, keywordId);
    const { texto: notaLimpia } = buildNotaCompletaLimpia(textoRaw);
    const extracto = buildExtractLimpio(notaLimpia || textoRaw, keyword, 600);
    const fechaPub = String(n.fecha_publicacion ?? '').trim();

    grupos.set(m.noticia_id, {
      noticia_id: m.noticia_id,
      titulo,
      url,
      url_norm: normalizeUrl(url),
      medio,
      fecha_noticia: fechaPub,
      texto_raw: textoRaw,
      extracto_limpio: extracto,
      sentimiento: String(m.sentimiento ?? '').trim(),
      tema: String(m.tema ?? '').trim(),
      keyword,
      categoria_editorial: cat,
      grupo_tema: grupoTema,
      razon_clasificacion: razon,
    });

    if (grupos.size >= maxRows) break;
  }

  return [...grupos.values()];
}

// ─────────────────────────────────────────────────────────────────────────────
// Reporte de resultado
// ─────────────────────────────────────────────────────────────────────────────

export interface ExportResult {
  headers_ok: boolean;
  faltantes: string[];
  filas_nuevas: number;
  duplicados_omitidos: number;
  filas_totales_estimado: number;
  mismatch: boolean;
  tab: string;
  spreadsheet_id: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<ExportResult> {
  const args = parseArgs(process.argv.slice(2));
  const ventanaMs = args.windowHours != null
    ? args.windowHours * 60 * 60 * 1000
    : args.windowDays * 24 * 60 * 60 * 1000;
  const isoDesde = new Date(Date.now() - ventanaMs).toISOString();
  const ventanaLabel = args.windowHours != null ? `${args.windowHours}h` : `${args.windowDays}d`;

  logger.info(
    {
      spreadsheetId: args.spreadsheetId, tab: args.tabName,
      ventana: ventanaLabel, dryRun: args.dryRun, output: args.output,
      NEVER_TOUCH: TAB_NOTAS_ENVIADAS,
    },
    '=== Mery export → test_pressclipping (sin envíos, alertas_activas intacto) ===',
  );

  // ── 1. Verificar headers del destino ─────────────────────────────────────
  const headersRes = await verificarHeaders(args.spreadsheetId, args.tabName);
  logger.info(headersRes, '[1] Verificación de headers en destino');
  if (!headersRes.ok) {
    logger.error({ faltantes: headersRes.faltantes }, 'MISMATCH HEADERS — abortando. Crear tab con los headers exactos.');
    const result: ExportResult = {
      headers_ok: false, faltantes: headersRes.faltantes,
      filas_nuevas: 0, duplicados_omitidos: 0, filas_totales_estimado: 0,
      mismatch: true, tab: args.tabName, spreadsheet_id: args.spreadsheetId,
    };
    return result;
  }

  // ── 2. Cargar menciones Mery de Supabase ─────────────────────────────────
  const menciones = await cargarMenciones(isoDesde, args.maxRows);
  logger.info({ total: menciones.length, desde: isoDesde }, '[2] Menciones Mery cargadas');

  // ── 3. Cargar guids/links existentes para dedup ───────────────────────────
  const { guids: guidsExistentes, links: linksExistentes } = await cargarDedupeKeys(args.spreadsheetId, args.tabName);
  logger.info({ guids: guidsExistentes.size, links: linksExistentes.size }, '[3] Dedup keys cargadas');

  // ── 4. Mapear y filtrar duplicados ────────────────────────────────────────
  const filas: OutRow[] = [];
  let dupOmitidos = 0;
  for (const m of menciones) {
    const row = mapToLegacyRow(m);
    const guid = String(row['guid'] ?? '');
    const link = String(row['link'] ?? '');
    if (guidsExistentes.has(guid) || linksExistentes.has(link)) {
      dupOmitidos++;
      continue;
    }
    filas.push(row);
    // Registrar para dedup dentro del mismo lote
    if (guid) guidsExistentes.add(guid);
    if (link) linksExistentes.add(link);
  }
  logger.info({ filas_nuevas: filas.length, dup_omitidos: dupOmitidos }, '[4] Filtrado de duplicados');

  for (const f of filas.slice(0, 10)) {
    logger.info(
      { title: String(f['title'] ?? '').slice(0, 70), source: f['source'], status: f['status'] },
      '[preview] fila candidata',
    );
  }

  if (args.dryRun || args.output === 'console') {
    logger.info({ filas_nuevas: filas.length }, '=== DRY-RUN — NADA ESCRITO EN SHEETS ===');
    return {
      headers_ok: true, faltantes: [],
      filas_nuevas: filas.length, duplicados_omitidos: dupOmitidos,
      filas_totales_estimado: guidsExistentes.size,
      mismatch: false, tab: args.tabName, spreadsheet_id: args.spreadsheetId,
    };
  }

  // ── 5. Escritura append-only en test_pressclipping ────────────────────────
  if (filas.length === 0) {
    logger.info({}, '[5] Sin filas nuevas — nada que escribir');
    return {
      headers_ok: true, faltantes: [],
      filas_nuevas: 0, duplicados_omitidos: dupOmitidos,
      filas_totales_estimado: guidsExistentes.size,
      mismatch: false, tab: args.tabName, spreadsheet_id: args.spreadsheetId,
    };
  }

  const escritas = await appendRowsById(args.spreadsheetId, args.tabName, filas);

  // ── 6. Readback ───────────────────────────────────────────────────────────
  const sheet = await getTabById(args.spreadsheetId, args.tabName);
  const rowsPost = await withSheetsRetry(() => sheet.getRows(), `getRows(readback) ${args.tabName}`);
  const filasTotales = rowsPost.length;
  const mismatch = escritas !== filas.length;

  logger.info(
    { escritas, filas_totales: filasTotales, dup_omitidos: dupOmitidos, mismatch },
    '[6] Readback post-escritura',
  );

  if (mismatch) {
    logger.error({ escritas, esperadas: filas.length }, 'MISMATCH en escritura — revisar cuota/permisos');
  }

  logger.info({}, `=== Mery export → ${args.tabName} completado — NO ENVIADOS, alertas_activas intacto ===`);

  return {
    headers_ok: true, faltantes: [],
    filas_nuevas: escritas, duplicados_omitidos: dupOmitidos,
    filas_totales_estimado: filasTotales,
    mismatch, tab: args.tabName, spreadsheet_id: args.spreadsheetId,
  };
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
