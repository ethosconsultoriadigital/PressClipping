/**
 * Reglas DETERMINÍSTICAS de "alertas sombra" (shadow alerts) — SIN IA, SIN red.
 *
 * Simula qué alertas se HABRÍAN enviado a partir de menciones ya detectadas,
 * clasificándolas por prioridad (P1/P2/P3) o descartándolas (BLOQUEADA/DUPLICADA),
 * y registrando motivo, canal hipotético y la regla de disparo. NUNCA envía nada.
 *
 * Calibración anti-sobre-alertamiento:
 *   - Una misma NOTA para un mismo CLIENTE genera UNA sola alerta (las keywords
 *     se agrupan en `keywords_detectadas`); el resto se marca DUPLICADA.
 *   - P1 (inmediata) exige una señal FUERTE (no basta medio/keyword "importante").
 *
 * Módulo PURO y testeable. No usa OpenAI ni clasificadores: 100% reglas.
 */
import { normalizeUrl } from '../comparators/mentionMatcher.js';

/** Cabeceras canónicas de la pestaña de salida `10_Alertas_Sombra` (solo-append). */
export const ALERTAS_SOMBRA_HEADERS = [
  'run_id', 'fecha_ejecucion', 'modo', 'cliente_id', 'cliente', 'mencion_id',
  'noticia_id', 'fecha_publicacion', 'medio', 'titulo', 'url', 'keyword',
  'grupo_tema', 'sentimiento', 'valoracion', 'prioridad_medio',
  'tipo_alerta_simulada', 'canal_simulado', 'habria_alerta', 'motivo_alerta',
  'motivo_bloqueo', 'regla_disparo', 'dedupe_key', 'estado_shadow', 'notas',
] as const;

export type TipoAlertaSimulada = 'inmediata' | 'resumen' | 'monitoreo' | 'bloqueada';
export type CanalSimulado = 'whatsapp' | 'email' | 'dashboard' | 'ninguno';
export type EstadoShadow =
  | 'P1_INMEDIATA'
  | 'P2_RESUMEN'
  | 'P3_DASHBOARD'
  | 'BLOQUEADA'
  | 'DUPLICADA';
export type HabriaAlerta = 'SÍ' | 'NO';

/** Mención ya detectada, normalizada para evaluación de alertas sombra. */
export interface MencionAlertaInput {
  mencion_id?: string | null;
  noticia_id?: string | null;
  cliente_id?: string | null;
  cliente?: string | null;
  fecha_publicacion?: string | null;
  medio?: string | null;
  titulo?: string | null;
  url?: string | null;
  keyword?: string | null;
  grupo_tema?: string | null;
  sentimiento?: string | null;
  /** Relevancia 0–1 (o 0–100; se normaliza). */
  valoracion?: number | null;
  /** Prioridad del medio: alta / media / baja. */
  prioridad_medio?: string | null;
  cliente_activo?: boolean;
  cliente_alertas_activas?: boolean;
  keyword_activa?: boolean;
  /** La keyword está marcada explícitamente para alertar (keywords.alerta). */
  keyword_alerta?: boolean;
  keyword_prioridad?: string | null;
  /** Tema reputacional/regulatorio/crisis fuerte (derivado de temas sensibles). */
  tema_reputacional?: boolean;
  es_falso_positivo?: boolean;
  /** Flag de detect (menciones.requiere_alerta). */
  requiere_alerta?: boolean;
}

/** Decisión de la regla para una mención (sin metadatos de corrida). */
export interface DecisionAlertaSombra {
  habria_alerta: HabriaAlerta;
  tipo_alerta_simulada: TipoAlertaSimulada;
  canal_simulado: CanalSimulado;
  motivo_alerta: string;
  motivo_bloqueo: string;
  regla_disparo: string;
  dedupe_key: string;
  estado_shadow: EstadoShadow;
  /** Keywords agrupadas de la misma nota/cliente (separadas por '|'). */
  keywords_detectadas: string;
}

export type CandidatoAlertaSombra = MencionAlertaInput & DecisionAlertaSombra;

export interface ResumenAlertasSombra {
  evaluadas: number;
  /** Filas que detonarían alerta (P1+P2). */
  candidatas: number;
  p1_inmediata: number;
  p2_resumen: number;
  p3_dashboard: number;
  bloqueada: number;
  duplicada: number;
}

/** Relevancia (0–1) mínima para "valoración alta" (señal fuerte P1). */
export const VALORACION_ALTA_MIN = 0.7;
/** Relevancia (0–1) por encima de la cual P1 aplica aunque falte otra señal. */
export const VALORACION_CRITICA_MIN = 0.85;
/** Relevancia (0–1) mínima para considerar una mención "relevante" (P2). */
export const VALORACION_RELEVANTE_MIN = 0.4;
/** Relevancia (0–1) por debajo de la cual es "baja relevancia extrema". */
export const VALORACION_EXTREMA_MAX = 0.05;

const PRIORIDAD_ALTA = new Set(['alta', 'critica', 'crítica', 'high', 'urgente']);
const PRIORIDAD_MEDIA = new Set(['media', 'medium', 'normal']);
const PRIORIDAD_BAJA = new Set(['baja', 'low', 'monitoreo']);

const txt = (v: unknown): string => String(v ?? '').trim();
const esVacio = (v: unknown): boolean => txt(v) === '';

function esUrlValida(url: unknown): boolean {
  const u = txt(url).toLowerCase();
  return u.startsWith('http://') || u.startsWith('https://');
}

function esSentimientoNegativo(s: unknown): boolean {
  return txt(s).toLowerCase().startsWith('negativ');
}

/** Normaliza la relevancia a escala 0–1 (acepta 0–100). */
export function normalizarValoracion(v: number | null | undefined): number {
  if (v == null || Number.isNaN(v)) return 0;
  return v > 1 ? v / 100 : v;
}

function esPrioridadAlta(p: unknown): boolean {
  return PRIORIDAD_ALTA.has(txt(p).toLowerCase());
}
function esPrioridadMediaOAlta(p: unknown): boolean {
  const k = txt(p).toLowerCase();
  return PRIORIDAD_ALTA.has(k) || PRIORIDAD_MEDIA.has(k);
}
function esPrioridadBaja(p: unknown): boolean {
  return PRIORIDAD_BAJA.has(txt(p).toLowerCase());
}

function tituloNorm(t: unknown): string {
  return txt(t).toLowerCase();
}

/**
 * dedupe_key FUERTE (una nota = una alerta por cliente):
 *   1) cliente_id + noticia_id
 *   2) cliente_id + url_normalizada
 *   3) cliente_id + titulo_norm + medio + fecha_publicacion
 *
 * NO se usa mencion_id: una misma nota puede tener varias keywords/menciones y
 * no debe generar varias alertas.
 */
export function dedupeKey(m: MencionAlertaInput): string {
  const cli = txt(m.cliente_id) || txt(m.cliente) || 'sin_cliente';
  if (!esVacio(m.noticia_id)) return `${cli}::${txt(m.noticia_id)}`;
  if (esUrlValida(m.url)) return `${cli}::${normalizeUrl(txt(m.url))}`;
  return `${cli}::${tituloNorm(m.titulo)}::${txt(m.medio).toLowerCase()}::${txt(m.fecha_publicacion)}`;
}

/** Primer motivo de bloqueo aplicable (o '' si no hay). */
function motivoBloqueo(m: MencionAlertaInput): string {
  if (m.cliente_activo === false) return 'cliente_inactivo';
  if (m.cliente_alertas_activas === false) return 'alertas_cliente_desactivadas';
  if (m.keyword_activa === false) return 'keyword_inactiva';
  if (m.es_falso_positivo === true) return 'posible_falso_positivo';
  if (!esUrlValida(m.url)) return 'sin_url';
  if (esVacio(m.titulo)) return 'sin_titulo';
  if (esVacio(m.medio)) return 'sin_medio';
  // Baja relevancia extrema: relevancia ~0 + medio de baja prioridad + sin señales.
  const val = normalizarValoracion(m.valoracion);
  if (
    m.valoracion != null &&
    val <= VALORACION_EXTREMA_MAX &&
    esPrioridadBaja(m.prioridad_medio) &&
    m.keyword_alerta !== true &&
    m.requiere_alerta !== true &&
    m.tema_reputacional !== true
  ) {
    return 'baja_relevancia_extrema';
  }
  return '';
}

/**
 * Señales FUERTES que detonan P1 (inmediata). Al menos una requerida.
 *
 * Calibración anti-sobre-alertamiento (clave): los flags `keyword.alerta` y
 * `requiere_alerta` NO bastan por sí solos — exigen además relevancia alta
 * (valoración ≥ 0.7) o sentimiento negativo. Así una keyword marcada como
 * alerta sobre una nota de baja relevancia cae a P2, no a P1.
 *
 * Deliberadamente NO incluye "medio prioridad alta" ni "keyword prioridad alta"
 * por sí solas.
 */
function senalesFuertes(m: MencionAlertaInput): string[] {
  const s: string[] = [];
  const val = normalizarValoracion(m.valoracion);
  const neg = esSentimientoNegativo(m.sentimiento);
  const relevanciaAlta = val >= VALORACION_ALTA_MIN || neg;
  if (neg && val >= VALORACION_ALTA_MIN) s.push('sentimiento_negativo_valoracion_alta');
  if (m.tema_reputacional === true) s.push('tema_reputacional');
  if (val >= VALORACION_CRITICA_MIN) s.push('valoracion_critica');
  if (m.keyword_alerta === true && relevanciaAlta) s.push('keyword_alerta_relevante');
  if (m.requiere_alerta === true && relevanciaAlta) s.push('requiere_alerta_relevante');
  return s;
}

/** ¿La mención es "relevante" (candidata a P2) aunque no sea crítica? */
function esRelevante(m: MencionAlertaInput): boolean {
  return (
    normalizarValoracion(m.valoracion) >= VALORACION_RELEVANTE_MIN ||
    esPrioridadMediaOAlta(m.prioridad_medio) ||
    esPrioridadMediaOAlta(m.keyword_prioridad)
  );
}

/**
 * Evalúa UNA mención (ya agregada por nota+cliente si viene de `evaluarLote`).
 * NO resuelve duplicados entre notas distintas; eso lo hace `evaluarLote`.
 */
export function evaluarMencion(m: MencionAlertaInput): DecisionAlertaSombra {
  const key = dedupeKey(m);
  const keywords = esVacio(m.keyword) ? '' : txt(m.keyword);

  const bloqueo = motivoBloqueo(m);
  if (bloqueo) {
    return {
      habria_alerta: 'NO',
      tipo_alerta_simulada: 'bloqueada',
      canal_simulado: 'ninguno',
      motivo_alerta: '',
      motivo_bloqueo: bloqueo,
      regla_disparo: 'bloqueada',
      dedupe_key: key,
      estado_shadow: 'BLOQUEADA',
      keywords_detectadas: keywords,
    };
  }

  const fuertes = senalesFuertes(m);
  if (fuertes.length > 0) {
    return {
      habria_alerta: 'SÍ',
      tipo_alerta_simulada: 'inmediata',
      canal_simulado: 'whatsapp',
      motivo_alerta: `P1 inmediata: ${fuertes.join(', ')}.`,
      motivo_bloqueo: '',
      regla_disparo: fuertes.join('|'),
      dedupe_key: key,
      estado_shadow: 'P1_INMEDIATA',
      keywords_detectadas: keywords,
    };
  }

  if (esRelevante(m)) {
    return {
      habria_alerta: 'SÍ',
      tipo_alerta_simulada: 'resumen',
      canal_simulado: 'email',
      motivo_alerta: 'P2 resumen: mención relevante no crítica (digest).',
      motivo_bloqueo: '',
      regla_disparo: 'mencion_relevante_no_critica',
      dedupe_key: key,
      estado_shadow: 'P2_RESUMEN',
      keywords_detectadas: keywords,
    };
  }

  return {
    habria_alerta: 'NO',
    tipo_alerta_simulada: 'monitoreo',
    canal_simulado: 'dashboard',
    motivo_alerta: 'P3 dashboard: monitoreo general, sin urgencia.',
    motivo_bloqueo: '',
    regla_disparo: 'monitoreo_general',
    dedupe_key: key,
    estado_shadow: 'P3_DASHBOARD',
    keywords_detectadas: keywords,
  };
}

/** Agrega un grupo de menciones de la MISMA nota+cliente en una sola señal. */
function agregarGrupo(grupo: MencionAlertaInput[]): {
  agg: MencionAlertaInput;
  keywords: string[];
} {
  const base = grupo[0]!;
  const keywords = [...new Set(grupo.map((g) => txt(g.keyword)).filter((k) => k !== ''))];
  const maxVal = Math.max(...grupo.map((g) => normalizarValoracion(g.valoracion)), 0);
  const anyNeg = grupo.some((g) => esSentimientoNegativo(g.sentimiento));
  const prioridadKw = grupo.some((g) => esPrioridadAlta(g.keyword_prioridad))
    ? 'alta'
    : grupo.some((g) => esPrioridadMediaOAlta(g.keyword_prioridad))
      ? 'media'
      : (base.keyword_prioridad ?? null);

  const agg: MencionAlertaInput = {
    ...base,
    sentimiento: anyNeg ? 'negativo' : base.sentimiento,
    valoracion: maxVal,
    requiere_alerta: grupo.some((g) => g.requiere_alerta === true),
    keyword_alerta: grupo.some((g) => g.keyword_alerta === true),
    tema_reputacional: grupo.some((g) => g.tema_reputacional === true),
    keyword_activa: grupo.some((g) => g.keyword_activa !== false),
    es_falso_positivo: grupo.every((g) => g.es_falso_positivo === true),
    keyword_prioridad: prioridadKw,
  };
  return { agg, keywords };
}

/**
 * Evalúa un LOTE de menciones AGRUPANDO por nota+cliente (`dedupe_key`):
 * cada nota genera UNA alerta primaria (P1/P2/P3/BLOQUEADA) con las keywords
 * agrupadas; las menciones extra de la misma nota se marcan DUPLICADA.
 */
export function evaluarLote(menciones: MencionAlertaInput[]): {
  candidatos: CandidatoAlertaSombra[];
  resumen: ResumenAlertasSombra;
} {
  const grupos = new Map<string, MencionAlertaInput[]>();
  for (const m of menciones) {
    const key = dedupeKey(m);
    const arr = grupos.get(key);
    if (arr) arr.push(m);
    else grupos.set(key, [m]);
  }

  const candidatos: CandidatoAlertaSombra[] = [];
  for (const [key, grupo] of grupos) {
    const { agg, keywords } = agregarGrupo(grupo);
    const decision = evaluarMencion(agg);
    const keywordsStr = keywords.join('|');

    // Fila primaria (conserva identidad del primer miembro, keywords agrupadas).
    candidatos.push({
      ...grupo[0]!,
      ...decision,
      dedupe_key: key,
      keywords_detectadas: keywordsStr,
    });

    // Menciones extra de la misma nota → DUPLICADA (no se vuelven a alertar).
    for (let i = 1; i < grupo.length; i++) {
      candidatos.push({
        ...grupo[i]!,
        habria_alerta: 'NO',
        tipo_alerta_simulada: 'bloqueada',
        canal_simulado: 'ninguno',
        motivo_alerta: '',
        motivo_bloqueo: 'duplicada_en_ventana',
        regla_disparo: 'duplicada',
        dedupe_key: key,
        estado_shadow: 'DUPLICADA',
        keywords_detectadas: keywordsStr,
      });
    }
  }

  const cuenta = (e: EstadoShadow): number =>
    candidatos.filter((c) => c.estado_shadow === e).length;
  const resumen: ResumenAlertasSombra = {
    evaluadas: menciones.length,
    p1_inmediata: cuenta('P1_INMEDIATA'),
    p2_resumen: cuenta('P2_RESUMEN'),
    p3_dashboard: cuenta('P3_DASHBOARD'),
    bloqueada: cuenta('BLOQUEADA'),
    duplicada: cuenta('DUPLICADA'),
    candidatas: cuenta('P1_INMEDIATA') + cuenta('P2_RESUMEN'),
  };

  return { candidatos, resumen };
}
