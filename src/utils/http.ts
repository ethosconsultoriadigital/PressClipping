/**
 * Cliente HTTP para scraping responsable.
 *
 * - User-Agent identificable (no suplantamos navegadores).
 * - Timeout por petición con AbortController.
 * - Reintentos con backoff exponencial ante errores de red / 5xx.
 * - Devuelve el texto del cuerpo; el llamador decide cómo parsearlo.
 */
import { logger } from './logger.js';

export const USER_AGENT =
  'EthosPRIntelligence/0.1 (+https://ethosconsultoriadigital.com; press-clipping)';

export interface FetchOptions {
  timeoutMs?: number;
  retries?: number;
  /** User-Agent personalizado (por defecto el del sistema). */
  userAgent?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Descarga el cuerpo de una URL como texto, con timeout y reintentos.
 * Lanza si agota los reintentos.
 */
export async function fetchText(
  url: string,
  opts: FetchOptions = {},
): Promise<string> {
  const { timeoutMs = 15000, retries = 2, userAgent = USER_AGENT } = opts;

  let lastErr: unknown;
  for (let intento = 0; intento <= retries; intento += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
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
      clearTimeout(timer);

      // 5xx → reintentable; 4xx → no tiene sentido reintentar.
      if (res.status >= 500) {
        throw new Error(`HTTP ${res.status} en ${url}`);
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} en ${url} (no reintentable)`);
      }
      return await res.text();
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const noReintentar = msg.includes('no reintentable');
      if (intento < retries && !noReintentar) {
        const backoff = 1000 * 2 ** intento;
        logger.debug({ url, intento, backoff }, `Reintentando fetch (${msg})`);
        await sleep(backoff);
        continue;
      }
      break;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
