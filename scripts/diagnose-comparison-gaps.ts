/**
 * Diagnóstico de gaps del comparativo Ethos vs PressClipping.
 *
 * Reconstruye el comparativo desde Supabase para una ventana de fechas y, para
 * cada registro del estado pedido (por default SOLO_PRESSCLIPPING), produce una
 * tabla de diagnóstico con causa raíz y acción recomendada.
 *
 * Uso:
 *   npm run diagnose-gaps -- --fecha-desde=2026-06-25 --fecha-hasta=2026-06-26
 *   npm run diagnose-gaps -- --fecha-desde=2026-06-25 --fecha-hasta=2026-06-26 --estado=SOLO_PRESSCLIPPING
 *
 * Solo lee. NO inserta, NO crawlea, NO toca Sheets.
 */
import 'dotenv/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  matchMenciones,
  normalizeUrl,
  type MencionNorm,
  type CausaRaiz,
} from '../src/comparators/mentionMatcher.js';
import { clusterizar, type PCRecord, type ClusterStatus } from '../src/comparators/cluster.js';
import {
  verdictoDiagnosticado,
  tokensSignificativos,
  causaToClusterStatus,
} from '../src/comparators/diagnosticoVerdicts.js';
import { SELECT_MENCION_EXPORT, mapMencionExport } from '../src/types/mencion.js';
import { foldText } from '../src/matchers/text.js';
import { normalizarVentanaTimestamp, aFechaMx } from '../src/utils/dateWindow.js';
import { logger } from '../src/utils/logger.js';

interface DiagArgs {
  fechaDesde?: string;
  fechaHasta?: string;
  estado: string;
}

function parseArgs(argv: string[]): DiagArgs {
  const out: DiagArgs = { estado: 'SOLO_PRESSCLIPPING' };
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    const key = eq === -1 ? body : body.slice(0, eq);
    const val = eq === -1 ? '' : body.slice(eq + 1);
    switch (key) {
      case 'fecha-desde': out.fechaDesde = val; break;
      case 'fecha-hasta': out.fechaHasta = val; break;
      case 'estado':      out.estado = val; break;
    }
  }
  return out;
}

const fold = (s?: string | null): string => foldText(s ?? '').replace(/\s+/g, ' ').trim();

/** Estado técnico conocido de fuentes (diagnósticos jun 2026). */
const MEDIO_SOURCE_STATUS: Record<string, CausaRaiz> = {
  'el economista': 'ETHOS_SOURCE_BLOCKED',
  'el informador': 'ETHOS_SOURCE_BLOCKED',
  'la silla rota': 'ETHOS_SOURCE_NO_FEED',
  'diario basta':  'ETHOS_SOURCE_TIMEOUT',
  'hospitalitas':  'ETHOS_SOURCE_MISSING',
};

const KEYWORDS_PRECISION = new Set(['tequila', 'mezcal', 'industria del mezcal']);

async function cargarEthos(sb: SupabaseClient, args: DiagArgs): Promise<MencionNorm[]> {
  let q = sb.from('menciones').select(SELECT_MENCION_EXPORT).neq('estado_revision', 'descartada');
  const { desde, hasta } = normalizarVentanaTimestamp({ desde: args.fechaDesde, hasta: args.fechaHasta });
  if (desde) q = q.gte('noticias.fecha_publicacion', desde);
  if (hasta) q = q.lte('noticias.fecha_publicacion', hasta);
  const { data, error } = await q;
  if (error) throw new Error(`Error cargando Ethos: ${error.message}`);
  return (data ?? []).map(mapMencionExport).map(f => ({
    fuente: 'Ethos' as const,
    fecha: f.fecha_publicacion?.substring(0, 10),
    cliente: f.cliente ?? undefined,
    keyword: f.keyword ?? undefined,
    medio: f.medio ?? undefined,
    titulo: f.titulo ?? undefined,
    url: f.url_original ?? undefined,
    url_norm: normalizeUrl(f.url_original),
    estado_revision: f.estado_revision ?? undefined,
  }));
}

async function cargarPC(sb: SupabaseClient, args: DiagArgs): Promise<MencionNorm[]> {
  let q = sb.from('comparativo_pressclipping').select('*');
  if (args.fechaDesde) q = q.gte('fecha', aFechaMx(args.fechaDesde));
  if (args.fechaHasta) q = q.lte('fecha', aFechaMx(args.fechaHasta));
  const { data, error } = await q;
  if (error) throw new Error(`Error cargando PressClipping: ${error.message}`);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    fuente: 'PressClipping' as const,
    fecha: (r['fecha'] as string | null) ?? undefined,
    cliente: (r['cliente'] as string | null) ?? undefined,
    grupo_tema: (r['grupo_tema'] as string | null) ?? undefined,
    keyword: (r['keyword'] as string | null) ?? undefined,
    medio: (r['medio'] as string | null) ?? undefined,
    titulo: (r['titulo'] as string | null) ?? undefined,
    url: (r['url'] as string | null) ?? undefined,
    url_norm: (r['url_norm'] as string | null) ?? normalizeUrl(r['url'] as string | null),
  }));
}

interface GapDiag {
  medio: string;
  keyword: string;
  titulo: string;
  url: string;
  fecha: string;
  medio_existe: boolean;
  medio_id: string | null;
  medio_activo: boolean | null;
  metodo: string | null;
  rss_url: string | null;
  sitemap_url: string | null;
  ultimo_estado: string | null;
  url_en_noticias: boolean;
  titulo_en_noticias: boolean;
  noticia_id: string | null;
  keyword_existe: boolean;
  cuerpo_contiene_keyword: boolean | null;
  causa_raiz: CausaRaiz;
  accion: string;
}

async function diagnosticarGap(
  sb: SupabaseClient,
  pc: MencionNorm,
  keywordsActivas: Set<string>,
): Promise<GapDiag> {
  const medioKey = fold(pc.medio);

  // 1. Medio en tabla
  const { data: medios } = await sb
    .from('medios')
    .select('medio_id, nombre_medio, activo, metodo_extraccion, rss_url, sitemap_url, ultimo_estado')
    .ilike('nombre_medio', `%${(pc.medio ?? '').split(' ')[0]}%`)
    .limit(5);
  const medio = (medios ?? []).find(m => fold(m.nombre_medio).includes(medioKey) || medioKey.includes(fold(m.nombre_medio)));

  // 2. Nota en noticias — buscar por URL primero (fiable para diagnósticos), luego título.
  let noticia: Record<string, any> | undefined;
  if (pc.url) {
    const { data } = await sb
      .from('noticias')
      .select('noticia_id, titulo, url_original, texto_cuerpo_nota, texto_nota_limpia, origen_cobertura')
      .or(`url_original.eq."${pc.url}",url_canonica.eq."${normalizeUrl(pc.url)}"`)
      .limit(1);
    noticia = data?.[0];
  }
  if (!noticia) {
    const frag = (pc.titulo ?? '').substring(0, 30);
    const { data } = await sb
      .from('noticias')
      .select('noticia_id, titulo, url_original, texto_cuerpo_nota, texto_nota_limpia, origen_cobertura')
      .ilike('titulo', `%${frag}%`)
      .limit(1);
    noticia = data?.[0];
  }
  const esDiagnostico = !!noticia && (noticia['origen_cobertura'] ?? 'ethos_organico') === 'pressclipping_diagnostico';

  // 3. keyword existe
  const keywordExiste = keywordsActivas.has(fold(pc.keyword));

  // 4. cuerpo contiene keyword (match directo o por tokens significativos)
  let cuerpoContiene: boolean | null = null;
  if (noticia) {
    const cuerpo = fold((noticia['texto_cuerpo_nota'] ?? noticia['texto_nota_limpia'] ?? '') + ' ' + (noticia['titulo'] ?? ''));
    const kwFold = fold(pc.keyword);
    cuerpoContiene = kwFold.length > 0 &&
      (cuerpo.includes(kwFold) || tokensSignificativos(pc.keyword ?? '').some(t => cuerpo.includes(t)));
  }

  // ── Determinar causa raíz ────────────────────────────────────────────────
  let causa: CausaRaiz;
  let accion: string;

  // 0. Veredicto humano diagnosticado por URL (prioridad).
  const vd = verdictoDiagnosticado(pc.url);
  if (vd) {
    causa = vd.causa;
    accion = `[diagnose-url] ${vd.nota}`;
  } else if (!noticia) {
    // No crawleada
    let sourceStatus: CausaRaiz | undefined;
    for (const [nombre, st] of Object.entries(MEDIO_SOURCE_STATUS)) {
      if (medioKey.includes(fold(nombre))) { sourceStatus = st; break; }
    }
    if (sourceStatus) {
      causa = sourceStatus;
      accion = causa === 'ETHOS_SOURCE_BLOCKED' ? 'Probar diagnose-url; si la URL extrae bien, el problema es discovery. Si falla, requiere proxy/JS.'
        : causa === 'ETHOS_SOURCE_NO_FEED' ? 'Buscar feed alterno o evaluar extracción directa por URL.'
        : causa === 'ETHOS_SOURCE_TIMEOUT' ? 'Apuntar a sub-sitemap estable; reintentar con timeout mayor.'
        : 'Diagnosticar fuente; agregar medio solo si hay RSS/sitemap viable.';
    } else if (!medio) {
      causa = 'ETHOS_SOURCE_MISSING';
      accion = 'Medio no configurado. Diagnosticar fuente y agregar si hay RSS/sitemap viable.';
    } else {
      causa = 'ETHOS_SOURCE_WINDOW_LIMITED';
      accion = 'Medio funcional pero la nota no entró en la ventana crawleada. Subir crawl-limit o frecuencia.';
    }
  } else if (cuerpoContiene === false) {
    causa = 'PC_FALSE_POSITIVE';
    accion = 'PressClipping reportó la keyword pero el cuerpo extraído no la contiene. Verificar si es FP real o gap de extracción (zona no textual).';
  } else if (KEYWORDS_PRECISION.has(fold(pc.keyword))) {
    causa = 'ETHOS_PRECISION_TRADEOFF';
    accion = 'El cuerpo contiene el término pero el contexto de precisión lo excluye (diseño anti-FP). Requiere decisión humana.';
  } else if (esDiagnostico) {
    // Solo existe copia diagnóstica con el término: extracción posible, gap de descubrimiento/fuente.
    let sourceStatus: CausaRaiz | undefined;
    for (const [nombre, st] of Object.entries(MEDIO_SOURCE_STATUS)) {
      if (medioKey.includes(fold(nombre))) { sourceStatus = st; break; }
    }
    causa = sourceStatus ?? 'ETHOS_DISCOVERY_GAP';
    accion = 'La URL extrae bien y contiene el término relevante: gap accionable de descubrimiento/fuente. Evaluar agregar/reparar medio con feed estable.';
  } else if (!keywordExiste) {
    causa = 'ETHOS_KEYWORD_GAP';
    accion = 'La nota existe y contiene el término pero ninguna keyword activa lo cubre. Agregar keyword.';
  } else {
    causa = 'ETHOS_CONTEXT_BLOCKED';
    accion = 'La keyword existe y el término está presente pero no generó mención: revisar contexto_incluir/excluir.';
  }

  return {
    medio: pc.medio ?? '-',
    keyword: pc.keyword ?? '-',
    titulo: (pc.titulo ?? '').substring(0, 60),
    url: pc.url ?? '-',
    fecha: pc.fecha ?? '-',
    medio_existe: !!medio,
    medio_id: medio?.medio_id ?? null,
    medio_activo: medio?.activo ?? null,
    metodo: medio?.metodo_extraccion ?? null,
    rss_url: medio?.rss_url ?? null,
    sitemap_url: medio?.sitemap_url ?? null,
    ultimo_estado: medio?.ultimo_estado ?? null,
    url_en_noticias: !!noticia,
    titulo_en_noticias: !!noticia,
    noticia_id: noticia?.noticia_id ?? null,
    keyword_existe: keywordExiste,
    cuerpo_contiene_keyword: cuerpoContiene,
    causa_raiz: causa,
    accion,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  logger.info({ ...args }, 'Iniciando diagnose-comparison-gaps');

  const sb = createClient(process.env['SUPABASE_URL']!, process.env['SUPABASE_SERVICE_ROLE_KEY']!);

  const [ethos, pc] = await Promise.all([cargarEthos(sb, args), cargarPC(sb, args)]);
  logger.info({ menciones_ethos: ethos.length, menciones_pressclipping: pc.length }, 'Datos cargados');

  if (pc.length === 0) {
    logger.warn({}, 'No hay registros PressClipping en la ventana. Nada que diagnosticar.');
    return;
  }

  // keywords activas (folded)
  const { data: kws } = await sb.from('keywords').select('keyword').eq('activa', true);
  const keywordsActivas = new Set((kws ?? []).map(k => fold(k.keyword)));

  const resultados = matchMenciones(ethos, pc);
  const gaps = resultados.filter(r => r.estado_comparativo === args.estado);

  console.log(`\n=== DIAGNÓSTICO DE GAPS (${args.estado}): ${gaps.length} ===\n`);

  const resumenCausas: Record<string, number> = {};
  const pcRecordsGap: PCRecord[] = [];
  const overridesByIndex = new Map<number, ClusterStatus>();

  for (const g of gaps) {
    // Reconstruir el MencionNorm PC correspondiente
    const pcMatch = pc.find(p => normalizeUrl(p.url_norm ?? p.url) === g.url_norm_pressclipping)
      ?? pc.find(p => fold(p.titulo) === fold(g.titulo));
    if (!pcMatch) continue;

    pcRecordsGap.push({
      fecha: pcMatch.fecha,
      keyword: pcMatch.keyword,
      medio: pcMatch.medio,
      titulo: pcMatch.titulo,
      url: pcMatch.url,
      url_norm: pcMatch.url_norm ?? normalizeUrl(pcMatch.url),
    });

    const d = await diagnosticarGap(sb, pcMatch, keywordsActivas);
    resumenCausas[d.causa_raiz] = (resumenCausas[d.causa_raiz] ?? 0) + 1;
    const st = causaToClusterStatus(d.causa_raiz);
    if (st) overridesByIndex.set(pcRecordsGap.length - 1, st);

    console.log(`── ${d.medio} | kw:${d.keyword} | ${d.fecha} ──`);
    console.log(`   título:        ${d.titulo}`);
    console.log(`   url:           ${d.url}`);
    console.log(`   medio_existe:  ${d.medio_existe}  id:${d.medio_id ?? '-'}  activo:${d.medio_activo ?? '-'}  metodo:${d.metodo ?? '-'}  estado:${d.ultimo_estado ?? '-'}`);
    console.log(`   rss:           ${d.rss_url ?? '-'}`);
    console.log(`   sitemap:       ${d.sitemap_url ?? '-'}`);
    console.log(`   en_noticias:   ${d.url_en_noticias}  noticia_id:${d.noticia_id ?? '-'}`);
    console.log(`   keyword_existe:${d.keyword_existe}  cuerpo_contiene_kw:${d.cuerpo_contiene_keyword ?? 'n/a'}`);
    console.log(`   CAUSA RAÍZ:    ${d.causa_raiz}`);
    console.log(`   ACCIÓN:        ${d.accion}`);
    console.log('');
  }

  console.log('=== RESUMEN DE CAUSAS (por registro) ===');
  for (const [c, n] of Object.entries(resumenCausas).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${c.padEnd(30)}: ${n}`);
  }

  // ── Clustering editorial (con overrides body-aware/diagnosticados) ──────────
  const clusters = clusterizar(pcRecordsGap, new Set(), overridesByIndex);
  console.log(`\n=== CLUSTERS EDITORIALES (${clusters.length} de ${pcRecordsGap.length} registros) ===\n`);
  for (const c of clusters.sort((a, b) => b.num_medios - a.num_medios)) {
    console.log(`── ${c.cluster_id} ──`);
    console.log(`   título_repr:   ${c.titulo_representativo.substring(0, 70)}`);
    console.log(`   keyword:       ${c.keyword ?? '-'}   fecha:${c.fecha ?? '-'}`);
    console.log(`   num_medios:    ${c.num_medios}  [${c.medios.join(', ')}]`);
    console.log(`   ESTADO:        ${c.estado_cluster}`);
    console.log(`   ACCIÓN:        ${c.accion_recomendada}`);
    console.log('');
  }

  const resumenClusters: Record<string, number> = {};
  for (const c of clusters) resumenClusters[c.estado_cluster] = (resumenClusters[c.estado_cluster] ?? 0) + 1;
  console.log('=== RESUMEN DE CLUSTERS ===');
  for (const [c, n] of Object.entries(resumenClusters).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${c.padEnd(30)}: ${n}`);
  }
}

main().catch(err => {
  logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Error fatal en diagnose-comparison-gaps');
  process.exit(1);
});
