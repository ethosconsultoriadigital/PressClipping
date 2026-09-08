/**
 * Tests deterministas para `src/mediaValidation/artifactSchemas.ts` (Media
 * Validation & Certification, Fase 1C HARDENING FINAL — B3C: validación
 * runtime de artifacts JSON que cruzan el filesystem).
 *
 * Cubre §45 del prompt de hardening (items 20-28).
 */
import { describe, it, expect } from 'vitest';
import { validateSnapshotArtifact } from '../src/mediaValidation/artifactSchemas.js';

function validMediaSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    medio_id: 'MED-A',
    status: 'COMPLETE',
    total_news: 3,
    clean_text_count: 2,
    body_count: 1,
    pages_read: 1,
    duplicate_rows_skipped: 0,
    errors: [],
    consistency: 'STABLE_OBSERVED',
    ...overrides,
  };
}

function validArtifact(overrides: Record<string, unknown> = {}, mediaOverrides: Record<string, unknown>[] = [validMediaSnapshot()]) {
  return {
    schema_version: 1,
    context_id: 'VAL-TEST-001',
    snapshot_role: 'BEFORE',
    window_anchor: '2026-09-07T22:00:00.000Z',
    window_days: 30,
    capture_started_at: '2026-09-07T22:00:00.000Z',
    capture_completed_at: '2026-09-07T22:05:00.000Z',
    requested_media_ids: ['MED-A'],
    media: mediaOverrides,
    ...overrides,
  };
}

describe('validateSnapshotArtifact — B3C', () => {
  it('28. artifact V1 válido se acepta sin cambios', () => {
    const artifact = validArtifact();
    const result = validateSnapshotArtifact(artifact);
    expect(result).toEqual(artifact);
  });

  it('20. status=COMPLETE + total_news=null → reject', () => {
    expect(() => validateSnapshotArtifact(validArtifact({}, [validMediaSnapshot({ total_news: null })]))).toThrow();
  });

  it('21. status=COMPLETE + total_news negativo → reject', () => {
    expect(() => validateSnapshotArtifact(validArtifact({}, [validMediaSnapshot({ total_news: -1 })]))).toThrow();
  });

  it('22. status=COMPLETE + clean_text_count=null → reject', () => {
    expect(() => validateSnapshotArtifact(validArtifact({}, [validMediaSnapshot({ clean_text_count: null })]))).toThrow();
  });

  it('23. status=COMPLETE + body_count como string → reject', () => {
    expect(() => validateSnapshotArtifact(validArtifact({}, [validMediaSnapshot({ body_count: '1' })]))).toThrow();
  });

  it('24. medio_id en blanco ("   ") → reject', () => {
    expect(() => validateSnapshotArtifact(validArtifact({}, [validMediaSnapshot({ medio_id: '   ' })]))).toThrow();
  });

  it('24b. medio_id vacío ("") → reject', () => {
    expect(() => validateSnapshotArtifact(validArtifact({}, [validMediaSnapshot({ medio_id: '' })]))).toThrow();
  });

  it('25. requested_media_ids como string suelto (no array) → reject', () => {
    expect(() => validateSnapshotArtifact(validArtifact({ requested_media_ids: 'MED-A' }))).toThrow();
  });

  it('26. status inválido (no en el enum) → reject', () => {
    expect(() => validateSnapshotArtifact(validArtifact({}, [validMediaSnapshot({ status: 'DONE' })]))).toThrow();
  });

  it('27. schema_version=2 (futuro/desconocido) → reject, nunca reinterpretar silenciosamente', () => {
    expect(() => validateSnapshotArtifact(validArtifact({ schema_version: 2 }))).toThrow();
  });

  it('snapshot_role inválido → reject', () => {
    expect(() => validateSnapshotArtifact(validArtifact({ snapshot_role: 'DURING' }))).toThrow();
  });

  it('context_id vacío → reject', () => {
    expect(() => validateSnapshotArtifact(validArtifact({ context_id: '' }))).toThrow();
  });

  it('context_id de solo espacios → reject', () => {
    expect(() => validateSnapshotArtifact(validArtifact({ context_id: '   ' }))).toThrow();
  });

  it('window_anchor inválido ("foo") → reject', () => {
    expect(() => validateSnapshotArtifact(validArtifact({ window_anchor: 'foo' }))).toThrow();
  });

  it('window_days activo (no null) pero window_anchor=null → reject (B1C)', () => {
    expect(() => validateSnapshotArtifact(validArtifact({ window_days: 30, window_anchor: null }))).toThrow();
  });

  it('capture_started_at posterior a capture_completed_at → reject', () => {
    expect(() =>
      validateSnapshotArtifact(
        validArtifact({ capture_started_at: '2026-09-07T23:00:00.000Z', capture_completed_at: '2026-09-07T22:00:00.000Z' }),
      ),
    ).toThrow();
  });

  it('status != COMPLETE con contadores no-null → reject (contadores solo válidos si COMPLETE)', () => {
    expect(() =>
      validateSnapshotArtifact(validArtifact({}, [validMediaSnapshot({ status: 'ERROR', total_news: 0 })])),
    ).toThrow();
  });

  it('status=ERROR con contadores null y consistency=UNKNOWN → acepta (forma correcta)', () => {
    const artifact = validArtifact(
      {},
      [
        {
          medio_id: 'MED-A',
          status: 'ERROR',
          total_news: null,
          clean_text_count: null,
          body_count: null,
          pages_read: 0,
          duplicate_rows_skipped: 0,
          errors: ['boom'],
          consistency: 'UNKNOWN',
        },
      ],
    );
    expect(() => validateSnapshotArtifact(artifact)).not.toThrow();
  });

  it('clean_text_count > total_news → reject (relación garantizada violada)', () => {
    expect(() =>
      validateSnapshotArtifact(validArtifact({}, [validMediaSnapshot({ total_news: 1, clean_text_count: 5, body_count: 0 })])),
    ).toThrow();
  });

  it('body_count > total_news → reject', () => {
    expect(() =>
      validateSnapshotArtifact(validArtifact({}, [validMediaSnapshot({ total_news: 1, clean_text_count: 0, body_count: 5 })])),
    ).toThrow();
  });

  it('pages_read/duplicate_rows_skipped fraccionarios o negativos → reject', () => {
    expect(() => validateSnapshotArtifact(validArtifact({}, [validMediaSnapshot({ pages_read: 1.5 })]))).toThrow();
    expect(() => validateSnapshotArtifact(validArtifact({}, [validMediaSnapshot({ duplicate_rows_skipped: -1 })]))).toThrow();
  });

  it('consistency inválido → reject', () => {
    expect(() => validateSnapshotArtifact(validArtifact({}, [validMediaSnapshot({ consistency: 'MAYBE' })]))).toThrow();
  });

  it('el mensaje de error lista TODAS las violaciones (no solo la primera)', () => {
    try {
      validateSnapshotArtifact(validArtifact({ context_id: '' }, [validMediaSnapshot({ medio_id: '' })]));
      expect.fail('debía lanzar');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).toMatch(/context_id/);
      expect(msg).toMatch(/medio_id/);
    }
  });

  it('objeto completamente ajeno (no relacionado) → reject con mensaje legible', () => {
    expect(() => validateSnapshotArtifact({ foo: 'bar' })).toThrow();
  });

  it('null/undefined como input → reject', () => {
    expect(() => validateSnapshotArtifact(null)).toThrow();
    expect(() => validateSnapshotArtifact(undefined)).toThrow();
  });
});
