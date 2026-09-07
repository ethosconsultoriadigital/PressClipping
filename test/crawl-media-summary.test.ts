/**
 * Tests del EMISOR del evento terminal atómico de crawl (Media Validation &
 * Certification — Fase 1B, Hardening Pass 2, §27 del prompt).
 *
 * Cubre dos capas:
 *
 * 1. `buildCrawlMediaSummaryLogPayload` (src/crawlers/index.ts): función
 *    PURA que construye el payload exacto que `scripts/crawl.ts` loguea una
 *    vez por medio. No tiene efectos secundarios ni depende de red/Supabase
 *    — se testea directamente y de forma determinista.
 * 2. `crawlMedio` (src/crawlers/index.ts): se mockean `fetchRss`/
 *    `fetchSitemap` para demostrar que la nueva observabilidad NO altera el
 *    `CrawlResult` ya existente (mismo shape, misma cascada RSS→sitemap,
 *    mismo fallback) y que, combinado con `buildCrawlMediaSummaryLogPayload`
 *    tal como lo invoca `scripts/crawl.ts`, produce el resultado terminal
 *    coherente esperado — en particular el caso obligatorio "RSS falla,
 *    sitemap funciona".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CRAWL_MEDIA_SUMMARY_EVENT,
  CRAWL_MEDIA_SUMMARY_SCHEMA_VERSION,
  buildCrawlMediaSummaryLogPayload,
  crawlMedio,
  type CrawlResult,
} from '../src/crawlers/index.js';
import type { MedioRow } from '../src/supabase/repositories.js';

function medio(over: Partial<MedioRow> = {}): MedioRow {
  return {
    medio_id: 'MED-A',
    nombre_medio: 'Medio de prueba',
    url_base: 'https://example.test',
    metodo_extraccion: null,
    rss_url: 'https://example.test/rss',
    sitemap_url: 'https://example.test/sitemap.xml',
    secciones_urls: null,
    requiere_javascript: false,
    requiere_proxy: false,
    frecuencia_minutos: null,
    pais: 'MX',
    estado: 'Jalisco',
    municipio: null,
    region: null,
    prioridad: null,
    ultimo_estado: null,
    ultimo_scrapeo: null,
    ...over,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. buildCrawlMediaSummaryLogPayload — contrato puro, determinista
// ─────────────────────────────────────────────────────────────────────────────

describe('buildCrawlMediaSummaryLogPayload — contrato', () => {
  it('1. crawl ok produce exactamente un payload válido con event/schema_version estables', () => {
    const payload = buildCrawlMediaSummaryLogPayload({
      medioId: 'MED-A',
      status: 'ok',
      sourceMethod: 'rss',
      detected: 10,
      items: 2,
      inserted: 2,
      duplicates: 0,
      promotedDiagnostic: 0,
      terminalErrorMessage: null,
    });
    expect(payload).toEqual({
      event: 'crawl_media_summary',
      schema_version: 1,
      medio_id: 'MED-A',
      status: 'ok',
      source_method: 'rss',
      detected: 10,
      items: 2,
      inserted: 2,
      duplicates: 0,
      promoted_diagnostic: 0,
      terminal_error: null,
    });
  });

  it('8. schema_version es estable (constante exportada, no recalculada por llamada)', () => {
    expect(CRAWL_MEDIA_SUMMARY_EVENT).toBe('crawl_media_summary');
    expect(CRAWL_MEDIA_SUMMARY_SCHEMA_VERSION).toBe(1);
    const p1 = buildCrawlMediaSummaryLogPayload({
      medioId: 'MED-A',
      status: 'ok',
      sourceMethod: 'rss',
      detected: 1,
      items: 1,
      inserted: 1,
      duplicates: 0,
      promotedDiagnostic: 0,
      terminalErrorMessage: null,
    });
    const p2 = buildCrawlMediaSummaryLogPayload({
      medioId: 'MED-B',
      status: 'error',
      sourceMethod: null,
      detected: 0,
      items: 0,
      inserted: 0,
      duplicates: 0,
      promotedDiagnostic: 0,
      terminalErrorMessage: 'boom',
    });
    expect(p1.schema_version).toBe(p2.schema_version);
    expect(p1.event).toBe(p2.event);
  });

  it('2. crawl sin_fuente produce un summary terminal válido (sin inventar terminal_error)', () => {
    const payload = buildCrawlMediaSummaryLogPayload({
      medioId: 'MED-A',
      status: 'sin_fuente',
      sourceMethod: null,
      detected: 0,
      items: 0,
      inserted: 0,
      duplicates: 0,
      promotedDiagnostic: 0,
      terminalErrorMessage: null, // sin_fuente: crawlMedio no reporta una causa (ultimoError es null en ese branch)
    });
    expect(payload.status).toBe('sin_fuente');
    expect(payload.terminal_error).toBeNull();
  });

  it('3. crawl omitido (método no soportado en MVP) queda representado con terminal_error explicativo', () => {
    const payload = buildCrawlMediaSummaryLogPayload({
      medioId: 'MED-A',
      status: 'omitido',
      sourceMethod: null,
      detected: 0,
      items: 0,
      inserted: 0,
      duplicates: 0,
      promotedDiagnostic: 0,
      terminalErrorMessage: 'Método "api" no soportado en MVP',
    });
    expect(payload.status).toBe('omitido');
    expect(payload.terminal_error).toEqual({ message: 'Método "api" no soportado en MVP' });
  });

  it('4. crawl error por ingest/persistencia conserva terminal_error real', () => {
    const payload = buildCrawlMediaSummaryLogPayload({
      medioId: 'MED-A',
      status: 'error', // estadoFinal sobrescrito por scripts/crawl.ts tras fallo de ingestNoticias
      sourceMethod: 'rss', // la fuente SÍ produjo items — el fallo fue en la persistencia, no en la fuente
      detected: 10,
      items: 2,
      inserted: 0, // ingestNoticias lanzó antes de contar insertadas
      duplicates: 0,
      promotedDiagnostic: 0,
      terminalErrorMessage: 'ingestNoticias: constraint violation',
    });
    expect(payload.status).toBe('error');
    expect(payload.source_method).toBe('rss');
    expect(payload.terminal_error).toEqual({ message: 'ingestNoticias: constraint violation' });
  });

  it('5/6. RSS falla + sitemap funciona: el summary representa sitemap+ok, el fallo RSS NUNCA se convierte en terminal_error', () => {
    // Tal como lo construye scripts/crawl.ts: `result` es el retorno de
    // crawlMedio() cuando sitemap tuvo éxito tras que RSS fallara — el
    // fallo de RSS ya fue logueado por separado (log.warn en
    // src/crawlers/index.ts) y NUNCA llega a los parámetros de este
    // builder, que solo conoce el resultado TERMINAL coherente.
    const payload = buildCrawlMediaSummaryLogPayload({
      medioId: 'MED-A',
      status: 'ok',
      sourceMethod: 'sitemap',
      detected: 40,
      items: 5,
      inserted: 5,
      duplicates: 0,
      promotedDiagnostic: 0,
      terminalErrorMessage: null,
    });
    expect(payload.status).toBe('ok');
    expect(payload.source_method).toBe('sitemap');
    expect(payload.terminal_error).toBeNull();
  });

  it('9. medio_id del payload siempre corresponde al medio_id pasado (nunca se infiere de otro campo)', () => {
    const payload = buildCrawlMediaSummaryLogPayload({
      medioId: 'MED-XYZ',
      status: 'ok',
      sourceMethod: 'rss',
      detected: 1,
      items: 1,
      inserted: 1,
      duplicates: 0,
      promotedDiagnostic: 0,
      terminalErrorMessage: null,
    });
    expect(payload.medio_id).toBe('MED-XYZ');
  });

  it('función pura: no muta el objeto de parámetros ni tiene efectos secundarios observables', () => {
    const params = {
      medioId: 'MED-A',
      status: 'ok',
      sourceMethod: 'rss',
      detected: 1,
      items: 1,
      inserted: 1,
      duplicates: 0,
      promotedDiagnostic: 0,
      terminalErrorMessage: null as string | null,
    };
    const frozen = JSON.stringify(params);
    buildCrawlMediaSummaryLogPayload(params);
    expect(JSON.stringify(params)).toBe(frozen);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. crawlMedio (mockeando fetchRss/fetchSitemap) — la nueva observabilidad
//    no altera selección/ingestión/CrawlResult (§27.7)
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../src/parsers/rss.js', () => ({ fetchRss: vi.fn() }));
vi.mock('../src/parsers/sitemap.js', () => ({ fetchSitemap: vi.fn() }));

import { fetchRss } from '../src/parsers/rss.js';
import { fetchSitemap } from '../src/parsers/sitemap.js';

const mockedFetchRss = fetchRss as unknown as ReturnType<typeof vi.fn>;
const mockedFetchSitemap = fetchSitemap as unknown as ReturnType<typeof vi.fn>;

describe('crawlMedio — CrawlResult sin cambios de shape (Pass 2 es puramente aditivo)', () => {
  beforeEach(() => {
    mockedFetchRss.mockReset();
    mockedFetchSitemap.mockReset();
  });

  it('CrawlResult conserva exactamente sus campos originales cuando RSS tiene éxito', async () => {
    mockedFetchRss.mockResolvedValue([{ url: 'https://example.test/n1' }, { url: 'https://example.test/n2' }]);
    const result: CrawlResult = await crawlMedio(medio(), 25);
    expect(Object.keys(result).sort()).toEqual(
      ['medio_id', 'fuente', 'urls_detectadas', 'items', 'estado', 'error'].sort(),
    );
    expect(result.estado).toBe('ok');
    expect(result.fuente).toBe('rss');
    expect(result.error).toBeNull();
    expect(mockedFetchSitemap).not.toHaveBeenCalled();
  });

  it('5/6. RSS falla (excepción) y sitemap funciona → CrawlResult representa sitemap+ok, sin rastro del fallo RSS en `error`', async () => {
    mockedFetchRss.mockRejectedValue(new Error('RSS inválido'));
    mockedFetchSitemap.mockResolvedValue([{ url: 'https://example.test/s1' }]);

    const result: CrawlResult = await crawlMedio(medio(), 25);

    expect(result.estado).toBe('ok');
    expect(result.fuente).toBe('sitemap');
    expect(result.error).toBeNull(); // el fallo de RSS es un intento, no queda en el resultado terminal

    // Combinado tal como lo hace scripts/crawl.ts: el summary terminal debe
    // representar sitemap+ok, jamás mezclar el fallo intermedio de RSS.
    const payload = buildCrawlMediaSummaryLogPayload({
      medioId: result.medio_id,
      status: result.estado,
      sourceMethod: result.fuente,
      detected: result.urls_detectadas,
      items: result.items.length,
      inserted: result.items.length,
      duplicates: 0,
      promotedDiagnostic: 0,
      terminalErrorMessage: result.error,
    });
    expect(payload.status).toBe('ok');
    expect(payload.source_method).toBe('sitemap');
    expect(payload.terminal_error).toBeNull();
  });

  it('medio_id del CrawlResult siempre corresponde al medio procesado', async () => {
    mockedFetchRss.mockResolvedValue([]);
    mockedFetchSitemap.mockResolvedValue([]);
    const result = await crawlMedio(medio({ medio_id: 'MED-ZZZ' }), 25);
    expect(result.medio_id).toBe('MED-ZZZ');
  });

  it('la cascada rss→sitemap y la selección de items no cambian (regresión de comportamiento)', async () => {
    mockedFetchRss.mockResolvedValue([]); // RSS sin items: prueba siguiente
    mockedFetchSitemap.mockResolvedValue([{ url: 'https://example.test/s1' }, { url: 'https://example.test/s2' }]);
    const result = await crawlMedio(medio(), 25);
    expect(result.fuente).toBe('sitemap');
    expect(result.items).toHaveLength(2);
    expect(mockedFetchRss).toHaveBeenCalledTimes(1);
    expect(mockedFetchSitemap).toHaveBeenCalledTimes(1);
  });
});
