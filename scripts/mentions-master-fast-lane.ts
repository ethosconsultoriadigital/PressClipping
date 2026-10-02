/**
 * Fast Lane operacional: News Lake -> enrich -> menciones consolidadas -> ETHOS_MENCIONES_MASTER.
 *
 * Cada ciclo:
 *   1) selecciona medios activos/seguros con la misma política de news-lake-capture
 *   2) procesa chunks con concurrencia acotada (crawl -> enrich)
 *   3) INMEDIATAMENTE después de cada chunk con crawl exitoso, busca noticias
 *      MATCHABLE (noticia_id + al menos un campo textual confiable). Título,
 *      resumen y URL ya no son requisitos. RAW texto_extraido no cuenta.
 *      Aplica TODAS las keywords activas y consolida 1 fila por noticia + cliente
 *   4) Global News Lake sweep (sin crawl): matching sobre noticias recientes
 *      ya existentes, aunque el medio no esté en el capture plan
 *   5) append-only a MENCIONES_MASTER con dedupe cliente_id//noticia_id
 *
 * CAPTURE ELIGIBILITY ≠ MATCHING ELIGIBILITY.
 * Capture: solo medios seguros/crawleables.
 * Matching: cualquier noticia reciente elegible del News Lake.
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
import { matchKeyword, type CampoBuscable, type MatchResultado } from '../src/matchers/keyword.js';
import { toKeywordRule } from '../src/matching/detectMentionsCore.js';
import { buildMentionScope } from '../src/matching/controlPlaneScope.js';
import {
  buildTrustedMatchingFields,
  hasTrustedSearchableText,
  type MatchingMode,
} from '../src/matching/trustedBody.js';
import {
  describeMasterBodyPolicy,
  isBodyCampo,
  keywordGetsTrustedBody,
  type MasterBodyPolicy,
} from '../src/matching/masterBodyCanary.js';
import { LIVE_WINDOW_HOURS, RECOVERY_WINDOW_HOURS, DEEP_RECOVERY_WINDOW_HOURS } from '../src/matching/matchWindows.js';
import { emptyBodyMatchingCounters, type BodyMatchingCounters } from '../src/matching/bodyMatchingMetrics.js';
import { normalizeHeader, parseIntOrNull } from '../src/utils/parse.js';
import { logger } from '../src/utils/logger.js';

const DEFAULT_SHEET_ID = '1T4-RLnBrK0lp3p-r23hRjrJAmI03QLzBavWM3ZpcmOA';
const DEFAULT_TAB = 'MENCIONES_MASTER';
export const OVERLAP_MINUTES = 60;
/** Snippet operacional. El cuerpo completo vive en News Lake. */
export const MASTER_SNIPPET_CHARS = 3_000;
/** Tope del sweep global. 48h LIVE supera 8k elegibles. */
export const GLOBAL_FETCH_CAP = 25_000;
/** Safety cap para recovery 24h/72h. Si se alcanza, CAP_HIT. */
export const RECOVERY_FETCH_CAP = 100_000;
export { LIVE_WINDOW_HOURS, RECOVERY_WINDOW_HOURS, DEEP_RECOVERY_WINDOW_HOURS };
const APPEND_CHUNK = 100;

interface Args {
  dryRun: boolean;
  matchOnly: boolean;
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

export interface MasterNewsRow {
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

export function parseArgs(argv: string[]): Args {
  const out: Args = {
    dryRun: false,
    matchOnly: false,
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
    if (arg === '--match-only') { out.matchOnly = true; continue; }
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
      case 'overlap-minutes': out.overlapMinutes = Math.max(1, parseIntOrNull(val) ?? out.overlapMinutes); break;
      case 'match-only': out.matchOnly = val === '' || val === 'true' || val === '1'; break;
    }
  }
  return out;
}

/** Mismo scope que 02_Menciones / detectMentionsCore: cliente.activo + keyword.activa + no huérfanas. */
export function groupKeywordsByActiveClient(
  clients: Array<{ cliente_id: string; nombre_cliente: string; activo: boolean }>,
  keywords: KeywordActivaRow[],
): {
  clientNames: Map<string, string>;
  keywordsByClient: Map<string, KeywordActivaRow[]>;
} {
  const scope = buildMentionScope({
    clientes: clients,
    keywords: keywords.map((k) => ({
      keyword_id: k.keyword_id,
      cliente_id: k.cliente_id,
      keyword: k.keyword,
      tipo_keyword: k.tipo_keyword,
      activa: true,
    })),
  });
  const allowed = new Set(scope.detection_keywords.map((k) => k.keyword_id));
  const clientNames = new Map(
    clients
      .filter((c) => scope.detection_client_ids.includes(c.cliente_id))
      .map((c) => [c.cliente_id, c.nombre_cliente]),
  );
  const keywordsByClient = new Map<string, KeywordActivaRow[]>();
  for (const kw of keywords) {
    if (!allowed.has(kw.keyword_id) || !kw.cliente_id) continue;
    const list = keywordsByClient.get(kw.cliente_id) ?? [];
    list.push(kw);
    keywordsByClient.set(kw.cliente_id, list);
  }
  return { clientNames, keywordsByClient };
}

export function windowSinceIso(startedAt: Date, overlapMinutes: number): string {
  return new Date(startedAt.getTime() - overlapMinutes * 60_000).toISOString();
}

export function newsInOverlapWindow(fechaCaptura: string | null, sinceIso: string): boolean {
  return Boolean(fechaCaptura && fechaCaptura >= sinceIso);
}

export function displayText(n: MasterNewsRow): string {
  const cuerpo = (n.texto_cuerpo_nota ?? '').trim();
  if (cuerpo) return cuerpo;
  const limpia = (n.texto_nota_limpia ?? '').trim();
  if (limpia) return limpia;
  return (n.resumen ?? '').trim();
}

/**
 * Matching Fast Lane MASTER.
 * Default: título/subtítulo/resumen/sección (producción actual).
 * BODY canary: MENTIONS_MASTER_BODY_V2 + allowlist por keyword (BODY_TRUSTED).
 */
export interface BuildRowsOpts {
  bodyMatchingV2?: boolean;
  masterBodyV2?: boolean;
  mode?: MatchingMode;
  contextRadius?: number;
  keywordAllowlist?: Iterable<string>;
  metrics?: BodyMatchingCounters;
  bodyPolicy?: MasterBodyPolicy;
}

export function matchingFields(
  n: MasterNewsRow,
  opts: BuildRowsOpts = {},
): CampoBuscable[] {
  const mode: MatchingMode = opts.mode ?? 'current';
  return buildTrustedMatchingFields(n, { mode }).campos;
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
  if (text.length <= MASTER_SNIPPET_CHARS) return text;
  const suffix = '\n\n[SNIPPET OPERACIONAL; CUERPO COMPLETO EN NEWS LAKE]';
  return text.slice(0, MASTER_SNIPPET_CHARS - suffix.length) + suffix;
}

export interface FetchNewsResult {
  rows: MasterNewsRow[];
  capHit: boolean;
  pagesScanned: number;
}

export async function fetchEligibleNews(
  sinceIso: string,
  medioIds?: string[],
  fetchCap = GLOBAL_FETCH_CAP,
): Promise<MasterNewsRow[]> {
  return (await fetchEligibleNewsPaged(sinceIso, medioIds, fetchCap)).rows;
}

export async function fetchEligibleNewsPaged(
  sinceIso: string,
  medioIds?: string[],
  fetchCap = GLOBAL_FETCH_CAP,
): Promise<FetchNewsResult> {
  const select =
    'noticia_id, medio_id, titulo, subtitulo, resumen, url_original, fecha_publicacion, fecha_captura,' +
    ' autor, seccion, texto_extraido, texto_nota_limpia, texto_cuerpo_nota, tipo_nota, calidad_extraccion,' +
    ' medios(nombre_medio)';
  const mapRow = (n: any): MasterNewsRow => ({
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
  });

  const runPage = async (from: number, to: number) => {
    let q = getSupabase()
      .from('noticias')
      .select(select)
      .gte('fecha_captura', sinceIso)
      .neq('origen_cobertura', 'pressclipping_diagnostico')
      .order('fecha_captura', { ascending: true })
      .order('noticia_id', { ascending: true })
      .range(from, to);
    if (medioIds && medioIds.length > 0) q = q.in('medio_id', medioIds);
    const { data, error } = await q;
    if (error) throw new Error(`No se pudieron leer noticias frescas: ${error.message}`);
    return data ?? [];
  };

  const out: MasterNewsRow[] = [];
  const page = 1000;
  let pagesScanned = 0;
  for (let from = 0; from < fetchCap; from += page) {
    const data = await runPage(from, from + page - 1);
    pagesScanned += 1;
    out.push(...data.map(mapRow).filter((n) => hasTrustedSearchableText(n)));
    if (data.length < page) {
      return { rows: out, capHit: false, pagesScanned };
    }
  }
  return { rows: out, capHit: true, pagesScanned };
}

export function buildRows(
  news: MasterNewsRow[],
  keywordsByClient: Map<string, KeywordActivaRow[]>,
  clientNames: Map<string, string>,
  opts: BuildRowsOpts = {},
): OutRow[] {
  const rows: OutRow[] = [];
  const metrics = opts.metrics;
  const mode: MatchingMode = opts.mode ?? 'body_high';
  for (const n of news) {
    const signalPacked = buildTrustedMatchingFields(n, { mode: 'current' });
    const bodyPacked = buildTrustedMatchingFields(n, { mode });
    const trustedCanary = bodyPacked.body.status === 'BODY_TRUSTED';
    const bodyUsable =
      mode === 'body_high' ? trustedCanary : Boolean(bodyPacked.body.text);
    if (metrics) {
      if ((n.texto_cuerpo_nota ?? '').trim()) metrics.body_available += 1;
      if (bodyPacked.body.status === 'BODY_TRUSTED') metrics.body_trusted += 1;
      else if (bodyPacked.body.status === 'BODY_FALLBACK_CLEAN') metrics.body_fallback_clean += 1;
      else if (bodyPacked.body.status === 'BODY_REJECTED') metrics.body_rejected += 1;
    }
    for (const [clientId, kws] of keywordsByClient.entries()) {
      const matches: MatchBundle[] = [];
      let anySignal = false;
      for (const kw of kws) {
        const useBody =
          keywordGetsTrustedBody(kw.keyword_id, {
            ...opts,
            tipoKeyword: kw.tipo_keyword,
          }) && bodyUsable;
        const rule = toKeywordRule(kw);
        const campos = useBody ? bodyPacked.campos : signalPacked.campos;
        const result = matchKeyword(rule, campos, {
          contextRadius: opts.contextRadius,
        });
        if (!result) continue;
        matches.push({ kw, result });
        if (!useBody) {
          anySignal = true;
          continue;
        }
        const signalHit = matchKeyword(rule, signalPacked.campos, {
          contextRadius: opts.contextRadius,
        });
        if (signalHit) anySignal = true;
      }
      if (matches.length === 0) continue;

      matches.sort((a, b) => b.result.score - a.result.score);
      const best = matches[0]!;
      const matchedAt = new Date().toISOString();
      const dedupeKey = `${clientId.toLowerCase()}//${n.noticia_id.toLowerCase()}`;
      const uniqueKeywords = [...new Set(matches.map((m) => m.kw.keyword))];
      const uniqueKeywordIds = [...new Set(matches.map((m) => m.kw.keyword_id))];
      if (metrics) {
        if (isBodyCampo(best.result.campo)) metrics.body_matches += 1;
        else metrics.signal_matches += 1;
        if (!anySignal) metrics.body_only_matches += 1;
        if (matches.length > 1) metrics.multi_field_matches += 1;
      }

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
        'nota completa': truncateForSheet(displayText(n)),
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

function bodyRunObservability(metrics?: BodyMatchingCounters, rows: OutRow[] = []) {
  const policy = describeMasterBodyPolicy();
  const mery = rows.filter((r) => String(r['cliente_id'] ?? '').toUpperCase() === 'CLI-MERY-TEST');
  const meryBody = mery.filter((r) => isBodyCampo(String(r['campo_match'] ?? '')));
  return {
    ...policy,
    body_only_matches: metrics?.body_only_matches ?? 0,
    body_matches: metrics?.body_matches ?? 0,
    signal_matches: metrics?.signal_matches ?? 0,
    mery_rows: mery.length,
    mery_body_matches: meryBody.length,
    mery_signal_matches: mery.length - meryBody.length,
  };
}

export async function loadExistingKeys(sheet: GoogleSpreadsheetWorksheet): Promise<Set<string>> {
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

export async function appendRows(
  sheet: GoogleSpreadsheetWorksheet,
  rows: OutRow[],
  existing: Set<string>,
  dryRun: boolean,
): Promise<{ appended: number; skipped: number; would_append: number }> {
  const unique: OutRow[] = [];
  for (const row of rows) {
    const key = String(row['dedupe_key'] ?? '').trim().toLowerCase();
    if (!key || existing.has(key)) continue;
    existing.add(key);
    unique.push(row);
  }
  if (dryRun || unique.length === 0) {
    return { appended: 0, skipped: rows.length - unique.length, would_append: unique.length };
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
  return { appended, skipped: rows.length - unique.length, would_append: unique.length };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date();
  let sinceIso = windowSinceIso(startedAt, args.overlapMinutes);

  const captureArgs: NewsLakeCaptureArgs = {
    dryRun: args.dryRun,
    maxMedios: args.maxMedios,
    maxNotas: args.maxNotas,
    enrichLimit: args.enrichLimit,
    windowDays: args.windowDays,
    chunkSize: args.chunkSize,
  };

  const [clients, keywords] = await Promise.all([
    getAllClientes(),
    getKeywordsActivas(),
  ]);
  const { clientNames, keywordsByClient } = groupKeywordsByActiveClient(clients, keywords);
  const keywordCount = [...keywordsByClient.values()].reduce((a, b) => a + b.length, 0);

  let sheet: GoogleSpreadsheetWorksheet | null = null;
  let existingKeys = new Set<string>();
  const doc = await getSpreadsheetById(args.sheetId);
  sheet = doc.sheetsByTitle[args.tab] ?? null;
  if (!sheet) throw new Error(`No existe pestaña ${args.tab} en ${args.sheetId}`);
  existingKeys = await loadExistingKeys(sheet);
  // Bootstrap inicial: si la Master todavía no tiene filas, sembrar desde la
  // misma ventana operativa (default 2 días) para que la primera corrida no
  // dependa exclusivamente del overlap.
  if (existingKeys.size === 0 && !args.dryRun) {
    sinceIso = new Date(startedAt.getTime() - args.windowDays * 24 * 60 * 60_000).toISOString();
    logger.info(
      { bootstrap_since_iso: sinceIso, bootstrap_window_days: args.windowDays },
      'MENCIONES_MASTER vacía: bootstrap inicial de menciones recientes',
    );
  }

  if (args.matchOnly) {
    const matchMetrics = emptyBodyMatchingCounters();
    logger.info({
      dry_run: args.dryRun,
      match_only: true,
      clientes_activos: clientNames.size,
      keywords_activas: keywordCount,
      since_iso: sinceIso,
      sheet_id: args.sheetId.slice(0, 8) + '...',
      tab: args.tab,
      minimo_export: 'any trusted field (titulo|subtitulo|resumen|seccion|trusted body)',
      global_sweep: true,
      ...bodyRunObservability(),
    }, '=== MENTIONS MASTER FAST LANE start (match-only) ===');

    const news = await fetchEligibleNews(sinceIso);
    const rows = buildRows(news, keywordsByClient, clientNames, { metrics: matchMetrics });
    const write = await appendRows(sheet, rows, existingKeys, args.dryRun);
    const medios = new Set(news.map((n) => n.medio_id).filter(Boolean));
    const latencies = rows
      .map((r) => r['latencia_minutos'])
      .filter((n): n is number => typeof n === 'number')
      .sort((a, b) => a - b);
    logger.info({
      duration_ms: Date.now() - startedAt.getTime(),
      noticias_frescas_elegibles: news.length,
      medios_unique: medios.size,
      menciones_consolidadas: rows.length,
      appended_master: write.appended,
      skipped_dedupe: write.skipped,
      would_append: write.would_append,
      latency_min: latencies[0] ?? null,
      latency_max: latencies[latencies.length - 1] ?? null,
      latency_median: latencies.length ? latencies[Math.floor(latencies.length / 2)]! : null,
      no_whatsapp: true,
      no_email: true,
      no_twilio: true,
      no_menciones_db_write: true,
      ...bodyRunObservability(matchMetrics, rows),
    }, '=== MENTIONS MASTER FAST LANE done (match-only) ===');
    return;
  }

  const plan = await calcularPlan(captureArgs);

  logger.info({
    dry_run: args.dryRun,
    medios: plan.medioIds.length,
    chunks: plan.chunks.length,
    chunk_size: args.chunkSize,
    chunk_concurrency: args.chunkConcurrency,
    clientes_activos: clientNames.size,
    keywords_activas: keywordCount,
    since_iso: sinceIso,
    sheet_id: args.sheetId.slice(0, 8) + '...',
    tab: args.tab,
    minimo_export: 'any trusted field (titulo|subtitulo|resumen|seccion|trusted body)',
    global_sweep: true,
    ...bodyRunObservability(),
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

      const news = await fetchEligibleNews(sinceIso, chunk);
      const rows = buildRows(news, keywordsByClient, clientNames);
      const write = await appendRows(sheet!, rows, existingKeys, args.dryRun);
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

  const globalMetrics = emptyBodyMatchingCounters();
  const globalNews = await fetchEligibleNews(sinceIso);
  const globalRows = buildRows(globalNews, keywordsByClient, clientNames, { metrics: globalMetrics });
  const globalWrite = await appendRows(sheet!, globalRows, existingKeys, args.dryRun);
  const globalMedios = new Set(globalNews.map((n) => n.medio_id).filter(Boolean));
  const fueraDePlan = [...globalMedios].filter((id) => !plan.medioIds.includes(id as string)).length;
  logger.info({
    noticias_global: globalNews.length,
    medios_unique: globalMedios.size,
    medios_fuera_capture_plan: fueraDePlan,
    menciones_consolidadas: globalRows.length,
    appended_master: globalWrite.appended,
    skipped_dedupe: globalWrite.skipped,
    would_append: globalWrite.would_append,
    ...bodyRunObservability(globalMetrics, globalRows),
  }, 'Global News Lake sweep (sin crawl)');

  logger.info({
    duration_ms: Date.now() - startedAt.getTime(),
    medios_plan: plan.medioIds.length,
    chunks: plan.chunks.length,
    chunks_fallidos: failedChunks,
    noticias_frescas_elegibles: totalNews,
    menciones_consolidadas: totalMatches,
    appended_master: totalAppended + globalWrite.appended,
    skipped_dedupe: totalSkipped + globalWrite.skipped,
    would_append_global: globalWrite.would_append,
    no_whatsapp: true,
    no_email: true,
    no_twilio: true,
    no_menciones_db_write: true,
    ...bodyRunObservability(globalMetrics, globalRows),
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
