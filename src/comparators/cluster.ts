/**
 * Clustering editorial de registros PressClipping.
 *
 * Objetivo: detectar columnas sindicadas / republicaciones que aparecen en
 * muchos medios con el mismo título, para no inflar la cobertura tratando cada
 * réplica como un gap independiente.
 *
 * Un "cluster" agrupa registros con:
 *   - misma fecha (día)
 *   - misma keyword normalizada
 *   - título normalizado fuerte similar (similitud >= 0.85)
 *
 * Es lógica PURA y testeable (sin red ni DB).
 */
import { normalizeTitulo, calcSimilarity } from './mentionMatcher.js';
import { foldText } from '../matchers/text.js';

/** Registro mínimo de PressClipping para clustering. */
export interface PCRecord {
  fecha?: string;
  keyword?: string;
  medio?: string;
  titulo?: string;
  url?: string;
  /** url normalizada (para cruzar con resultados de match). */
  url_norm?: string;
}

export type ClusterStatus =
  | 'PC_UNIQUE_VALID'
  | 'PC_SYNDICATED_REPRINT'
  | 'PC_SYNDICATED_LOW_VALUE'
  | 'PC_FALSE_POSITIVE'
  | 'ETHOS_ACTIONABLE_GAP'
  | 'ETHOS_PRECISION_TRADEOFF'
  | 'ETHOS_SOURCE_MISSING_CLUSTER'
  | 'ETHOS_MATCHED_CLUSTER'
  | 'REVISAR_HUMANO';

/** Prioridad para resolver el estado de un cluster con varios miembros diagnosticados. */
const PRIORIDAD_OVERRIDE: ClusterStatus[] = [
  'ETHOS_MATCHED_CLUSTER',
  'ETHOS_ACTIONABLE_GAP',
  'ETHOS_PRECISION_TRADEOFF',
  'PC_FALSE_POSITIVE',
  'PC_SYNDICATED_LOW_VALUE',
];

export interface Cluster {
  cluster_id: string;
  titulo_representativo: string;
  keyword?: string;
  fecha?: string;
  medios: string[];
  num_medios: number;
  urls: string[];
  /** Índices de los registros originales que componen el cluster. */
  indices: number[];
  estado_cluster: ClusterStatus;
  accion_recomendada: string;
  /** True si algún registro del cluster está matcheado con Ethos. */
  matched: boolean;
}

/** Umbral de similitud de título para fusionar variantes casi iguales. */
const UMBRAL_CLUSTER = 0.85;

/** Cuántos medios distintos hacen que un cluster se considere sindicado. */
const MIN_MEDIOS_SINDICADO = 3;

/** Prefijos de columna editorial que se eliminan antes de comparar títulos. */
const PREFIJOS_COLUMNA = [
  'indicador politico',
  'columna',
  'opinion',
  'editorial',
  'analisis',
  'pais',
  'el cristalazo',
  'bajo reserva',
  'trascendio',
];

/** Entidades/temas que indican relevancia real para los clientes. */
const TOKENS_RELEVANTES = [
  'tequila', 'mezcal', 'bacardi', 'jumex', 'ieps', 'bebida', 'bebidas',
  'alcohol', 'alcoholica', 'alcoholicas', 'impuesto', 'agave', 'denominacion',
  'reforma laboral', 'salario minimo', 'sindical', 'conciliacion laboral',
  'comercam', 'nom-006', 'nom-070', 'azucarada', 'azucaradas', 'refresco',
];

/**
 * Normalización fuerte de título: fold + quita puntuación + quita prefijos de
 * columna + colapsa espacios. Reutiliza normalizeTitulo y le quita prefijos.
 */
export function normalizeTituloFuerte(titulo: string | null | undefined): string {
  let t = normalizeTitulo(titulo); // ya fold + sin puntuación + espacios colapsados
  for (const p of PREFIJOS_COLUMNA) {
    if (t.startsWith(p + ' ')) {
      t = t.slice(p.length).trim();
      break;
    }
  }
  return t;
}

/** ¿El texto contiene algún token relevante para los clientes? */
export function contieneTokenRelevante(texto: string | null | undefined): boolean {
  const t = foldText(texto ?? '');
  return TOKENS_RELEVANTES.some(tok => t.includes(tok));
}

function slug(s: string, max = 24): string {
  return foldText(s).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, max);
}

/**
 * Agrupa registros PressClipping en clusters editoriales.
 * `matchedUrlNorms` (opcional): set de url_norm que están matcheadas con Ethos,
 * para marcar `matched` y clasificar como ETHOS_MATCHED_CLUSTER.
 */
export function clusterizar(
  records: PCRecord[],
  matchedUrlNorms: ReadonlySet<string> = new Set(),
  overridesByIndex: ReadonlyMap<number, ClusterStatus> = new Map(),
): Cluster[] {
  const clusters: Cluster[] = [];

  records.forEach((rec, idx) => {
    const fecha = (rec.fecha ?? '').substring(0, 10);
    const kwFold = foldText(rec.keyword ?? '');
    const tituloFuerte = normalizeTituloFuerte(rec.titulo);

    // Buscar cluster compatible: misma fecha + misma keyword + título similar.
    let destino = clusters.find(c => {
      if ((c.fecha ?? '') !== fecha) return false;
      if (foldText(c.keyword ?? '') !== kwFold) return false;
      const repFuerte = normalizeTituloFuerte(c.titulo_representativo);
      return calcSimilarity(repFuerte, tituloFuerte) >= UMBRAL_CLUSTER;
    });

    const medio = rec.medio ?? '(sin medio)';
    const url = rec.url ?? '';
    const isMatched = !!rec.url_norm && matchedUrlNorms.has(rec.url_norm);

    if (!destino) {
      destino = {
        cluster_id: `pc_${fecha.replace(/-/g, '')}_${slug(rec.keyword ?? 'nokw', 14)}_${slug(tituloFuerte, 20)}`,
        titulo_representativo: rec.titulo ?? '(sin título)',
        keyword: rec.keyword,
        fecha,
        medios: [medio],
        num_medios: 1,
        urls: url ? [url] : [],
        indices: [idx],
        estado_cluster: 'REVISAR_HUMANO',
        accion_recomendada: '',
        matched: isMatched,
      };
      clusters.push(destino);
    } else {
      if (!destino.medios.includes(medio)) destino.medios.push(medio);
      destino.num_medios = destino.medios.length;
      if (url) destino.urls.push(url);
      destino.indices.push(idx);
      destino.matched = destino.matched || isMatched;
    }
  });

  for (const c of clusters) clasificarCluster(c);

  // Aplicar overrides diagnosticados (causa body-aware / veredicto humano).
  if (overridesByIndex.size > 0) {
    for (const c of clusters) {
      if (c.estado_cluster === 'ETHOS_MATCHED_CLUSTER') continue;
      const estadosDiag = c.indices
        .map(i => overridesByIndex.get(i))
        .filter((s): s is ClusterStatus => !!s);
      if (estadosDiag.length === 0) continue;
      const elegido = PRIORIDAD_OVERRIDE.find(p => estadosDiag.includes(p));
      if (elegido) {
        c.estado_cluster = elegido;
        c.accion_recomendada = accionPorEstado(elegido, c.num_medios);
      }
    }
  }
  return clusters;
}

/** Acción recomendada según el estado de cluster (tras override diagnosticado). */
function accionPorEstado(estado: ClusterStatus, numMedios: number): string {
  switch (estado) {
    case 'ETHOS_ACTIONABLE_GAP':
      return 'Gap real y relevante confirmado por diagnóstico de URL. Evaluar reparar/agregar fuente con RSS/sitemap estable.';
    case 'ETHOS_PRECISION_TRADEOFF':
      return 'El cuerpo contiene el término pero el contexto de precisión lo excluye (diseño anti-FP). Documentar; no relajar aún.';
    case 'PC_FALSE_POSITIVE':
      return 'Diagnóstico de URL confirma que el cuerpo no es relevante para el cliente. Falso positivo de PressClipping.';
    case 'PC_SYNDICATED_LOW_VALUE':
      return `Mención real pero de bajo valor (tangencial/entretenimiento${numMedios >= 3 ? '/sindicada' : ''}). No accionable.`;
    default:
      return 'Requiere revisión humana.';
  }
}

/** Asigna estado_cluster y accion_recomendada con heurística conservadora. */
export function clasificarCluster(c: Cluster): void {
  // La relevancia se mide por el TÍTULO, no por la keyword: la keyword es la
  // clasificación amplia de PressClipping (siempre "relevante" por definición),
  // así que una columna de futbol bajo keyword "Bebidas alcohólicas" NO es relevante.
  const relevante = contieneTokenRelevante(c.titulo_representativo);

  if (c.matched) {
    c.estado_cluster = 'ETHOS_MATCHED_CLUSTER';
    c.accion_recomendada = 'Ya cubierto por Ethos. Sin acción.';
    return;
  }

  const sindicado = c.num_medios >= MIN_MEDIOS_SINDICADO;

  if (sindicado) {
    if (relevante) {
      c.estado_cluster = 'PC_SYNDICATED_REPRINT';
      c.accion_recomendada = `Columna/nota sindicada en ${c.num_medios} medios CON tema relevante. Considerar capturar 1 fuente representativa, no las ${c.num_medios}.`;
    } else {
      c.estado_cluster = 'PC_SYNDICATED_LOW_VALUE';
      c.accion_recomendada = `Columna sindicada en ${c.num_medios} medios SIN tema relevante en el título (keyword clasificatoria amplia de PC). Verificar cuerpo; probable ruido. NO agregar medios por esto.`;
    }
    return;
  }

  // 1-2 medios
  if (relevante) {
    c.estado_cluster = 'ETHOS_ACTIONABLE_GAP';
    c.accion_recomendada = 'Gap real y relevante. Evaluar reparar/agregar la fuente del medio si tiene RSS/sitemap.';
  } else {
    c.estado_cluster = 'REVISAR_HUMANO';
    c.accion_recomendada = 'Keyword clasificatoria amplia sin entidad relevante en el título. Requiere revisión humana del cuerpo (posible PC_FALSE_POSITIVE).';
  }
}

export interface ClusterMetrics {
  pressclipping_registros: number;
  pressclipping_clusters: number;
  clusters_matched: number;
  clusters_solo_pressclipping: number;
  clusters_pc_false_positive: number;
  clusters_syndicated_low_value: number;
  clusters_syndicated_reprint: number;
  clusters_actionable_gap: number;
  clusters_precision_tradeoff: number;
  clusters_revisar_humano: number;
  cobertura_bruta_clusters: string;
  cobertura_ajustada_clusters: string;
}

/** Calcula métricas por cluster a partir de la lista clusterizada. */
export function calcularMetricasCluster(
  clusters: Cluster[],
  totalRegistros: number,
): ClusterMetrics {
  const total = clusters.length;
  const matched = clusters.filter(c => c.estado_cluster === 'ETHOS_MATCHED_CLUSTER').length;
  const fp = clusters.filter(c => c.estado_cluster === 'PC_FALSE_POSITIVE').length;
  const lowValue = clusters.filter(c => c.estado_cluster === 'PC_SYNDICATED_LOW_VALUE').length;
  const reprint = clusters.filter(c => c.estado_cluster === 'PC_SYNDICATED_REPRINT').length;
  const actionable = clusters.filter(c => c.estado_cluster === 'ETHOS_ACTIONABLE_GAP').length;
  const precision = clusters.filter(c => c.estado_cluster === 'ETHOS_PRECISION_TRADEOFF').length;
  const revisar = clusters.filter(c => c.estado_cluster === 'REVISAR_HUMANO').length;
  const soloPC = total - matched;

  // Denominador ajustado: excluye FP, sindicadas de bajo valor y precision trade-off (no accionables).
  const denomAjustado = total - fp - lowValue - precision;

  return {
    pressclipping_registros: totalRegistros,
    pressclipping_clusters: total,
    clusters_matched: matched,
    clusters_solo_pressclipping: soloPC,
    clusters_pc_false_positive: fp,
    clusters_syndicated_low_value: lowValue,
    clusters_syndicated_reprint: reprint,
    clusters_actionable_gap: actionable,
    clusters_precision_tradeoff: precision,
    clusters_revisar_humano: revisar,
    cobertura_bruta_clusters: total > 0 ? (matched / total).toFixed(2) : 'N/A',
    cobertura_ajustada_clusters: denomAjustado > 0 ? (matched / denomAjustado).toFixed(2) : 'N/A',
  };
}
