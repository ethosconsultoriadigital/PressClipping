/**
 * Tests deterministas para `src/mediaValidation/runContext.ts` (Media
 * Validation & Certification, Fase 1C + HARDENING FINAL: B2C/B4C/B1C).
 */
import { describe, it, expect } from 'vitest';
import {
  buildRunContextFromRunEvidence,
  deriveRunLevelDryRun,
  checkRunContextIdentity,
} from '../src/mediaValidation/runContext.js';
import { fakeRunEvidence, fakeMediaEvidence, fakeEnrichEvidence, fakeUnattributedEnrich } from './fixtures/runEvidenceFixtures.js';
import type { SnapshotResult, MediaSnapshot, SnapshotRole } from '../src/mediaValidation/newsLakeSnapshot.js';

const ANCHOR = '2026-09-07T22:00:00.000Z';

function snapOf(
  mediaIds: string[],
  overrides: Partial<Pick<SnapshotResult, 'window_days' | 'window_anchor' | 'context_id' | 'snapshot_role' | 'capture_started_at' | 'capture_completed_at'>> = {},
): SnapshotResult {
  const media: MediaSnapshot[] = mediaIds.map((id) => ({
    medio_id: id,
    status: 'COMPLETE',
    total_news: 0,
    clean_text_count: 0,
    body_count: 0,
    pages_read: 1,
    duplicate_rows_skipped: 0,
    errors: [],
    consistency: 'STABLE_OBSERVED',
  }));
  return {
    schema_version: 1,
    context_id: 'VAL-TEST-001',
    snapshot_role: 'BEFORE',
    window_anchor: ANCHOR,
    window_days: 30,
    capture_started_at: '2026-09-07T22:00:00.000Z',
    capture_completed_at: '2026-09-07T22:05:00.000Z',
    requested_media_ids: mediaIds,
    media,
    ...overrides,
  };
}

function baseCtxOpts(overrides: Partial<{ contextId: string; windowAnchor: string | null; windowDays: number | null }> = {}) {
  return { contextId: 'VAL-TEST-001', windowAnchor: ANCHOR, windowDays: 30, ...overrides };
}

describe('buildRunContextFromRunEvidence — Fase 1C', () => {
  it('21. run_id se preserva sin modificación', () => {
    const ctx = buildRunContextFromRunEvidence(
      fakeRunEvidence({ run: { run_id: 'gh-run-12345', requested_media_ids: [], requested_media_ids_source: 'explicit_input', requested_media_ids_coverage: 'COMPLETE' } }),
      baseCtxOpts(),
    );
    expect(ctx.run_id).toBe('gh-run-12345');
  });

  it('22. requested_media_ids (universo solicitado) se preserva', () => {
    const ctx = buildRunContextFromRunEvidence(
      fakeRunEvidence({ run: { run_id: null, requested_media_ids: ['MED-A', 'MED-B'], requested_media_ids_source: 'explicit_input', requested_media_ids_coverage: 'COMPLETE' } }),
      baseCtxOpts(),
    );
    expect(ctx.requested_media_ids).toEqual(['MED-A', 'MED-B']);
  });

  it('6. requested_media_ids=null permanece null (B2C — no se colapsa con ?? [])', () => {
    const ctx = buildRunContextFromRunEvidence(
      fakeRunEvidence({ run: { run_id: null, requested_media_ids: null, requested_media_ids_source: 'unavailable', requested_media_ids_coverage: 'UNKNOWN' } }),
      baseCtxOpts(),
    );
    expect(ctx.requested_media_ids).toBeNull();
  });

  it('7. requested_media_ids=[] permanece [] (universo explícitamente vacío, distinto de null)', () => {
    const ctx = buildRunContextFromRunEvidence(
      fakeRunEvidence({ run: { run_id: null, requested_media_ids: [], requested_media_ids_source: 'explicit_input', requested_media_ids_coverage: 'COMPLETE' } }),
      baseCtxOpts(),
    );
    expect(ctx.requested_media_ids).toEqual([]);
    expect(ctx.requested_media_ids).not.toBeNull();
  });

  it('9. coverage UNKNOWN se conserva', () => {
    const ctx = buildRunContextFromRunEvidence(
      fakeRunEvidence({ run: { run_id: null, requested_media_ids: null, requested_media_ids_source: 'unavailable', requested_media_ids_coverage: 'UNKNOWN' } }),
      baseCtxOpts(),
    );
    expect(ctx.requested_media_ids_coverage).toBe('UNKNOWN');
  });

  it('10/23. coverage PARTIAL se conserva (subconjunto conocido no se convierte en cobertura total)', () => {
    const ctx = buildRunContextFromRunEvidence(
      fakeRunEvidence({ run: { run_id: null, requested_media_ids: ['MED-A'], requested_media_ids_source: 'chunk_plan_logs', requested_media_ids_coverage: 'PARTIAL' } }),
      baseCtxOpts(),
    );
    expect(ctx.requested_media_ids_coverage).toBe('PARTIAL');
    expect(ctx.requested_media_ids_source).toBe('chunk_plan_logs');
  });

  it('24. parámetros operativos explícitos (window_days/max_notas/enrich_limit) se preservan solo si se pasan', () => {
    const ctx1 = buildRunContextFromRunEvidence(fakeRunEvidence(), { ...baseCtxOpts(), maxNotas: 5, enrichLimit: 20 });
    expect(ctx1.window_days).toBe(30);
    expect(ctx1.max_notas).toBe(5);
    expect(ctx1.enrich_limit).toBe(20);

    const ctx2 = buildRunContextFromRunEvidence(fakeRunEvidence(), { contextId: 'VAL-TEST-001', windowAnchor: null });
    expect(ctx2.window_days).toBeNull();
    expect(ctx2.max_notas).toBeNull();
    expect(ctx2.enrich_limit).toBeNull();
  });

  it('B4C: contextId vacío lanza (identidad obligatoria)', () => {
    expect(() => buildRunContextFromRunEvidence(fakeRunEvidence(), { contextId: '', windowAnchor: null })).toThrow(/contextId/);
  });

  it('B1C: windowAnchor malformado lanza', () => {
    expect(() => buildRunContextFromRunEvidence(fakeRunEvidence(), { contextId: 'VAL-1', windowAnchor: 'foo' })).toThrow();
  });

  it('B1C: windowDays activo sin windowAnchor lanza (nunca se inventa)', () => {
    expect(() =>
      buildRunContextFromRunEvidence(fakeRunEvidence(), { contextId: 'VAL-1', windowAnchor: null, windowDays: 30 }),
    ).toThrow(/windowAnchor/);
  });
});

describe('deriveRunLevelDryRun — Fase 1C', () => {
  it('todos los medios con dry_run=true consistente → true', () => {
    const run = fakeRunEvidence({
      media: [
        fakeMediaEvidence('MED-A', { enrich: fakeEnrichEvidence({ dry_run: true, presence: 'PRESENT' }) }),
        fakeMediaEvidence('MED-B', { enrich: fakeEnrichEvidence({ dry_run: true, presence: 'PRESENT' }) }),
      ],
    });
    expect(deriveRunLevelDryRun(run)).toBe(true);
  });

  it('sin ningún dry_run observado → null (desconocido, no se asume false)', () => {
    const run = fakeRunEvidence({ media: [fakeMediaEvidence('MED-A')] });
    expect(deriveRunLevelDryRun(run)).toBeNull();
  });

  it('valores contradictorios entre medios (true y false) → null (nunca se elige uno)', () => {
    const run = fakeRunEvidence({
      media: [
        fakeMediaEvidence('MED-A', { enrich: fakeEnrichEvidence({ dry_run: true, presence: 'PRESENT' }) }),
        fakeMediaEvidence('MED-B', { enrich: fakeEnrichEvidence({ dry_run: false, presence: 'PRESENT' }) }),
      ],
    });
    expect(deriveRunLevelDryRun(run)).toBeNull();
  });

  it('unattributed_enrich.dry_run participa en la derivación', () => {
    const run = fakeRunEvidence({
      media: [fakeMediaEvidence('MED-A', { enrich: fakeEnrichEvidence({ dry_run: false, presence: 'PRESENT' }) })],
      unattributed_enrich: fakeUnattributedEnrich({ dry_run: true }),
    });
    expect(deriveRunLevelDryRun(run)).toBeNull();
  });
});

describe('checkRunContextIdentity — Fase 1C HARDENING FINAL (§26-28)', () => {
  function ctxFor(mediaIds: string[] | null, opts: Partial<{ windowDays: number | null; windowAnchor: string | null; contextId: string }> = {}) {
    const runEvidence = fakeRunEvidence({
      run: {
        run_id: null,
        requested_media_ids: mediaIds,
        requested_media_ids_source: mediaIds === null ? 'unavailable' : 'explicit_input',
        requested_media_ids_coverage: mediaIds === null ? 'UNKNOWN' : 'COMPLETE',
      },
    });
    return buildRunContextFromRunEvidence(runEvidence, {
      contextId: opts.contextId ?? 'VAL-TEST-001',
      windowAnchor: opts.windowAnchor ?? ANCHOR,
      windowDays: opts.windowDays ?? 30,
    });
  }

  it('caso feliz: mismo context_id/roles/universo/window → MATCH', () => {
    const ctx = ctxFor(['MED-A', 'MED-B']);
    const before = snapOf(['MED-A', 'MED-B'], { snapshot_role: 'BEFORE' });
    const after = snapOf(['MED-A', 'MED-B'], {
      snapshot_role: 'AFTER',
      capture_started_at: '2026-09-07T22:10:00.000Z',
      capture_completed_at: '2026-09-07T22:15:00.000Z',
    });
    const result = checkRunContextIdentity({ context: ctx, before, after });
    expect(result.status).toBe('MATCH');
    expect(result.issues).toEqual([]);
  });

  it('25. context mismatch detectado si before/after corresponden a universos de medio_id distintos', () => {
    const ctx = ctxFor(['MED-A', 'MED-B']);
    const before = snapOf(['MED-A', 'MED-B'], { snapshot_role: 'BEFORE' });
    const after = snapOf(['MED-A', 'MED-C'], { snapshot_role: 'AFTER', capture_started_at: '2026-09-07T22:10:00.000Z', capture_completed_at: '2026-09-07T22:15:00.000Z' });
    const result = checkRunContextIdentity({ context: ctx, before, after });
    expect(result.status).toBe('MISMATCH');
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('26. mismo universo en distinto orden NO crea mismatch (comparación por conjunto)', () => {
    const ctx = ctxFor(['MED-A', 'MED-B']);
    const before = snapOf(['MED-A', 'MED-B'], { snapshot_role: 'BEFORE' });
    const after = snapOf(['MED-B', 'MED-A'], { snapshot_role: 'AFTER', capture_started_at: '2026-09-07T22:10:00.000Z', capture_completed_at: '2026-09-07T22:15:00.000Z' });
    const result = checkRunContextIdentity({ context: ctx, before, after });
    expect(result.status).toBe('MATCH');
  });

  it('8. universo desconocido (context null) con before/after concretos → NO MATCH pleno (universo desconocido != vacío)', () => {
    const ctx = ctxFor(null);
    const before = snapOf([], { snapshot_role: 'BEFORE' });
    const after = snapOf([], { snapshot_role: 'AFTER', capture_started_at: '2026-09-07T22:10:00.000Z', capture_completed_at: '2026-09-07T22:15:00.000Z' });
    const result = checkRunContextIdentity({ context: ctx, before, after });
    expect(result.status).toBe('MISMATCH');
    expect(result.issues.some((i) => i.includes('desconocido'))).toBe(true);
  });

  it('window_days distinto entre before y after → MISMATCH', () => {
    const ctx = ctxFor(['MED-A']);
    const before = snapOf(['MED-A'], { snapshot_role: 'BEFORE', window_days: 30 });
    const after = snapOf(['MED-A'], { snapshot_role: 'AFTER', window_days: 7, capture_started_at: '2026-09-07T22:10:00.000Z', capture_completed_at: '2026-09-07T22:15:00.000Z' });
    const result = checkRunContextIdentity({ context: ctx, before, after });
    expect(result.status).toBe('MISMATCH');
    expect(result.issues.some((i) => i.includes('window_days'))).toBe(true);
  });

  it('3/27. anchors diferentes entre before y after → MISMATCH', () => {
    const ctx = ctxFor(['MED-A']);
    const before = snapOf(['MED-A'], { snapshot_role: 'BEFORE', window_anchor: ANCHOR });
    const after = snapOf(['MED-A'], {
      snapshot_role: 'AFTER',
      window_anchor: '2026-09-08T22:00:00.000Z',
      capture_started_at: '2026-09-07T22:10:00.000Z',
      capture_completed_at: '2026-09-07T22:15:00.000Z',
    });
    const result = checkRunContextIdentity({ context: ctx, before, after });
    expect(result.status).toBe('MISMATCH');
    expect(result.issues.some((i) => i.includes('window_anchor'))).toBe(true);
  });

  it('5. mismo window_days sin anchor compartido (before/after con distinto anchor) no puede declararse identidad plena', () => {
    const ctx = ctxFor(['MED-A'], { windowAnchor: ANCHOR });
    const before = snapOf(['MED-A'], { snapshot_role: 'BEFORE', window_anchor: ANCHOR });
    const after = snapOf(['MED-A'], {
      snapshot_role: 'AFTER',
      window_anchor: '2099-01-01T00:00:00.000Z',
      capture_started_at: '2026-09-07T22:10:00.000Z',
      capture_completed_at: '2026-09-07T22:15:00.000Z',
    });
    expect(checkRunContextIdentity({ context: ctx, before, after }).status).toBe('MISMATCH');
  });

  it('11/27. mismo universo/window pero context_id distinto → MISMATCH', () => {
    const ctx = ctxFor(['MED-A'], { contextId: 'VAL-A' });
    const before = snapOf(['MED-A'], { snapshot_role: 'BEFORE', context_id: 'VAL-A' });
    const after = snapOf(['MED-A'], {
      snapshot_role: 'AFTER',
      context_id: 'VAL-B', // ¡run distinto!
      capture_started_at: '2026-09-07T22:10:00.000Z',
      capture_completed_at: '2026-09-07T22:15:00.000Z',
    });
    const result = checkRunContextIdentity({ context: ctx, before, after });
    expect(result.status).toBe('MISMATCH');
    expect(result.issues.some((i) => i.includes('context_id'))).toBe(true);
  });

  it('12/14. mismo context_id en los tres → puede MATCH; contexto distinto nunca produce VERIFIED (ver run-validation-evidence)', () => {
    const ctx = ctxFor(['MED-A'], { contextId: 'VAL-A' });
    const before = snapOf(['MED-A'], { snapshot_role: 'BEFORE', context_id: 'VAL-A' });
    const after = snapOf(['MED-A'], { snapshot_role: 'AFTER', context_id: 'VAL-A', capture_started_at: '2026-09-07T22:10:00.000Z', capture_completed_at: '2026-09-07T22:15:00.000Z' });
    expect(checkRunContextIdentity({ context: ctx, before, after }).status).toBe('MATCH');
  });

  it('13. context_id vacío en el propio RunContext → MISMATCH explícito (no se ignora)', () => {
    const ctx = ctxFor(['MED-A'], { contextId: 'VAL-A' });
    const brokenCtx = { ...ctx, context_id: '' };
    const before = snapOf(['MED-A'], { snapshot_role: 'BEFORE', context_id: 'VAL-A' });
    const after = snapOf(['MED-A'], { snapshot_role: 'AFTER', context_id: 'VAL-A', capture_started_at: '2026-09-07T22:10:00.000Z', capture_completed_at: '2026-09-07T22:15:00.000Z' });
    const result = checkRunContextIdentity({ context: brokenCtx, before, after });
    expect(result.status).toBe('MISMATCH');
  });

  it('16. roles swapped (before con role AFTER, after con role BEFORE) → MISMATCH', () => {
    const ctx = ctxFor(['MED-A']);
    const before = snapOf(['MED-A'], { snapshot_role: 'AFTER' }); // ¡intercambiado!
    const after = snapOf(['MED-A'], { snapshot_role: 'BEFORE', capture_started_at: '2026-09-07T22:10:00.000Z', capture_completed_at: '2026-09-07T22:15:00.000Z' });
    const result = checkRunContextIdentity({ context: ctx, before, after });
    expect(result.status).toBe('MISMATCH');
    expect(result.issues.some((i) => i.includes('snapshot_role'))).toBe(true);
  });

  it('15. BEFORE en el slot before + AFTER en el slot after (roles correctos) → sin issues de rol', () => {
    const ctx = ctxFor(['MED-A']);
    const before = snapOf(['MED-A'], { snapshot_role: 'BEFORE' });
    const after = snapOf(['MED-A'], { snapshot_role: 'AFTER', capture_started_at: '2026-09-07T22:10:00.000Z', capture_completed_at: '2026-09-07T22:15:00.000Z' });
    const result = checkRunContextIdentity({ context: ctx, before, after });
    expect(result.issues.filter((i) => i.includes('snapshot_role'))).toEqual([]);
  });

  it('17. after comienza ANTES de que before termine → MISMATCH (orden temporal inválido)', () => {
    const ctx = ctxFor(['MED-A']);
    const before = snapOf(['MED-A'], {
      snapshot_role: 'BEFORE',
      capture_started_at: '2026-09-07T22:00:00.000Z',
      capture_completed_at: '2026-09-07T22:20:00.000Z',
    });
    const after = snapOf(['MED-A'], {
      snapshot_role: 'AFTER',
      capture_started_at: '2026-09-07T22:10:00.000Z', // ¡antes de que before terminara!
      capture_completed_at: '2026-09-07T22:30:00.000Z',
    });
    const result = checkRunContextIdentity({ context: ctx, before, after });
    expect(result.status).toBe('MISMATCH');
    expect(result.issues.some((i) => i.includes('antes') || i.includes('posterior'))).toBe(true);
  });

  it('universo de before/after coincide entre sí pero no con context.requested_media_ids → MISMATCH', () => {
    const ctx = ctxFor(['MED-A']);
    const before = snapOf(['MED-Z'], { snapshot_role: 'BEFORE' });
    const after = snapOf(['MED-Z'], { snapshot_role: 'AFTER', capture_started_at: '2026-09-07T22:10:00.000Z', capture_completed_at: '2026-09-07T22:15:00.000Z' });
    expect(checkRunContextIdentity({ context: ctx, before, after }).status).toBe('MISMATCH');
  });
});
