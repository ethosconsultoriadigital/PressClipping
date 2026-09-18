/**
 * Cliente HTTP para scraping responsable.
 *
 * - User-Agent identificable (no suplantamos navegadores).
 * - Timeout por petición con AbortController.
 * - Reintentos con backoff exponencial ante errores de red / 5xx.
 * - Devuelve el texto del cuerpo; el llamador decide cómo parsearlo.
 *
 * ENRICH DRAIN V1 añadió DOS capacidades, ambas opt-in para no cambiarle la
 * semántica a los consumidores existentes (RSS, sitemaps, extractor legacy):
 *
 *   1. `boundBodyRead`: el timeout cubre también `res.text()`. Por defecto el
 *      temporizador se cancela en cuanto llegan las cabeceras, así que un
 *      origen que manda cabeceras rápido y luego deja el cuerpo colgado podía
 *      bloquear el proceso sin límite. El drain NO puede permitirse eso: su
 *      presupuesto por artículo debe ser real.
 *   2. `maxAttempts`: tope duro de intentos (el drain usa 1, porque el
 *      reintento vive en la metadata persistente, no dentro del run).
 *
 * Los fallos se lanzan como `HttpRequestError`, que conserva EXACTAMENTE los
 * mensajes previos ("HTTP 403 en <url> (no reintentable)") y además expone
 * status, `Retry-After` y clase de fallo para clasificarlos sin parsear texto.
 */
import { logger } from './logger.js';

export const USER_AGENT =
  'EthosPRIntelligence/0.1 (+https://ethosconsultoriadigital.com; press-clipping)';

/** Naturaleza del fallo HTTP, sin adivinar por substring del mensaje. */
export type HttpFailureKind = 'http_status' | 'timeout' | 'network';

/** Error HTTP con metadata estructurada. El mensaje es el histórico. */
export class HttpRequestError extends Error {
  readonly kind: HttpFailureKind;
  readonly url: string;
  readonly finalUrl: string | null;
  readonly status: number | null;
  readonly retryAfterSeconds: number | null;
  /** ¿Tiene sentido reintentar DENTRO del mismo proceso? */
  readonly retryable: boolean;

  constructor(
    message: string,
    detalle: {
      kind: HttpFailureKind;
      url: string;
      finalUrl?: string | null;
      status?: number | null;
      retryAfterSeconds?: number | null;
      retryable: boolean;
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = 'HttpRequestError';
    this.kind = detalle.kind;
    this.url = detalle.url;
    this.finalUrl = detalle.finalUrl ?? null;
    this.status = detalle.status ?? null;
    this.retryAfterSeconds = detalle.retryAfterSeconds ?? null;
    this.retryable = detalle.retryable;
    if (detalle.cause !== undefined) (this as { cause?: unknown }).cause = detalle.cause;
  }
}

export interface FetchOptions {
  timeoutMs?: number;
  retries?: number;
  /** User-Agent personalizado (por defecto el del sistema). */
  userAgent?: string;
  /**
   * El timeout abarca la lectura completa del cuerpo, no solo las cabeceras.
   * Default `false` = comportamiento legacy.
   */
  boundBodyRead?: boolean;
  /** Tope duro de intentos totales. Tiene prioridad sobre `retries`. */
  maxAttempts?: number;
}

/** Respuesta con metadata: status real y URL final tras redirecciones. */
export interface HttpFetchResult {
  text: string;
  status: number;
  finalUrl: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** `Retry-After` en segundos: acepta delta-seconds o HTTP-date. */
export function parseRetryAfter(valor: string | null, ahora: Date = new Date()): number | null {
  if (!valor) return null;
  const limpio = valor.trim();
  if (/^\d+$/.test(limpio)) {
    const segundos = Number.parseInt(limpio, 10);
    return Number.isFinite(segundos) && segundos >= 0 ? segundos : null;
  }
  const fecha = Date.parse(limpio);
  if (Number.isNaN(fecha)) return null;
  return Math.max(0, Math.round((fecha - ahora.getTime()) / 1000));
}

function esAbort(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false;
  const e = err as { name?: string; message?: string };
  return e.name === 'AbortError' || /aborted/i.test(e.message ?? '');
}

/**
 * Descarga con metadata. Lanza `HttpRequestError` si agota los intentos.
 */
export async function fetchTextWithMeta(
  url: string,
  opts: FetchOptions = {},
): Promise<HttpFetchResult> {
  const { timeoutMs = 15000, retries = 2, userAgent = USER_AGENT, boundBodyRead = false } = opts;
  const intentosMax = Math.max(1, opts.maxAttempts ?? retries + 1);

  let lastErr: unknown;
  for (let intento = 0; intento < intentosMax; intento += 1) {
    const controller = new AbortController();
    let expiro = false;
    const timer = setTimeout(() => {
      expiro = true;
      controller.abort();
    }, timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'user-agent': userAgent,
          accept: 'application/rss+xml, application/xml, text/xml, text/html, */*',
        },
      });
      // Legacy: el temporizador muere al recibir cabeceras. Con
      // `boundBodyRead` sigue vivo hasta terminar de leer el cuerpo.
      if (!boundBodyRead) clearTimeout(timer);

      const retryAfter = parseRetryAfter(res.headers?.get?.('retry-after') ?? null);
      const finalUrl = typeof res.url === 'string' && res.url.length > 0 ? res.url : url;

      // 5xx → reintentable; 4xx → no tiene sentido reintentar.
      if (res.status >= 500) {
        throw new HttpRequestError(`HTTP ${res.status} en ${url}`, {
          kind: 'http_status',
          url,
          finalUrl,
          status: res.status,
          retryAfterSeconds: retryAfter,
          retryable: true,
        });
      }
      if (!res.ok) {
        throw new HttpRequestError(`HTTP ${res.status} en ${url} (no reintentable)`, {
          kind: 'http_status',
          url,
          finalUrl,
          status: res.status,
          retryAfterSeconds: retryAfter,
          retryable: false,
        });
      }
      const text = await res.text();
      if (boundBodyRead) clearTimeout(timer);
      return { text, status: res.status, finalUrl };
    } catch (err) {
      clearTimeout(timer);
      const normalizado = normalizarError(err, url, timeoutMs, expiro);
      lastErr = normalizado;
      if (intento < intentosMax - 1 && normalizado.retryable) {
        const backoff = 1000 * 2 ** intento;
        logger.debug({ url, intento, backoff }, `Reintentando fetch (${normalizado.message})`);
        await sleep(backoff);
        continue;
      }
      break;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function normalizarError(
  err: unknown,
  url: string,
  timeoutMs: number,
  expiro: boolean,
): HttpRequestError {
  if (err instanceof HttpRequestError) return err;
  const msg = err instanceof Error ? err.message : String(err);
  if (expiro || esAbort(err)) {
    return new HttpRequestError(`Timeout de ${timeoutMs}ms en ${url}`, {
      kind: 'timeout',
      url,
      retryable: true,
      cause: err,
    });
  }
  // Compatibilidad: un mensaje legacy con "no reintentable" sigue sin
  // reintentarse aunque venga de un llamador que construyó el error a mano.
  return new HttpRequestError(msg, {
    kind: 'network',
    url,
    retryable: !msg.includes('no reintentable'),
    cause: err,
  });
}

/**
 * Descarga el cuerpo de una URL como texto, con timeout y reintentos.
 * Lanza si agota los reintentos.
 */
export async function fetchText(url: string, opts: FetchOptions = {}): Promise<string> {
  const { text } = await fetchTextWithMeta(url, opts);
  return text;
}
