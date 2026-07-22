import { describe, it, expect } from 'vitest';
import { parseArgs, extraerUrlsDelListado, MEDIO_ID, BLOG_URL } from '../scripts/crawl-direct-cnit.js';
import { CNIT_MEDIO } from '../scripts/catalog-cnit.js';
import { medioSchema } from '../src/types/schemas.js';

describe('crawl-direct-cnit — constantes', () => {
  it('MEDIO_ID es MED-0188', () => {
    expect(MEDIO_ID).toBe('MED-0188');
  });

  it('BLOG_URL apunta al blog público de CNIT', () => {
    expect(BLOG_URL).toBe('https://cnit.org.mx/blog');
  });
});

describe('crawl-direct-cnit — parseArgs', () => {
  it('valores por defecto: dryRun=false, limit=10', () => {
    expect(parseArgs([])).toEqual({ dryRun: false, limit: 10 });
  });

  it('--dry-run activa dryRun', () => {
    expect(parseArgs(['--dry-run'])).toMatchObject({ dryRun: true });
  });

  it('--limit=5 establece limit=5', () => {
    expect(parseArgs(['--limit=5'])).toMatchObject({ limit: 5 });
  });

  it('--dry-run + --limit=20 combina correctamente', () => {
    expect(parseArgs(['--dry-run', '--limit=20'])).toEqual({ dryRun: true, limit: 20 });
  });

  it('--limit= inválido mantiene el default 10', () => {
    expect(parseArgs(['--limit=abc'])).toMatchObject({ limit: 10 });
  });
});

describe('crawl-direct-cnit — extraerUrlsDelListado', () => {
  it('extrae URLs únicas del blog de CNIT', () => {
    const html = `
      <a href="https://cnit.org.mx/blog/denominacion-de-origen">nota 1</a>
      <a href="https://cnit.org.mx/blog/sustentabilidad-2024">nota 2</a>
      <a href="https://cnit.org.mx/blog/denominacion-de-origen">duplicado</a>
    `;
    const urls = extraerUrlsDelListado(html);
    expect(urls).toHaveLength(2);
    expect(urls).toContain('https://cnit.org.mx/blog/denominacion-de-origen');
    expect(urls).toContain('https://cnit.org.mx/blog/sustentabilidad-2024');
  });

  it('ignora URLs externas o que no sean del blog de CNIT', () => {
    const html = `
      <a href="https://otro-sitio.com/nota">externo</a>
      <a href="https://cnit.org.mx/blog/comunicado-oficial">válido</a>
      <a href="https://cnit.org.mx/contacto">no es blog</a>
    `;
    const urls = extraerUrlsDelListado(html);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toBe('https://cnit.org.mx/blog/comunicado-oficial');
  });

  it('devuelve arreglo vacío si no hay URLs del blog', () => {
    expect(extraerUrlsDelListado('<html><body>sin links</body></html>')).toEqual([]);
  });

  it('deduplica: no repite la misma URL', () => {
    const html = Array(5).fill('<a href="https://cnit.org.mx/blog/nota-unica">x</a>').join('\n');
    expect(extraerUrlsDelListado(html)).toHaveLength(1);
  });
});

describe('catalog-cnit — CNIT_MEDIO', () => {
  it('valida contra el esquema real de la tabla medios', () => {
    const r = medioSchema.safeParse(CNIT_MEDIO);
    expect(r.success, r.success ? '' : JSON.stringify(r.error?.issues)).toBe(true);
  });

  it('medio_id es MED-0188 y coincide con el extractor', () => {
    expect(CNIT_MEDIO.medio_id).toBe('MED-0188');
    expect(CNIT_MEDIO.medio_id).toBe(MEDIO_ID);
  });

  it('metodo_extraccion es DIRECT (fuente de descubrimiento propia)', () => {
    expect(CNIT_MEDIO.metodo_extraccion).toBe('DIRECT');
  });

  it('no requiere proxy ni JavaScript', () => {
    expect(CNIT_MEDIO.requiere_proxy).toBe(false);
    expect(CNIT_MEDIO.requiere_javascript).toBe(false);
  });

  it('prioridad Alta — relevante para Patrón', () => {
    expect(CNIT_MEDIO.prioridad).toBe('Alta');
  });
});
