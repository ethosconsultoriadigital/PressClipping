/**
 * Reglas DETERMINÍSTICAS de "alertas sombra" (shadow alerts) — SIN IA, SIN red.
 *
 * Simula qué alertas se HABRÍAN enviado a partir de menciones ya detectadas,
 * clasificándolas en inmediata / resumen / monitoreo y registrando el motivo,
 * el canal hipotético y, en su caso, el motivo de bloqueo. NUNCA envía nada.
 *
 * Módulo PURO y testeable: recibe menciones normalizadas y devuelve candidatos.
 * No usa OpenAI ni ningún clasificador; la decisión es 100% por reglas.
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

export type TipoAlertaSimulada = 'inmediata' | 'resumen' | 'monitoreo';
export type CanalSimulado = 'whatsapp' | 'email' | 'dashboard';
export type EstadoShadow =
  | 'candidato'
  | 'bloqueada'
  | 'duplicada'
  | 'baja_prioridad'
  | 'error';
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
  // Señales de configuración (panel de control):
  cliente_activo?: boolean;
  cliente_alertas_activas?: boolean;
  keyword_activa?: boolean;
  /** La keyword está marcada para alertar (keywords.alerta). */
  keyword_alerta?: boolean;
  /** Prioridad de la keyword: alta / critica / media / baja. */
  keyword_prioridad?: string | null;
  /** Tema reputacional/regulatorio (derivado de temas sensibles). */
  tema_reputacional?: boolean;
  /** estado_revision indica posible falso positivo. */
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
}

export type CandidatoAlertaSombra = MencionAlertaInput & DecisionAlertaSombra;

export interface ResumenAlertasSombra {
  candidatas: number;
  inmediatas: number;
  resumen: number;
  bloqueadas: number;
  duplicadas: number;
  baja_prioridad: number;
}

/** Umbral de relevancia (0–1) para considerar "valoración alta". */
export const VALORACION_ALTA_MIN = 0.7;

const PRIORIDAD_ALTA = new Set(['alta', 'critica', 'crítica', 'high', 'urgente']);
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

function esPrioridadBaja(p: unknown): boolean {
  return PRIORIDAD_BAJA.has(txt(p).toLowerCase());
}

/**
 * dedupe_key estable:
 *   - preferente: cliente_id + mencion_id
 *   - fallback (sin mencion_id): cliente_id + url_normalizada + keyword
 */
export function dedupeKey(m: MencionAlertaInput): string {
  const cli = txt(m.cliente_id) || txt(m.cliente) || 'sin_cliente';
  if (!esVacio(m.mencion_id)) return `${cli}::${txt(m.mencion_id)}`;
  const url = esVacio(m.url) ? 'sin_url' : normalizeUrl(txt(m.url));
  return `${cli}::${url}::${txt(m.keyword).toLowerCase()}`;
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
  return '';
}

/** Señales que detonan una alerta INMEDIATA (al menos una). */
function senalesCriticas(m: MencionAlertaInput): string[] {
  const s: string[] = [];
  if (esSentimientoNegativo(m.sentimiento)) s.push('sentimiento_negativo');
  if (normalizarValoracion(m.valoracion) >= VALORACION_ALTA_MIN) s.push('valoracion_alta');
  if (esPrioridadAlta(m.keyword_prioridad)) s.push('keyword_critica');
  if (esPrioridadAlta(m.prioridad_medio)) s.push('medio_prioridad_alta');
  if (m.tema_reputacional === true) s.push('tema_reputacional');
  if (m.requiere_alerta === true) s.push('requiere_alerta');
  if (m.keyword_alerta === true) s.push('keyword_alerta');
  return s;
}

/**
 * Evalúa UNA mención (sin considerar duplicados; eso lo resuelve `evaluarLote`).
 */
export function evaluarMencion(m: MencionAlertaInput): DecisionAlertaSombra {
  const key = dedupeKey(m);

  const bloqueo = motivoBloqueo(m);
  if (bloqueo) {
    return {
      habria_alerta: 'NO',
      tipo_alerta_simulada: 'monitoreo',
      canal_simulado: 'dashboard',
      motivo_alerta: '',
      motivo_bloqueo: bloqueo,
      regla_disparo: 'bloqueada',
      dedupe_key: key,
      estado_shadow: 'bloqueada',
    };
  }

  const criticas = senalesCriticas(m);
  if (criticas.length > 0) {
    return {
      habria_alerta: 'SÍ',
      tipo_alerta_simulada: 'inmediata',
      canal_simulado: 'whatsapp',
      motivo_alerta: `Mención crítica: ${criticas.join(', ')}.`,
      motivo_bloqueo: '',
      regla_disparo: criticas.join('|'),
      dedupe_key: key,
      estado_shadow: 'candidato',
    };
  }

  // Válida pero no crítica: baja prioridad explícita → monitoreo (sin alerta).
  if (esPrioridadBaja(m.prioridad_medio) || esPrioridadBaja(m.keyword_prioridad)) {
    return {
      habria_alerta: 'NO',
      tipo_alerta_simulada: 'monitoreo',
      canal_simulado: 'dashboard',
      motivo_alerta: '',
      motivo_bloqueo: 'baja_relevancia',
      regla_disparo: 'baja_prioridad',
      dedupe_key: key,
      estado_shadow: 'baja_prioridad',
    };
  }

  // Válida no crítica de prioridad media: iría en un resumen (digest), no inmediata.
  return {
    habria_alerta: 'SÍ',
    tipo_alerta_simulada: 'resumen',
    canal_simulado: 'email',
    motivo_alerta: 'Mención válida no crítica: candidata a resumen.',
    motivo_bloqueo: '',
    regla_disparo: 'mencion_valida_no_critica',
    dedupe_key: key,
    estado_shadow: 'candidato',
  };
}

/**
 * Evalúa un LOTE de menciones, resolviendo duplicados por `dedupe_key`
 * (la primera aparición conserva su decisión; las siguientes se marcan
 * `duplicada`). Devuelve los candidatos y un resumen agregado.
 */
export function evaluarLote(menciones: MencionAlertaInput[]): {
  candidatos: CandidatoAlertaSombra[];
  resumen: ResumenAlertasSombra;
} {
  const vistos = new Set<string>();
  const candidatos: CandidatoAlertaSombra[] = [];

  for (const m of menciones) {
    let decision = evaluarMencion(m);
    if (vistos.has(decision.dedupe_key)) {
      decision = {
        ...decision,
        habria_alerta: 'NO',
        tipo_alerta_simulada: 'monitoreo',
        canal_simulado: 'dashboard',
        motivo_alerta: '',
        motivo_bloqueo: 'duplicada_en_ventana',
        regla_disparo: 'duplicada',
        estado_shadow: 'duplicada',
      };
    } else {
      vistos.add(decision.dedupe_key);
    }
    candidatos.push({ ...m, ...decision });
  }

  const resumen: ResumenAlertasSombra = {
    candidatas: candidatos.filter((c) => c.estado_shadow === 'candidato').length,
    inmediatas: candidatos.filter(
      (c) => c.estado_shadow === 'candidato' && c.tipo_alerta_simulada === 'inmediata',
    ).length,
    resumen: candidatos.filter(
      (c) => c.estado_shadow === 'candidato' && c.tipo_alerta_simulada === 'resumen',
    ).length,
    bloqueadas: candidatos.filter((c) => c.estado_shadow === 'bloqueada').length,
    duplicadas: candidatos.filter((c) => c.estado_shadow === 'duplicada').length,
    baja_prioridad: candidatos.filter((c) => c.estado_shadow === 'baja_prioridad').length,
  };

  return { candidatos, resumen };
}
