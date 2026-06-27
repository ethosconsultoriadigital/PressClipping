/**
 * Módulo de comparación de menciones: Ethos vs PressClipping.
 *
 * Proporciona normalización de URLs, títulos y medios, cálculo de
 * similitud de texto (Levenshtein normalizado) y el algoritmo de
 * cruce que clasifica cada par como MATCH, MATCH_PROBABLE, etc.
 *
 * Sin dependencias externas pesadas: la similitud se calcula con
 * Levenshtein implementado internamente.
 */

import { canonicalizeUrl } from '../normalizers/url.js';
import { foldText } from '../matchers/text.js';

// ─────────────────────────────────────────────────────────────────────────────
// Tipos públicos
// ─────────────────────────────────────────────────────────────────────────────

export type FuenteComparativo = 'Ethos' | 'PressClipping';

export interface MencionNorm {
  fuente: FuenteComparativo;
  fecha?: string;           // YYYY-MM-DD
  cliente?: string;
  cliente_id?: string;
  grupo_tema?: string;
  keyword?: string;
  medio?: string;
  titulo?: string;
  url?: string;
  url_norm?: string;        // se calcula si no se provee
  autor?: string;
  seccion?: string;
  tipo_nota?: string;
  id_externo?: string;      // ID nativo del sistema fuente (para deduplicación en importación)
  estado_revision?: string; // estado de revisión manual (solo menciones Ethos)
  raw?: unknown;
}

/**
 * Categoría de causa raíz del comparativo. Permite separar cobertura bruta
 * (todos los SOLO_PRESSCLIPPING penalizan) de cobertura ajustada (solo los
 * gaps realmente atacables penalizan).
 */
export type CausaRaiz =
  | 'MATCH_REAL'
  | 'PC_FALSE_POSITIVE'
  | 'PC_SYNDICATED_LOW_VALUE'
  | 'ETHOS_EXTRACTION_GAP'
  | 'ETHOS_KEYWORD_GAP'
  | 'ETHOS_CONTEXT_BLOCKED'
  | 'ETHOS_DISCOVERY_GAP'
  | 'ETHOS_SOURCE_BLOCKED'
  | 'ETHOS_SOURCE_MISSING'
  | 'ETHOS_SOURCE_NO_FEED'
  | 'ETHOS_SOURCE_WINDOW_LIMITED'
  | 'ETHOS_SOURCE_TIMEOUT'
  | 'ETHOS_PRECISION_TRADEOFF'
  | 'SOLO_ETHOS_VALID'
  | 'SOLO_ETHOS_BORDERLINE'
  | 'SOLO_ETHOS_FALSE_POSITIVE'
  | 'REVISAR_HUMANO';

/** Categorías de SOLO_PRESSCLIPPING que NO son atacables (no penalizan cobertura ajustada). */
export const CAUSAS_NO_ACCIONABLES: ReadonlySet<CausaRaiz> = new Set<CausaRaiz>([
  'PC_FALSE_POSITIVE',
  'PC_SYNDICATED_LOW_VALUE',
  'ETHOS_SOURCE_BLOCKED',
  'ETHOS_SOURCE_NO_FEED',
  'ETHOS_SOURCE_MISSING',
  'ETHOS_SOURCE_TIMEOUT',
  'ETHOS_PRECISION_TRADEOFF',
]);

export type MatchTipo =
  | 'MATCH_FUERTE'
  | 'MATCH_PROBABLE'
  | 'MATCH_DEBIL'
  | 'SIN_MATCH';

export type EstadoComparativo =
  | 'MATCH'
  | 'SOLO_PRESSCLIPPING'
  | 'SOLO_ETHOS'
  | 'MATCH_PROBABLE'
  | 'DUPLICADO_POSIBLE'
  | 'REVISAR';

export interface ComparativoResultado {
  fecha?: string;
  cliente?: string;
  grupo_tema?: string;
  keyword?: string;
  medio?: string;
  titulo?: string;
  url_ethos?: string;
  url_pressclipping?: string;
  url_norm_ethos?: string;
  url_norm_pressclipping?: string;
  match_tipo: MatchTipo;
  en_ethos: boolean;
  en_pressclipping: boolean;
  estado_comparativo: EstadoComparativo;
  score_similitud?: number;
  diferencia_dias?: number;
  razon_posible?: string;
  accion_recomendada?: string;
  comentario?: string;
  /** Categoría de causa raíz (se asigna en la fase de clasificación). */
  categoria?: CausaRaiz;
}

// ─────────────────────────────────────────────────────────────────────────────
// Umbrales de matching
// ─────────────────────────────────────────────────────────────────────────────

/** Similitud de título mínima para MATCH_PROBABLE. */
const UMBRAL_PROBABLE = 0.85;
/** Similitud de título mínima para MATCH_DEBIL. */
const UMBRAL_DEBIL = 0.60;
/** Ventana de días para considerar que dos fechas son "cercanas". */
const VENTANA_DIAS = 3;

// ─────────────────────────────────────────────────────────────────────────────
// Normalización de URL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Devuelve la URL canónica (sin tracking, fragmentos ni trailing slash).
 * Reutiliza `canonicalizeUrl` del normalizer existente.
 * Acepta null/undefined y devuelve cadena vacía para facilitar comparaciones.
 */
export function normalizeUrl(url: string | null | undefined): string {
  if (!url) return '';
  return canonicalizeUrl(url.trim());
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalización de título
// ─────────────────────────────────────────────────────────────────────────────

/** Signos de puntuación que se eliminan antes de comparar títulos. */
const PUNCT_RE = /[.,;:!¡?¿"'«»()\[\]{}\-–—_|\/\\*&#@%^~`]+/g;

/**
 * Normaliza un título para comparación:
 * - lowercase
 * - sin acentos ni ñ (via foldText)
 * - sin puntuación fuerte
 * - espacios múltiples colapsados
 */
export function normalizeTitulo(titulo: string | null | undefined): string {
  if (!titulo) return '';
  return foldText(titulo)
    .replace(PUNCT_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalización de medio
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normaliza el nombre de un medio para comparación:
 * - lowercase + sin acentos
 * - elimina sufijos genéricos como "noticias", "digital", "online"
 * - elimina puntuación
 */
const SUFIJOS_MEDIO = /\b(noticias|digital|online|mx|periodico|diario|portal)\b/gi;

export function normalizeMedio(medio: string | null | undefined): string {
  if (!medio) return '';
  return foldText(medio)
    .replace(SUFIJOS_MEDIO, '')
    .replace(PUNCT_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Similitud de texto (Levenshtein normalizado)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calcula la distancia de Levenshtein entre dos cadenas.
 * Complejidad O(m·n); solo se usa con títulos cortos (<= 300 chars).
 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1]! + 1,          // inserción
        prev[j]! + 1,              // eliminación
        prev[j - 1]! + cost,       // sustitución
      );
    }
    prev.splice(0, prev.length, ...curr);
  }
  return prev[b.length]!;
}

/**
 * Similitud normalizada en [0, 1].
 * 1.0 = idénticas; 0.0 = sin similitud.
 */
export function calcSimilarity(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades de fecha
// ─────────────────────────────────────────────────────────────────────────────

function parseFecha(fecha: string | undefined): Date | null {
  if (!fecha) return null;
  const d = new Date(fecha);
  return isNaN(d.getTime()) ? null : d;
}

function difDias(a: Date, b: Date): number {
  return Math.round(Math.abs(a.getTime() - b.getTime()) / 86_400_000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Algoritmo de matching
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dado un registro Ethos, intenta encontrar el mejor match en el array de
 * registros PressClipping.
 *
 * Retorna null si no hay match (SIN_MATCH).
 */
function findBestMatch(
  ethos: MencionNorm,
  pcs: MencionNorm[],
): { pc: MencionNorm; tipo: MatchTipo; score: number; dias: number } | null {
  const urlE = normalizeUrl(ethos.url_norm ?? ethos.url);
  const titE = normalizeTitulo(ethos.titulo);
  const medE = normalizeMedio(ethos.medio);
  const fechaE = parseFecha(ethos.fecha);

  let best: { pc: MencionNorm; tipo: MatchTipo; score: number; dias: number } | null = null;

  for (const pc of pcs) {
    const urlP = normalizeUrl(pc.url_norm ?? pc.url);
    const titP = normalizeTitulo(pc.titulo);
    const medP = normalizeMedio(pc.medio);
    const fechaP = parseFecha(pc.fecha);

    const dias =
      fechaE && fechaP ? difDias(fechaE, fechaP) : VENTANA_DIAS + 1;

    // ── MATCH_FUERTE: misma URL normalizada ──────────────────────────────
    if (urlE && urlP && urlE === urlP) {
      return { pc, tipo: 'MATCH_FUERTE', score: 1.0, dias };
    }

    // ── MATCH_PROBABLE: título ≥ 85%, mismo medio, fecha ±3 días ─────────
    const scoreTit = titE && titP ? calcSimilarity(titE, titP) : 0;
    const mismoMedio = medE && medP && medE === medP;
    const fechaCercana = dias <= VENTANA_DIAS;

    if (scoreTit >= UMBRAL_PROBABLE && mismoMedio && fechaCercana) {
      if (!best || scoreTit > best.score) {
        best = { pc, tipo: 'MATCH_PROBABLE', score: scoreTit, dias };
      }
      continue;
    }

    // ── MATCH_DEBIL: título ≥ 60%, mismo medio, fecha ±3 días ───────────
    if (scoreTit >= UMBRAL_DEBIL && mismoMedio && fechaCercana) {
      if (!best || (best.tipo === 'SIN_MATCH' || scoreTit > best.score)) {
        best = { pc, tipo: 'MATCH_DEBIL', score: scoreTit, dias };
      }
    }
  }

  return best;
}

// ─────────────────────────────────────────────────────────────────────────────
// Función principal
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cruza menciones Ethos con registros PressClipping y devuelve la lista
 * completa de resultados comparativos (MATCH, SOLO_ETHOS, SOLO_PRESSCLIPPING).
 *
 * Algoritmo:
 * 1. Para cada registro Ethos, buscar el mejor match en PressClipping.
 * 2. Los registros PressClipping que no tuvieron match quedan como SOLO_PRESSCLIPPING.
 */
export function matchMenciones(
  ethos: MencionNorm[],
  pressclipping: MencionNorm[],
): ComparativoResultado[] {
  const resultados: ComparativoResultado[] = [];
  const pcMatcheados = new Set<MencionNorm>();

  for (const e of ethos) {
    const match = findBestMatch(e, pressclipping);

    if (!match) {
      resultados.push({
        fecha: e.fecha,
        cliente: e.cliente,
        grupo_tema: e.grupo_tema,
        keyword: e.keyword,
        medio: e.medio,
        titulo: e.titulo,
        url_ethos: e.url,
        url_norm_ethos: normalizeUrl(e.url_norm ?? e.url),
        match_tipo: 'SIN_MATCH',
        en_ethos: true,
        en_pressclipping: false,
        estado_comparativo: 'SOLO_ETHOS',
        razon_posible: 'No se encontró registro equivalente en PressClipping.',
        accion_recomendada: 'Revisar si PressClipping cubre este medio o tema.',
      });
      continue;
    }

    pcMatcheados.add(match.pc);

    const estadoComparativo: EstadoComparativo =
      match.tipo === 'MATCH_FUERTE'    ? 'MATCH'
      : match.tipo === 'MATCH_PROBABLE' ? 'MATCH_PROBABLE'
      : 'REVISAR';

    resultados.push({
      fecha: e.fecha ?? match.pc.fecha,
      cliente: e.cliente ?? match.pc.cliente,
      grupo_tema: e.grupo_tema ?? match.pc.grupo_tema,
      keyword: e.keyword ?? match.pc.keyword,
      medio: e.medio ?? match.pc.medio,
      titulo: e.titulo,
      url_ethos: e.url,
      url_pressclipping: match.pc.url,
      url_norm_ethos: normalizeUrl(e.url_norm ?? e.url),
      url_norm_pressclipping: normalizeUrl(match.pc.url_norm ?? match.pc.url),
      match_tipo: match.tipo,
      en_ethos: true,
      en_pressclipping: true,
      estado_comparativo: estadoComparativo,
      score_similitud: match.score,
      diferencia_dias: match.dias,
      razon_posible:
        match.tipo === 'MATCH_FUERTE'
          ? 'URL idéntica.'
          : `Título similar (${(match.score * 100).toFixed(0)}%) + mismo medio + fecha ±${match.dias}d.`,
      accion_recomendada: 'Validar manualmente si corresponde al mismo artículo.',
    });
  }

  // Registros PressClipping sin match → SOLO_PRESSCLIPPING
  for (const pc of pressclipping) {
    if (pcMatcheados.has(pc)) continue;
    resultados.push({
      fecha: pc.fecha,
      cliente: pc.cliente,
      grupo_tema: pc.grupo_tema,
      keyword: pc.keyword,
      medio: pc.medio,
      titulo: pc.titulo,
      url_pressclipping: pc.url,
      url_norm_pressclipping: normalizeUrl(pc.url_norm ?? pc.url),
      match_tipo: 'SIN_MATCH',
      en_ethos: false,
      en_pressclipping: true,
      estado_comparativo: 'SOLO_PRESSCLIPPING',
      razon_posible: 'Ethos no capturó este artículo.',
      accion_recomendada:
        'Revisar si el medio está configurado y si la keyword es cubierta.',
    });
  }

  return resultados;
}

/**
 * Headers recomendados para la pestaña 05_Comparativo_PressClipping.
 * Se documentan aquí como fuente de verdad; el script de exportación
 * los usará cuando se implemente la escritura a Sheets.
 */
export const COMPARATIVO_SHEET_HEADERS = [
  'fecha',
  'cliente',
  'grupo_tema',
  'keyword',
  'medio',
  'titulo',
  'url_ethos',
  'url_pressclipping',
  'url_norm_ethos',
  'url_norm_pressclipping',
  'match_tipo',
  'en_ethos',
  'en_pressclipping',
  'estado_comparativo',
  'score_similitud',
  'diferencia_dias',
  'razon_posible',
  'accion_recomendada',
  'comentario',
] as const;
