/**
 * Comparativo Ethos vs PressClipping.
 *
 * Lee menciones de Ethos (Supabase) y registros de PressClipping
 * (tabla comparativo_pressclipping), las cruza con mentionMatcher
 * y reporta los resultados.
 *
 * Uso:
 *   npm run compare-mentions -- --dry-run
 *   npm run compare-mentions -- --cliente=CLI-0002 --fecha-desde=2026-01-01
 *   npm run compare-mentions -- --output=console
 *   npm run compare-mentions -- --output=csv        (pendiente)
 *   npm run compare-mentions -- --output=sheet      (pendiente)
 *
 * Prerrequisito:
 *   - Tabla comparativo_pressclipping debe existir y tener registros.
 *     Si está vacía, el script lo indica claramente y termina sin error.
 */
import 'dotenv/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  matchMenciones,
  normalizeUrl,
  CAUSAS_NO_ACCIONABLES,
  type MencionNorm,
  type ComparativoResultado,
  type CausaRaiz,
} from '../src/comparators/mentionMatcher.js';
import {
  SELECT_MENCION_EXPORT,
  mapMencionExport,
} from '../src/types/mencion.js';
import {
  clusterizar,
  calcularMetricasCluster,
  type PCRecord,
  type Cluster,
  type ClusterStatus,
} from '../src/comparators/cluster.js';
import {
  verdictoDiagnosticado,
  tokensSignificativos,
  causaToClusterStatus,
} from '../src/comparators/diagnosticoVerdicts.js';
import { foldText } from '../src/matchers/text.js';
import { appendOutputRows, clearOutputDataRange } from '../src/sheets/write.js';
import { OUTPUT_TABS, getOutputTab, withSheetsRetry } from '../src/sheets/client.js';
import { normalizarVentanaTimestamp, aFechaMx } from '../src/utils/dateWindow.js';
import { logger } from '../src/utils/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Args
// ─────────────────────────────────────────────────────────────────────────────

type OutputMode = 'console' | 'csv' | 'sheet';

interface CompareArgs {
  cliente?: string;
  fechaDesde?: string;
  fechaHasta?: string;
  dryRun: boolean;
  output: OutputMode;
  /** Si está activo, limpia A2:S de la pestaña antes de escribir (evita duplicados). */
  replaceWindow: boolean;
  /** Si está activo, incluye también menciones de notas traídas por diagnóstico (no solo orgánicas). */
  includeDiagnostic: boolean;
}

function parseArgs(argv: string[]): CompareArgs {
  const out: CompareArgs = {
    dryRun: false, output: 'console', replaceWindow: false, includeDiagnostic: false,
  };
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    const key = eq === -1 ? body : body.slice(0, eq);
    const val = eq === -1 ? '' : body.slice(eq + 1);
    switch (key) {
      case 'cliente':            out.cliente = val; break;
      case 'fecha-desde':        out.fechaDesde = val; break;
      case 'fecha-hasta':        out.fechaHasta = val; break;
      case 'dry-run':            out.dryRun = true; break;
      case 'output':             out.output = val as OutputMode; break;
      case 'replace-window':     out.replaceWindow = true; break;
      case 'include-diagnostic': out.includeDiagnostic = true; break;
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Carga de datos
// ─────────────────────────────────────────────────────────────────────────────

async function cargarMencionesEthos(
  sb: SupabaseClient,
  args: CompareArgs,
): Promise<MencionNorm[]> {
  let query = sb
    .from('menciones')
    .select(SELECT_MENCION_EXPORT)
    .neq('estado_revision', 'descartada');

  // Columna timestamptz: usar límites con hora (hasta = fin de día MX inclusivo).
  const { desde, hasta } = normalizarVentanaTimestamp({ desde: args.fechaDesde, hasta: args.fechaHasta });
  if (desde) query = query.gte('noticias.fecha_publicacion', desde);
  if (hasta) query = query.lte('noticias.fecha_publicacion', hasta);

  const { data, error } = await query;
  if (error) throw new Error(`Error al cargar menciones Ethos: ${error.message}`);

  const filas = (data ?? []).map(mapMencionExport);

  let filtradas = args.cliente
    ? filas.filter(f => (f.cliente ?? '').toLowerCase().includes(args.cliente!.toLowerCase()))
    : filas;

  // ── Filtro por origen de cobertura ────────────────────────────────────────
  // Por default solo cuenta cobertura orgánica (ethos_organico). Las notas
  // traídas por diagnóstico desde PressClipping no inflan la cobertura, salvo
  // que se pase --include-diagnostic.
  if (!args.includeDiagnostic) {
    const diagnosticoIds = await cargarNoticiasDiagnostico(sb, filtradas.map(f => f.noticia_id));
    if (diagnosticoIds.size > 0) {
      filtradas = filtradas.filter(f => !diagnosticoIds.has(f.noticia_id));
    }
  }

  return filtradas.map(f => ({
    fuente: 'Ethos' as const,
    fecha:     f.fecha_publicacion?.substring(0, 10),
    cliente:   f.cliente ?? undefined,
    keyword:   f.keyword ?? undefined,
    medio:     f.medio ?? undefined,
    titulo:    f.titulo ?? undefined,
    url:       f.url_original ?? undefined,
    url_norm:  normalizeUrl(f.url_original),
    estado_revision: f.estado_revision ?? undefined,
  }));
}

/**
 * Devuelve el set de noticia_id cuyo origen_cobertura NO es orgánico
 * (diagnóstico desde PressClipping o manual). Si la columna aún no existe
 * (migración 0012 pendiente), devuelve un set vacío sin romper.
 */
async function cargarNoticiasDiagnostico(
  sb: SupabaseClient,
  noticiaIds: string[],
): Promise<Set<string>> {
  if (noticiaIds.length === 0) return new Set();
  const { data, error } = await sb
    .from('noticias')
    .select('noticia_id, origen_cobertura')
    .in('noticia_id', noticiaIds)
    .neq('origen_cobertura', 'ethos_organico');

  if (error) {
    // Columna inexistente (migración 0012 pendiente) → no filtrar nada.
    if (error.message.includes('origen_cobertura') || error.code === '42703') {
      logger.warn({}, 'Columna origen_cobertura no existe aún (migración 0012 pendiente). Contando todo como orgánico.');
      return new Set();
    }
    throw new Error(`Error al cargar origen_cobertura: ${error.message}`);
  }
  return new Set((data ?? []).map(r => r.noticia_id as string));
}

async function cargarPressClipping(
  sb: SupabaseClient,
  args: CompareArgs,
): Promise<MencionNorm[]> {
  let query = sb.from('comparativo_pressclipping').select('*');

  // Columna `date`: comparar por fecha calendario MX (ya inclusiva del día).
  if (args.cliente) query = query.ilike('cliente', `%${args.cliente}%`);
  if (args.fechaDesde) query = query.gte('fecha', aFechaMx(args.fechaDesde));
  if (args.fechaHasta) query = query.lte('fecha', aFechaMx(args.fechaHasta));

  const { data, error } = await query;

  if (error) {
    if (error.code === '42P01' || error.message.includes('schema cache')) {
      throw new Error(
        'La tabla comparativo_pressclipping no existe en Supabase. ' +
        'Aplica la migración 0010_comparativo_pressclipping.sql primero.',
      );
    }
    throw new Error(`Error al cargar PressClipping: ${error.message}`);
  }

  return (data ?? []).map((r: Record<string, unknown>) => ({
    fuente: 'PressClipping' as const,
    fecha:     (r['fecha'] as string | null) ?? undefined,
    cliente:   (r['cliente'] as string | null) ?? undefined,
    cliente_id: (r['cliente_id'] as string | null) ?? undefined,
    grupo_tema: (r['grupo_tema'] as string | null) ?? undefined,
    keyword:   (r['keyword'] as string | null) ?? undefined,
    medio:     (r['medio'] as string | null) ?? undefined,
    titulo:    (r['titulo'] as string | null) ?? undefined,
    url:       (r['url'] as string | null) ?? undefined,
    url_norm:  (r['url_norm'] as string | null) ?? normalizeUrl(r['url'] as string | null),
    autor:     (r['autor'] as string | null) ?? undefined,
    seccion:   (r['seccion'] as string | null) ?? undefined,
    tipo_nota: (r['tipo_nota'] as string | null) ?? undefined,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Clasificación de causa raíz
// ─────────────────────────────────────────────────────────────────────────────

/** Estado técnico de fuente por medio (diagnósticos jun 2026). */
const MEDIO_SOURCE_STATUS: Record<string, CausaRaiz> = {
  'el economista': 'ETHOS_SOURCE_BLOCKED',
  'el informador': 'ETHOS_SOURCE_BLOCKED',
  'la silla rota': 'ETHOS_SOURCE_NO_FEED',
  'diario basta':  'ETHOS_SOURCE_TIMEOUT',
  'hospitalitas':  'ETHOS_SOURCE_MISSING',
};

/** Keywords con contexto de precisión endurecido (su bloqueo = trade-off, no gap). */
const KEYWORDS_PRECISION = new Set(['tequila', 'mezcal', 'industria del mezcal']);

const fold = (s?: string | null): string => foldText(s ?? '').replace(/\s+/g, ' ').trim();

/** Comentario humano por categoría. */
function comentarioDe(cat: CausaRaiz, extra = ''): string {
  const base: Record<CausaRaiz, string> = {
    MATCH_REAL: 'Coincidencia real Ethos↔PressClipping.',
    PC_FALSE_POSITIVE: 'PressClipping reportó la keyword pero el cuerpo extraído no la contiene.',
    PC_SYNDICATED_LOW_VALUE: 'Mención real pero de bajo valor para el cliente (tangencial/entretenimiento/sindicada). No accionable.',
    ETHOS_EXTRACTION_GAP: 'La nota existe; el término podría estar en zona no extraída.',
    ETHOS_KEYWORD_GAP: 'La nota existe y contiene el término, pero ninguna keyword activa lo cubre.',
    ETHOS_CONTEXT_BLOCKED: 'La keyword existe y el término está presente, pero el contexto_incluir/excluir impidió la mención.',
    ETHOS_DISCOVERY_GAP: 'La URL extrae bien y contiene el término: el gap es de descubrimiento/fuente, no de extracción.',
    ETHOS_SOURCE_BLOCKED: 'Medio bloqueado (403/404/502). Sin fuente accesible.',
    ETHOS_SOURCE_MISSING: 'Medio no configurado y sin fuente técnica viable.',
    ETHOS_SOURCE_NO_FEED: 'Medio sin RSS/sitemap XML viable.',
    ETHOS_SOURCE_WINDOW_LIMITED: 'Medio funcional pero la nota quedó fuera de la ventana crawleada.',
    ETHOS_SOURCE_TIMEOUT: 'Fuente del medio responde con timeout intermitente.',
    ETHOS_PRECISION_TRADEOFF: 'La nota contiene el término pero el contexto de precisión la excluye (diseño anti-FP).',
    SOLO_ETHOS_VALID: 'Cobertura única de Ethos, validada manualmente.',
    SOLO_ETHOS_BORDERLINE: 'Cobertura única de Ethos, borderline; requiere criterio humano.',
    SOLO_ETHOS_FALSE_POSITIVE: 'Mención Ethos descartada en revisión manual.',
    REVISAR_HUMANO: 'Requiere revisión humana.',
  };
  return `[${cat}] ${base[cat]}${extra ? ' ' + extra : ''}`;
}

/**
 * Asigna `categoria` a cada resultado y actualiza `comentario`.
 * Para SOLO_PRESSCLIPPING consulta `noticias` para distinguir
 * PC_FALSE_POSITIVE / EXTRACTION_GAP / PRECISION_TRADEOFF / WINDOW_LIMITED.
 */
async function clasificarResultados(
  sb: SupabaseClient,
  resultados: ComparativoResultado[],
  ethos: MencionNorm[],
): Promise<void> {
  // Mapa titulo-normalizado → estado_revision (para SOLO_ETHOS)
  const estadoPorTitulo = new Map<string, string>();
  for (const e of ethos) {
    if (e.titulo) estadoPorTitulo.set(fold(e.titulo), e.estado_revision ?? 'pendiente');
  }

  for (const r of resultados) {
    if (r.estado_comparativo === 'MATCH' || r.estado_comparativo === 'MATCH_PROBABLE') {
      r.categoria = 'MATCH_REAL';
      r.comentario = comentarioDe('MATCH_REAL');
      continue;
    }

    if (r.estado_comparativo === 'SOLO_ETHOS') {
      const est = estadoPorTitulo.get(fold(r.titulo)) ?? 'pendiente';
      const cat: CausaRaiz =
        est === 'validada'   ? 'SOLO_ETHOS_VALID'
        : est === 'descartada' ? 'SOLO_ETHOS_FALSE_POSITIVE'
        : 'SOLO_ETHOS_BORDERLINE';
      r.categoria = cat;
      r.comentario = comentarioDe(cat);
      continue;
    }

    if (r.estado_comparativo === 'SOLO_PRESSCLIPPING') {
      r.categoria = await clasificarSoloPC(sb, r);
      r.comentario = comentarioDe(r.categoria);
      continue;
    }

    r.categoria = 'REVISAR_HUMANO';
    r.comentario = comentarioDe('REVISAR_HUMANO');
  }
}

/** Determina la causa raíz de un SOLO_PRESSCLIPPING consultando noticias.
 *  Busca la nota primero por URL (fiable para diagnósticos guardados desde
 *  PressClipping) y, en su defecto, por título. Si la nota encontrada es un
 *  diagnóstico (origen_cobertura=pressclipping_diagnostico), el cuerpo existe
 *  pero el medio NO está cubierto orgánicamente: el gap es accionable. */
async function clasificarSoloPC(
  sb: SupabaseClient,
  r: ComparativoResultado,
): Promise<CausaRaiz> {
  const medioKey = fold(r.medio);

  // 0) Veredicto humano ya diagnosticado por URL (tiene prioridad).
  const vd = verdictoDiagnosticado(r.url_pressclipping);
  if (vd) return vd.causa;

  // 1) Buscar por URL (canónica u original) — fiable para diagnósticos.
  let noticia: Record<string, any> | undefined;
  const url = r.url_pressclipping;
  if (url) {
    const { data } = await sb
      .from('noticias')
      .select('noticia_id, titulo, texto_cuerpo_nota, texto_nota_limpia, origen_cobertura')
      .or(`url_original.eq."${url}",url_canonica.eq."${normalizeUrl(url)}"`)
      .limit(1);
    noticia = data?.[0];
  }
  // 2) Fallback por título.
  if (!noticia) {
    const frag = (r.titulo ?? '').substring(0, 30);
    const { data } = await sb
      .from('noticias')
      .select('noticia_id, titulo, texto_cuerpo_nota, texto_nota_limpia, origen_cobertura')
      .ilike('titulo', `%${frag}%`)
      .limit(1);
    noticia = data?.[0];
  }

  if (!noticia) {
    // No crawleada: depende del estado de la fuente del medio
    for (const [nombre, causa] of Object.entries(MEDIO_SOURCE_STATUS)) {
      if (medioKey.includes(fold(nombre))) return causa;
    }
    return 'ETHOS_SOURCE_WINDOW_LIMITED'; // medio funcional, no alcanzó esta nota
  }

  // La nota existe (orgánica o diagnóstico): ¿el término está en el cuerpo?
  const cuerpo = fold((noticia['texto_cuerpo_nota'] ?? noticia['texto_nota_limpia'] ?? '') + ' ' + (noticia['titulo'] ?? ''));
  const kwFold = fold(r.keyword);
  // Match directo o por tokens significativos (keywords compuestas de PC).
  const termPresente = kwFold.length > 0 &&
    (cuerpo.includes(kwFold) || tokensSignificativos(r.keyword ?? '').some(t => cuerpo.includes(t)));
  const esDiagnostico = (noticia['origen_cobertura'] ?? 'ethos_organico') === 'pressclipping_diagnostico';

  if (!termPresente) {
    // Cuerpo extraído sin la keyword → FP de PressClipping.
    return 'PC_FALSE_POSITIVE';
  }
  if (KEYWORDS_PRECISION.has(kwFold)) {
    return 'ETHOS_PRECISION_TRADEOFF';
  }
  // Término presente y relevante. Si solo tenemos copia diagnóstica, el medio
  // no se captura orgánicamente: es un gap accionable de descubrimiento/fuente.
  if (esDiagnostico) {
    for (const [nombre, causa] of Object.entries(MEDIO_SOURCE_STATUS)) {
      if (medioKey.includes(fold(nombre))) return causa;
    }
    return 'ETHOS_DISCOVERY_GAP';
  }
  // Nota orgánica con el término pero sin mención → keyword/contexto.
  return 'ETHOS_KEYWORD_GAP';
}

// ─────────────────────────────────────────────────────────────────────────────
// Métricas
// ─────────────────────────────────────────────────────────────────────────────

function calcularMetricas(
  resultados: ComparativoResultado[],
  ethos: MencionNorm[],
  pc: MencionNorm[],
): Record<string, number | string> {
  const matches        = resultados.filter(r => r.estado_comparativo === 'MATCH').length;
  const matchProbables = resultados.filter(r => r.estado_comparativo === 'MATCH_PROBABLE').length;
  const soloEthos      = resultados.filter(r => r.estado_comparativo === 'SOLO_ETHOS').length;
  const soloPC         = resultados.filter(r => r.estado_comparativo === 'SOLO_PRESSCLIPPING').length;
  const aRevisar       = resultados.filter(r => r.estado_comparativo === 'REVISAR').length;

  // ── Métricas brutas ────────────────────────────────────────────────────
  const precisionBruta = ethos.length > 0
    ? ((matches + matchProbables) / ethos.length).toFixed(2) : 'N/A';
  const coberturaBruta = pc.length > 0
    ? ((matches + matchProbables) / pc.length).toFixed(2) : 'N/A';

  // ── Métricas ajustadas (usando categoría de causa raíz) ──────────────────
  const soloPCResultados = resultados.filter(r => r.estado_comparativo === 'SOLO_PRESSCLIPPING');
  const pcFalsePositives = soloPCResultados.filter(r => r.categoria === 'PC_FALSE_POSITIVE').length;
  const noAccionables    = soloPCResultados.filter(r => r.categoria && CAUSAS_NO_ACCIONABLES.has(r.categoria)).length;
  const accionables      = soloPC - noAccionables;

  const soloEthosResultados = resultados.filter(r => r.estado_comparativo === 'SOLO_ETHOS');
  const soloEthosValidos    = soloEthosResultados.filter(r => r.categoria === 'SOLO_ETHOS_VALID').length;
  const soloEthosBorderline = soloEthosResultados.filter(r => r.categoria === 'SOLO_ETHOS_BORDERLINE').length;
  const soloEthosFP         = soloEthosResultados.filter(r => r.categoria === 'SOLO_ETHOS_FALSE_POSITIVE').length;

  // cobertura ajustada = matches / (PC total - no accionables)
  const denomAjustado = pc.length - noAccionables;
  const coberturaAjustada = denomAjustado > 0
    ? ((matches + matchProbables) / denomAjustado).toFixed(2) : 'N/A';

  // precisión ajustada = validadas / (validadas + descartadas) entre menciones Ethos revisables
  const ethosValidadas  = ethos.filter(e => e.estado_revision === 'validada').length;
  const ethosDescartadas = ethos.filter(e => e.estado_revision === 'descartada').length;
  const revisables = ethosValidadas + ethosDescartadas;
  const precisionAjustada = revisables > 0
    ? (ethosValidadas / revisables).toFixed(2) : 'N/A';

  return {
    menciones_ethos: ethos.length,
    menciones_pressclipping: pc.length,
    matches,
    matchProbables,
    soloEthos,
    soloPC,
    aRevisar,
    cobertura_bruta: coberturaBruta,
    precision_bruta: precisionBruta,
    pc_false_positives: pcFalsePositives,
    solo_pressclipping_accionables: accionables,
    solo_pressclipping_no_accionables: noAccionables,
    solo_ethos_validos: soloEthosValidos,
    solo_ethos_borderline: soloEthosBorderline,
    solo_ethos_false_positive: soloEthosFP,
    cobertura_ajustada: coberturaAjustada,
    precision_ajustada: precisionAjustada,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Output consola
// ─────────────────────────────────────────────────────────────────────────────

function imprimirConsola(
  resultados: ComparativoResultado[],
  metricas: Record<string, number | string>,
): void {
  console.log('\n=== MÉTRICAS ===');
  for (const [k, v] of Object.entries(metricas)) {
    console.log(`  ${k.padEnd(22)}: ${v}`);
  }
  console.log('\n=== RESULTADOS (con causa raíz) ===');
  for (const r of resultados) {
    console.log(`  [${(r.categoria ?? r.estado_comparativo).padEnd(28)}] ${String(r.titulo ?? '').substring(0, 60)}`);
    console.log(`    medio:${r.medio}  kw:${r.keyword}  fecha:${r.fecha}  score:${r.score_similitud?.toFixed(2) ?? '-'}`);
  }
}

/** Mapea un resultado a fila de la pestaña 05_Comparativo_PressClipping. */
function resultadoToSheetRow(
  r: ComparativoResultado,
  metricas: Record<string, number | string>,
): Record<string, string | number | boolean | null | undefined> {
  return {
    fecha:              r.fecha ?? '',
    cliente:            r.cliente ?? '',
    grupo_tema:         r.grupo_tema ?? '',
    keyword:            r.keyword ?? '',
    medio:              r.medio ?? '',
    titulo:             r.titulo ?? '',
    url_ethos:          r.url_ethos ?? '',
    url_pressclipping:  r.url_pressclipping ?? '',
    match_tipo:         r.match_tipo,
    en_ethos:           r.en_ethos ? 'SÍ' : 'NO',
    en_pressclipping:   r.en_pressclipping ? 'SÍ' : 'NO',
    estado_comparativo: r.estado_comparativo,
    score_similitud:    r.score_similitud != null ? r.score_similitud.toFixed(2) : '',
    diferencia_dias:    r.diferencia_dias != null ? String(r.diferencia_dias) : '',
    razon_posible:      r.categoria ?? r.razon_posible ?? '',
    accion_recomendada: r.accion_recomendada ?? '',
    comentario:         r.comentario ?? r.razon_posible ?? '',
    cobertura_estimada: metricas['cobertura_ajustada'],
    precision_estimada: metricas['precision_ajustada'],
    exportado_at:       new Date().toISOString(),
  };
}

/** Rango de DATOS de 05 (todo menos la cabecera A1:S1). */
const RANGO_DATOS_05 = 'A2:S';

interface Conteo05 {
  total: number;
  match: number;
  soloPC: number;
  soloEthos: number;
}

/**
 * Lee de vuelta 05_Comparativo_PressClipping (A2:S) y cuenta filas reales y por
 * `estado_comparativo`. Es la fuente de verdad de `filas_05_escritas` (read-back
 * confirmado, NO el rows.length generado antes de escribir).
 */
async function leerComparativo05(): Promise<Conteo05> {
  const tab = await getOutputTab(OUTPUT_TABS.COMPARATIVO);
  await withSheetsRetry(() => tab.loadHeaderRow(), 'loadHeaderRow 05 read-back');
  const headers = tab.headerValues;
  const rows = await withSheetsRetry(() => tab.getRows(), 'getRows 05 read-back');
  const reales = rows.filter((r) =>
    headers.some((h) => String(r.get(h) ?? '').trim() !== ''),
  );
  const c: Conteo05 = { total: reales.length, match: 0, soloPC: 0, soloEthos: 0 };
  for (const r of reales) {
    const e = String(r.get('estado_comparativo') ?? '').trim();
    if (e === 'MATCH') c.match++;
    else if (e === 'SOLO_PRESSCLIPPING') c.soloPC++;
    else if (e === 'SOLO_ETHOS') c.soloEthos++;
  }
  return c;
}

/**
 * Snapshot vivo de 05 con replace-window SEGURO:
 *   1) Limpia A2:S en UNA llamada atómica (clear de rango), conservando A1.
 *   2) Escribe el bloque completo de resultados (nunca append acumulativo).
 *   3) Lee de vuelta y confirma conteos; si no coinciden, reintenta 1 vez más.
 * Devuelve los conteos confirmados por read-back y si quedó `mismatch`.
 */
async function exportarASheet(
  resultados: ComparativoResultado[],
  metricas: Record<string, number | string>,
  _replaceWindow: boolean,
): Promise<Conteo05 & { mismatch: boolean }> {
  const filas = resultados.map((r) => resultadoToSheetRow(r, metricas));
  const esperado: Conteo05 = {
    total: resultados.length,
    match: resultados.filter((r) => r.estado_comparativo === 'MATCH').length,
    soloPC: resultados.filter((r) => r.estado_comparativo === 'SOLO_PRESSCLIPPING').length,
    soloEthos: resultados.filter((r) => r.estado_comparativo === 'SOLO_ETHOS').length,
  };

  let readback: Conteo05 = { total: 0, match: 0, soloPC: 0, soloEthos: 0 };
  let mismatch = true;
  const MAX_INTENTOS = 2; // escritura + 1 reintento ante mismatch
  for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
    // 05 SIEMPRE es snapshot: clear de rango atómico + escritura en bloque.
    await clearOutputDataRange(OUTPUT_TABS.COMPARATIVO, RANGO_DATOS_05);
    if (filas.length > 0) {
      await appendOutputRows(OUTPUT_TABS.COMPARATIVO, filas);
    }
    readback = await leerComparativo05();
    mismatch =
      readback.total !== esperado.total ||
      readback.match !== esperado.match ||
      readback.soloPC !== esperado.soloPC ||
      readback.soloEthos !== esperado.soloEthos;
    if (!mismatch) break;
    logger.warn(
      { intento, esperado, readback },
      'Read-back de 05 no coincide con lo generado; reintentando escritura.',
    );
  }

  logger.info(
    {
      // filas_05_escritas = conteo CONFIRMADO por read-back (no rows.length previo)
      escritas: readback.total,
      readback_match: readback.match,
      readback_solo_pressclipping: readback.soloPC,
      readback_solo_ethos: readback.soloEthos,
      esperadas: esperado.total,
      sheets_write_mismatch: mismatch,
    },
    `Comparativo exportado a ${OUTPUT_TABS.COMPARATIVO}`,
  );
  return { ...readback, mismatch };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  logger.info({
    cliente: args.cliente,
    fechaDesde: args.fechaDesde,
    fechaHasta: args.fechaHasta,
    dryRun: args.dryRun,
    output: args.output,
  }, 'Iniciando compare-mentions');

  if (args.output === 'csv') {
    logger.warn({ output: args.output }, '--output=csv aún no implementado. Usando --output=console.');
    args.output = 'console';
  }

  const sb = createClient(
    process.env['SUPABASE_URL']!,
    process.env['SUPABASE_SERVICE_ROLE_KEY']!,
  );

  let ethosMenciones: MencionNorm[];
  let pcMenciones: MencionNorm[];

  try {
    [ethosMenciones, pcMenciones] = await Promise.all([
      cargarMencionesEthos(sb, args),
      cargarPressClipping(sb, args),
    ]);
  } catch (err: unknown) {
    logger.error(
      { error: err instanceof Error ? err.message : String(err) },
      'Error al cargar datos',
    );
    process.exit(1);
  }

  logger.info({
    menciones_ethos: ethosMenciones.length,
    menciones_pressclipping: pcMenciones.length,
  }, 'Datos cargados');

  // ── Guardia: sin datos PressClipping ─────────────────────────────────────
  if (pcMenciones.length === 0) {
    logger.warn(
      {},
      'No hay histórico PressClipping cargado en comparativo_pressclipping. ' +
      'Comparativo no ejecutable. Importa el histórico con:\n' +
      '  npm run import-pressclipping -- --fuente=csv --archivo=<path> --dry-run',
    );
    process.exit(0);
  }

  if (args.dryRun) {
    logger.info({
      menciones_ethos: ethosMenciones.length,
      menciones_pressclipping: pcMenciones.length,
    }, '[dry-run] Conteos disponibles — no se ejecuta el cruce.');
    return;
  }

  // ── Ejecutar cruce ────────────────────────────────────────────────────────
  const resultados = matchMenciones(ethosMenciones, pcMenciones);

  // ── Clasificar causa raíz (consulta noticias para SOLO_PRESSCLIPPING) ─────
  await clasificarResultados(sb, resultados, ethosMenciones);

  // ── Clustering editorial de PressClipping ────────────────────────────────
  const matchedUrlNorms = new Set(
    resultados
      .filter(r => r.estado_comparativo === 'MATCH' || r.estado_comparativo === 'MATCH_PROBABLE')
      .map(r => r.url_norm_pressclipping ?? '')
      .filter(Boolean),
  );
  const pcRecords: PCRecord[] = pcMenciones.map(p => ({
    fecha: p.fecha,
    keyword: p.keyword,
    medio: p.medio,
    titulo: p.titulo,
    url: p.url,
    url_norm: p.url_norm ?? normalizeUrl(p.url),
  }));

  // Overrides de cluster derivados de la causa raíz body-aware/diagnosticada.
  const statusPorUrlNorm = new Map<string, ClusterStatus>();
  for (const r of resultados) {
    if (!r.en_pressclipping) continue;
    const st = causaToClusterStatus(r.categoria);
    if (st && r.url_norm_pressclipping) statusPorUrlNorm.set(r.url_norm_pressclipping, st);
  }
  const overridesByIndex = new Map<number, ClusterStatus>();
  pcRecords.forEach((rec, i) => {
    const st = rec.url_norm ? statusPorUrlNorm.get(rec.url_norm) : undefined;
    if (st) overridesByIndex.set(i, st);
  });

  const clusters = clusterizar(pcRecords, matchedUrlNorms, overridesByIndex);
  anotarClustersEnResultados(resultados, clusters, pcRecords);
  const metricasCluster = calcularMetricasCluster(clusters, pcRecords.length);

  const metricas = {
    ...calcularMetricas(resultados, ethosMenciones, pcMenciones),
    ...metricasCluster,
  };

  logger.info({
    total_resultados: resultados.length,
    ...metricas,
  }, 'Comparativo completado.');

  if (args.output === 'console') {
    imprimirConsola(resultados, metricas);
  } else if (args.output === 'sheet') {
    imprimirConsola(resultados, metricas);
    await exportarASheet(resultados, metricas, args.replaceWindow);
  }
}

/**
 * Añade al `comentario` de cada resultado con presencia en PressClipping la
 * info del cluster editorial al que pertenece (cluster_id, size, status) y, si
 * la URL ya fue diagnosticada directamente, los marcadores de diagnóstico.
 */
function anotarClustersEnResultados(
  resultados: ComparativoResultado[],
  clusters: Cluster[],
  pcRecords: PCRecord[],
): void {
  // url_norm → cluster
  const porUrl = new Map<string, Cluster>();
  for (const c of clusters) {
    for (const i of c.indices) {
      const un = pcRecords[i]?.url_norm;
      if (un) porUrl.set(un, c);
    }
  }
  for (const r of resultados) {
    if (!r.en_pressclipping) continue;
    const c = r.url_norm_pressclipping ? porUrl.get(r.url_norm_pressclipping) : undefined;
    if (!c) continue;
    let tag = `cluster_id=${c.cluster_id}; cluster_size=${c.num_medios}; cluster_status=${c.estado_cluster}`;
    if (verdictoDiagnosticado(r.url_pressclipping)) {
      tag += '; diagnose_url=ok; origen_cobertura=pressclipping_diagnostico';
    }
    r.comentario = r.comentario ? `${r.comentario} | ${tag}` : tag;
  }
}

main().catch(err => {
  logger.error(
    { error: err instanceof Error ? err.message : String(err) },
    'Error fatal en compare-mentions',
  );
  process.exit(1);
});
