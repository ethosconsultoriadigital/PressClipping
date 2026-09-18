/**
 * Puente entre el drain y el extractor real: descarga acotada, clasificación
 * estructurada del fallo y construcción de los campos a persistir.
 *
 * Se mantiene aparte de `enrichNews.ts` a propósito: el enrich legacy no
 * cambia de semántica, y el drain necesita garantías que el legacy no da
 * (timeout que cubre el cuerpo, un solo intento HTTP, clase de fallo).
 */
import { fetchAndExtract, type FetchExtractResult } from '../extractors/html.js';
import { construirActualizacion, type NoticiaEnriquecibleRow } from './enrichNews.js';
import type { DrainArticleOutcome, DrainCandidateRow } from './enrichDrain.js';
import type { EnrichFailureClass } from './enrichRetryPolicy.js';

/** Clasificación estructurada del fallo de una extracción. */
export function clasificarFalloExtraccion(extracto: FetchExtractResult): {
  failureClass: EnrichFailureClass;
  retryAfterSeconds: number | null;
} {
  const http = extracto.httpError;
  if (!http) return { failureClass: 'UNKNOWN', retryAfterSeconds: null };
  const retryAfterSeconds = http.retryAfterSeconds ?? null;

  if (http.kind === 'timeout') return { failureClass: 'TIMEOUT', retryAfterSeconds };
  if (http.kind === 'network') return { failureClass: 'NETWORK_TRANSIENT', retryAfterSeconds };

  const status = http.status ?? 0;
  if (status === 403) return { failureClass: 'HTTP_403', retryAfterSeconds };
  if (status === 404 || status === 410) return { failureClass: 'HTTP_404_410', retryAfterSeconds };
  if (status === 429) return { failureClass: 'HTTP_429', retryAfterSeconds };
  if (status >= 500) return { failureClass: 'HTTP_5XX', retryAfterSeconds };
  return { failureClass: 'UNKNOWN', retryAfterSeconds };
}

export interface ProcesadorArticuloOpts {
  /** Timeout de la descarga, cubriendo cabeceras + cuerpo. */
  timeoutMs?: number;
  maxChars?: number;
  /** Inyectable para tests: por defecto el extractor real. */
  extract?: (url: string, opts: { timeoutMs: number; maxChars?: number }) => Promise<FetchExtractResult>;
}

export const DRAIN_ARTICLE_TIMEOUT_MS = 12_000;

/**
 * Crea el `processArticle` que consume el drain. Un artículo = UNA petición
 * HTTP (`maxAttempts: 1`): reintentar dentro del run rompería el presupuesto y
 * duplicaría carga sobre un origen que probablemente esté caído.
 */
export function crearProcesadorDeArticulos(
  opts: ProcesadorArticuloOpts = {},
): (row: DrainCandidateRow) => Promise<DrainArticleOutcome> {
  const timeoutMs = opts.timeoutMs ?? DRAIN_ARTICLE_TIMEOUT_MS;
  const extract =
    opts.extract ??
    ((url: string, o: { timeoutMs: number; maxChars?: number }) =>
      fetchAndExtract(url, {
        timeoutMs: o.timeoutMs,
        maxChars: o.maxChars,
        boundBodyRead: true,
        maxAttempts: 1,
      }));

  return async (row: DrainCandidateRow): Promise<DrainArticleOutcome> => {
    const url = row.url_original;
    if (!url) {
      return {
        ok: false,
        cleanText: null,
        fields: { error_extraccion: 'noticia sin url_original' },
        failureClass: 'UNKNOWN',
      };
    }

    const extracto = await extract(url, { timeoutMs, maxChars: opts.maxChars });

    if (!extracto.ok) {
      const { failureClass, retryAfterSeconds } = clasificarFalloExtraccion(extracto);
      return {
        ok: false,
        cleanText: null,
        fields: { error_extraccion: extracto.error ?? failureClass },
        failureClass,
        retryAfterSeconds,
      };
    }

    const { fields } = construirActualizacion(row as unknown as NoticiaEnriquecibleRow, extracto);
    const clean = fields.texto_nota_limpia ?? null;
    return { ok: true, cleanText: clean, fields };
  };
}
