/**
 * Tests del extractor DIRECT para La Silla Rota (MED-0191).
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
} from '../scripts/crawl-direct-lasillarota.js';

describe('crawl-direct-lasillarota — constantes', () => {
  it('MEDIO_ID es MED-0191', () => expect(MEDIO_ID).toBe('MED-0191'));
  it('BASE_URL es https://lasillarota.com', () => expect(BASE_URL).toBe('https://lasillarota.com'));
  it('HOME_URL incluye BASE_URL', () => expect(HOME_URL).toContain(BASE_URL));
});

describe('crawl-direct-lasillarota — parseArgs', () => {
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

describe('crawl-direct-lasillarota — extraerUrlsDeHomepage', () => {
  const htmlConArticulos = `
    <html>
      <a href="https://lasillarota.com/nacional/2026/7/22/sheinbaum-anuncia-plan-energetico-54321.html">Nota 1</a>
      <a href="https://lasillarota.com/politica/2026/7/21/senado-aprueba-reforma-99999.html">Nota 2</a>
      <a href="https://lasillarota.com/economia/2026/7/20/pib-mexico-crece-11111.html">Nota 3</a>
    </html>
  `;

  it('extrae URLs absolutas del dominio lasillarota.com', () => {
    const urls = extraerUrlsDeHomepage(htmlConArticulos);
    expect(urls).toContain('https://lasillarota.com/nacional/2026/7/22/sheinbaum-anuncia-plan-energetico-54321.html');
    expect(urls).toContain('https://lasillarota.com/politica/2026/7/21/senado-aprueba-reforma-99999.html');
    expect(urls).toContain('https://lasillarota.com/economia/2026/7/20/pib-mexico-crece-11111.html');
  });

  it('devuelve 3 URLs del HTML de prueba', () => {
    expect(extraerUrlsDeHomepage(htmlConArticulos)).toHaveLength(3);
  });

  it('deduplicación: misma URL dos veces → una sola', () => {
    const htmlDuplex = `
      <a href="https://lasillarota.com/nacional/2026/7/22/nota-repetida-77777.html">A</a>
      <a href="https://lasillarota.com/nacional/2026/7/22/nota-repetida-77777.html">B (dup)</a>
    `;
    expect(extraerUrlsDeHomepage(htmlDuplex)).toHaveLength(1);
  });

  it('no extrae URLs de páginas de sección (sin fecha ni ID numérico)', () => {
    const htmlSecciones = `
      <a href="https://lasillarota.com/nacional/">Sección Nacional</a>
      <a href="https://lasillarota.com/politica/">Política</a>
    `;
    expect(extraerUrlsDeHomepage(htmlSecciones)).toHaveLength(0);
  });

  it('no extrae URLs de rutas relativas (patrón exige URL absoluta lasillarota.com)', () => {
    const htmlRelativo = `
      <a href="/nacional/2026/7/22/nota-relativa-55555.html">Relativa</a>
    `;
    expect(extraerUrlsDeHomepage(htmlRelativo)).toHaveLength(0);
  });

  it('no extrae URLs de otros dominios', () => {
    const htmlExterno = `
      <a href="https://otro.com/nacional/2026/7/22/nota-ajena-12345.html">Otro</a>
    `;
    expect(extraerUrlsDeHomepage(htmlExterno)).toHaveLength(0);
  });

  it('HTML vacío → array vacío', () => {
    expect(extraerUrlsDeHomepage('')).toHaveLength(0);
  });

  it('las URLs generadas empiezan con BASE_URL', () => {
    const urls = extraerUrlsDeHomepage(htmlConArticulos);
    for (const u of urls) expect(u.startsWith('https://lasillarota.com/')).toBe(true);
  });

  it('URL_PATTERN no incluye "keyword" ni "cliente"', () => {
    expect(URL_PATTERN.source).not.toContain('keyword');
    expect(URL_PATTERN.source).not.toContain('cliente');
  });
});
