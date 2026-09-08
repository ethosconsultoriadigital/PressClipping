/**
 * Tests deterministas para `src/mediaValidation/temporalWindow.ts` y para
 * la derivación real del cutoff en `createSupabaseFetchNoticiasPage`
 * (Media Validation & Certification, Fase 1C HARDENING FINAL — B1C).
 *
 * Cubre §41 del prompt de hardening (temporal window).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { computeWindowStart, isValidIsoTimestamp } from '../src/mediaValidation/temporalWindow.js';

const ANCHOR = '2026-09-07T22:00:00.000Z';

describe('isValidIsoTimestamp', () => {
  it('acepta un ISO timestamp real', () => {
    expect(isValidIsoTimestamp(ANCHOR)).toBe(true);
  });

  it('rechaza "" / "foo" / valores no-string', () => {
    expect(isValidIsoTimestamp('')).toBe(false);
    expect(isValidIsoTimestamp('   ')).toBe(false);
    expect(isValidIsoTimestamp('foo')).toBe(false);
    expect(isValidIsoTimestamp(null)).toBe(false);
    expect(isValidIsoTimestamp(undefined)).toBe(false);
    expect(isValidIsoTimestamp(123 as unknown as string)).toBe(false);
  });
});

describe('computeWindowStart — §41 (mismo anchor → mismo cutoff)', () => {
  it('1. mismo anchor + mismo window_days genera EXACTAMENTE el mismo cutoff (llamado dos veces)', () => {
    const cutoff1 = computeWindowStart(ANCHOR, 30);
    const cutoff2 = computeWindowStart(ANCHOR, 30);
    expect(cutoff1).toBe(cutoff2);
    expect(cutoff1).toBe(new Date(new Date(ANCHOR).getTime() - 30 * 86400000).toISOString());
  });

  it('2. Date.now() distinto NO afecta el cutoff cuando el anchor es fijo (la función nunca lee Date.now)', () => {
    const spy = vi.spyOn(Date, 'now');
    spy.mockReturnValue(new Date('2026-09-07T10:00:00.000Z').getTime());
    const cutoffA = computeWindowStart(ANCHOR, 30);
    spy.mockReturnValue(new Date('2026-09-07T10:20:00.000Z').getTime()); // 20 minutos después
    const cutoffB = computeWindowStart(ANCHOR, 30);
    spy.mockRestore();
    expect(cutoffA).toBe(cutoffB);
  });

  it('4. anchor malformado lanza en vez de producir un cutoff silenciosamente incorrecto', () => {
    expect(() => computeWindowStart('foo', 30)).toThrow();
    expect(() => computeWindowStart('', 30)).toThrow();
  });

  it('windowDays=0 produce cutoff === anchor', () => {
    expect(computeWindowStart(ANCHOR, 0)).toBe(new Date(ANCHOR).toISOString());
  });
});

describe('createSupabaseFetchNoticiasPage — cutoff real derivado del anchor, no de Date.now()', () => {
  let gteCalls: Array<{ col: string; val: string }>;

  beforeEach(() => {
    gteCalls = [];
    vi.doMock('../src/supabase/client.js', () => ({
      getSupabase: () => ({
        from: () => ({
          select: () => {
            const chain: Record<string, unknown> = {};
            chain.eq = () => chain;
            chain.order = () => chain;
            chain.range = () => chain;
            chain.gte = (col: string, val: string) => {
              gteCalls.push({ col, val });
              return chain;
            };
            chain.then = (resolve: (v: { data: unknown[]; error: null }) => void) =>
              resolve({ data: [], error: null });
            return chain;
          },
        }),
      }),
    }));
  });

  afterEach(() => {
    vi.doUnmock('../src/supabase/client.js');
    vi.resetModules();
  });

  it('2 (real). mismo windowAnchor produce el mismo cutoff real sin importar cuándo se invoque', async () => {
    const { createSupabaseFetchNoticiasPage } = await import('../src/mediaValidation/newsLakeSnapshot.js');
    const fetchPage = createSupabaseFetchNoticiasPage();

    const spy = vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-09-07T10:00:00.000Z').getTime());
    await fetchPage({ medioId: 'MED-A', windowDays: 30, windowAnchor: ANCHOR, offset: 0, pageSize: 1000 });

    spy.mockReturnValue(new Date('2026-09-07T10:20:00.000Z').getTime());
    await fetchPage({ medioId: 'MED-A', windowDays: 30, windowAnchor: ANCHOR, offset: 0, pageSize: 1000 });
    spy.mockRestore();

    expect(gteCalls).toHaveLength(2);
    expect(gteCalls[0]!.col).toBe('fecha_publicacion');
    expect(gteCalls[0]!.val).toBe(gteCalls[1]!.val); // mismo cutoff exacto pese a Date.now() distinto
  });
});
