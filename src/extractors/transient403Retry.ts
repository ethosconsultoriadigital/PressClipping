/**
 * Reintento único de HTTP 403 en hosts donde el WAF alterna 403/200
 * con el mismo User-Agent identificable (sin suplantar navegador).
 *
 * Evidencia Líder Empresarial (liderempresarial.com): ráfagas de GET
 * al artículo reciben 403 y el GET inmediato siguiente, mismo UA, 200
 * con HTML extraíble. No es paywall ni cambio de extractor.
 */
import { fetchTextWithMeta, HttpRequestError, type FetchOptions, type HttpFetchResult } from '../utils/http.js';

export const TRANSIENT_403_RETRY_HOSTS = new Set(['liderempresarial.com', 'voxpopulinoticias.com.mx']);

export function hostnameOfArticleUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

export function shouldRetryOnceOn403(url: string, status: number | null | undefined): boolean {
  return status === 403 && TRANSIENT_403_RETRY_HOSTS.has(hostnameOfArticleUrl(url));
}

export type FetchHtmlFn = (url: string, opts?: FetchOptions) => Promise<HttpFetchResult>;

/**
 * Un GET extra SOLO si el primero fue 403 y el host está en la lista.
 * El segundo fallo (403 u otro) se propaga igual que siempre.
 */
export async function fetchHtmlRespectingTransient403(
  url: string,
  opts: FetchOptions = {},
  fetchHtml: FetchHtmlFn = fetchTextWithMeta,
): Promise<HttpFetchResult> {
  try {
    return await fetchHtml(url, opts);
  } catch (err) {
    if (err instanceof HttpRequestError && shouldRetryOnceOn403(url, err.status)) {
      return await fetchHtml(url, opts);
    }
    throw err;
  }
}
