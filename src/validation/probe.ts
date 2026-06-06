/**
 * Prueba NO destructiva de las fuentes de un medio.
 *
 * Descarga y parsea RSS y sitemap por separado para diagnosticar cuál
 * funciona, SIN guardar nada en la base histórica. Reusa los parsers de la
 * Fase 3. Es la única parte de la validación que toca la red, y está acotada.
 */
import { fetchRss } from '../parsers/rss.js';
import { fetchSitemap } from '../parsers/sitemap.js';
import type { MedioInput, ProbeResult } from './diagnostics.js';

/**
 * Prueba las fuentes declaradas del medio. `muestra` limita cuántos ítems se
 * piden al sitemap (la validación no necesita el feed completo).
 */
export async function probeMedio(
  m: MedioInput,
  muestra = 10,
): Promise<ProbeResult> {
  const result: ProbeResult = {
    rss_ok: false,
    rss_items: 0,
    sitemap_ok: false,
    sitemap_items: 0,
    error: null,
  };
  const errores: string[] = [];

  if (m.rss_url) {
    try {
      const items = await fetchRss(m.rss_url);
      result.rss_ok = true;
      result.rss_items = items.length;
    } catch (err) {
      errores.push(`rss: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (m.sitemap_url) {
    try {
      const items = await fetchSitemap(m.sitemap_url, { limit: muestra });
      result.sitemap_ok = true;
      result.sitemap_items = items.length;
    } catch (err) {
      errores.push(`sitemap: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (errores.length > 0) result.error = errores.join(' | ');
  return result;
}
