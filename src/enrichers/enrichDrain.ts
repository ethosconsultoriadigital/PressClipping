/**
 * ENRICH DRAIN V1 — coordinador de UNA sesión acotada.
 *
 * Reemplaza (detrás de feature flag) al enrich de cupo fijo que provocó el
 * incidente del run 35370007814: 622 notas nuevas, cupo global de 500,
 * `recent-first` y cero memoria ⇒ 124 notas jamás entraron y los fallos
 * seguían NULL, así que podían reaparecer.
 *
 * Todo ocurre en UN proceso. No hay broker, ni workers, ni leases: la
 * coordinación es un `Set` de intentos y dos cursores keyset.
 *
 * Invariantes que este módulo garantiza (y que sus tests fijan):
 *
 *   1. Una noticia se intenta COMO MÁXIMO una vez por sesión
 *      (`attempted_this_run`, poblado ANTES del fetch del artículo).
 *   2. Un fallo que sigue con `texto_nota_limpia` NULL no puede reaparecer en
 *      otra página del mismo run.
 *   3. Paginación keyset, nunca OFFSET, nunca `NOT IN` con miles de UUID.
 *   4. El cursor avanza por la clave LEÍDA, falle o no el procesamiento.
 *   5. No se empieza un artículo si su presupuesto máximo invade la reserva
 *      final del job.
 *   6. La terminación siempre es explícita: DRAINED / TIME_BUDGET /
 *      SAFETY_LIMIT / NO_PROGRESS / INFRA_ERROR.
 *   7. Éxito = texto limpio no vacío Y escritura confirmada.
 */
import {
  cursorAvanzo,
  cursorDesdeFila,
  type DrainCursor,
  type DrainPageRequest,
  type DrainQueue,
} from './enrichDrainQuery.js';
import {
  DEFAULT_ENRICH_RETRY_CONFIG,
  ENRICH_FAILURE_CLASSES,
  esTextoLimpioUtil,
  planEnrichRetry,
  type EnrichFailureClass,
  type EnrichRetryConfig,
} from './enrichRetryPolicy.js';
import type { NoticiaEnriquecidaUpdate } from './enrichNews.js';

/** Fila candidata tal como la entrega el repositorio del drain. */
export interface DrainCandidateRow {
  noticia_id: string;
  medio_id: string | null;
  url_original: string | null;
  created_at: string | null;
  texto_nota_limpia: string | null;
  [extra: string]: unknown;
}

/** Campos de contenido + metadata de reintento que el drain escribe. */
export interface DrainUpdateFields extends NoticiaEnriquecidaUpdate {
  enrich_last_attempt_at?: string | null;
  enrich_next_attempt_at?: string | null;
  enrich_failure_class?: string | null;
}

/** Resultado del intento de UN artículo (fetch + extract), ya clasificado. */
export interface DrainArticleOutcome {
  ok: boolean;
  /** Texto limpio extraído. Vacío/whitespace NO es éxito. */
  cleanText: string | null;
  /** Campos de contenido a persistir (los arma el llamador con el extractor). */
  fields: DrainUpdateFields;
  /** Clase de fallo cuando `ok === false`. */
  failureClass?: EnrichFailureClass;
  /** `Retry-After` en segundos si el origen lo mandó. */
  retryAfterSeconds?: number | null;
}

export interface DrainDeps {
  /** Lee una página keyset de candidatos. Puede lanzar ⇒ INFRA_ERROR. */
  fetchPage: (req: DrainPageRequest) => Promise<DrainCandidateRow[]>;
  /** Descarga y extrae un artículo. No debería lanzar; si lanza, se captura. */
  processArticle: (row: DrainCandidateRow) => Promise<DrainArticleOutcome>;
  /** Escritura CONFIRMADA: `true` solo si la fila se actualizó de verdad. */
  persist: (noticiaId: string, fields: DrainUpdateFields) => Promise<boolean>;
  /** Reloj inyectable. */
  now: () => Date;
  /** ¿Este medio está bloqueado en ESTE entorno? (403 cloud ⇒ BLOCKED_REVIEW). */
  isEnvironmentBlocked?: (medioId: string | null) => boolean;
  /** Observabilidad opcional por página/artículo. */
  onEvent?: (evento: DrainEvent) => void;
}

export type DrainEvent =
  | { type: 'page'; queue: DrainQueue; rows: number; nuevos: number; pass: number }
  | { type: 'attempt'; noticia_id: string; medio_id: string | null; queue: DrainQueue }
  | { type: 'outcome'; noticia_id: string; bucket: DrainBucket; failure_class: EnrichFailureClass | null };

/** Buckets mutuamente excluyentes: su suma es exactamente `attempted`. */
export type DrainBucket =
  | 'persisted_success'
  | 'failed_retryable'
  | 'failed_blocked'
  | 'empty_clean'
  | 'write_failed';

export type DrainTerminationReason =
  | 'DRAINED'
  | 'TIME_BUDGET'
  | 'SAFETY_LIMIT'
  | 'NO_PROGRESS'
  | 'INFRA_ERROR';

export interface DrainOptions {
  /** Cutoff W. Default: `now()` al arrancar. Nada creado después se procesa. */
  cutoff?: Date;
  /** Instante absoluto en el que el drain debe haber terminado. */
  deadline: Date;
  /** Frontera FRESH/BACKLOG en minutos hacia atrás desde el cutoff. */
  freshnessWindowMinutes?: number;
  /** Cuota de servicio de la cola FRESH (0..1). Configurable, no invariante. */
  freshShare?: number;
  /** Tamaño de página/buffer. NO es un cupo total. */
  pageSize?: number;
  /** Tope duro de páginas leídas en la sesión. */
  maxPasses?: number;
  /** Tope duro de artículos intentados (0 = sin tope). */
  maxAttempts?: number;
  /** Presupuesto máximo de un artículo (fetch + extract + escritura). */
  articleBudgetMs?: number;
  /** Margen de operación reservado antes del deadline. */
  operationSafetyMs?: number;
  /** Presupuesto de una lectura de página. */
  pageBudgetMs?: number;
  /** Máximo de intentos consecutivos por medio dentro de una rotación. */
  maxPerMediaPerPass?: number;
  /** Medios distintos que se intentan tener en buffer antes de servir. */
  minMediaEnBuffer?: number;
  /** Páginas extra que se pueden leer para diversificar el buffer. */
  diversityPrefetchPages?: number;
  /** Aísla el drain a estos medios. */
  medioIds?: readonly string[] | null;
  retryConfig?: EnrichRetryConfig;
  /** Páginas consecutivas sin candidatos nuevos antes de declarar NO_PROGRESS. */
  noProgressStrikes?: number;
  /** Errores de escritura consecutivos antes de declarar INFRA_ERROR. */
  maxConsecutiveWriteErrors?: number;
}

export const DRAIN_DEFAULTS = {
  freshnessWindowMinutes: 1440,
  freshShare: 0.7,
  pageSize: 100,
  maxPasses: 200,
  maxAttempts: 0,
  articleBudgetMs: 20_000,
  operationSafetyMs: 5_000,
  pageBudgetMs: 10_000,
  maxPerMediaPerPass: 1,
  minMediaEnBuffer: 2,
  diversityPrefetchPages: 1,
  noProgressStrikes: 2,
  maxConsecutiveWriteErrors: 5,
} as const;

export interface DrainResult {
  termination_reason: DrainTerminationReason;
  cutoff: string;
  fresh_since: string;
  deadline: string;
  /** Filas únicas leídas de DB (candidatos elegibles vistos). */
  eligible_seen: number;
  attempted: number;
  persisted_success: number;
  failed_retryable: number;
  failed_blocked: number;
  empty_clean: number;
  write_failed: number;
  fresh_attempted: number;
  backlog_attempted: number;
  media_served: number;
  media_attempts: Record<string, number>;
  /** Candidatos ya leídos que NO se intentaron por falta de presupuesto. */
  deferred_time_budget: number;
  passes: number;
  duration_ms: number;
  /** Intentos hechos menos noticias únicas intentadas. Debe ser siempre 0. */
  duplicate_attempts: number;
  /** Candidatos que la DB devolvió pese a estar ya intentados (se descartaron). */
  duplicate_candidates_filtered: number;
  failure_classes: Record<EnrichFailureClass, number>;
  /** Solo se estima si ambas colas se agotaron; si no, `null` (sin queries caras). */
  remaining_eligible_estimate: number | null;
  infra_error: string | null;
}

interface QueueState {
  queue: DrainQueue;
  buffer: Map<string, DrainCandidateRow[]>;
  rotation: string[];
  rotationIndex: number;
  /** Medio que está consumiendo su cuota consecutiva. */
  currentKey: string | null;
  currentTaken: number;
  buffered: number;
  cursor: DrainCursor | null;
  exhausted: boolean;
  strikes: number;
}

function nuevaCola(queue: DrainQueue): QueueState {
  return {
    queue,
    buffer: new Map(),
    rotation: [],
    rotationIndex: 0,
    currentKey: null,
    currentTaken: 0,
    buffered: 0,
    cursor: null,
    exhausted: false,
    strikes: 0,
  };
}

function contadoresDeClase(): Record<EnrichFailureClass, number> {
  const out = {} as Record<EnrichFailureClass, number>;
  for (const clase of ENRICH_FAILURE_CLASSES) out[clase] = 0;
  return out;
}

/**
 * Fairness por medio DENTRO del buffer ya leído.
 *
 * Estrategia (documentada en S2.6): una página trae hasta `pageSize`
 * candidatos en el orden global de la cola; el drain los agrupa por `medio_id`
 * y los sirve en round-robin, tomando como mucho `maxPerMediaPerPass` seguidos
 * de cada medio antes de rotar. El resto del buffer NO se descarta ni se
 * vuelve a consultar: queda para las siguientes vueltas. Así un medio de alto
 * volumen no monopoliza los intentos y el número de queries sigue siendo
 * O(páginas), no O(artículos) — clave con 150–200 medios configurados.
 */
function encolar(estado: QueueState, filas: readonly DrainCandidateRow[]): void {
  for (const fila of filas) {
    const clave = fila.medio_id ?? '__sin_medio__';
    let lista = estado.buffer.get(clave);
    if (!lista) {
      lista = [];
      estado.buffer.set(clave, lista);
      estado.rotation.push(clave);
    }
    lista.push(fila);
    estado.buffered += 1;
  }
}

function sacarDe(estado: QueueState, clave: string): DrainCandidateRow | null {
  const lista = estado.buffer.get(clave);
  if (!lista || lista.length === 0) return null;
  const fila = lista.shift()!;
  estado.buffered -= 1;
  return fila;
}

function tomarSiguiente(estado: QueueState, maxPorMedio: number): DrainCandidateRow | null {
  if (estado.buffered === 0) return null;

  // El medio actual sigue dentro de su cuota consecutiva.
  if (
    estado.currentKey != null &&
    estado.currentTaken < Math.max(1, maxPorMedio) &&
    (estado.buffer.get(estado.currentKey)?.length ?? 0) > 0
  ) {
    const fila = sacarDe(estado, estado.currentKey)!;
    estado.currentTaken += 1;
    return fila;
  }

  // Rotar al siguiente medio con candidatos pendientes. `rotationIndex` es
  // SIEMPRE el índice por el que empieza la próxima búsqueda.
  const total = estado.rotation.length;
  for (let vuelta = 0; vuelta < total; vuelta += 1) {
    const idx = (estado.rotationIndex + vuelta) % total;
    const clave = estado.rotation[idx]!;
    const fila = sacarDe(estado, clave);
    if (fila == null) continue;
    estado.rotationIndex = (idx + 1) % total;
    estado.currentKey = clave;
    estado.currentTaken = 1;
    return fila;
  }
  return null;
}

function mediosConPendientes(estado: QueueState): number {
  let n = 0;
  for (const lista of estado.buffer.values()) if (lista.length > 0) n += 1;
  return n;
}

function limpiarRotacion(estado: QueueState): void {
  if (estado.buffered > 0) return;
  estado.buffer.clear();
  estado.rotation = [];
  estado.rotationIndex = 0;
  estado.currentKey = null;
  estado.currentTaken = 0;
}

/**
 * Ejecuta UNA sesión de drain. Nunca lanza: los fallos de infraestructura se
 * devuelven como `termination_reason: 'INFRA_ERROR'` con `infra_error` poblado,
 * para que el runner decida (un exit 0 no equivale a drain sano).
 */
export async function runEnrichDrain(
  deps: DrainDeps,
  options: DrainOptions,
): Promise<DrainResult> {
  const cfg = {
    freshnessWindowMinutes: options.freshnessWindowMinutes ?? DRAIN_DEFAULTS.freshnessWindowMinutes,
    freshShare: options.freshShare ?? DRAIN_DEFAULTS.freshShare,
    pageSize: options.pageSize ?? DRAIN_DEFAULTS.pageSize,
    maxPasses: options.maxPasses ?? DRAIN_DEFAULTS.maxPasses,
    maxAttempts: options.maxAttempts ?? DRAIN_DEFAULTS.maxAttempts,
    articleBudgetMs: options.articleBudgetMs ?? DRAIN_DEFAULTS.articleBudgetMs,
    operationSafetyMs: options.operationSafetyMs ?? DRAIN_DEFAULTS.operationSafetyMs,
    pageBudgetMs: options.pageBudgetMs ?? DRAIN_DEFAULTS.pageBudgetMs,
    maxPerMediaPerPass: options.maxPerMediaPerPass ?? DRAIN_DEFAULTS.maxPerMediaPerPass,
    minMediaEnBuffer: options.minMediaEnBuffer ?? DRAIN_DEFAULTS.minMediaEnBuffer,
    diversityPrefetchPages: options.diversityPrefetchPages ?? DRAIN_DEFAULTS.diversityPrefetchPages,
    noProgressStrikes: options.noProgressStrikes ?? DRAIN_DEFAULTS.noProgressStrikes,
    maxConsecutiveWriteErrors:
      options.maxConsecutiveWriteErrors ?? DRAIN_DEFAULTS.maxConsecutiveWriteErrors,
    retryConfig: options.retryConfig ?? DEFAULT_ENRICH_RETRY_CONFIG,
  };

  const inicio = deps.now();
  const cutoff = options.cutoff ?? inicio;
  const freshSince = new Date(cutoff.getTime() - cfg.freshnessWindowMinutes * 60_000);
  const deadlineMs = options.deadline.getTime();

  const attempted = new Set<string>();
  // Toda noticia que ya entró a un buffer. `attempted` no basta: una fila
  // todavía en buffer (leída, aún no intentada) también debe ser inmune a
  // reentrar si la DB la devuelve otra vez.
  const leidos = new Set<string>();
  const colas: Record<DrainQueue, QueueState> = {
    fresh: nuevaCola('fresh'),
    backlog: nuevaCola('backlog'),
  };
  const mediaAttempts: Record<string, number> = {};
  const failureClasses = contadoresDeClase();

  let eligibleSeen = 0;
  let passes = 0;
  let duplicadosFiltrados = 0;
  let intentosHechos = 0;
  let deferred = 0;
  let consecutiveWriteErrors = 0;
  let infraError: string | null = null;
  let terminacion: DrainTerminationReason | null = null;
  const buckets: Record<DrainBucket, number> = {
    persisted_success: 0,
    failed_retryable: 0,
    failed_blocked: 0,
    empty_clean: 0,
    write_failed: 0,
  };
  let freshAttempted = 0;
  let backlogAttempted = 0;

  const hayPresupuesto = (necesarioMs: number): boolean =>
    deps.now().getTime() + necesarioMs + cfg.operationSafetyMs <= deadlineMs;

  async function rellenar(estado: QueueState): Promise<boolean> {
    if (estado.exhausted) return false;
    if (passes >= cfg.maxPasses) {
      terminacion = 'SAFETY_LIMIT';
      return false;
    }
    if (!hayPresupuesto(cfg.pageBudgetMs)) {
      terminacion = 'TIME_BUDGET';
      return false;
    }

    const req: DrainPageRequest = {
      queue: estado.queue,
      cutoff: cutoff.toISOString(),
      freshSince: freshSince.toISOString(),
      pageSize: cfg.pageSize,
      medioIds: options.medioIds ?? null,
      cursor: estado.cursor,
    };

    let filas: DrainCandidateRow[];
    try {
      filas = await deps.fetchPage(req);
    } catch (err) {
      infraError = err instanceof Error ? err.message : String(err);
      terminacion = 'INFRA_ERROR';
      return false;
    }
    passes += 1;

    if (filas.length === 0) {
      estado.exhausted = true;
      deps.onEvent?.({ type: 'page', queue: estado.queue, rows: 0, nuevos: 0, pass: passes });
      return false;
    }

    const ultima = filas[filas.length - 1]!;
    const nuevoCursor = cursorDesdeFila({
      created_at: ultima.created_at,
      noticia_id: ultima.noticia_id,
    });
    if (!cursorAvanzo(estado.cursor, nuevoCursor)) {
      // La misma clave otra vez: el keyset no está avanzando, seguir sería un
      // bucle infinito sobre la misma página.
      terminacion = 'NO_PROGRESS';
      return false;
    }
    estado.cursor = nuevoCursor;

    // Invariante 2: nada ya visto vuelve al buffer, aunque la DB lo devuelva.
    const nuevos = filas.filter((f) => !leidos.has(f.noticia_id) && !attempted.has(f.noticia_id));
    duplicadosFiltrados += filas.length - nuevos.length;
    eligibleSeen += nuevos.length;
    for (const f of nuevos) leidos.add(f.noticia_id);
    encolar(estado, nuevos);
    deps.onEvent?.({
      type: 'page',
      queue: estado.queue,
      rows: filas.length,
      nuevos: nuevos.length,
      pass: passes,
    });

    if (nuevos.length === 0) {
      estado.strikes += 1;
      if (estado.strikes >= cfg.noProgressStrikes) {
        terminacion = 'NO_PROGRESS';
        return false;
      }
      return false;
    }
    estado.strikes = 0;
    if (filas.length < cfg.pageSize) {
      // Última página de esta cola: ya no hay más detrás del cursor.
      estado.exhausted = true;
    }
    return true;
  }

  async function disponible(estado: QueueState): Promise<boolean> {
    if (estado.buffered === 0) {
      limpiarRotacion(estado);
      while (!estado.exhausted && terminacion == null) {
        await rellenar(estado);
        if (estado.buffered > 0) break;
      }
    }

    // Prefetch de diversidad: si el buffer quedó dominado por un solo medio
    // (página entera de un medio de alto volumen), se leen hasta N páginas
    // extra para que la rotación tenga con quién alternar. Acotado a propósito:
    // el coste sigue siendo O(páginas), nunca una query por artículo.
    let extra = 0;
    while (
      estado.buffered > 0 &&
      !estado.exhausted &&
      terminacion == null &&
      extra < cfg.diversityPrefetchPages &&
      mediosConPendientes(estado) < cfg.minMediaEnBuffer
    ) {
      const antes = passes;
      await rellenar(estado);
      if (passes === antes) break; // no se llegó a leer (deadline / tope de páginas)
      extra += 1;
    }

    return estado.buffered > 0;
  }

  function preferida(): DrainQueue {
    const total = freshAttempted + backlogAttempted;
    return freshAttempted / (total + 1) < cfg.freshShare ? 'fresh' : 'backlog';
  }

  while (terminacion == null) {
    if (cfg.maxAttempts > 0 && attempted.size >= cfg.maxAttempts) {
      terminacion = 'SAFETY_LIMIT';
      break;
    }

    const primera = preferida();
    const segunda: DrainQueue = primera === 'fresh' ? 'backlog' : 'fresh';
    let elegida: DrainQueue | null = null;
    if (await disponible(colas[primera])) elegida = primera;
    else if (terminacion == null && (await disponible(colas[segunda]))) elegida = segunda;

    if (terminacion != null) break;
    if (elegida == null) {
      terminacion = 'DRAINED';
      break;
    }

    // Invariante 5: no empezar un artículo cuyo presupuesto invade la reserva.
    if (!hayPresupuesto(cfg.articleBudgetMs)) {
      terminacion = 'TIME_BUDGET';
      break;
    }

    const estado = colas[elegida];
    const fila = tomarSiguiente(estado, cfg.maxPerMediaPerPass);
    if (fila == null) {
      limpiarRotacion(estado);
      continue;
    }

    // Invariante 1: marcado ANTES del fetch. Pase lo que pase, no vuelve.
    attempted.add(fila.noticia_id);
    intentosHechos += 1;
    if (elegida === 'fresh') freshAttempted += 1;
    else backlogAttempted += 1;
    const claveMedio = fila.medio_id ?? '__sin_medio__';
    mediaAttempts[claveMedio] = (mediaAttempts[claveMedio] ?? 0) + 1;
    deps.onEvent?.({
      type: 'attempt',
      noticia_id: fila.noticia_id,
      medio_id: fila.medio_id,
      queue: elegida,
    });

    const { bucket, failureClass } = await intentarArticulo(fila);
    buckets[bucket] += 1;
    if (failureClass) failureClasses[failureClass] += 1;
    deps.onEvent?.({
      type: 'outcome',
      noticia_id: fila.noticia_id,
      bucket,
      failure_class: failureClass,
    });

    if (bucket === 'write_failed') {
      consecutiveWriteErrors += 1;
      if (consecutiveWriteErrors >= cfg.maxConsecutiveWriteErrors) {
        infraError = `Escrituras fallidas consecutivas: ${consecutiveWriteErrors}`;
        terminacion = 'INFRA_ERROR';
        break;
      }
    } else {
      consecutiveWriteErrors = 0;
    }
  }

  async function intentarArticulo(
    fila: DrainCandidateRow,
  ): Promise<{ bucket: DrainBucket; failureClass: EnrichFailureClass | null }> {
    const bloqueoEntorno = deps.isEnvironmentBlocked?.(fila.medio_id) ?? false;

    let outcome: DrainArticleOutcome;
    try {
      outcome = await deps.processArticle(fila);
    } catch (err) {
      outcome = {
        ok: false,
        cleanText: null,
        fields: { error_extraccion: err instanceof Error ? err.message : String(err) },
        failureClass: 'UNKNOWN',
      };
    }

    const ahora = deps.now();

    // Éxito solo si hay texto limpio real; `''` nunca cuenta.
    if (outcome.ok && esTextoLimpioUtil(outcome.cleanText)) {
      const fields: DrainUpdateFields = {
        ...outcome.fields,
        enrich_last_attempt_at: ahora.toISOString(),
        enrich_next_attempt_at: null,
        enrich_failure_class: null,
      };
      let confirmado = false;
      try {
        confirmado = await deps.persist(fila.noticia_id, fields);
      } catch {
        confirmado = false;
      }
      if (confirmado) return { bucket: 'persisted_success', failureClass: null };
      await persistirFallo(fila, 'WRITE_FAILED', outcome, ahora, bloqueoEntorno);
      return { bucket: 'write_failed', failureClass: 'WRITE_FAILED' };
    }

    const clase: EnrichFailureClass = outcome.ok
      ? 'EMPTY_CLEAN_TEXT'
      : (outcome.failureClass ?? 'UNKNOWN');
    const plan = await persistirFallo(fila, clase, outcome, ahora, bloqueoEntorno);
    if (!plan.escrito) return { bucket: 'write_failed', failureClass: 'WRITE_FAILED' };
    if (clase === 'EMPTY_CLEAN_TEXT') return { bucket: 'empty_clean', failureClass: clase };
    return {
      bucket: plan.bloqueado ? 'failed_blocked' : 'failed_retryable',
      failureClass: clase,
    };
  }

  async function persistirFallo(
    fila: DrainCandidateRow,
    clase: EnrichFailureClass,
    outcome: DrainArticleOutcome,
    ahora: Date,
    bloqueoEntorno: boolean,
  ): Promise<{ escrito: boolean; bloqueado: boolean }> {
    const plan = planEnrichRetry({
      failureClass: clase,
      now: ahora,
      retryAfterSeconds: outcome.retryAfterSeconds ?? null,
      environmentBlocked: bloqueoEntorno,
      config: cfg.retryConfig,
    });
    // Nunca se escribe texto falso: solo metadata y el rastro de error.
    const fields: DrainUpdateFields = {
      estado_extraccion: 'error',
      error_extraccion: outcome.fields.error_extraccion ?? clase,
      enrich_last_attempt_at: plan.enrich_last_attempt_at,
      enrich_next_attempt_at: plan.enrich_next_attempt_at,
      enrich_failure_class: plan.enrich_failure_class,
    };
    try {
      const escrito = await deps.persist(fila.noticia_id, fields);
      return { escrito, bloqueado: plan.state === 'BLOCKED_REVIEW' };
    } catch {
      return { escrito: false, bloqueado: plan.state === 'BLOCKED_REVIEW' };
    }
  }

  const bufferPendiente = colas.fresh.buffered + colas.backlog.buffered;
  if (terminacion === 'TIME_BUDGET' || terminacion === 'SAFETY_LIMIT') {
    deferred = bufferPendiente;
  }
  const ambasAgotadas = colas.fresh.exhausted && colas.backlog.exhausted;

  const fin = deps.now();
  return {
    termination_reason: terminacion ?? 'DRAINED',
    cutoff: cutoff.toISOString(),
    fresh_since: freshSince.toISOString(),
    deadline: options.deadline.toISOString(),
    eligible_seen: eligibleSeen,
    attempted: attempted.size,
    persisted_success: buckets.persisted_success,
    failed_retryable: buckets.failed_retryable,
    failed_blocked: buckets.failed_blocked,
    empty_clean: buckets.empty_clean,
    write_failed: buckets.write_failed,
    fresh_attempted: freshAttempted,
    backlog_attempted: backlogAttempted,
    media_served: Object.keys(mediaAttempts).length,
    media_attempts: mediaAttempts,
    deferred_time_budget: deferred,
    passes,
    duration_ms: fin.getTime() - inicio.getTime(),
    duplicate_attempts: intentosHechos - attempted.size,
    duplicate_candidates_filtered: duplicadosFiltrados,
    failure_classes: failureClasses,
    remaining_eligible_estimate:
      terminacion === 'DRAINED' ? 0 : ambasAgotadas ? bufferPendiente : null,
    infra_error: infraError,
  };
}

/** ¿El resultado permite continuar con detect/compare? (contrato S4.6). */
export function drainPermiteDownstream(result: DrainResult): boolean {
  return (
    result.termination_reason === 'DRAINED' ||
    result.termination_reason === 'TIME_BUDGET' ||
    result.termination_reason === 'SAFETY_LIMIT'
  );
}

/** ¿El drain dejó deuda? Sirve para reportar DEGRADED en vez de "todo bien". */
export function drainDejoDeuda(result: DrainResult): boolean {
  return (
    result.termination_reason !== 'DRAINED' ||
    result.failed_retryable > 0 ||
    result.failed_blocked > 0 ||
    result.empty_clean > 0 ||
    result.write_failed > 0
  );
}
