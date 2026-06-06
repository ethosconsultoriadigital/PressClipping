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

/**
 * Ejecuta la ingesta de un medio respetando `limit` (max_notas_por_medio).
 * Nunca lanza: encapsula los errores en el CrawlResult para no tumbar la corrida.
 */
export async function crawlMedio(
  medio: MedioRow,
  limit: number,
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

  // Construye el orden de intentos: método declarado primero, luego cascada.
  const orden: ('rss' | 'sitemap')[] = [];
  const declarado = medio.metodo_extraccion?.trim().toLowerCase();
  if (declarado && METODOS_MVP.has(declarado)) orden.push(declarado as 'rss' | 'sitemap');
  for (const m of ['rss', 'sitemap'] as const) {
    if (!orden.includes(m)) orden.push(m);
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
          : await fetchSitemap(url, { limit });

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
