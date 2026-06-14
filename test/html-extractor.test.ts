import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractFromHtml, fetchAndExtract } from '../src/extractors/html.js';

const PARRAFO = 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ';

function articulo(extra = ''): string {
  return `
    <article>
      <p>${PARRAFO}</p>
      <p>${PARRAFO}</p>
      ${extra}
    </article>`;
}

describe('extractFromHtml - título', () => {
  it('prioriza og:title', () => {
    const html = `<html><head>
      <meta property="og:title" content="Título OG">
      <meta name="twitter:title" content="Título TW">
      <title>Título Tag</title>
    </head><body><h1>Título H1</h1></body></html>`;
    const r = extractFromHtml(html, 'https://m.mx/nota/slug');
    expect(r.titulo).toBe('Título OG');
    expect(r.metodo_titulo).toBe('html_og');
  });

  it('usa twitter:title si no hay og:title', () => {
    const html = `<html><head>
      <meta name="twitter:title" content="Título TW">
      <title>Título Tag</title>
    </head><body></body></html>`;
    const r = extractFromHtml(html, 'https://m.mx/nota/slug');
    expect(r.titulo).toBe('Título TW');
    expect(r.metodo_titulo).toBe('html_twitter');
  });

  it('usa <title> si no hay metadatos OG/Twitter', () => {
    const html = `<html><head><title>Título Tag</title></head><body><h1>H1</h1></body></html>`;
    const r = extractFromHtml(html, 'https://m.mx/nota/slug');
    expect(r.titulo).toBe('Título Tag');
    expect(r.metodo_titulo).toBe('html_title');
  });

  it('usa <h1> si no hay <title>', () => {
    const html = `<html><head></head><body><h1>Título H1</h1></body></html>`;
    const r = extractFromHtml(html, 'https://m.mx/nota/slug');
    expect(r.titulo).toBe('Título H1');
    expect(r.metodo_titulo).toBe('html_h1');
  });

  it('cae al fallback del slug de la URL si no hay nada en el HTML', () => {
    const html = `<html><head></head><body><p>solo texto</p></body></html>`;
    const r = extractFromHtml(html, 'https://m.mx/nota/messi-es-campeon');
    expect(r.titulo).toBe('Messi es campeon');
    expect(r.metodo_titulo).toBe('fallback_url_slug');
  });
});

describe('extractFromHtml - resumen', () => {
  it('prioriza meta description', () => {
    const html = `<html><head>
      <meta name="description" content="Resumen meta">
      <meta property="og:description" content="Resumen OG">
    </head><body>${articulo()}</body></html>`;
    const r = extractFromHtml(html, 'https://m.mx/x');
    expect(r.resumen).toBe('Resumen meta');
  });

  it('usa og:description si no hay meta description', () => {
    const html = `<html><head>
      <meta property="og:description" content="Resumen OG">
    </head><body>${articulo()}</body></html>`;
    const r = extractFromHtml(html, 'https://m.mx/x');
    expect(r.resumen).toBe('Resumen OG');
  });

  it('si no hay metadatos, usa los primeros párrafos del texto', () => {
    const html = `<html><head></head><body>${articulo()}</body></html>`;
    const r = extractFromHtml(html, 'https://m.mx/x');
    expect(r.resumen).toBeTruthy();
    expect(r.resumen!.length).toBeLessThanOrEqual(600);
    expect(r.resumen!).toContain('Lorem ipsum');
  });
});

describe('extractFromHtml - texto', () => {
  it('extrae el cuerpo desde <article>', () => {
    const html = `<html><body>${articulo()}</body></html>`;
    const r = extractFromHtml(html, 'https://m.mx/x');
    expect(r.metodo_texto).toBe('html_article');
    expect(r.texto_extraido).toContain('Lorem ipsum');
  });

  it('extrae desde <main> si no hay <article>', () => {
    const html = `<html><body><main><p>${PARRAFO}</p><p>${PARRAFO}</p></main></body></html>`;
    const r = extractFromHtml(html, 'https://m.mx/x');
    expect(r.metodo_texto).toBe('html_main');
    expect(r.texto_extraido).toContain('Lorem ipsum');
  });

  it('extrae desde contenedor común (.entry-content)', () => {
    const html = `<html><body><div class="entry-content"><p>${PARRAFO}</p><p>${PARRAFO}</p></div></body></html>`;
    const r = extractFromHtml(html, 'https://m.mx/x');
    expect(r.metodo_texto).toBe('html_container');
    expect(r.texto_extraido).toContain('Lorem ipsum');
  });

  it('cae a párrafos sueltos del body si no hay contenedor conocido', () => {
    const html = `<html><body><p>${PARRAFO}</p><p>${PARRAFO}</p></body></html>`;
    const r = extractFromHtml(html, 'https://m.mx/x');
    expect(r.metodo_texto).toBe('html_paragraphs');
    expect(r.texto_extraido).toContain('Lorem ipsum');
  });

  it('filtra ruido (script/nav/footer/ads)', () => {
    const html = `<html><body><article>
      <nav><p>menu navegacion</p></nav>
      <script>var x = 'codigo basura';</script>
      <p>${PARRAFO}</p>
      <p>${PARRAFO}</p>
      <footer><p>pie de pagina derechos</p></footer>
    </article></body></html>`;
    const r = extractFromHtml(html, 'https://m.mx/x');
    expect(r.texto_extraido).toContain('Lorem ipsum');
    expect(r.texto_extraido).not.toContain('menu navegacion');
    expect(r.texto_extraido).not.toContain('codigo basura');
    expect(r.texto_extraido).not.toContain('pie de pagina');
  });

  it('respeta el límite de caracteres (maxChars)', () => {
    const muchos = `<article>${'<p>' + PARRAFO.repeat(50) + '</p>'}</article>`;
    const r = extractFromHtml(`<html><body>${muchos}</body></html>`, 'https://m.mx/x', {
      maxChars: 100,
    });
    expect(r.texto_extraido!.length).toBeLessThanOrEqual(100);
  });

  it('devuelve texto null si no hay párrafos', () => {
    const html = `<html><head><title>T</title></head><body></body></html>`;
    const r = extractFromHtml(html, 'https://m.mx/x');
    expect(r.texto_extraido).toBeNull();
    expect(r.metodo_texto).toBeNull();
  });
});

describe('extractFromHtml - imagen, autor, sección', () => {
  it('extrae og:image y luego twitter:image', () => {
    const og = extractFromHtml(
      `<html><head><meta property="og:image" content="https://m.mx/a.jpg"></head><body></body></html>`,
      'https://m.mx/x',
    );
    expect(og.imagen).toBe('https://m.mx/a.jpg');

    const tw = extractFromHtml(
      `<html><head><meta name="twitter:image" content="https://m.mx/b.jpg"></head><body></body></html>`,
      'https://m.mx/x',
    );
    expect(tw.imagen).toBe('https://m.mx/b.jpg');
  });

  it('extrae autor y sección de metadatos si existen', () => {
    const html = `<html><head>
      <meta name="author" content="Ana Pérez">
      <meta property="article:section" content="Deportes">
    </head><body></body></html>`;
    const r = extractFromHtml(html, 'https://m.mx/x');
    expect(r.autor).toBe('Ana Pérez');
    expect(r.seccion).toBe('Deportes');
  });

  it('no rompe si faltan autor/sección/imagen', () => {
    const r = extractFromHtml(`<html><head><title>T</title></head><body></body></html>`, 'https://m.mx/x');
    expect(r.autor).toBeNull();
    expect(r.seccion).toBeNull();
    expect(r.imagen).toBeNull();
  });
});

describe('fetchAndExtract', () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('descarga y extrae cuando el fetch responde OK', async () => {
    const html = `<html><head><meta property="og:title" content="Nota Remota"></head><body>${articulo()}</body></html>`;
    globalThis.fetch = vi.fn(async () =>
      new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }),
    ) as unknown as typeof fetch;

    const r = await fetchAndExtract('https://m.mx/nota/algo');
    expect(r.ok).toBe(true);
    expect(r.error).toBeNull();
    expect(r.titulo).toBe('Nota Remota');
    expect(r.texto_extraido).toContain('Lorem ipsum');
  });

  it('no lanza si el fetch falla; devuelve ok=false y título fallback del slug', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ECONNRESET red caída');
    }) as unknown as typeof fetch;

    const r = await fetchAndExtract('https://m.mx/nota/messi-campeon', { timeoutMs: 50 });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('ECONNRESET');
    expect(r.titulo).toBe('Messi campeon');
    expect(r.metodo_titulo).toBe('fallback_url_slug');
    expect(r.texto_extraido).toBeNull();
  });

  it('maneja respuesta HTTP de error (404) sin lanzar', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('not found', { status: 404 }),
    ) as unknown as typeof fetch;

    const r = await fetchAndExtract('https://m.mx/nota/inexistente');
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });
});
