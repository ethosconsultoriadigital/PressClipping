/**
 * Tests deterministas para `src/mediaValidation/mediaDelta.ts` (Media
 * Validation & Certification, Fase 1C). Cubre exactamente los casos
 * obligatorios del prompt §32 (delta).
 */
import { describe, it, expect } from 'vitest';
import { computeMediaDelta, computeAllMediaDeltas } from '../src/mediaValidation/mediaDelta.js';
import type { MediaSnapshot, SnapshotResult } from '../src/mediaValidation/newsLakeSnapshot.js';

function complete(medioId: string, total: number, clean: number, body: number): MediaSnapshot {
  return {
    medio_id: medioId,
    status: 'COMPLETE',
    total_news: total,
    clean_text_count: clean,
    body_count: body,
    pages_read: 1,
    duplicate_rows_skipped: 0,
    errors: [],
    consistency: 'STABLE_OBSERVED',
  };
}

function failed(medioId: string, status: 'ERROR' | 'PARTIAL' | 'UNKNOWN'): MediaSnapshot {
  return {
    medio_id: medioId,
    status,
    total_news: null,
    clean_text_count: null,
    body_count: null,
    pages_read: status === 'PARTIAL' ? 1 : 0,
    duplicate_rows_skipped: 0,
    errors: status === 'UNKNOWN' ? [] : ['boom'],
    consistency: 'UNKNOWN',
  };
}

function snapshotOf(media: MediaSnapshot[], windowDays: number | null = 30): SnapshotResult {
  return {
    schema_version: 1,
    context_id: 'VAL-TEST-001',
    snapshot_role: 'BEFORE',
    window_anchor: windowDays === null ? null : '2026-09-07T22:00:00.000Z',
    window_days: windowDays,
    capture_started_at: new Date().toISOString(),
    capture_completed_at: new Date().toISOString(),
    requested_media_ids: media.map((m) => m.medio_id),
    media,
  };
}

describe('computeMediaDelta — Fase 1C', () => {
  it('13. 0 → 3 noticias produce delta +3', () => {
    const d = computeMediaDelta(complete('MED-A', 0, 0, 0), complete('MED-A', 3, 3, 3));
    expect(d.status).toBe('COMPUTED');
    expect(d.news_delta).toBe(3);
    expect(d.clean_text_delta).toBe(3);
    expect(d.body_delta).toBe(3);
  });

  it('14. 5 → 5 produce delta 0', () => {
    const d = computeMediaDelta(complete('MED-A', 5, 5, 5), complete('MED-A', 5, 5, 5));
    expect(d.news_delta).toBe(0);
    expect(d.clean_text_delta).toBe(0);
    expect(d.body_delta).toBe(0);
  });

  it('15. 5 → 3 produce delta -2 (negativo, NO se corrige a cero)', () => {
    const d = computeMediaDelta(complete('MED-A', 5, 5, 5), complete('MED-A', 3, 3, 3));
    expect(d.status).toBe('COMPUTED');
    expect(d.news_delta).toBe(-2);
    expect(d.clean_text_delta).toBe(-2);
    expect(d.body_delta).toBe(-2);
  });

  it('16. clean_text_delta y body_delta son independientes entre sí', () => {
    const d = computeMediaDelta(complete('MED-A', 2, 1, 0), complete('MED-A', 5, 1, 4));
    expect(d.news_delta).toBe(3);
    expect(d.clean_text_delta).toBe(0);
    expect(d.body_delta).toBe(4);
  });

  it('17. before ERROR → delta null, con razón explícita', () => {
    const d = computeMediaDelta(failed('MED-A', 'ERROR'), complete('MED-A', 3, 3, 3));
    expect(d.status).toBe('UNAVAILABLE');
    expect(d.news_delta).toBeNull();
    expect(d.clean_text_delta).toBeNull();
    expect(d.body_delta).toBeNull();
    expect(d.reason).toContain('ERROR');
  });

  it('18. after ERROR → delta null', () => {
    const d = computeMediaDelta(complete('MED-A', 3, 3, 3), failed('MED-A', 'ERROR'));
    expect(d.status).toBe('UNAVAILABLE');
    expect(d.news_delta).toBeNull();
  });

  it('19. snapshot PARTIAL (before o after) → no se inventa un delta', () => {
    const d1 = computeMediaDelta(failed('MED-A', 'PARTIAL'), complete('MED-A', 3, 3, 3));
    const d2 = computeMediaDelta(complete('MED-A', 3, 3, 3), failed('MED-A', 'PARTIAL'));
    expect(d1.status).toBe('UNAVAILABLE');
    expect(d2.status).toBe('UNAVAILABLE');
  });

  it('lanza si medio_id no coincide entre before y after (error de programación del llamador)', () => {
    expect(() => computeMediaDelta(complete('MED-A', 1, 1, 1), complete('MED-B', 1, 1, 1))).toThrow();
  });

  it('20. MED-A y MED-B no se mezclan al calcular deltas en batch', () => {
    const before = snapshotOf([complete('MED-A', 1, 1, 1), complete('MED-B', 10, 10, 10)]);
    const after = snapshotOf([complete('MED-A', 4, 1, 1), complete('MED-B', 5, 10, 10)]);
    const deltas = computeAllMediaDeltas(before, after);
    const a = deltas.find((d) => d.medio_id === 'MED-A')!;
    const b = deltas.find((d) => d.medio_id === 'MED-B')!;
    expect(a.news_delta).toBe(3);
    expect(b.news_delta).toBe(-5);
  });

  it('computeAllMediaDeltas: medio ausente en "after" produce UNAVAILABLE explícito, no se omite silenciosamente', () => {
    const before = snapshotOf([complete('MED-A', 1, 1, 1)]);
    const after = snapshotOf([]);
    const deltas = computeAllMediaDeltas(before, after);
    expect(deltas).toHaveLength(1);
    expect(deltas[0]!.status).toBe('UNAVAILABLE');
    expect(deltas[0]!.reason).toContain('MED-A');
  });
});
