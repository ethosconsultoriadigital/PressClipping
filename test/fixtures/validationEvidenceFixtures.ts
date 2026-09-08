/**
 * Fábricas mínimas de `MediaSnapshot`/`MediaPersistenceEvidence`/
 * `MediaValidationRecord`/`RunContext`/`RunValidationEvidence` (contratos de
 * Fase 1C) para tests de Fase 1D/1E. Complementan `runEvidenceFixtures.ts`
 * (Fase 1B) — Fase 1D/1E NO reabre 1B/1C, solo construye objetos con la
 * FORMA de sus contratos ya publicados.
 */
import type { MediaSnapshot } from '../../src/mediaValidation/newsLakeSnapshot.js';
import type { MediaDelta } from '../../src/mediaValidation/mediaDelta.js';
import type { MediaPersistenceEvidence, MediaValidationRecord, RunValidationEvidence } from '../../src/mediaValidation/runValidationEvidence.js';
import type { RunContext, ContextMatchResult } from '../../src/mediaValidation/runContext.js';
import { fakeMediaEvidence, fakeRunEvidence } from './runEvidenceFixtures.js';

export function fakeMediaSnapshot(medioId: string, overrides: Partial<MediaSnapshot> = {}): MediaSnapshot {
  return {
    medio_id: medioId,
    status: 'COMPLETE',
    total_news: 0,
    clean_text_count: 0,
    body_count: 0,
    pages_read: 1,
    duplicate_rows_skipped: 0,
    errors: [],
    consistency: 'STABLE_OBSERVED',
    ...overrides,
  };
}

export function fakeMediaDelta(medioId: string, overrides: Partial<MediaDelta> = {}): MediaDelta {
  return {
    medio_id: medioId,
    status: 'UNAVAILABLE',
    news_delta: null,
    clean_text_delta: null,
    body_delta: null,
    reason: 'fixture por defecto — sin delta calculado.',
    ...overrides,
  };
}

export function fakePersistenceEvidence(medioId: string, overrides: Partial<MediaPersistenceEvidence> = {}): MediaPersistenceEvidence {
  return {
    medio_id: medioId,
    status: 'UNVERIFIED',
    before: fakeMediaSnapshot(medioId),
    after: fakeMediaSnapshot(medioId),
    delta: fakeMediaDelta(medioId),
    reason: null,
    ...overrides,
  };
}

export function fakeMediaValidationRecord(medioId: string, overrides: Partial<MediaValidationRecord> = {}): MediaValidationRecord {
  return {
    medio_id: medioId,
    run_evidence: fakeMediaEvidence(medioId),
    persistence: fakePersistenceEvidence(medioId),
    reconciliation: [],
    ...overrides,
  };
}

export function fakeRunContext(overrides: Partial<RunContext> = {}): RunContext {
  return {
    context_id: 'CTX-TEST-0001',
    run_id: null,
    requested_media_ids: null,
    requested_media_ids_source: 'unavailable',
    requested_media_ids_coverage: 'UNKNOWN',
    dry_run: null,
    window_anchor: null,
    window_days: null,
    max_notas: null,
    enrich_limit: null,
    ...overrides,
  };
}

export function fakeContextMatchResult(overrides: Partial<ContextMatchResult> = {}): ContextMatchResult {
  return { status: 'MATCH', issues: [], ...overrides };
}

export function fakeRunValidationEvidence(overrides: Partial<RunValidationEvidence> = {}): RunValidationEvidence {
  return {
    schema_version: 1,
    context: fakeRunContext(),
    context_identity: fakeContextMatchResult(),
    media: [],
    unattributed_enrich: fakeRunEvidence().unattributed_enrich,
    warnings: [],
    ...overrides,
  };
}
