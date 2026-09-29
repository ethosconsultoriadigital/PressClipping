/**
 * Fast Lane operacional: News Lake -> enrich -> menciones consolidadas -> ETHOS_MENCIONES_MASTER.
 *
 * Cada ciclo:
 *   1) selecciona medios activos/seguros con la misma política de news-lake-capture
 *   2) procesa chunks con concurrencia acotada (crawl -> enrich)
 *   3) INMEDIATAMENTE después de cada chunk con crawl exitoso, busca noticias
 *      frescas con mínimo TÍTULO + DESCRIPCIÓN/RESUMEN + URL. Si el enrich ya
 *      produjo cuerpo limpio se aprovecha; si no, la descripción es suficiente.
 *      Aplica TODAS las keywords activas y consolida 1 fila por noticia + cliente
 *   4) append-only a MENCIONES_MASTER con dedupe cliente_id//noticia_id
 *
 * Guardrails:
 *   - NO inserta en menciones
 *   - NO marca menciones_procesado
 *   - NO WhatsApp / email / Twilio / alertas
 *   - NO toca Sheets finales de clientes
 */
import 'dotenv/config';
import { DateTime } from 'luxon';
import { pathToFileURL } from 'node:url';
import type { GoogleSpreadsheetWorksheet } from 'google-spreadsheet';
import { calcularPlan, procesarChunk, type NewsLakeCaptureArgs } from './news-lake-capture.js';
import { getSupabase } from '../src/supabase/client.js';
import { getAllClientes, getKeywordsActivas, type KeywordActivaRow } from '../src/supabase/repositories.js';
import { getSpreadsheetById, withSheetsRetry } from '../src/sheets/client.js';
import {
  matchKeyword,
  splitTerminos,
  PESOS_CAMPO,
  type CampoBuscable,
  type KeywordRule,
  type MatchResultado,
  type TipoKeyword,
} from '../src/matchers/keyword.js';
import { normalizeHeader, parseIntOrNull } from '../src/utils/parse.js';
import { logger } from '../src/utils/logger.js';

const DEFAULT_SHEET_ID = '1T4-RLnBrK0lp3p-r23hRjrJAmI03QLzBavWM3ZpcmOA';
const DEFAULT_TAB = 'MENCIONES_MASTER';
const OVERLAP_MINUTES = 90;
const MAX_CELL_CHARS = 49_000;
const APPEND_CHUNK = 100;
const TIPOS_VALIDOS: TipoKeyword[] = ['exacta', 'frase_exacta', 'contiene', 'booleana', 'exacta_contextual'];

interface Args {
  dryRun: boolean;
  sheetId: string;
  tab: string;
  maxMedios: number;
  chunkSize: number;
  chunkConcurrency: number;
  maxNotas: number;
  enrichLimit: number;
  windowDays: number;
  overlapMinutes: number;
}

interface MasterNewsRow {
  noticia_id: string;
  medio_id: string | null;
  medio_nombre: string | null;
  titulo: string | null;
  subtitulo: string | null;
  resumen: string | null;
  url_original: string | null;
  fecha_publicacion: string | null;
  fecha_captura: string | null;
  autor: string | null;
  seccion: string | null;
  texto_extraido: string | null;
  texto_nota_limpia: string | null;
  texto_cuerpo_nota: string | null;
  tipo_nota: string | null;
  calidad_extraccion: string | null;
}

interface MatchBundle {
  kw: KeywordActivaRow;
  result: MatchResultado;
}

type OutRow = Record<string, string | number | boolean | null>;

function parseArgs(argv: string[]): Args {
  const out: Args = {
    dryRun: false,
    sheetId: process.env['GOOGLE_MENTIONS_MASTER_SHEET_ID'] || DEFAULT_SHEET_ID,
    tab: process.env['GOOGLE_MENTIONS_MASTER_TAB'] || DEFAULT_TAB,
    maxMedios: 0,
    chunkSize: 5,
    chunkConcurrency: 3,
    maxNotas: 10,
    enrichLimit: 60,
    windowDays: 2,
    overlapMinutes: OVERLAP_MINUTES,
  };
  for (const arg of argv) {
    if (arg === '--dry-run') { out.dryRun = true; continue; }
    if (arg === '--no-dry-run') { out.dryRun = false; continue; }
    if (!arg.startsWith('--')) continue;
    const [key, ...rest] = arg.slice(2).split('=');
    const val = rest.join('=');
    switch (key) {
      case 'dry-run': out.dryRun = val === '' || val === 'true' || val === '1'; break;
      case 'sheet-id': if (val) out.sheetId = val; break;
      case 'tab': if (val) out.tab = val; break;
      case 'max-medios': out.maxMedios = parseIntOrNull(val) ?? out.maxMedios; break;
      case 'chunk-size': out.chunkSize = Math.max(1, parseIntOrNull(val) ?? out.chunkSize); break;
      case 'chunk-concurrency': out.chunkConcurrency = Math.max(1, Math.min(5, parseIntOrNull(val) ?? out.chunkConcurrency)); break;
      case 'max-notas': out.maxNotas = Math.max(1, parseIntOrNull(val) ?? out.maxNotas); break;
      case 'enrich-limit': out.enrichLimit = Math.max(1, parseIntOrNull(val) ?? out.enrichLimit); break;
      case 'window-days': out.windowDays = Math.max(1, parseIntOrNull(val) ?? out.windowDays); break;
      case 'overlap-minutes': out.overlapMinutes = Math.max(15, parseIntOrNull(val) ?? out.overlapMinutes); break;
    }
  }
  return out;
}

function toKeywordRule(kw: KeywordActivaRow): KeywordRule {
  const tipo: TipoKeyword = (TIPOS_VALIDOS as string[]).includes(kw.tipo_keyword)
    ? kw.tipo_keyword as TipoKeyword
    : 'contiene';
  return {
    keyword_id: kw.keyword_id,
    cliente_id: kw.cliente_id,
    keyword: kw.keyword,
    terminos: splitTerminos(kw.keyword, kw.alias_o_variantes),
    tipo,
    regla: kw.regla,
    contextoIncluir: splitTerminos(kw.contexto_incluir),
    contextoExcluir: splitTerminos(kw.contexto_excluir),
  };
}

function effectiveText(n: MasterNewsRow): string {
  return n.texto_cuerpo_nota ?? n.texto_nota_limpia ?? n.texto_extraido ?? n.resumen ?? '';
}

function searchableFields(n: MasterNewsRow): CampoBuscable[] {
  return [
    { nombre: 'titulo', texto: n.titulo ?? '', peso: PESOS_CAMPO.titulo! },
    { nombre: 'subtitulo', texto: n.subtitulo ?? '', peso: PESOS_CAMPO.subtitulo! },
    { nombre: 'resumen', texto: n.resumen ?? '', peso: PESOS_CAMPO.resumen! },
    { nombre: 'seccion', texto: n.seccion ?? '', peso: PESOS_CAMPO.seccion! },
    { nombre: 'texto_extraido', texto: effectiveText(n), peso: PESOS_CAMPO.texto_extraido! },
    { nombre: 'medio', texto: n.medio_nombre ?? '', peso: PESOS_CAMPO.medio! },
  ];
}

function localHour(iso: string | null): string {
  if (!iso) return '';
  const dt = DateTime.fromISO(iso, { setZone: true });
  if (!dt.isValid) return '';
  return dt.setZone('America/Mexico_City').toFormat('HH:mm:ss');
}

function latencyMinutes(publicada: string | null, matchedAt: string): number | null {
  if (!publicada) return null;
  const a = DateTime.fromISO(publicada, { setZone: true });
  const b = DateTime.fromISO(matchedAt, { setZone: true });
  if (!a.isValid || !b.isValid) return null;
  return Math.max(0, Math.round(b.diff(a, 'minutes').minutes));
}

function truncateForSheet(text: string): string {
  if (text.length <= MAX_CELL_CHARS) return text;
  const suffix = '\n\n[TRUNCADO POR LIMITE DE CELDA DE GOOGLE SHEETS]';
  return text.slice(0, MAX_CELL_CHARS - suffix.length) + suffix;
}

async function fetchFreshNews(medioIds: string[], sinceIso: string): Promise<MasterNewsRow[]> {
  const { data, error } = await getSupabase()
    .from('noticias')
    .select(
      'noticia_id, medio_id, titulo, subtitulo, resumen, url_original, fecha_publicacion, fecha_captura,' +
      ' autor, seccion, texto_extraido, texto_nota_limpia, texto_cuerpo_nota, tipo_nota, calidad_extraccion,' +
      ' medios(nombre_medio)',
    )
    .in('medio_id', medioIds)
    .gte('fecha_captura', sinceIso)
    .not('titulo', 'is', null)
    .not('resumen', 'is', null)
    .not('url_original', 'is', null)
    .neq('origen_cobertura', 'pressclipping_diagnostico')
    .order('fecha_captura', { ascending: true })
    .limit(2000);

  if (error) throw new Error(`No se pudieron leer noticias frescas: ${error.message}`);
  return (data ?? []).map((n: any) => ({
    noticia_id: n.noticia_id,
    medio_id: n.medio_id ?? null,
    medio_nombre: n.medios?.nombre_medio ?? null,
    titulo: n.titulo ?? null,
    subtitulo: n.subtitulo ?? null,
    resumen: n.resumen ?? null,
    url_original: n.url_original ?? null,
    fecha_publicacion: n.fecha_publicacion ?? null,
    fecha_captura: n.fecha_captura ?? null,
    autor: n.autor ?? null,
    seccion: n.seccion ?? null,
    texto_extraido: n.texto_extraido ?? null,
    texto_nota_limpia: n.texto_nota_limpia ?? null,
    texto_cuerpo_nota: n.texto_cuerpo_nota ?? null,
    tipo_nota: n.tipo_nota ?? null,
    calidad_extraccion: n.calidad_extraccion ?? null,
  })).filter((n: MasterNewsRow) =>
    Boolean(n.titulo?.trim()) &&
    Boolean(n.resumen?.trim()) &&
    Boolean(n.url_original?.trim()),
  );
}

function buildRows(
  news: MasterNewsRow[],
  keywordsByClient: Map<string, KeywordActivaRow[]>,
  clientNames: Map<string, string>,
): OutRow[] {
  const rows: OutRow[] = [];
  for (const n of news) {
    const campos = searchableFields(n);
    for (const [clientId, kws] of keywordsByClient.entries()) {
      const matches: MatchBundle[] = [];
      for (const kw of kws) {
        const result = matchKeyword(toKeywordRule(kw), campos);
        if (result) matches.push({ kw, result });
      }
      if (matches.length === 0) continue;

      matches.sort((a, b) => b.result.score - a.result.score);
      const best = matches[0]!;
      const matchedAt = new Date().toISOString();
      const dedupeKey = `${clientId.toLowerCase()}//${n.noticia_id.toLowerCase()}`;
      const uniqueKeywords = [...new Set(matches.map((m) => m.kw.keyword))];
      const uniqueKeywordIds = [...new Set(matches.map((m) => m.kw.keyword_id))];

      rows.push({
        'NOTICIA': n.noticia_id,
        'estanteria': clientNames.get(clientId) ?? clientId,
        'palabra': best.kw.keyword,
        'fecha_publicacion': n.fecha_publicacion ?? '',
        'fecha_captura': n.fecha_captura ?? '',
        'medio': n.medio_nombre ?? '',
        'horaPublicacion': localHour(n.fecha_publicacion),
        'HoraCaptura': localHour(n.fecha_captura),
        'titulo / titular': n.titulo ?? '',
        'nota completa': truncateForSheet(effectiveText(n)),
        'url': n.url_original ?? '',
        'sentimiento': '',
        'tema': '',
        'Valoracion del M': '',
        'AUTOR': n.autor ?? '',
        'cliente_id': clientId,
        'medio_id': n.medio_id ?? '',
        'keyword_id': best.kw.keyword_id,
        'keywords_matched': uniqueKeywords.join(' | '),
        'keyword_ids_matched': uniqueKeywordIds.join(' | '),
        'tipo_mencion': best.result.tipo_match.toUpperCase(),
        'campo_match': best.result.campo.toUpperCase(),
        'match_count': matches.length,
        'score_relevancia': best.result.score,
        'resumen': n.resumen ?? '',
        'seccion': n.seccion ?? '',
        'subtema': '',
        'relevancia_ia': '',
        'tipo_nota': n.tipo_nota ?? '',
        'calidad_extraccion': n.calidad_extraccion ?? '',
        'requiere_alerta': matches.some((m) => m.kw.alerta),
        'estado_revision': 'AUTO_MATCH',
        'matched_at': matchedAt,
        'dedupe_key': dedupeKey,
        'latencia_minutos': latencyMinutes(n.fecha_publicacion, matchedAt),
      });
    }
  }
  return rows;
}

async function loadExistingKeys(sheet: GoogleSpreadsheetWorksheet): Promise<Set<string>> {
  await withSheetsRetry(() => sheet.loadHeaderRow(), 'master loadHeaderRow');
  const norm = sheet.headerValues.map(normalizeHeader);
  if (!norm.includes(normalizeHeader('dedupe_key'))) {
    throw new Error('MENCIONES_MASTER no tiene columna dedupe_key');
  }
  const rows = await withSheetsRetry(() => sheet.getRows(), 'master read dedupe');
  const set = new Set<string>();
  for (const row of rows) {
    const key = String(row.get('dedupe_key') ?? '').trim().toLowerCase();
    if (key) set.add(key);
  }
  return set;
}

async function appendRows(
  sheet: GoogleSpreadsheetWorksheet,
  rows: OutRow[],
  existing: Set<string>,
  dryRun: boolean,
): Promise<{ appended: number; skipped: number }> {
  const unique: OutRow[] = [];
  for (const row of rows) {
    const key = String(row['dedupe_key'] ?? '').trim().toLowerCase();
    if (!key || existing.has(key)) continue;
    existing.add(key);
    unique.push(row);
  }
  if (dryRun || unique.length === 0) {
    return { appended: dryRun ? 0 : unique.length, skipped: rows.length - unique.length };
  }

  await withSheetsRetry(() => sheet.loadHeaderRow(), 'master reloadHeaderRow');
  const normToRaw = new Map<string, string>();
  for (const raw of sheet.headerValues) normToRaw.set(normalizeHeader(raw), raw);

  let appended = 0;
  for (let i = 0; i < unique.length; i += APPEND_CHUNK) {
    const chunk = unique.slice(i, i + APPEND_CHUNK).map((row) => {
      const mapped: Record<string, string | number | boolean> = {};
      for (const [key, value] of Object.entries(row)) {
        const header = normToRaw.get(normalizeHeader(key));
        if (!header || value === null) continue;
        mapped[header] = value;
      }
      return mapped;
    });
    await withSheetsRetry(() => sheet.addRows(chunk as any[]), 'master addRows');
    appended += chunk.length;
  }
  return { appended, skipped: rows.length - unique.length };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date();
  let sinceIso = new Date(startedAt.getTime() - args.overlapMinutes * 60_000).toISOString();

  const captureArgs: NewsLakeCaptureArgs = {
    dryRun: args.dryRun,
    maxMedios: args.maxMedios,
    maxNotas: args.maxNotas,
    enrichLimit: args.enrichLimit,
    windowDays: args.windowDays,
    chunkSize: args.chunkSize,
  };

  const [clients, keywords, plan] = await Promise.all([
    getAllClientes(),
    getKeywordsActivas(),
    calcularPlan(captureArgs),
  ]);

  const activeClients = new Map(
    clients.filter((c) => c.activo).map((c) => [c.cliente_id, c.nombre_cliente]),
  );
  const keywordsByClient = new Map<string, KeywordActivaRow[]>();
  for (const kw of keywords) {
    if (!kw.cliente_id || !activeClients.has(kw.cliente_id)) continue;
    const list = keywordsByClient.get(kw.cliente_id) ?? [];
    list.push(kw);
    keywordsByClient.set(kw.cliente_id, list);
  }

  let sheet: GoogleSpreadsheetWorksheet | null = null;
  let existingKeys = new Set<string>();
  if (!args.dryRun) {
    const doc = await getSpreadsheetById(args.sheetId);
    sheet = doc.sheetsByTitle[args.tab] ?? null;
    if (!sheet) throw new Error(`No existe pestaña ${args.tab} en ${args.sheetId}`);
    existingKeys = await loadExistingKeys(sheet);
    // Bootstrap inicial: si la Master todavía no tiene filas, sembrar desde la
    // misma ventana operativa (default 2 días) para que la primera corrida no
    // dependa exclusivamente de encontrar una mención nacida en los últimos 90 min.
    if (existingKeys.size === 0) {
      sinceIso = new Date(startedAt.getTime() - args.windowDays * 24 * 60 * 60_000).toISOString();
      logger.info(
        { bootstrap_since_iso: sinceIso, bootstrap_window_days: args.windowDays },
        'MENCIONES_MASTER vacía: bootstrap inicial de menciones recientes',
      );
    }
  }

  logger.info({
    dry_run: args.dryRun,
    medios: plan.medioIds.length,
    chunks: plan.chunks.length,
    chunk_size: args.chunkSize,
    chunk_concurrency: args.chunkConcurrency,
    clientes_activos: activeClients.size,
    keywords_activas: [...keywordsByClient.values()].reduce((a, b) => a + b.length, 0),
    since_iso: sinceIso,
    sheet_id: args.sheetId.slice(0, 8) + '...',
    tab: args.tab,
    minimo_export: 'titulo + resumen/descripcion + url',
    cuerpo_completo: 'best_effort_no_bloqueante',
  }, '=== MENTIONS MASTER FAST LANE start ===');

  let nextIndex = 0;
  let totalNews = 0;
  let totalMatches = 0;
  let totalAppended = 0;
  let totalSkipped = 0;
  let failedChunks = 0;

  const worker = async (workerId: number): Promise<void> => {
    while (true) {
      const index = nextIndex++;
      if (index >= plan.chunks.length) return;
      const chunk = plan.chunks[index]!;
      const result = await procesarChunk(chunk, captureArgs, index, plan.chunks.length);
      // La condición mínima para exportar NO es tener cuerpo completo.
      // Si el crawl funcionó, podemos publicar una mención con título +
      // descripción/resumen + URL aunque el enrich haya fallado o no haya
      // conseguido cuerpo. El enrich sigue siendo best-effort y, cuando existe,
      // mejora "nota completa".
      if (result.crawlCode !== 0) {
        failedChunks++;
        continue;
      }
      if (result.enrichCode !== 0) {
        logger.warn(
          { worker_id: workerId, chunk_index: index + 1, medios: chunk, enrich_code: result.enrichCode },
          'Enrich no quedó completo; se continúa con metadata mínima (título + descripción + URL)',
        );
      }

      if (args.dryRun) continue;

      const news = await fetchFreshNews(chunk, sinceIso);
      const rows = buildRows(news, keywordsByClient, activeClients);
      const write = await appendRows(sheet!, rows, existingKeys, false);
      totalNews += news.length;
      totalMatches += rows.length;
      totalAppended += write.appended;
      totalSkipped += write.skipped;

      logger.info({
        worker_id: workerId,
        chunk_index: index + 1,
        medios: chunk,
        noticias_frescas_elegibles: news.length,
        menciones_consolidadas: rows.length,
        appended_master: write.appended,
        skipped_dedupe: write.skipped,
      }, 'Chunk listo -> MENCIONES_MASTER actualizada inmediatamente');
    }
  };

  const workers = Array.from(
    { length: Math.min(args.chunkConcurrency, Math.max(1, plan.chunks.length)) },
    (_, i) => worker(i + 1),
  );
  await Promise.all(workers);

  logger.info({
    duration_ms: Date.now() - startedAt.getTime(),
    medios_plan: plan.medioIds.length,
    chunks: plan.chunks.length,
    chunks_fallidos: failedChunks,
    noticias_frescas_elegibles: totalNews,
    menciones_consolidadas: totalMatches,
    appended_master: totalAppended,
    skipped_dedupe: totalSkipped,
    no_whatsapp: true,
    no_email: true,
    no_twilio: true,
    no_menciones_db_write: true,
  }, '=== MENTIONS MASTER FAST LANE done ===');
}

function isEntrypoint(): boolean {
  const entry = process.argv[1];
  return !!entry && import.meta.url === pathToFileURL(entry).href;
}

if (isEntrypoint()) {
  main().catch((err) => {
    logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Fast Lane fatal');
    process.exit(1);
  });
}
