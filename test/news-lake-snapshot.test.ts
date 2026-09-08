/**
 * Tests deterministas para `src/mediaValidation/newsLakeSnapshot.ts`
 * (Media Validation & Certification, Fase 1C + HARDENING FINAL).
 *
 * Todas las pruebas inyectan un `FetchNoticiasPage` simulado — CERO llamadas
 * reales a Supabase.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  buildNewsLakeSnapshot,
  type FetchNoticiasPage,
  type FetchNoticiasPageParams,
  type NoticiaSnapshotRow,
  type BuildSnapshotOptions,
} from '../src/mediaValidation/newsLakeSnapshot.js';

const ANCHOR = '2026-09-07T22:00:00.000Z';

function row(id: string, medioId: string, textoLimpio: string | null, cuerpo: string | null): NoticiaSnapshotRow {
  return { noticia_id: id, medio_id: medioId, texto_nota_limpia: textoLimpio, texto_cuerpo_nota: cuerpo };
}

/** Opciones base con identidad de contexto/rol/ventana ya rellenadas — los tests que no son el foco de esos campos los reutilizan tal cual. */
function baseOpts(overrides: Partial<BuildSnapshotOptions> = {}): Omit<BuildSnapshotOptions, 'mediaIds' | 'fetchPage'> {
  return {
    contextId: 'VAL-TEST-001',
    snapshotRole: 'BEFORE',
    windowDays: null,
    windowAnchor: null,
    pageSize: 1000,
    ...overrides,
  };
}

function fakeFetcher(
  pagesByMedio: Record<string, Array<{ data: NoticiaSnapshotRow[] | null; error?: { message: string } | null }>>,
): FetchNoticiasPage {
  const cursor: Record<string, number> = {};
  return vi.fn(async (params: FetchNoticiasPageParams) => {
    const pages = pagesByMedio[params.medioId] ?? [];
    const i = cursor[params.medioId] ?? 0;
    cursor[params.medioId] = i + 1;
    const page = pages[i];
    if (!page) return { data: [], error: null };
    return { data: page.data, error: page.error ?? null };
  });
}

describe('buildNewsLakeSnapshot — Fase 1C', () => {
  it('38. medio con 0 noticias reales → snapshot COMPLETE, total=0 (no null)', async () => {
    const fetchPage = fakeFetcher({ 'MED-A': [{ data: [] }] });
    const result = await buildNewsLakeSnapshot({ ...baseOpts(), mediaIds: ['MED-A'], fetchPage });
    expect(result.media).toHaveLength(1);
    const m = result.media[0]!;
    expect(m.status).toBe('COMPLETE');
    expect(m.total_news).toBe(0);
    expect(m.clean_text_count).toBe(0);
    expect(m.body_count).toBe(0);
    expect(m.consistency).toBe('STABLE_OBSERVED');
  });

  it('2. medio con N noticias → contadores correctos (clean_text/body separados)', async () => {
    const fetchPage = fakeFetcher({
      'MED-A': [
        {
          data: [
            row('n1', 'MED-A', 'texto limpio', 'cuerpo'),
            row('n2', 'MED-A', 'texto limpio', null),
            row('n3', 'MED-A', null, null),
          ],
        },
      ],
    });
    const result = await buildNewsLakeSnapshot({ ...baseOpts(), mediaIds: ['MED-A'], fetchPage });
    const m = result.media[0]!;
    expect(m.status).toBe('COMPLETE');
    expect(m.total_news).toBe(3);
    expect(m.clean_text_count).toBe(2);
    expect(m.body_count).toBe(1);
  });

  it('41. medio fuera de cron se consulta igual si está solicitado explícitamente (no hay filtro de cron en este módulo)', async () => {
    const fetchPage = fakeFetcher({ 'MED-FUERA-DE-CRON': [{ data: [row('n1', 'MED-FUERA-DE-CRON', 'x', 'y')] }] });
    const result = await buildNewsLakeSnapshot({ ...baseOpts(), mediaIds: ['MED-FUERA-DE-CRON'], fetchPage });
    expect(result.media[0]!.status).toBe('COMPLETE');
    expect(result.media[0]!.total_news).toBe(1);
    expect(fetchPage).toHaveBeenCalledWith(expect.objectContaining({ medioId: 'MED-FUERA-DE-CRON' }));
  });

  it('39. primera página con error → ERROR, no cero', async () => {
    const fetchPage = fakeFetcher({ 'MED-A': [{ data: null, error: { message: 'conexión fallida' } }] });
    const result = await buildNewsLakeSnapshot({ ...baseOpts(), mediaIds: ['MED-A'], fetchPage });
    const m = result.media[0]!;
    expect(m.status).toBe('ERROR');
    expect(m.total_news).toBeNull();
    expect(m.clean_text_count).toBeNull();
    expect(m.body_count).toBeNull();
    expect(m.consistency).toBe('UNKNOWN');
    expect(m.errors.length).toBeGreaterThan(0);
  });

  it('40. página posterior con error → PARTIAL (no ERROR, no snapshot completo con conteo de la página 1)', async () => {
    const paginaLlena = Array.from({ length: 2 }, (_, i) => row(`n${i}`, 'MED-A', 'x', 'y'));
    const fetchPage = fakeFetcher({ 'MED-A': [{ data: paginaLlena }, { data: null, error: { message: 'timeout' } }] });
    const result = await buildNewsLakeSnapshot({ ...baseOpts(), mediaIds: ['MED-A'], fetchPage, pageSize: 2 });
    const m = result.media[0]!;
    expect(m.status).toBe('PARTIAL');
    expect(m.total_news).toBeNull();
    expect(m.clean_text_count).toBeNull();
    expect(m.body_count).toBeNull();
    expect(m.consistency).toBe('UNKNOWN');
    expect(m.pages_read).toBe(1);
  });

  it('6. paginación con múltiples páginas → totals correctos (agregados de todas las páginas)', async () => {
    const p1 = Array.from({ length: 3 }, (_, i) => row(`p1-${i}`, 'MED-A', 'x', 'y'));
    const p2 = Array.from({ length: 3 }, (_, i) => row(`p2-${i}`, 'MED-A', 'x', null));
    const p3 = [row('p3-0', 'MED-A', null, null)];
    const fetchPage = fakeFetcher({ 'MED-A': [{ data: p1 }, { data: p2 }, { data: p3 }] });
    const result = await buildNewsLakeSnapshot({ ...baseOpts(), mediaIds: ['MED-A'], fetchPage, pageSize: 3 });
    const m = result.media[0]!;
    expect(m.status).toBe('COMPLETE');
    expect(m.total_news).toBe(7);
    expect(m.clean_text_count).toBe(6);
    expect(m.body_count).toBe(3);
    expect(m.pages_read).toBe(3);
  });

  it('7. texto_nota_limpia vacío/blanco → no cuenta como clean text', async () => {
    const fetchPage = fakeFetcher({ 'MED-A': [{ data: [row('n1', 'MED-A', '', 'cuerpo'), row('n2', 'MED-A', '   ', 'cuerpo')] }] });
    const result = await buildNewsLakeSnapshot({ ...baseOpts(), mediaIds: ['MED-A'], fetchPage });
    expect(result.media[0]!.clean_text_count).toBe(0);
    expect(result.media[0]!.body_count).toBe(2);
  });

  it('8. texto_cuerpo_nota vacío/blanco → no cuenta como body', async () => {
    const fetchPage = fakeFetcher({ 'MED-A': [{ data: [row('n1', 'MED-A', 'limpio', ''), row('n2', 'MED-A', 'limpio', '  ')] }] });
    const result = await buildNewsLakeSnapshot({ ...baseOpts(), mediaIds: ['MED-A'], fetchPage });
    expect(result.media[0]!.clean_text_count).toBe(2);
    expect(result.media[0]!.body_count).toBe(0);
  });

  it('9. duplicación de rows entre páginas no se cuenta dos veces', async () => {
    const dup = row('n1', 'MED-A', 'x', 'y');
    const fetchPage = fakeFetcher({ 'MED-A': [{ data: [dup, row('n2', 'MED-A', 'x', 'y')] }, { data: [dup] }] });
    const result = await buildNewsLakeSnapshot({ ...baseOpts(), mediaIds: ['MED-A'], fetchPage, pageSize: 2 });
    const m = result.media[0]!;
    expect(m.total_news).toBe(2);
    expect(m.duplicate_rows_skipped).toBe(1);
  });

  it('48. dos medios se mantienen separados (sin contaminación cruzada)', async () => {
    const fetchPage = fakeFetcher({
      'MED-A': [{ data: [row('a1', 'MED-A', 'x', 'y')] }],
      'MED-B': [{ data: [row('b1', 'MED-B', null, null), row('b2', 'MED-B', 'x', 'y')] }],
    });
    const result = await buildNewsLakeSnapshot({ ...baseOpts(), mediaIds: ['MED-A', 'MED-B'], fetchPage });
    const a = result.media.find((m) => m.medio_id === 'MED-A')!;
    const b = result.media.find((m) => m.medio_id === 'MED-B')!;
    expect(a.total_news).toBe(1);
    expect(a.clean_text_count).toBe(1);
    expect(b.total_news).toBe(2);
    expect(b.clean_text_count).toBe(1);
  });

  it('11. resultado vacío exitoso (0 filas) es distinto de un error (ambos escenarios distinguibles)', async () => {
    const fetchPage = fakeFetcher({
      'MED-VACIO': [{ data: [] }],
      'MED-ERROR': [{ data: null, error: { message: 'fallo' } }],
    });
    const result = await buildNewsLakeSnapshot({ ...baseOpts(), mediaIds: ['MED-VACIO', 'MED-ERROR'], fetchPage });
    const vacio = result.media.find((m) => m.medio_id === 'MED-VACIO')!;
    const error = result.media.find((m) => m.medio_id === 'MED-ERROR')!;
    expect(vacio.status).toBe('COMPLETE');
    expect(vacio.total_news).toBe(0);
    expect(error.status).toBe('ERROR');
    expect(error.total_news).toBeNull();
  });

  it('12. medio_ids explícitos se normalizan (trim + dedupe) y se preservan en requested_media_ids', async () => {
    const fetchPage = fakeFetcher({ 'MED-A': [{ data: [] }], 'MED-B': [{ data: [] }] });
    const result = await buildNewsLakeSnapshot({
      ...baseOpts(),
      mediaIds: [' MED-A ', 'MED-B', 'MED-A', '', '   '],
      fetchPage,
    });
    expect(result.requested_media_ids).toEqual(['MED-A', 'MED-B']);
    expect(result.media).toHaveLength(2);
  });

  it('excepción de transporte inesperada (fuera del contrato {data,error}) se trata como ERROR, nunca como fin de paginación', async () => {
    const fetchPage: FetchNoticiasPage = vi.fn(async () => {
      throw new Error('socket hang up');
    });
    const result = await buildNewsLakeSnapshot({ ...baseOpts(), mediaIds: ['MED-A'], fetchPage });
    const m = result.media[0]!;
    expect(m.status).toBe('ERROR');
    expect(m.errors[0]).toContain('socket hang up');
  });

  it('página exactamente igual a pageSize dispara una página adicional para confirmar fin real (0 filas)', async () => {
    const full = Array.from({ length: 2 }, (_, i) => row(`n${i}`, 'MED-A', 'x', 'y'));
    const fetchPage = fakeFetcher({ 'MED-A': [{ data: full }, { data: [] }] });
    const result = await buildNewsLakeSnapshot({ ...baseOpts(), mediaIds: ['MED-A'], fetchPage, pageSize: 2 });
    const m = result.media[0]!;
    expect(m.status).toBe('COMPLETE');
    expect(m.total_news).toBe(2);
    expect(m.pages_read).toBe(2);
  });

  it('capture_started_at <= capture_completed_at, y ambos son ISO válidos', async () => {
    const fetchPage = fakeFetcher({ 'MED-A': [{ data: [] }] });
    const result = await buildNewsLakeSnapshot({ ...baseOpts(), mediaIds: ['MED-A'], fetchPage });
    expect(() => new Date(result.capture_started_at).toISOString()).not.toThrow();
    expect(() => new Date(result.capture_completed_at).toISOString()).not.toThrow();
    expect(new Date(result.capture_started_at).getTime()).toBeLessThanOrEqual(
      new Date(result.capture_completed_at).getTime(),
    );
  });

  it('identidad de contexto/rol/schema_version se conservan en el SnapshotResult', async () => {
    const fetchPage = fakeFetcher({ 'MED-A': [{ data: [] }] });
    const result = await buildNewsLakeSnapshot({
      contextId: 'VAL-XYZ',
      snapshotRole: 'AFTER',
      windowDays: null,
      windowAnchor: null,
      mediaIds: ['MED-A'],
      fetchPage,
    });
    expect(result.context_id).toBe('VAL-XYZ');
    expect(result.snapshot_role).toBe('AFTER');
    expect(result.schema_version).toBe(1);
  });
});

describe('§33 — Pagination drift (consistency)', () => {
  it('35. duplicate row entre páginas → consistency=POSSIBLE_DRIFT, con duplicate_rows_skipped>0 visible', async () => {
    const p1 = [row('n1', 'MED-A', 'x', 'y'), row('n2', 'MED-A', 'x', 'y')];
    const p2 = [row('n1', 'MED-A', 'x', 'y')]; // n1 repetido — el dataset se movió
    const fetchPage = fakeFetcher({ 'MED-A': [{ data: p1 }, { data: p2 }] });
    const result = await buildNewsLakeSnapshot({ ...baseOpts(), mediaIds: ['MED-A'], fetchPage, pageSize: 2 });
    const m = result.media[0]!;
    expect(m.status).toBe('COMPLETE'); // la query en sí terminó sin error
    expect(m.duplicate_rows_skipped).toBe(1);
    expect(m.consistency).toBe('POSSIBLE_DRIFT');
  });

  it('37. paginación limpia (sin duplicados) sigue siendo elegible como STABLE_OBSERVED', async () => {
    const p1 = [row('n1', 'MED-A', 'x', 'y')];
    const p2 = [row('n2', 'MED-A', 'x', 'y')];
    const fetchPage = fakeFetcher({ 'MED-A': [{ data: p1 }, { data: p2 }] });
    const result = await buildNewsLakeSnapshot({ ...baseOpts(), mediaIds: ['MED-A'], fetchPage, pageSize: 1 });
    const m = result.media[0]!;
    expect(m.status).toBe('COMPLETE');
    expect(m.duplicate_rows_skipped).toBe(0);
    expect(m.consistency).toBe('STABLE_OBSERVED');
  });
});

describe('B1C — window_anchor obligatorio y validado (identidad temporal)', () => {
  it('4. malformed anchor ("", "foo") → reject', async () => {
    const fetchPage = fakeFetcher({ 'MED-A': [{ data: [] }] });
    await expect(
      buildNewsLakeSnapshot({ ...baseOpts({ windowDays: 30, windowAnchor: '' }), mediaIds: ['MED-A'], fetchPage }),
    ).rejects.toThrow();
    await expect(
      buildNewsLakeSnapshot({ ...baseOpts({ windowDays: 30, windowAnchor: 'foo' }), mediaIds: ['MED-A'], fetchPage }),
    ).rejects.toThrow();
  });

  it('windowDays activo sin windowAnchor → reject (nunca se sustituye por Date.now())', async () => {
    const fetchPage = fakeFetcher({ 'MED-A': [{ data: [] }] });
    await expect(
      buildNewsLakeSnapshot({ ...baseOpts({ windowDays: 30, windowAnchor: null }), mediaIds: ['MED-A'], fetchPage }),
    ).rejects.toThrow(/windowAnchor/);
  });

  it('contextId vacío → reject', async () => {
    const fetchPage = fakeFetcher({ 'MED-A': [{ data: [] }] });
    await expect(
      buildNewsLakeSnapshot({ ...baseOpts({ contextId: '' }), mediaIds: ['MED-A'], fetchPage }),
    ).rejects.toThrow(/contextId/);
  });

  it('windowDays === null permite windowAnchor === null (sin filtro temporal, válido)', async () => {
    const fetchPage = fakeFetcher({ 'MED-A': [{ data: [] }] });
    const result = await buildNewsLakeSnapshot({
      ...baseOpts({ windowDays: null, windowAnchor: null }),
      mediaIds: ['MED-A'],
      fetchPage,
    });
    expect(result.window_anchor).toBeNull();
  });

  it('windowAnchor se propaga sin cambios al fetchPage (params.windowAnchor === el valor dado)', async () => {
    const fetchPage = fakeFetcher({ 'MED-A': [{ data: [] }] });
    await buildNewsLakeSnapshot({
      ...baseOpts({ windowDays: 30, windowAnchor: ANCHOR }),
      mediaIds: ['MED-A'],
      fetchPage,
    });
    expect(fetchPage).toHaveBeenCalledWith(expect.objectContaining({ windowAnchor: ANCHOR, windowDays: 30 }));
  });
});
