/**
 * Contrato de reintento del article enrich (ENRICH DRAIN V1).
 *
 * Módulo PURO: sin DB, sin red, sin `Date.now()` implícito (el reloj se pasa
 * como parámetro). Define tres cosas y nada más:
 *
 *   1. Qué es un ÉXITO PERSISTIDO (clean no vacío + escritura confirmada).
 *   2. Cómo se clasifica un fallo (`EnrichFailureClass`).
 *   3. Cuándo vuelve a ser elegible una nota (`planEnrichRetry`).
 *
 * Deliberadamente NO hay motor de backoff exponencial, ni tabla de historial de
 * intentos, ni leases. La memoria es una fila con tres columnas
 * (`supabase/migrations/0014_enrich_retry_metadata.sql`).
 */

/** Clases de fallo persistidas en `noticias.enrich_failure_class`. */
export type EnrichFailureClass =
  | 'TIMEOUT'
  | 'NETWORK_TRANSIENT'
  | 'HTTP_429'
  | 'HTTP_5XX'
  | 'HTTP_403'
  | 'HTTP_404_410'
  | 'EMPTY_CLEAN_TEXT'
  | 'WRITE_FAILED'
  | 'UNKNOWN';

export const ENRICH_FAILURE_CLASSES: readonly EnrichFailureClass[] = [
  'TIMEOUT',
  'NETWORK_TRANSIENT',
  'HTTP_429',
  'HTTP_5XX',
  'HTTP_403',
  'HTTP_404_410',
  'EMPTY_CLEAN_TEXT',
  'WRITE_FAILED',
  'UNKNOWN',
] as const;

/** Estado de deuda de enrich derivado de la fila. */
export type EnrichDebtState =
  | 'SUCCESS'
  | 'NEVER_ATTEMPTED'
  | 'RETRY_SCHEDULED'
  | 'BLOCKED_REVIEW';

/** Campos de la fila necesarios para derivar el estado. */
export interface EnrichDebtRow {
  texto_nota_limpia: string | null;
  enrich_last_attempt_at: string | null;
  enrich_next_attempt_at: string | null;
  enrich_failure_class: string | null;
}

/**
 * Éxito = texto limpio con contenido real. `''` y `'   '` NO son éxito: ese fue
 * exactamente el agujero que dejaba notas "enriquecidas" sin texto buscable.
 */
export function esTextoLimpioUtil(texto: string | null | undefined): boolean {
  return typeof texto === 'string' && texto.trim().length > 0;
}

/** Deriva el estado de deuda de una fila (contrato S1.2). */
export function derivarEstadoEnrich(row: EnrichDebtRow): EnrichDebtState {
  if (esTextoLimpioUtil(row.texto_nota_limpia)) return 'SUCCESS';
  if (row.enrich_last_attempt_at == null) return 'NEVER_ATTEMPTED';
  if (row.enrich_next_attempt_at != null) return 'RETRY_SCHEDULED';
  return 'BLOCKED_REVIEW';
}

/** Delays de la política V1. Todos configurables: nada hard-coded en el motor. */
export interface EnrichRetryConfig {
  /** Deuda transitoria genérica / UNKNOWN. Default alineado al ciclo diario. */
  nextCycleMinutes: number;
  /** Timeout y errores de red. */
  transientMinutes: number;
  /** HTTP 429 sin `Retry-After` utilizable. */
  rateLimitMinutes: number;
  /** HTTP 5xx del origen. */
  serverErrorMinutes: number;
  /** Cooldown de 403 cuando NO está declarado como bloqueo de entorno. */
  forbiddenCooldownMinutes: number;
  /** Fallo de escritura en Supabase. */
  writeFailedMinutes: number;
  /** Tope superior para un `Retry-After` gigante del origen. */
  maxRetryAfterMinutes: number;
}

export const DEFAULT_ENRICH_RETRY_CONFIG: EnrichRetryConfig = {
  nextCycleMinutes: 1440,
  transientMinutes: 180,
  rateLimitMinutes: 360,
  serverErrorMinutes: 360,
  forbiddenCooldownMinutes: 2880,
  writeFailedMinutes: 60,
  maxRetryAfterMinutes: 1440,
};

export interface PlanEnrichRetryInput {
  failureClass: EnrichFailureClass;
  /** Reloj del proceso (ISO o Date). */
  now: Date;
  /** Segundos de `Retry-After` si el origen lo mandó (429/503). */
  retryAfterSeconds?: number | null;
  /**
   * El medio está declarado como bloqueado en ESTE entorno (p. ej. MED-0029 en
   * GitHub Actions). Un 403 así no se reintenta a ciegas: queda para revisión.
   */
  environmentBlocked?: boolean;
  config?: EnrichRetryConfig;
}

/** Metadata a persistir tras un intento fallido. */
export interface EnrichRetryPlan {
  enrich_last_attempt_at: string;
  /** `null` ⇒ BLOCKED_REVIEW: no vuelve a entrar al drain sin decisión humana. */
  enrich_next_attempt_at: string | null;
  enrich_failure_class: EnrichFailureClass;
  state: Extract<EnrichDebtState, 'RETRY_SCHEDULED' | 'BLOCKED_REVIEW'>;
}

function enMinutos(now: Date, minutos: number): string {
  return new Date(now.getTime() + minutos * 60_000).toISOString();
}

/**
 * Política V1. Dentro de un mismo run NUNCA se reintenta (eso lo garantiza
 * `attempted_this_run` en el drain); esto solo decide la elegibilidad ENTRE
 * corridas.
 */
export function planEnrichRetry(input: PlanEnrichRetryInput): EnrichRetryPlan {
  const cfg = input.config ?? DEFAULT_ENRICH_RETRY_CONFIG;
  const now = input.now;
  const last = now.toISOString();
  const bloqueado = (): EnrichRetryPlan => ({
    enrich_last_attempt_at: last,
    enrich_next_attempt_at: null,
    enrich_failure_class: input.failureClass,
    state: 'BLOCKED_REVIEW',
  });
  const reintento = (minutos: number): EnrichRetryPlan => ({
    enrich_last_attempt_at: last,
    enrich_next_attempt_at: enMinutos(now, minutos),
    enrich_failure_class: input.failureClass,
    state: 'RETRY_SCHEDULED',
  });

  switch (input.failureClass) {
    case 'TIMEOUT':
    case 'NETWORK_TRANSIENT':
      return reintento(cfg.transientMinutes);

    case 'HTTP_429': {
      // El `Retry-After` se PRESERVA como señal de elegibilidad; jamás se duerme
      // el job entero esperándolo.
      const porCabecera =
        input.retryAfterSeconds != null && input.retryAfterSeconds > 0
          ? Math.min(Math.ceil(input.retryAfterSeconds / 60), cfg.maxRetryAfterMinutes)
          : 0;
      return reintento(Math.max(porCabecera, cfg.rateLimitMinutes));
    }

    case 'HTTP_5XX': {
      const porCabecera =
        input.retryAfterSeconds != null && input.retryAfterSeconds > 0
          ? Math.min(Math.ceil(input.retryAfterSeconds / 60), cfg.maxRetryAfterMinutes)
          : 0;
      return reintento(Math.max(porCabecera, cfg.serverErrorMinutes));
    }

    case 'HTTP_403':
      // Bloqueo de entorno conocido (cloud) ⇒ no quemar intentos cada ciclo.
      return input.environmentBlocked ? bloqueado() : reintento(cfg.forbiddenCooldownMinutes);

    case 'HTTP_404_410':
      // El recurso no existe: reintentarlo es ruido puro.
      return bloqueado();

    case 'EMPTY_CLEAN_TEXT':
      // No es éxito. Queda como deuda VISIBLE con su clase, no como reintento
      // infinito contra una plantilla que el extractor genérico no resuelve.
      return bloqueado();

    case 'WRITE_FAILED':
      return reintento(cfg.writeFailedMinutes);

    case 'UNKNOWN':
    default:
      return reintento(cfg.nextCycleMinutes);
  }
}

/** Metadata que limpia el rastro de fallo al confirmar un éxito persistido. */
export function limpiarMetadataFallo(now: Date): {
  enrich_last_attempt_at: string;
  enrich_next_attempt_at: null;
  enrich_failure_class: null;
} {
  return {
    enrich_last_attempt_at: now.toISOString(),
    enrich_next_attempt_at: null,
    enrich_failure_class: null,
  };
}

/** ¿Esta clase de fallo vuelve a ser elegible en algún momento? */
export function esClaseReintentable(
  failureClass: EnrichFailureClass,
  opts: { environmentBlocked?: boolean } = {},
): boolean {
  return (
    planEnrichRetry({
      failureClass,
      now: new Date(0),
      environmentBlocked: opts.environmentBlocked,
    }).enrich_next_attempt_at != null
  );
}
