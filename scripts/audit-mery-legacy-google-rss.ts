/**
 * MERY LEGACY GOOGLE RSS COMPARISON + MEDIA GAP AUDIT.
 *
 * Lee el concentrado histórico de la alerta Google RSS de Mery Pozos
 * (`data/imports/CONCENTRADO_NOTAS_MERYPOZOS.xlsx`, sin modificarlo) y lo
 * compara contra las menciones Ethos de CLI-MERY-TEST para la misma ventana.
 *
 * Objetivo: correr Ethos EN PARALELO a la alerta actual (sin apagarla),
 * detectar medios faltantes/gaps de cron, reducir ruido de Google RSS y medir
 * cuándo Ethos captura igual o mejor que la alerta legacy.
 *
 * NO usa IA. NO usa export-results, classify-ia, generate-xml, SMTP, Twilio,
 * email/WhatsApp. `alertas_activas=false` NO se toca — solo lectura.
 * Escribe ÚNICAMENTE la tab `19_Mery_Comparativo_GoogleRSS_vs_Ethos`
 * (nunca 16/17/18, nunca Patrón, nunca Jumex).
 *
 * Uso:
 *   npm run mery:compare:legacy -- --input=data/imports/CONCENTRADO_NOTAS_MERYPOZOS.xlsx --window-days=30 --dry-run
 *   npm run mery:compare:legacy -- --input=data/imports/CONCENTRADO_NOTAS_MERYPOZOS.xlsx --window-hours=24 --output=sheet
 */
import 'dotenv/config';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import XLSX from 'xlsx';
import { getSupabase } from '../src/supabase/client.js';
import { ensureSheetTabAndHeaders, appendHistoryRows, type OutRow } from '../src/sheets/write.js';
import { getOutputTab } from '../src/sheets/client.js';
import { logger } from '../src/utils/logger.js';
import { parseIntOrNull } from '../src/utils/parse.js';
import { mediosEnCualquierCron } from '../src/config/shadowMedia.js';
import { clasificarMery, estadoEditorialMery } from '../src/editorial/meryCriteria.js';
import {
  buildNotaCompletaLimpia,
  selectBestText,
} from './export-mery-final-preview-no-pc.js';
import {
  normalizeLegacyRow,
  compararLegacyVsEthos,
  parseFechaLegacy,
  type LegacyRowRaw,
  type LegacyRowNorm,
  type EthosRowNorm,
  type MedioEstadoCatalogo,
  type FilaComparativa,
} from '../src/comparators/meryLegacyComparator.js';
import { normalizeMedio, normalizeUrl } from '../src/comparators/mentionMatcher.js';
import { esPagoConvenio, esAgregador, esFuentePropia } from '../src/normalizers/meryLegacySource.js';

const CLI_ID = 'CLI-MERY-TEST';
const SHEET_NAME_LEGACY = 'NOTAS ENVIADAS MERYPOZOS';
const COMPARATIVO_TAB = '19_Mery_Comparativo_GoogleRSS_vs_Ethos';

const MEDIOS_PRIORITARIOS_VALIDAR = [
  'El Informador',
  'Semanario Conciencia Pública',
  'MURAL',
  'UDG TV / Canal 44',
  'A Fondo Jalisco',
  'El Sol de México',
  'Político MX',
  'Siker',
  'Notisistema',
  'Tráfico ZMG',
  'Vallarta Independiente',
  'AFmedios',
  'Página 24 Jalisco',
  'Milenio',
  'El Heraldo de México',
  'La Crónica de Hoy',
  'Partidero',
];

export const HEADERS_COMPARATIVO: string[] = [
  'fecha_comparacion', 'ventana', 'fecha_legacy', 'source_legacy', 'source_canonico',
  'medio_ethos', 'title_legacy', 'description_legacy', 'link_legacy', 'guid_legacy',
  'titulo_ethos', 'url_ethos', 'categoria_ethos', 'estado_ethos', 'nota_completa_ethos',
  'estado_comparativo', 'razon_comparativo', 'medio_id', 'esta_en_catalogo',
  'en_cron_daily_validated', 'accion_recomendada',
  // extra — deduplicación en escrituras repetidas (no forma parte del reporte visible)
  'dedupe_key',
];

// ─────────────────────────────────────────────────────────────────────────────
// Args
// ─────────────────────────────────────────────────────────────────────────────

export interface Args {
  input: string;
  windowDays: number;
  windowHours?: number;
  dryRun: boolean;
  output: 'console' | 'sheet';
  maxMediosPrioritarios: number;
}

export function parseArgs(argv: string[]): Args {
  const out: Args = {
    input: 'data/imports/CONCENTRADO_NOTAS_MERYPOZOS.xlsx',
    windowDays: 30,
    dryRun: false,
    output: 'console',
    maxMediosPrioritarios: MEDIOS_PRIORITARIOS_VALIDAR.length,
  };
  for (const arg of argv) {
    if (arg === '--dry-run') { out.dryRun = true; continue; }
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    const key = eq === -1 ? body : body.slice(0, eq);
    const val = eq === -1 ? '' : body.slice(eq + 1);
    if (key === 'input') out.input = val || out.input;
    if (key === 'window-days') out.windowDays = parseIntOrNull(val) ?? out.windowDays;
    if (key === 'window-hours') out.windowHours = parseIntOrNull(val) ?? out.windowHours;
    if (key === 'output') out.output = (val as 'console' | 'sheet') || out.output;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// FASE 1 — Lectura del concentrado legacy (read-only)
// ─────────────────────────────────────────────────────────────────────────────

export function leerConcentradoLegacy(rutaXlsx: string): LegacyRowRaw[] {
  if (!fs.existsSync(rutaXlsx)) {
    throw new Error(`Archivo legacy no encontrado: ${rutaXlsx}`);
  }
  const wb = XLSX.readFile(rutaXlsx);
  const nombreHoja = wb.SheetNames.find((n) => n.trim().toUpperCase() === SHEET_NAME_LEGACY) ?? wb.SheetNames[0];
  if (!nombreHoja) throw new Error('El archivo xlsx no tiene hojas');
  const ws = wb.Sheets[nombreHoja]!;
  const filas = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: '' });
  const [, ...dataRows] = filas;

  return dataRows
    .filter((r) => Array.isArray(r) && r.length > 0 && String(r[0] ?? '').trim())
    .map((r) => ({
      title: String(r[0] ?? ''),
      description: String(r[1] ?? ''),
      link: String(r[2] ?? ''),
      pubDate: String(r[3] ?? ''),
      source: String(r[4] ?? ''),
      guid: String(r[5] ?? ''),
      status: String(r[6] ?? ''),
      sentimiento: String(r[7] ?? ''),
      tema: String(r[8] ?? ''),
    }));
}

interface ReporteLegacy {
  filas_leidas: number;
  filas_validas: number;
  sources_unicas: number;
  links_google_news: number;
  links_directos: number;
  rango_fechas: { min: string; max: string };
  notas_con_mery_en_title_description: number;
  posible_ruido: number;
}

export function construirReporteLegacy(rows: LegacyRowNorm[]): ReporteLegacy {
  const fechasValidas = rows.map((r) => r.fecha).filter((d): d is Date => d != null).sort((a, b) => a.getTime() - b.getTime());
  const sourcesUnicas = new Set(rows.map((r) => r.source_legacy).filter(Boolean));
  const linksGoogleNews = rows.filter((r) => r.es_google_news).length;

  return {
    filas_leidas: rows.length,
    filas_validas: rows.filter((r) => r.title && r.link).length,
    sources_unicas: sourcesUnicas.size,
    links_google_news: linksGoogleNews,
    links_directos: rows.length - linksGoogleNews,
    rango_fechas: {
      min: fechasValidas[0] ? fechasValidas[0].toISOString().slice(0, 10) : '',
      max: fechasValidas.length ? fechasValidas[fechasValidas.length - 1]!.toISOString().slice(0, 10) : '',
    },
    notas_con_mery_en_title_description: rows.filter((r) => r.nombre_fuerte).length,
    posible_ruido: rows.filter((r) => r.es_ruido).length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// FASE 3 — Ranking de medios legacy + validación de catálogo
// ─────────────────────────────────────────────────────────────────────────────

interface RankingMedio {
  source_canonico: string;
  total_filas: number;
  mery_fuerte: number;
  links_directos: number;
  links_google_news: number;
  posible_ruido: number;
}

export function construirRankingMedios(rows: LegacyRowNorm[]): RankingMedio[] {
  const porMedio = new Map<string, RankingMedio>();
  for (const r of rows) {
    if (!r.source_canonico) continue;
    const e = porMedio.get(r.source_canonico) ?? {
      source_canonico: r.source_canonico,
      total_filas: 0, mery_fuerte: 0, links_directos: 0, links_google_news: 0, posible_ruido: 0,
    };
    e.total_filas++;
    if (r.nombre_fuerte) e.mery_fuerte++;
    if (r.es_google_news) e.links_google_news++; else e.links_directos++;
    if (r.es_ruido) e.posible_ruido++;
    porMedio.set(r.source_canonico, e);
  }
  return [...porMedio.values()].sort((a, b) => b.mery_fuerte - a.mery_fuerte || b.total_filas - a.total_filas);
}

interface MedioValidacion extends RankingMedio {
  esta_en_catalogo: boolean;
  medio_id: string | null;
  activo: boolean | null;
  en_cron_daily_validated: boolean | null;
  metodo_extraccion: string | null;
  accion_recomendada: string;
}

async function validarMediosPrioritarios(
  ranking: RankingMedio[],
  sb: ReturnType<typeof getSupabase>,
): Promise<{ validacion: MedioValidacion[]; catalogoPorSourceCanonico: Map<string, MedioEstadoCatalogo> }> {
  const { data: catalogo, error } = await sb
    .from('medios')
    .select('medio_id, nombre_medio, activo, metodo_extraccion')
    .order('medio_id');
  if (error) throw new Error(`No se pudo leer catálogo de medios: ${error.message}`);

  const cronCompleto = mediosEnCualquierCron();
  const catalogoNorm = new Map<string, any>();
  for (const m of (catalogo ?? []) as any[]) {
    catalogoNorm.set(normalizeMedio(m.nombre_medio), m);
  }

  const catalogoPorSourceCanonico = new Map<string, MedioEstadoCatalogo>();
  for (const r of ranking) {
    const entry = catalogoNorm.get(normalizeMedio(r.source_canonico));
    catalogoPorSourceCanonico.set(r.source_canonico, {
      esta_en_catalogo: entry != null,
      medio_id: entry?.medio_id ?? null,
      activo: entry ? Boolean(entry.activo) : null,
      en_cron: entry ? cronCompleto.has(entry.medio_id) : null,
      metodo_extraccion: entry?.metodo_extraccion ?? null,
    });
  }

  const rankingPorNombre = new Map(ranking.map((r) => [r.source_canonico, r]));
  const validacion: MedioValidacion[] = MEDIOS_PRIORITARIOS_VALIDAR.map((nombre) => {
    const r = rankingPorNombre.get(nombre) ?? {
      source_canonico: nombre, total_filas: 0, mery_fuerte: 0, links_directos: 0, links_google_news: 0, posible_ruido: 0,
    };
    const cat = catalogoPorSourceCanonico.get(nombre) ?? {
      esta_en_catalogo: false, medio_id: null, activo: null, en_cron: null, metodo_extraccion: null,
    };

    let accion: string;
    if (esAgregador(nombre)) accion = 'NO_CATALOGAR_AGREGADOR';
    else if (esFuentePropia(nombre)) accion = 'FUENTE_PROPIA_SEPARADA';
    else if (esPagoConvenio(nombre)) accion = 'D_PAGO_CONVENIO_API';
    else if (!cat.esta_en_catalogo) accion = 'AGREGAR_A_CATALOGO';
    else if (!cat.activo) accion = 'ACTIVAR_EN_CRON';
    else if (!cat.en_cron) accion = 'ACTIVAR_EN_CRON';
    else if (!cat.metodo_extraccion) accion = 'NECESITA_DIRECT_EXTRACTOR';
    else accion = 'OK_EN_CATALOGO';

    return {
      ...r,
      esta_en_catalogo: cat.esta_en_catalogo,
      medio_id: cat.medio_id,
      activo: cat.activo,
      en_cron_daily_validated: cat.en_cron,
      metodo_extraccion: cat.metodo_extraccion,
      accion_recomendada: accion,
    };
  });

  return { validacion, catalogoPorSourceCanonico };
}

// ─────────────────────────────────────────────────────────────────────────────
// FASE 4 — Carga de menciones Ethos (CLI-MERY-TEST) para la ventana
// ─────────────────────────────────────────────────────────────────────────────

async function cargarEthosRows(
  sb: ReturnType<typeof getSupabase>,
  isoDesde: string,
): Promise<EthosRowNorm[]> {
  const { data: raw, error } = await sb
    .from('menciones')
    .select(
      `mencion_id, noticia_id, keyword_id, keyword, texto_match,
       noticias!inner(titulo, url_original, resumen, fecha_publicacion,
                      texto_nota_limpia, texto_cuerpo_nota, texto_extraido,
                      medios(medio_id, nombre_medio))`,
    )
    .eq('cliente_id', CLI_ID)
    .gte('created_at', isoDesde)
    .order('created_at', { ascending: false })
    .limit(5000);

  if (error) throw new Error(`No se pudieron leer menciones Ethos: ${error.message}`);

  const grupos = new Map<string, EthosRowNorm & { _mejorTexto: string }>();
  for (const m of (raw ?? []) as any[]) {
    const n = m.noticias;
    const titulo = String(n?.titulo ?? '').trim();
    const url = String(n?.url_original ?? '').trim();
    const medio = String(n?.medios?.nombre_medio ?? '').trim();
    const medioId = String(n?.medios?.medio_id ?? '').trim();
    const textoMatch = String(m.texto_match ?? '').trim();
    const textoRaw = selectBestText(n, textoMatch);
    const keywordId = String(m.keyword_id ?? '').trim();
    const cat = clasificarMery(titulo, keywordId, textoRaw || undefined);
    const fecha = parseFechaLegacy(n?.fecha_publicacion ?? '');

    if (!grupos.has(m.noticia_id)) {
      const { texto: notaLimpia } = buildNotaCompletaLimpia(textoRaw);
      grupos.set(m.noticia_id, {
        noticia_id: m.noticia_id,
        titulo, url,
        url_norm: '', // se calcula en el comparador vía normalizeUrl si se necesita
        medio, medio_id: medioId,
        fecha,
        categoria_editorial: cat,
        estado_editorial: estadoEditorialMery(cat),
        nota_completa_limpia: notaLimpia,
        _mejorTexto: textoRaw,
      });
    }
  }

  return [...grupos.values()].map((g) => ({ ...g, url_norm: normalizeUrl(g.url) }));
}

// ─────────────────────────────────────────────────────────────────────────────
// FASE 6 — Métricas de cobertura
// ─────────────────────────────────────────────────────────────────────────────

interface MetricasCobertura {
  legacy_total: number;
  legacy_ruido: number;
  legacy_util: number;
  ethos_total: number;
  ambos: number;
  solo_legacy: number;
  solo_ethos: number;
  medios_faltantes: number;
  medios_en_catalogo_sin_cron: number;
  medios_requieren_direct: number;
  medios_d_pago_convenio: number;
  precision_estimada_ethos: number;
  recall_vs_legacy_total: number;
  recall_vs_legacy_util: number;
}

export function calcularMetricasCobertura(
  legacyRows: LegacyRowNorm[],
  ethosTotal: number,
  filas: FilaComparativa[],
): MetricasCobertura {
  const legacyTotal = legacyRows.length;
  const legacyRuido = legacyRows.filter((r) => r.es_ruido).length;
  const legacyUtil = legacyTotal - legacyRuido;

  const ambos = filas.filter((f) => f.estado_comparativo === 'AMBOS').length;
  const soloEthos = filas.filter((f) => f.estado_comparativo === 'SOLO_ETHOS').length;
  const soloLegacy = filas.filter((f) => f.link_legacy || f.title_legacy).length - ambos -
    filas.filter((f) => f.estado_comparativo === 'DUPLICADO_PROBABLE').length;

  const distintos = (estado: FilaComparativa['estado_comparativo']) =>
    new Set(filas.filter((f) => f.estado_comparativo === estado).map((f) => f.source_canonico)).size;

  return {
    legacy_total: legacyTotal,
    legacy_ruido: legacyRuido,
    legacy_util: legacyUtil,
    ethos_total: ethosTotal,
    ambos,
    solo_legacy: Math.max(0, soloLegacy),
    solo_ethos: soloEthos,
    medios_faltantes: distintos('MEDIO_FALTANTE_ETHOS'),
    medios_en_catalogo_sin_cron: distintos('MEDIO_EN_CATALOGO_SIN_CRON'),
    medios_requieren_direct: distintos('MEDIO_REQUIERE_DIRECT'),
    medios_d_pago_convenio: distintos('MEDIO_D_PAGO_CONVENIO'),
    precision_estimada_ethos: ethosTotal > 0 ? Number((ambos / ethosTotal).toFixed(3)) : 0,
    recall_vs_legacy_total: legacyTotal > 0 ? Number((ambos / legacyTotal).toFixed(3)) : 0,
    recall_vs_legacy_util: legacyUtil > 0 ? Number((ambos / legacyUtil).toFixed(3)) : 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fechaComparacion = new Date().toISOString();
  const ventanaMs = args.windowHours != null ? args.windowHours * 60 * 60 * 1000 : args.windowDays * 24 * 60 * 60 * 1000;
  const ventanaLabel = args.windowHours != null ? `${args.windowHours}h` : `${args.windowDays}d`;
  const desde = new Date(Date.now() - ventanaMs);

  logger.info(
    { input: args.input, windowDays: args.windowDays, windowHours: args.windowHours, dryRun: args.dryRun, output: args.output },
    '=== MERY LEGACY GOOGLE RSS COMPARISON + MEDIA GAP AUDIT (solo lectura, sin envíos) ===',
  );

  // ── FASE 1: leer concentrado legacy ──────────────────────────────────────
  const rawRows = leerConcentradoLegacy(args.input);
  const legacyRowsTodas = rawRows.map(normalizeLegacyRow);
  const reporteLegacy = construirReporteLegacy(legacyRowsTodas);
  logger.info(reporteLegacy, '[FASE 1] Resumen del concentrado legacy (dataset completo)');

  // ── FASE 2 + 3: normalización + ranking + validación de catálogo ────────
  const ranking = construirRankingMedios(legacyRowsTodas);
  logger.info({ medios_unicos: ranking.length, top10: ranking.slice(0, 10) }, '[FASE 3] Ranking de medios legacy (top 10)');

  const sb = getSupabase();
  const { validacion, catalogoPorSourceCanonico } = await validarMediosPrioritarios(ranking, sb);
  logger.info({ validacion }, '[FASE 3] Validación de medios prioritarios contra catálogo Ethos');

  // ── FASE 4 + 5 + 6: comparación en ventana ───────────────────────────────
  const legacyEnVentana = legacyRowsTodas.filter((r) => r.fecha && r.fecha.getTime() >= desde.getTime());
  const ethosRows = await cargarEthosRows(sb, desde.toISOString());

  const filasComparativo = compararLegacyVsEthos(legacyEnVentana, ethosRows, catalogoPorSourceCanonico, {
    fechaComparacion, ventana: ventanaLabel,
  });

  const metricas = calcularMetricasCobertura(legacyEnVentana, ethosRows.length, filasComparativo);
  logger.info(metricas, `[FASE 6] Métricas de cobertura — ventana ${ventanaLabel}`);

  for (const f of filasComparativo.slice(0, 15)) {
    logger.info(
      { estado: f.estado_comparativo, medio: f.source_canonico || f.medio_ethos, titulo: (f.title_legacy || f.titulo_ethos).slice(0, 70), accion: f.accion_recomendada },
      '[preview] fila comparativo',
    );
  }

  if (args.dryRun || args.output === 'console') {
    logger.info({ filas_generadas: filasComparativo.length }, '=== FIN dry-run — NADA ESCRITO EN SHEETS ===');
    return;
  }

  // ── FASE 10: escritura controlada — SOLO tab 19 ──────────────────────────
  const ensure = await ensureSheetTabAndHeaders(COMPARATIVO_TAB, HEADERS_COMPARATIVO);
  logger.info({ tab: COMPARATIVO_TAB, accion: ensure.accion, mismatch: ensure.mismatch }, 'ensureSheetTabAndHeaders');
  if (ensure.mismatch) { logger.error({ tab: COMPARATIVO_TAB }, 'MISMATCH headers. Abortando.'); process.exit(1); }

  const existentes = new Set<string>();
  try {
    const tab = await getOutputTab(COMPARATIVO_TAB);
    const prev = await tab.getRows();
    for (const r of prev) { const k = String(r.get('dedupe_key') ?? '').trim(); if (k) existentes.add(k); }
  } catch { /* tab recién creada */ }

  const nuevas = filasComparativo.filter((f) => !existentes.has(f.dedupe_key)) as unknown as OutRow[];
  const dupOmitidos = filasComparativo.length - nuevas.length;

  if (nuevas.length > 0) {
    const escritas = await appendHistoryRows(COMPARATIVO_TAB, HEADERS_COMPARATIVO, nuevas);
    logger.info({ tab: COMPARATIVO_TAB, escritas, dup_omitidos: dupOmitidos }, 'Tab comparativo escrita');
  } else {
    logger.info({ tab: COMPARATIVO_TAB, dup_omitidos: dupOmitidos }, 'Tab comparativo sin filas nuevas');
  }

  logger.info({}, '=== Comparativo Mery legacy vs Ethos completado — sin envíos, alertas_activas intacto ===');
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
