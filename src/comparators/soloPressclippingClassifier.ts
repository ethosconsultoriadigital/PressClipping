/**
 * Clasificador DETERMINÍSTICO (sin IA) de filas `SOLO_PRESSCLIPPING` del
 * comparativo Ethos vs PressClipping (pestaña `05_Comparativo_PressClipping`).
 *
 * Objetivo: separar la brecha REAL accionable del ruido (falsos positivos de PC,
 * sindicación de bajo valor, homónimos) para poder medir readiness de sustitución
 * de forma honesta. NO usa red, NO usa IA: solo reglas sobre datos ya presentes
 * en la fila (estado_comparativo, keyword, medio, título, causa raíz previa,
 * score de similitud, diferencia de días, razón/acción sugeridas).
 *
 * Módulo PURO y testeable.
 */

/** Categorías permitidas para clasificar un SOLO_PRESSCLIPPING (fase de gaps). */
export type CategoriaGap =
  | 'GAP_REAL_ACCIONABLE'
  | 'PC_FALSE_POSITIVE'
  | 'SINDICADA_DUPLICADA_LOW_VALUE'
  | 'FUENTE_NO_CUBIERTA'
  | 'FUENTE_BLOQUEADA'
  | 'EXTRACCION_FALLIDA'
  | 'KEYWORD_MISSING'
  | 'WINDOW_MISMATCH'
  | 'URL_NORMALIZATION_ISSUE'
  | 'HOMONIMO_O_RUIDO'
  | 'REVISAR_HUMANO';

export type PrioridadGap = 'ALTA' | 'MEDIA' | 'BAJA' | 'NINGUNA';

/** Fila mínima del comparativo necesaria para clasificar (tolerante a nulos). */
export interface FilaComparativo {
  estado_comparativo?: string | null;
  match_tipo?: string | null;
  cliente_id?: string | null;
  cliente?: string | null;
  medio?: string | null;
  keyword?: string | null;
  titulo?: string | null;
  url_pressclipping?: string | null;
  url_ethos?: string | null;
  score_similitud?: number | string | null;
  diferencia_dias?: number | string | null;
  razon_posible?: string | null;
  accion_recomendada?: string | null;
  /** Causa raíz previa (CausaRaiz) si el comparativo ya la asignó. */
  categoria?: string | null;
}

export interface ClasificacionGap {
  categoria_gap: CategoriaGap;
  subcategoria_gap: string;
  prioridad_gap: PrioridadGap;
  causa_probable_gap: string;
  accion_recomendada_gap: string;
  requiere_revision_humana: boolean;
}

const txt = (v: unknown): string => String(v ?? '').trim();
const low = (v: unknown): string => txt(v).toLowerCase();

/** Convierte a número tolerando string vacío / no numérico. */
function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Mapea una CausaRaiz previa (si existe en la fila) a categoría_gap. Es la señal
 * más fuerte porque suele venir de veredictos humanos o de estado de fuente.
 */
function desdeCausaRaiz(causa: string): CategoriaGap | undefined {
  switch (causa) {
    case 'PC_FALSE_POSITIVE':          return 'PC_FALSE_POSITIVE';
    case 'PC_SYNDICATED_LOW_VALUE':    return 'SINDICADA_DUPLICADA_LOW_VALUE';
    case 'ETHOS_SOURCE_BLOCKED':       return 'FUENTE_BLOQUEADA';
    case 'ETHOS_SOURCE_TIMEOUT':       return 'FUENTE_BLOQUEADA';
    case 'ETHOS_SOURCE_MISSING':       return 'FUENTE_NO_CUBIERTA';
    case 'ETHOS_SOURCE_NO_FEED':       return 'FUENTE_NO_CUBIERTA';
    case 'ETHOS_SOURCE_WINDOW_LIMITED':return 'WINDOW_MISMATCH';
    case 'ETHOS_EXTRACTION_GAP':       return 'EXTRACCION_FALLIDA';
    case 'ETHOS_KEYWORD_GAP':          return 'KEYWORD_MISSING';
    case 'ETHOS_CONTEXT_BLOCKED':      return 'HOMONIMO_O_RUIDO';
    case 'ETHOS_PRECISION_TRADEOFF':   return 'HOMONIMO_O_RUIDO';
    case 'ETHOS_DISCOVERY_GAP':        return 'GAP_REAL_ACCIONABLE';
    case 'REVISAR_HUMANO':             return 'REVISAR_HUMANO';
    default:                           return undefined;
  }
}

/** Señales de sindicación / agregadores de bajo valor por nombre de medio o URL. */
const MEDIOS_SINDICADORES = /(\bmsn\b|news\.google|google news|yahoo|bing|terra|infobae wire|prensa[- ]?latina|notimex|\befe\b|reuters|\bap\b)/i;
/** Slugs / secciones que suelen ser listados o índices, no notas individuales. */
const LISTING_HINT = /(\/tag\/|\/tags\/|\/seccion\/|\/categoria\/|\/category\/|\/author\/|\/autor\/|\/page\/|\/buscar|\/search)/i;

/**
 * Clasifica UNA fila SOLO_PRESSCLIPPING de forma determinística.
 *
 * Precedencia: causa raíz previa → señales de ruido (FP/sindicado/homónimo) →
 * señales de fuente/extracción → resto = gap real accionable (conservador: si no
 * hay evidencia de ruido, se asume brecha real de cobertura que hay que atacar).
 */
export function clasificarSoloPressclipping(fila: FilaComparativo): ClasificacionGap {
  const causa = txt(fila.categoria);
  const medio = txt(fila.medio);
  const keyword = txt(fila.keyword);
  const titulo = txt(fila.titulo);
  const url = txt(fila.url_pressclipping) || txt(fila.url_ethos);
  const razon = low(fila.razon_posible);
  const accion = txt(fila.accion_recomendada);
  const dias = num(fila.diferencia_dias);

  const base = (
    categoria: CategoriaGap,
    prioridad: PrioridadGap,
    causaProbable: string,
    accionRec: string,
    revision = false,
    subcat = '',
  ): ClasificacionGap => ({
    categoria_gap: categoria,
    subcategoria_gap: subcat,
    prioridad_gap: prioridad,
    causa_probable_gap: causaProbable,
    accion_recomendada_gap: accionRec || accion || 'revisar',
    requiere_revision_humana: revision,
  });

  // 1) Causa raíz previa (señal más confiable).
  const porCausa = causa ? desdeCausaRaiz(causa) : undefined;
  if (porCausa) {
    const prioridad: PrioridadGap =
      porCausa === 'GAP_REAL_ACCIONABLE' ? 'ALTA'
      : porCausa === 'FUENTE_NO_CUBIERTA' || porCausa === 'EXTRACCION_FALLIDA' || porCausa === 'KEYWORD_MISSING' ? 'MEDIA'
      : porCausa === 'REVISAR_HUMANO' ? 'MEDIA'
      : 'BAJA';
    return base(
      porCausa,
      prioridad,
      `causa_raiz=${causa}`,
      accionPorCategoria(porCausa),
      porCausa === 'REVISAR_HUMANO',
      `causa_raiz:${causa}`,
    );
  }

  // 2) Ruido explícito por razón textual.
  if (/falso\s*positivo|false\s*positive/.test(razon)) {
    return base('PC_FALSE_POSITIVE', 'BAJA', 'razon_posible indica falso positivo de PC', 'descartar (no penaliza cobertura)', false, 'razon');
  }
  if (/sindicad|syndicat|replica|agregador|wire\b/.test(razon)) {
    return base('SINDICADA_DUPLICADA_LOW_VALUE', 'BAJA', 'razon_posible indica sindicación/replicador', 'descartar (bajo valor editorial)', false, 'razon');
  }
  if (/homonim|homónim|ruido|tangencial|fuera de ambito|fuera de ámbito/.test(razon)) {
    return base('HOMONIMO_O_RUIDO', 'BAJA', 'razon_posible indica homónimo/ruido', 'afinar keyword/contexto', true, 'razon');
  }

  // 3) Sindicación por medio/URL.
  if (MEDIOS_SINDICADORES.test(medio) || MEDIOS_SINDICADORES.test(url)) {
    return base('SINDICADA_DUPLICADA_LOW_VALUE', 'BAJA', `medio agregador/sindicador (${medio || url})`, 'descartar (bajo valor)', false, 'medio');
  }

  // 4) Listado / sección (no es una nota individual).
  if (LISTING_HINT.test(url)) {
    return base('URL_NORMALIZATION_ISSUE', 'BAJA', 'URL parece listado/sección, no nota individual', 'revisar normalización de URL', true, 'listing');
  }

  // 5) Fuente/keyword/window por razón textual.
  if (/keyword|palabra clave/.test(razon) && /(falta|missing|no configurad|sin keyword)/.test(razon)) {
    return base('KEYWORD_MISSING', 'MEDIA', 'razón indica keyword no configurada', 'agregar/ajustar keyword', false, 'razon');
  }
  if (/bloque|403|forbidden|paywall|captcha/.test(razon)) {
    return base('FUENTE_BLOQUEADA', 'BAJA', 'fuente bloqueada (403/paywall/captcha)', 'marcar fuente bloqueada', false, 'razon');
  }
  if (/no cubiert|sin fuente|no rss|sin feed|no crawl/.test(razon)) {
    return base('FUENTE_NO_CUBIERTA', 'MEDIA', 'medio sin fuente cubierta en Ethos', 'evaluar alta de fuente', false, 'razon');
  }
  if (/extrac|cuerpo|body|vacio|vacío/.test(razon)) {
    return base('EXTRACCION_FALLIDA', 'MEDIA', 'extracción de cuerpo fallida/incompleta', 'reparar extractor del medio', false, 'razon');
  }

  // 6) Desfase de ventana (PC muy fuera del rango temporal de Ethos).
  if (dias !== undefined && Math.abs(dias) > 3) {
    return base('WINDOW_MISMATCH', 'BAJA', `diferencia_dias=${dias} fuera de ventana`, 'revisar ventana temporal', false, 'window');
  }

  // 7) Sin señal de ruido → gap real accionable (conservador).
  const prioridad: PrioridadGap = titulo || keyword ? 'ALTA' : 'MEDIA';
  return base(
    'GAP_REAL_ACCIONABLE',
    prioridad,
    'sin señal de ruido: cobertura ausente en Ethos',
    'priorizar alta/reparación de fuente para el medio',
    false,
    'default',
  );
}

/** Acción recomendada canónica por categoría. */
export function accionPorCategoria(cat: CategoriaGap): string {
  switch (cat) {
    case 'GAP_REAL_ACCIONABLE':           return 'priorizar cobertura (alta/reparación de fuente)';
    case 'PC_FALSE_POSITIVE':             return 'descartar (falso positivo de PC)';
    case 'SINDICADA_DUPLICADA_LOW_VALUE': return 'descartar (sindicado/bajo valor)';
    case 'FUENTE_NO_CUBIERTA':            return 'evaluar alta de fuente';
    case 'FUENTE_BLOQUEADA':              return 'marcar fuente bloqueada / reintentar distinto';
    case 'EXTRACCION_FALLIDA':            return 'reparar extractor del medio';
    case 'KEYWORD_MISSING':               return 'agregar/ajustar keyword';
    case 'WINDOW_MISMATCH':               return 'revisar ventana temporal';
    case 'URL_NORMALIZATION_ISSUE':       return 'revisar normalización de URL';
    case 'HOMONIMO_O_RUIDO':              return 'afinar keyword/contexto';
    case 'REVISAR_HUMANO':                return 'revisión humana';
  }
}

/** ¿La categoría es un gap REAL que penaliza cobertura ajustada? */
export function esGapAccionable(cat: CategoriaGap): boolean {
  return cat === 'GAP_REAL_ACCIONABLE'
    || cat === 'FUENTE_NO_CUBIERTA'
    || cat === 'EXTRACCION_FALLIDA'
    || cat === 'KEYWORD_MISSING';
}

/** Columnas nuevas recomendadas para clasificar en 05 (append, no rompe orden). */
export const GAP_CLASSIFICATION_HEADERS = [
  'categoria_gap',
  'subcategoria_gap',
  'prioridad_gap',
  'causa_probable_gap',
  'accion_recomendada_gap',
  'requiere_revision_humana',
] as const;
