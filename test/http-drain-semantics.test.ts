/**
 * S3 — semántica HTTP del drain y preservación del comportamiento legacy.
 *
 * Todo con `fetch` mockeado: nada de red real.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  fetchText,
  fetchTextWithMeta,
  HttpRequestError,
  parseRetryAfter,
} from '../src/utils/http.js';
import { fetchAndExtract } from '../src/extractors/html.js';
import {
  clasificarFalloExtraccion,
  crearProcesadorDeArticulos,
} from '../src/enrichers/drainArticle.js';
import type { FetchExtractResult } from '../src/extractors/html.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

/** Respuesta mínima compatible con lo que usa `fetchTextWithMeta`. */
function respuesta(opts: {
  status: number;
  body?: string;
  headers?: Record<string, string>;
  url?: string;
  bodyDelayMs?: number;
  bodyNuncaTermina?: boolean;
  signal?: AbortSignal;
}): unknown {
  const headers = new Headers(opts.headers ?? {});
  return {
    status: opts.status,
    ok: opts.status >= 200 && opts.status < 300,
    url: opts.url ?? 'https://medio.mx/nota',
    headers,
    text: () =>
      new Promise<string>((resolve, reject) => {
        if (opts.signal) {
          opts.signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }
        if (opts.bodyNuncaTermina) return;
        setTimeout(() => resolve(opts.body ?? '<html></html>'), opts.bodyDelayMs ?? 0);
      }),
  };
}

function mockFetch(handler: (url: string, init: RequestInit) => unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (url: string, init: RequestInit) => handler(url, init));
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe('parseRetryAfter', () => {
  it('acepta delta-seconds', () => {
    expect(parseRetryAfter('120')).toBe(120);
    expect(parseRetryAfter('0')).toBe(0);
  });

  it('acepta HTTP-date y lo convierte a segundos restantes', () => {
    const ahora = new Date('2026-09-19T12:00:00Z');
    expect(parseRetryAfter('Sat, 19 Sep 2026 12:05:00 GMT', ahora)).toBe(300);
  });

  it('devuelve null ante ausencia o basura', () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('   ')).toBeNull();
    expect(parseRetryAfter('pronto')).toBeNull();
  });
});

describe('fetchTextWithMeta — timeout de cuerpo completo', () => {
  it('BUG CERRADO: con boundBodyRead el timeout cubre el cuerpo colgado', async () => {
    mockFetch((_url, init) =>
      respuesta({ status: 200, bodyNuncaTermina: true, signal: init.signal as AbortSignal }),
    );
    const t0 = Date.now();
    await expect(
      fetchTextWithMeta('https://medio.mx/nota', {
        timeoutMs: 80,
        boundBodyRead: true,
        maxAttempts: 1,
      }),
    ).rejects.toMatchObject({ kind: 'timeout' });
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('LEGACY intacto: por defecto el cuerpo lento todavía se lee', async () => {
    mockFetch((_url, init) =>
      respuesta({
        status: 200,
        body: '<html>tarde pero llega</html>',
        bodyDelayMs: 150,
        signal: init.signal as AbortSignal,
      }),
    );
    const texto = await fetchText('https://medio.mx/nota', { timeoutMs: 50, retries: 0 });
    expect(texto).toContain('tarde pero llega');
  });

  it('el timeout se clasifica como TIMEOUT, no como error de red', async () => {
    mockFetch((_url, init) =>
      respuesta({ status: 200, bodyNuncaTermina: true, signal: init.signal as AbortSignal }),
    );
    const err = await fetchTextWithMeta('https://medio.mx/nota', {
      timeoutMs: 60,
      boundBodyRead: true,
      maxAttempts: 1,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpRequestError);
    expect(err.kind).toBe('timeout');
    expect(err.message).toContain('Timeout de 60ms');
  });
});

describe('fetchTextWithMeta — errores estructurados', () => {
  it('403 conserva el mensaje histórico y expone status', async () => {
    mockFetch(() => respuesta({ status: 403 }));
    const err = await fetchTextWithMeta('https://jornada.mx/nota', { maxAttempts: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpRequestError);
    expect(err.message).toBe('HTTP 403 en https://jornada.mx/nota (no reintentable)');
    expect(err.kind).toBe('http_status');
    expect(err.status).toBe(403);
    expect(err.retryable).toBe(false);
  });

  it('404 y 410 llegan con su status', async () => {
    for (const status of [404, 410]) {
      mockFetch(() => respuesta({ status }));
      const err = await fetchTextWithMeta('https://medio.mx/x', { maxAttempts: 1 }).catch((e) => e);
      expect(err.status).toBe(status);
      expect(err.retryable).toBe(false);
    }
  });

  it('429 se distingue del 4xx genérico y captura Retry-After sin dormir el job', async () => {
    mockFetch(() => respuesta({ status: 429, headers: { 'retry-after': '900' } }));
    const t0 = Date.now();
    const err = await fetchTextWithMeta('https://medio.mx/x', { maxAttempts: 1 }).catch((e) => e);
    expect(err.status).toBe(429);
    expect(err.retryAfterSeconds).toBe(900);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('5xx es reintentable y conserva el mensaje histórico', async () => {
    mockFetch(() => respuesta({ status: 503 }));
    const err = await fetchTextWithMeta('https://medio.mx/x', { maxAttempts: 1 }).catch((e) => e);
    expect(err.message).toBe('HTTP 503 en https://medio.mx/x');
    expect(err.retryable).toBe(true);
  });

  it('error de red se clasifica como network', async () => {
    mockFetch(() => {
      throw new Error('ECONNRESET red caída');
    });
    const err = await fetchTextWithMeta('https://medio.mx/x', { maxAttempts: 1 }).catch((e) => e);
    expect(err.kind).toBe('network');
    expect(err.message).toContain('ECONNRESET');
  });

  it('devuelve la URL final tras redirecciones', async () => {
    mockFetch(() => respuesta({ status: 200, url: 'https://medio.mx/nota-final', body: '<html>ok</html>' }));
    const r = await fetchTextWithMeta('https://medio.mx/nota', { maxAttempts: 1 });
    expect(r.finalUrl).toBe('https://medio.mx/nota-final');
    expect(r.status).toBe(200);
  });
});

describe('fetchTextWithMeta — intentos', () => {
  it('maxAttempts=1 no reintenta ni ante 5xx', async () => {
    const fn = mockFetch(() => respuesta({ status: 500 }));
    await expect(fetchTextWithMeta('https://medio.mx/x', { maxAttempts: 1 })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('LEGACY intacto: por defecto reintenta 5xx hasta 3 veces', async () => {
    const fn = mockFetch(() => respuesta({ status: 500 }));
    await expect(fetchText('https://medio.mx/x', { timeoutMs: 50 })).rejects.toThrow('HTTP 500');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('LEGACY intacto: un 4xx no se reintenta', async () => {
    const fn = mockFetch(() => respuesta({ status: 403 }));
    await expect(fetchText('https://medio.mx/x')).rejects.toThrow('no reintentable');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('fetchAndExtract — metadata de fallo', () => {
  it('expone httpError estructurado sin lanzar', async () => {
    mockFetch(() => respuesta({ status: 403 }));
    const r = await fetchAndExtract('https://jornada.mx/nota/algo', { maxAttempts: 1 });
    expect(r.ok).toBe(false);
    expect(r.httpError).toMatchObject({ kind: 'http_status', status: 403 });
  });

  it('un 200 normal sigue extrayendo igual que antes', async () => {
    const html = '<html><head><meta property="og:title" content="Nota"></head><body><article><p>' +
      'Texto suficientemente largo para pasar la heurística de limpieza del extractor generico. '.repeat(6) +
      '</p></article></body></html>';
    mockFetch(() => respuesta({ status: 200, body: html }));
    const r = await fetchAndExtract('https://medio.mx/nota/algo');
    expect(r.ok).toBe(true);
    expect(r.titulo).toBe('Nota');
    expect(r.httpError).toBeUndefined();
  });
});

describe('clasificarFalloExtraccion', () => {
  const base = { ok: false, error: 'x' } as unknown as FetchExtractResult;

  it('mapea cada status a su clase', () => {
    const casos: Array<[number, string]> = [
      [403, 'HTTP_403'],
      [404, 'HTTP_404_410'],
      [410, 'HTTP_404_410'],
      [429, 'HTTP_429'],
      [500, 'HTTP_5XX'],
      [503, 'HTTP_5XX'],
      [451, 'UNKNOWN'],
    ];
    for (const [status, esperado] of casos) {
      const r = clasificarFalloExtraccion({
        ...base,
        httpError: { kind: 'http_status', status, retryAfterSeconds: null, finalUrl: null },
      });
      expect(r.failureClass).toBe(esperado);
    }
  });

  it('timeout y red tienen clase propia', () => {
    expect(
      clasificarFalloExtraccion({
        ...base,
        httpError: { kind: 'timeout', status: null, retryAfterSeconds: null, finalUrl: null },
      }).failureClass,
    ).toBe('TIMEOUT');
    expect(
      clasificarFalloExtraccion({
        ...base,
        httpError: { kind: 'network', status: null, retryAfterSeconds: null, finalUrl: null },
      }).failureClass,
    ).toBe('NETWORK_TRANSIENT');
  });

  it('propaga Retry-After del 429', () => {
    const r = clasificarFalloExtraccion({
      ...base,
      httpError: { kind: 'http_status', status: 429, retryAfterSeconds: 300, finalUrl: null },
    });
    expect(r).toEqual({ failureClass: 'HTTP_429', retryAfterSeconds: 300 });
  });

  it('sin httpError (fallo del extractor) ⇒ UNKNOWN', () => {
    expect(clasificarFalloExtraccion(base).failureClass).toBe('UNKNOWN');
  });
});

describe('crearProcesadorDeArticulos', () => {
  const fila = {
    noticia_id: 'n1',
    medio_id: 'MED-0001',
    url_original: 'https://medio.mx/nota',
    created_at: '2026-09-19T10:00:00.000Z',
    texto_nota_limpia: null,
    titulo: null,
    resumen: null,
    texto_extraido: null,
    autor: null,
    seccion: null,
    imagen_principal: null,
    extracto_nota_1300: null,
    calidad_extraccion: null,
    texto_limpio_chars: null,
    texto_cuerpo_nota: null,
    extracto_cuerpo_1300: null,
    cuerpo_nota_chars: null,
    tipo_nota: null,
  };

  it('éxito: devuelve cleanText y campos de contenido', async () => {
    const processArticle = crearProcesadorDeArticulos({
      extract: async () =>
        ({
          ok: true,
          error: null,
          titulo: 'T',
          resumen: null,
          texto_extraido: 'texto',
          texto_nota_limpia: 'cuerpo limpio de la nota',
          extracto_nota_1300: 'cuerpo limpio de la nota',
          calidad_extraccion: 'alta',
          texto_limpio_chars: 24,
          texto_cuerpo_nota: 'cuerpo limpio de la nota',
          extracto_cuerpo_1300: 'cuerpo limpio de la nota',
          cuerpo_nota_chars: 24,
          tipo_nota: null,
          imagen: null,
          autor: null,
          seccion: null,
          metodo_titulo: 'html_og',
          metodo_texto: 'html_article',
        }) as unknown as FetchExtractResult,
    });
    const out = await processArticle(fila);
    expect(out.ok).toBe(true);
    expect(out.cleanText).toBe('cuerpo limpio de la nota');
    expect(out.fields.texto_nota_limpia).toBe('cuerpo limpio de la nota');
  });

  it('extracción OK sin texto limpio ⇒ ok con cleanText null (el drain lo marca vacío)', async () => {
    const processArticle = crearProcesadorDeArticulos({
      extract: async () =>
        ({
          ok: true,
          error: null,
          titulo: 'T',
          texto_nota_limpia: null,
          metodo_titulo: 'html_og',
          metodo_texto: null,
        }) as unknown as FetchExtractResult,
    });
    const out = await processArticle(fila);
    expect(out.ok).toBe(true);
    expect(out.cleanText).toBeNull();
  });

  it('403 ⇒ fallo clasificado con su mensaje', async () => {
    const processArticle = crearProcesadorDeArticulos({
      extract: async () =>
        ({
          ok: false,
          error: 'HTTP 403 en https://medio.mx/nota (no reintentable)',
          httpError: { kind: 'http_status', status: 403, retryAfterSeconds: null, finalUrl: null },
        }) as unknown as FetchExtractResult,
    });
    const out = await processArticle(fila);
    expect(out.ok).toBe(false);
    expect(out.failureClass).toBe('HTTP_403');
    expect(out.fields.error_extraccion).toContain('HTTP 403');
  });

  it('noticia sin URL no intenta red', async () => {
    let llamado = false;
    const processArticle = crearProcesadorDeArticulos({
      extract: async () => {
        llamado = true;
        return {} as FetchExtractResult;
      },
    });
    const out = await processArticle({ ...fila, url_original: null });
    expect(llamado).toBe(false);
    expect(out.failureClass).toBe('UNKNOWN');
  });

  it('el drain pide un solo intento HTTP y timeout de cuerpo completo', async () => {
    mockFetch(() => respuesta({ status: 500 }));
    const fn = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const processArticle = crearProcesadorDeArticulos({ timeoutMs: 100 });
    const out = await processArticle(fila);
    expect(out.ok).toBe(false);
    expect(out.failureClass).toBe('HTTP_5XX');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
