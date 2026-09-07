/**
 * Crawler por medio: aplica el orden de extracción con fallback en cascada.
 *
 * MVP: solo RSS y sitemap. 'secciones', 'html', 'buscador' y 'api' quedan
 * declarados pero no implementados (se reportan como omitidos).
 *
 * Si `metodo_extraccion` está definido en el medio, se intenta ese primero;
 * en cualquier caso se respeta el orden RSS → sitemap como preferencia.
 */
import { fetchRss } from '../parsers/rss.js';
import { fetchSitemap } from '../parsers/sitemap.js';
import { normalizeNoticia, type NoticiaInsert } from '../normalizers/noticia.js';
import type { MedioRow } from '../supabase/repositories.js';
import { childLogger } from '../utils/logger.js';

export interface CrawlResult {
  medio_id: string;
  fuente: string | null; // qué método produjo resultados
  urls_detectadas: number;
  items: NoticiaInsert[];
  estado: 'ok' | 'sin_fuente' | 'omitido' | 'error';
  error: string | null;
}

const METODOS_MVP = new Set(['rss', 'sitemap']);

// ─────────────────────────────────────────────────────────────────────────────
// Evento terminal atómico por medio (Media Validation & Certification —
// Fase 1B, Hardening Pass 2: hallazgos B3/B5). PURAMENTE ADITIVO: no cambia
// `crawlMedio()` ni `CrawlResult`, no afecta selección/fallback/ingestión.
//
// Lo emite `scripts/crawl.ts` (no este módulo) UNA vez por medio_id, justo
// después de conocer de forma atómica en su loop: el `CrawlResult` de
// `crawlMedio()` (fuente que funcionó, detectadas, items) + el resultado de
// `ingestNoticias()` (insertadas/duplicados/promovidas) + el `estadoFinal`/
// `errorFinal` ya resueltos (que pueden diferir del `CrawlResult` si
// `ingestNoticias` lanza). Por eso el *constructor* del payload vive aquí
// (junto al resto del contrato de evidencia de crawl, simétrico a
// `buildEnrichMediaSummaryLogPayload` en `src/enrichers/enrichNews.ts`), pero
// la *emisión* (logger.info) ocurre en `scripts/crawl.ts`, que es quien tiene
// todos los valores en scope al mismo tiempo.
//
// Todos los campos describen SIEMPRE el mismo resultado terminal (atomicidad,
// §6 del prompt de Pass 2): nunca se construye mezclando `source_method` de
// un intento con `inserted` de otro. `terminal_error` es la causa TERMINAL
// (por qué el medio no llegó a `status='ok'`, o por qué fue omitido), nunca
// un error de intento/fuente intermedio — esos siguen siendo exclusivamente
// los eventos `log.warn({fuente, err}, 'Fallo en fuente, probando siguiente')`
// de este mismo módulo, sin cambios.
// ─────────────────────────────────────────────────────────────────────────────

export const CRAWL_MEDIA_SUMMARY_EVENT = 'crawl_media_summary';
export const CRAWL_MEDIA_SUMMARY_SCHEMA_VERSION = 1;

export interface CrawlMediaSummaryTerminalError {
  message: string;
}

export interface CrawlMediaSummaryLogPayload {
  event: typeof CRAWL_MEDIA_SUMMARY_EVENT;
  schema_version: typeof CRAWL_MEDIA_SUMMARY_SCHEMA_VERSION;
  medio_id: string;
  /** Mismo valor que el `estadoFinal` de scripts/crawl.ts (== CrawlResult.estado, salvo que ingestNoticias haya lanzado). */
  status: string;
  /** Fuente cuyo resultado produjo `items` (p.ej. 'rss'|'sitemap'), o null si ninguna produjo items. */
  source_method: string | null;
  detected: number;
  items: number;
  inserted: number;
  duplicates: number;
  promoted_diagnostic: number;
  /**
   * Causa TERMINAL, o `null` si no hay ninguna conocida (éxito, o motivo
   * desconocido — nunca se inventa una causa cuando no existe).
   */
  terminal_error: CrawlMediaSummaryTerminalError | null;
}

/**
 * Construye (sin loguear ni tener efectos secundarios) el payload del
 * evento terminal atómico de crawl a partir de los valores que
 * `scripts/crawl.ts` YA conoce en su loop, de forma síncrona y coherente,
 * para UN medio_id. Función pura, testeable sin Supabase/red/IO.
 */
export function buildCrawlMediaSummaryLogPayload(params: {
  medioId: string;
  status: string;
  sourceMethod: string | null;
  detected: number;
  items: number;
  inserted: number;
  duplicates: number;
  promotedDiagnostic: number;
  terminalErrorMessage: string | null;
}): CrawlMediaSummaryLogPayload {
  return {
    event: CRAWL_MEDIA_SUMMARY_EVENT,
    schema_version: CRAWL_MEDIA_SUMMARY_SCHEMA_VERSION,
    medio_id: params.medioId,
    status: params.status,
    source_method: params.sourceMethod,
    detected: params.detected,
    items: params.items,
    inserted: params.inserted,
    duplicates: params.duplicates,
    promoted_diagnostic: params.promotedDiagnostic,
    terminal_error: params.terminalErrorMessage ? { message: params.terminalErrorMessage } : null,
  };
}

/** Opciones de crawl dirigido (backfill). No afectan el crawl normal si se omiten. */
export interface CrawlMedioOpts {
  /** Fuerza la fuente (rss|sitemap) e ignora la cascada. Útil para backfill por sitemap. */
  forceFuente?: 'rss' | 'sitemap';
  /** Presupuesto de sub-sitemaps a descargar en índices (solo aplica a sitemap). */
  sitemapMaxSubs?: number;
  /** Profundidad máxima de recursión de índices (solo aplica a sitemap). */
  sitemapMaxDepth?: number;
}

/**
 * Ejecuta la ingesta de un medio respetando `limit` (max_notas_por_medio).
 * Nunca lanza: encapsula los errores en el CrawlResult para no tumbar la corrida.
 */
export async function crawlMedio(
  medio: MedioRow,
  limit: number,
  opts: CrawlMedioOpts = {},
): Promise<CrawlResult> {
  const log = childLogger({ medio_id: medio.medio_id });
  const base: Omit<CrawlResult, 'fuente' | 'urls_detectadas' | 'items' | 'estado' | 'error'> = {
    medio_id: medio.medio_id,
  };

  // En MVP omitimos medios que requieren JS o proxy.
  if (medio.requiere_javascript || medio.requiere_proxy) {
    log.info('Medio omitido (requiere JS/proxy, fuera del MVP)');
    return { ...base, fuente: null, urls_detectadas: 0, items: [], estado: 'omitido', error: null };
  }

  // Construye el orden de intentos. Con forceFuente se usa SOLO esa fuente
  // (backfill dirigido); si no, método declarado primero y luego cascada.
  const orden: ('rss' | 'sitemap')[] = [];
  const declarado = medio.metodo_extraccion?.trim().toLowerCase();
  if (opts.forceFuente) {
    orden.push(opts.forceFuente);
  } else {
    if (declarado && METODOS_MVP.has(declarado)) orden.push(declarado as 'rss' | 'sitemap');
    for (const m of ['rss', 'sitemap'] as const) {
      if (!orden.includes(m)) orden.push(m);
    }
  }

  const ctx = {
    medio_id: medio.medio_id,
    pais: medio.pais,
    estado: medio.estado,
    municipio: medio.municipio,
  };

  let ultimoError: string | null = null;

  for (const metodo of orden) {
    const url = metodo === 'rss' ? medio.rss_url : medio.sitemap_url;
    if (!url) continue;

    try {
      const raw =
        metodo === 'rss'
          ? await fetchRss(url)
          : await fetchSitemap(url, {
              limit,
              maxSubSitemaps: opts.sitemapMaxSubs,
              maxDepth: opts.sitemapMaxDepth,
            });

      const items = raw
        .map((it) => normalizeNoticia(it, { ...ctx, fuente: metodo }))
        .filter((n): n is NoticiaInsert => n !== null)
        .slice(0, limit);

      if (items.length > 0) {
        log.info({ fuente: metodo, detectadas: raw.length, items: items.length }, 'Fuente con resultados');
        return {
          ...base,
          fuente: metodo,
          urls_detectadas: raw.length,
          items,
          estado: 'ok',
          error: null,
        };
      }
      log.debug({ fuente: metodo }, 'Fuente sin items, probando siguiente');
    } catch (err) {
      ultimoError = err instanceof Error ? err.message : String(err);
      log.warn({ fuente: metodo, err: ultimoError }, 'Fallo en fuente, probando siguiente');
    }
  }

  // Detecta si el medio pedía métodos aún no soportados en MVP.
  if (declarado && !METODOS_MVP.has(declarado)) {
    return {
      ...base,
      fuente: null,
      urls_detectadas: 0,
      items: [],
      estado: 'omitido',
      error: `Método "${declarado}" no soportado en MVP`,
    };
  }

  return {
    ...base,
    fuente: null,
    urls_detectadas: 0,
    items: [],
    estado: ultimoError ? 'error' : 'sin_fuente',
    error: ultimoError,
  };
}
