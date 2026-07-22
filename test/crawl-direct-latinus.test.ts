/**
 * Tests del extractor DIRECT para LatinUS (MED-0190).
 * Verifica constantes, parseArgs y la función de extracción de URLs.
 * Sin red: el HTML de prueba está inline.
 */
import { describe, it, expect } from 'vitest';
import {
  MEDIO_ID,
  BASE_URL,
  HOME_URL,
  URL_PATTERN,
  parseArgs,
  extraerUrlsDeHomepage,
} from '../scripts/crawl-direct-latinus.js';

describe('crawl-direct-latinus — constantes', () => {
  it('MEDIO_ID es MED-0190', () => expect(MEDIO_ID).toBe('MED-0190'));
  it('BASE_URL es https://latinus.us', () => expect(BASE_URL).toBe('https://latinus.us'));
  it('HOME_URL incluye BASE_URL', () => expect(HOME_URL).toContain(BASE_URL));
});

describe('crawl-direct-latinus — parseArgs', () => {
  it('defaults: dryRun=false, limit=10', () => {
    expect(parseArgs([])).toEqual({ dryRun: false, limit: 10 });
  });

  it('--dry-run activa dryRun', () => {
    expect(parseArgs(['--dry-run'])).toMatchObject({ dryRun: true });
  });

  it('--limit=5 fija limit', () => {
    expect(parseArgs(['--limit=5'])).toMatchObject({ limit: 5 });
  });

  it('combinación: --dry-run --limit=20', () => {
    expect(parseArgs(['--dry-run', '--limit=20'])).toEqual({ dryRun: true, limit: 20 });
  });
});

describe('crawl-direct-latinus — extraerUrlsDeHomepage', () => {
  const htmlConArticulos = `
    <html>
      <a href="/nacional/2026/7/22/elecciones-mexico-2026-12345.html">Nota 1</a>
      <a href="/politica/2026/7/21/reforma-fiscal-aprobada-98765.html">Nota 2</a>
      <a href="/economia/2026/7/20/pesos-dolar-tipo-cambio-55555.html">Nota 3</a>
    </html>
  `;

  it('extrae URLs absolutas con BASE_URL', () => {
    const urls = extraerUrlsDeHomepage(htmlConArticulos);
    expect(urls).toContain('https://latinus.us/nacional/2026/7/22/elecciones-mexico-2026-12345.html');
    expect(urls).toContain('https://latinus.us/politica/2026/7/21/reforma-fiscal-aprobada-98765.html');
    expect(urls).toContain('https://latinus.us/economia/2026/7/20/pesos-dolar-tipo-cambio-55555.html');
  });

  it('devuelve 3 URLs del HTML de prueba', () => {
    expect(extraerUrlsDeHomepage(htmlConArticulos)).toHaveLength(3);
  });

  it('deduplicación: misma URL aparece dos veces → devuelve una sola', () => {
    const htmlDuplex = `
      <a href="/nacional/2026/7/22/nota-unica-12345.html">A</a>
      <a href="/nacional/2026/7/22/nota-unica-12345.html">B (duplicada)</a>
    `;
    expect(extraerUrlsDeHomepage(htmlDuplex)).toHaveLength(1);
  });

  it('no extrae URLs de páginas de sección (sin fecha ni ID numérico)', () => {
    const htmlSecciones = `
      <a href="/nacional/">Sección Nacional</a>
      <a href="/economia/">Economía</a>
      <a href="/video/">Videos</a>
    `;
    expect(extraerUrlsDeHomepage(htmlSecciones)).toHaveLength(0);
  });

  it('no extrae URLs de otros dominios ni absolutas de terceros', () => {
    const htmlExterno = `
      <a href="https://otro.com/nota/2026/7/22/articulo-12345.html">Otro sitio</a>
      <a href="https://google.com/search?q=latinus">Google</a>
    `;
    expect(extraerUrlsDeHomepage(htmlExterno)).toHaveLength(0);
  });

  it('HTML vacío → array vacío', () => {
    expect(extraerUrlsDeHomepage('')).toHaveLength(0);
  });

  it('las URLs generadas empiezan con BASE_URL', () => {
    const urls = extraerUrlsDeHomepage(htmlConArticulos);
    for (const u of urls) expect(u.startsWith('https://latinus.us/')).toBe(true);
  });

  it('URL_PATTERN no incluye "direct" ni keywords de cliente', () => {
    expect(URL_PATTERN.source).not.toContain('keyword');
    expect(URL_PATTERN.source).not.toContain('cliente');
    expect(URL_PATTERN.source).not.toContain('direct');
  });
});
