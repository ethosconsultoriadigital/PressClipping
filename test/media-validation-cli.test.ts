/**
 * Tests deterministas para las funciones puras de parseo de argumentos de
 * los CLIs delgados de Fase 1C (Media Validation & Certification,
 * HARDENING FINAL — §49 del prompt: tests CLI mínimos, sin spawning).
 *
 * No se testea el proceso completo (I/O real de Supabase/filesystem) — solo
 * `parseArgs` de cada script, que es puro y determinista.
 */
import { describe, it, expect } from 'vitest';
import { parseArgs as parseSnapshotArgs } from '../scripts/media-validation-snapshot.js';
import { parseArgs as parseComposeArgs } from '../scripts/media-validation-compose.js';
import { validateSnapshotArtifact } from '../src/mediaValidation/artifactSchemas.js';
import { checkRunContextIdentity } from '../src/mediaValidation/runContext.js';
import { buildRunContextFromRunEvidence } from '../src/mediaValidation/runContext.js';
import { fakeRunEvidence, fakeMediaEvidence } from './fixtures/runEvidenceFixtures.js';
import type { SnapshotResult } from '../src/mediaValidation/newsLakeSnapshot.js';

describe('media-validation-snapshot — parseArgs', () => {
  it('parsea --context-id/--role/--medio-ids/--window-days/--window-anchor/--out', () => {
    const args = parseSnapshotArgs([
      '--context-id=VAL-1',
      '--role=before',
      '--medio-ids=MED-A,MED-B',
      '--window-days=30',
      '--window-anchor=2026-09-07T22:00:00.000Z',
      '--out=data/before.json',
    ]);
    expect(args.contextId).toBe('VAL-1');
    expect(args.role).toBe('BEFORE');
    expect(args.medioIds).toEqual(['MED-A', 'MED-B']);
    expect(args.windowDays).toBe(30);
    expect(args.windowAnchor).toBe('2026-09-07T22:00:00.000Z');
    expect(args.out).toBe('data/before.json');
  });

  it('--role=after (minúscula) se normaliza a "AFTER"', () => {
    expect(parseSnapshotArgs(['--role=after']).role).toBe('AFTER');
  });

  it('50. --role inválido ("during") produce role=null (rechazado aguas abajo por main())', () => {
    expect(parseSnapshotArgs(['--role=during']).role).toBeNull();
  });

  it('flags ausentes producen null/[] explícitos, nunca valores fabricados', () => {
    const args = parseSnapshotArgs([]);
    expect(args.contextId).toBeNull();
    expect(args.role).toBeNull();
    expect(args.medioIds).toEqual([]);
    expect(args.windowDays).toBeNull();
    expect(args.windowAnchor).toBeNull();
  });
});

describe('media-validation-compose — parseArgs', () => {
  it('parsea --run-log/--before/--after/--context-id/--window-anchor/--out', () => {
    const args = parseComposeArgs([
      '--run-log=data/run.log',
      '--before=data/before.json',
      '--after=data/after.json',
      '--context-id=VAL-1',
      '--medio-ids=MED-A,MED-B',
      '--window-days=30',
      '--window-anchor=2026-09-07T22:00:00.000Z',
      '--out=data/evidence.json',
    ]);
    expect(args.runLog).toBe('data/run.log');
    expect(args.before).toBe('data/before.json');
    expect(args.after).toBe('data/after.json');
    expect(args.contextId).toBe('VAL-1');
    expect(args.medioIds).toEqual(['MED-A', 'MED-B']);
    expect(args.windowAnchor).toBe('2026-09-07T22:00:00.000Z');
  });

  it('--medio-ids ausente produce undefined (distinto de [] — no se fabrica una lista vacía)', () => {
    expect(parseComposeArgs(['--run-log=x', '--before=y', '--after=z']).medioIds).toBeUndefined();
  });
});

describe('51. wrong role fails — snapshot_role incorrecto es detectado por validateSnapshotArtifact + checkRunContextIdentity', () => {
  function validSnapshot(role: 'BEFORE' | 'AFTER', overrides: Partial<SnapshotResult> = {}): SnapshotResult {
    return validateSnapshotArtifact({
      schema_version: 1,
      context_id: 'VAL-1',
      snapshot_role: role,
      window_anchor: '2026-09-07T22:00:00.000Z',
      window_days: 30,
      capture_started_at: '2026-09-07T22:00:00.000Z',
      capture_completed_at: '2026-09-07T22:05:00.000Z',
      requested_media_ids: ['MED-A'],
      media: [
        {
          medio_id: 'MED-A',
          status: 'COMPLETE',
          total_news: 1,
          clean_text_count: 1,
          body_count: 1,
          pages_read: 1,
          duplicate_rows_skipped: 0,
          errors: [],
          consistency: 'STABLE_OBSERVED',
        },
      ],
      ...overrides,
    });
  }

  it('artifact con snapshot_role="BEFORE" cargado como "after" es detectado por checkRunContextIdentity como MISMATCH', () => {
    const runEvidence = fakeRunEvidence({
      run: { run_id: null, requested_media_ids: ['MED-A'], requested_media_ids_source: 'explicit_input', requested_media_ids_coverage: 'COMPLETE' },
      media: [fakeMediaEvidence('MED-A')],
    });
    const context = buildRunContextFromRunEvidence(runEvidence, { contextId: 'VAL-1', windowAnchor: '2026-09-07T22:00:00.000Z', windowDays: 30 });

    const before = validSnapshot('BEFORE');
    const afterMisusedAsBeforeRole = validSnapshot('BEFORE'); // ambos son 'BEFORE' — swap real

    const result = checkRunContextIdentity({ context, before, after: afterMisusedAsBeforeRole });
    expect(result.status).toBe('MISMATCH');
    expect(result.issues.some((i) => i.includes('snapshot_role'))).toBe(true);
    void before;
  });
});

describe('52. context mismatch detected (helper puro, sin CLI)', () => {
  it('context_id distinto entre before y after es detectado', () => {
    const runEvidence = fakeRunEvidence({
      run: { run_id: null, requested_media_ids: ['MED-A'], requested_media_ids_source: 'explicit_input', requested_media_ids_coverage: 'COMPLETE' },
      media: [fakeMediaEvidence('MED-A')],
    });
    const context = buildRunContextFromRunEvidence(runEvidence, { contextId: 'VAL-1', windowAnchor: '2026-09-07T22:00:00.000Z', windowDays: 30 });

    const base = {
      schema_version: 1 as const,
      window_anchor: '2026-09-07T22:00:00.000Z',
      window_days: 30,
      requested_media_ids: ['MED-A'],
      media: [],
    };
    const before: SnapshotResult = { ...base, context_id: 'VAL-1', snapshot_role: 'BEFORE', capture_started_at: '2026-09-07T22:00:00.000Z', capture_completed_at: '2026-09-07T22:05:00.000Z' };
    const after: SnapshotResult = { ...base, context_id: 'VAL-2', snapshot_role: 'AFTER', capture_started_at: '2026-09-07T22:10:00.000Z', capture_completed_at: '2026-09-07T22:15:00.000Z' };

    expect(checkRunContextIdentity({ context, before, after }).status).toBe('MISMATCH');
  });
});

describe('53. schema mismatch detected', () => {
  it('schema_version desconocido (2) es rechazado por validateSnapshotArtifact antes de llegar a ningún CLI', () => {
    expect(() =>
      validateSnapshotArtifact({
        schema_version: 2,
        context_id: 'VAL-1',
        snapshot_role: 'BEFORE',
        window_anchor: null,
        window_days: null,
        capture_started_at: '2026-09-07T22:00:00.000Z',
        capture_completed_at: '2026-09-07T22:05:00.000Z',
        requested_media_ids: [],
        media: [],
      }),
    ).toThrow();
  });
});
