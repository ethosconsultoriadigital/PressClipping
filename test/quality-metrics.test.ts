import { describe, expect, it } from 'vitest';
import { computeMediaQualityMetrics, computeQualityMetricsForRun } from '../src/mediaValidation/qualityMetrics.js';
import { fakeCrawlEvidence, fakeEnrichEvidence, fakeMediaEvidence } from './fixtures/runEvidenceFixtures.js';
import {
  fakeMediaSnapshot,
  fakeMediaDelta,
  fakePersistenceEvidence,
  fakeMediaValidationRecord,
  fakeRunValidationEvidence,
} from './fixtures/validationEvidenceFixtures.js';

const CTX = { context_id: 'CTX-0001', context_identity: 'MATCH' as const };

describe('computeMediaQualityMetrics — Fase 1D', () => {
  it('1. persisted_clean_text_ratio correcto (after COMPLETE, denominador > 0)', () => {
    const record = fakeMediaValidationRecord('MED-1', {
      persistence: fakePersistenceEvidence('MED-1', {
        status: 'VERIFIED',
        after: fakeMediaSnapshot('MED-1', { status: 'COMPLETE', total_news: 10, clean_text_count: 7, body_count: 4 }),
      }),
    });
    const m = computeMediaQualityMetrics(record, CTX);
    expect(m.ratios.persisted_clean_text_ratio).toEqual({
      availability: 'AVAILABLE',
      value: 0.7,
      numerator: 7,
      denominator: 10,
      issue: null,
    });
  });

  it('2. persisted_body_ratio correcto', () => {
    const record = fakeMediaValidationRecord('MED-1', {
      persistence: fakePersistenceEvidence('MED-1', {
        after: fakeMediaSnapshot('MED-1', { status: 'COMPLETE', total_news: 8, clean_text_count: 8, body_count: 2 }),
      }),
    });
    const m = computeMediaQualityMetrics(record, CTX);
    expect(m.ratios.persisted_body_ratio.value).toBe(0.25);
    expect(m.ratios.persisted_body_ratio.availability).toBe('AVAILABLE');
  });

  it('3. total_news=0 → ratios NOT_APPLICABLE, nunca 0% fabricado', () => {
    const record = fakeMediaValidationRecord('MED-1', {
      persistence: fakePersistenceEvidence('MED-1', {
        after: fakeMediaSnapshot('MED-1', { status: 'COMPLETE', total_news: 0, clean_text_count: 0, body_count: 0 }),
      }),
    });
    const m = computeMediaQualityMetrics(record, CTX);
    expect(m.ratios.persisted_clean_text_ratio.availability).toBe('NOT_APPLICABLE');
    expect(m.ratios.persisted_clean_text_ratio.value).toBeNull();
    expect(m.ratios.persisted_clean_text_ratio.issue).toBe('ZERO_DENOMINATOR');
    expect(m.ratios.persisted_body_ratio.availability).toBe('NOT_APPLICABLE');
  });

  it('4. after snapshot no-COMPLETE (ERROR) → persisted ratios UNAVAILABLE, nunca 0', () => {
    const record = fakeMediaValidationRecord('MED-1', {
      persistence: fakePersistenceEvidence('MED-1', {
        status: 'INDETERMINATE',
        after: fakeMediaSnapshot('MED-1', { status: 'ERROR', total_news: null, clean_text_count: null, body_count: null }),
      }),
    });
    const m = computeMediaQualityMetrics(record, CTX);
    expect(m.ratios.persisted_clean_text_ratio.availability).toBe('UNAVAILABLE');
    expect(m.ratios.persisted_clean_text_ratio.value).toBeNull();
    expect(m.ratios.persisted_clean_text_ratio.issue).toBe('DENOMINATOR_UNAVAILABLE');
    expect(m.persisted.after_total_news).toBeNull();
  });

  it('5. persistence INDETERMINATE se refleja en gates.persistence_status', () => {
    const record = fakeMediaValidationRecord('MED-1', { persistence: fakePersistenceEvidence('MED-1', { status: 'INDETERMINATE' }) });
    const m = computeMediaQualityMetrics(record, CTX);
    expect(m.gates.persistence_status).toBe('INDETERMINATE');
  });

  it('6. run evidence PARTIAL se refleja en gates.run_evidence_status', () => {
    const record = fakeMediaValidationRecord('MED-1', { run_evidence: fakeMediaEvidence('MED-1', { evidence_status: 'PARTIAL' }) });
    const m = computeMediaQualityMetrics(record, CTX);
    expect(m.gates.run_evidence_status).toBe('PARTIAL');
  });

  it('7. run evidence MISSING se refleja en gates.run_evidence_status', () => {
    const record = fakeMediaValidationRecord('MED-1', { run_evidence: fakeMediaEvidence('MED-1', { evidence_status: 'MISSING' }) });
    const m = computeMediaQualityMetrics(record, CTX);
    expect(m.gates.run_evidence_status).toBe('MISSING');
  });

  it('8a. invalid evidence (crawl.invalid_event_count>0) → has_invalid_evidence=true', () => {
    const record = fakeMediaValidationRecord('MED-1', {
      run_evidence: fakeMediaEvidence('MED-1', { crawl: fakeCrawlEvidence({ invalid_event_count: 2 }) }),
    });
    const m = computeMediaQualityMetrics(record, CTX);
    expect(m.gates.has_invalid_evidence).toBe(true);
  });

  it('8b. unsupported_event_count>0 → has_unsupported_evidence=true', () => {
    const record = fakeMediaValidationRecord('MED-1', { run_evidence: fakeMediaEvidence('MED-1', { unsupported_event_count: 1 }) });
    const m = computeMediaQualityMetrics(record, CTX);
    expect(m.gates.has_unsupported_evidence).toBe(true);
  });

  it('8c. conflicto sin resolver (crawl.legacy_conflict) → has_unresolved_evidence_conflict=true', () => {
    const record = fakeMediaValidationRecord('MED-1', {
      run_evidence: fakeMediaEvidence('MED-1', { crawl: fakeCrawlEvidence({ legacy_conflict: true }) }),
    });
    const m = computeMediaQualityMetrics(record, CTX);
    expect(m.gates.has_unresolved_evidence_conflict).toBe(true);
  });

  it('8d. mixed_dry_run en enrich → has_unresolved_evidence_conflict=true', () => {
    const record = fakeMediaValidationRecord('MED-1', {
      run_evidence: fakeMediaEvidence('MED-1', { enrich: fakeEnrichEvidence({ mixed_dry_run: true }) }),
    });
    const m = computeMediaQualityMetrics(record, CTX);
    expect(m.gates.has_unresolved_evidence_conflict).toBe(true);
  });

  it('9. enrich.processed=0 → run_clean_text_ratio/run_body_ratio/enrich_failure_ratio NOT_APPLICABLE, nunca fabricados', () => {
    const record = fakeMediaValidationRecord('MED-1', {
      run_evidence: fakeMediaEvidence('MED-1', {
        enrich: fakeEnrichEvidence({
          presence: 'PRESENT',
          requested: true,
          processed: 0,
          updated: 0,
          unchanged: 0,
          failed: 0,
          clean_text_count: 0,
          body_count: 0,
          dry_run: false,
          content_persistence: 'UNVERIFIED',
          raw_summary_event_count: 1,
        }),
      }),
    });
    const m = computeMediaQualityMetrics(record, CTX);
    expect(m.ratios.run_clean_text_ratio.availability).toBe('NOT_APPLICABLE');
    expect(m.ratios.run_clean_text_ratio.issue).toBe('ZERO_DENOMINATOR');
    expect(m.ratios.run_body_ratio.availability).toBe('NOT_APPLICABLE');
    expect(m.ratios.enrich_failure_ratio.availability).toBe('NOT_APPLICABLE');
  });

  it('10. enrich_failure_ratio correcto y con matiz PERSISTENCE_NOT_VERIFIED en ratios de EJECUCIÓN', () => {
    const record = fakeMediaValidationRecord('MED-1', {
      run_evidence: fakeMediaEvidence('MED-1', {
        enrich: fakeEnrichEvidence({
          presence: 'PRESENT',
          requested: true,
          processed: 10,
          updated: 5,
          unchanged: 2,
          failed: 3,
          clean_text_count: 6,
          body_count: 4,
          dry_run: false,
          content_persistence: 'UNVERIFIED',
          raw_summary_event_count: 1,
        }),
      }),
    });
    const m = computeMediaQualityMetrics(record, CTX);
    expect(m.ratios.enrich_failure_ratio.value).toBe(0.3);
    expect(m.ratios.enrich_failure_ratio.availability).toBe('AVAILABLE');
    expect(m.ratios.run_clean_text_ratio.value).toBe(0.6);
    expect(m.ratios.run_clean_text_ratio.issue).toBe('PERSISTENCE_NOT_VERIFIED'); // matiz, no bloqueo (§14 del prompt de 1D)
    expect(m.ratios.run_body_ratio.value).toBe(0.4);
  });

  it('11. delta negativo se preserva sin corregirse a 0', () => {
    const record = fakeMediaValidationRecord('MED-1', {
      persistence: fakePersistenceEvidence('MED-1', {
        status: 'VERIFIED',
        delta: fakeMediaDelta('MED-1', { status: 'COMPUTED', news_delta: -3, clean_text_delta: -1, body_delta: 0, reason: null }),
      }),
    });
    const m = computeMediaQualityMetrics(record, CTX);
    expect(m.delta.status).toBe('COMPUTED');
    expect(m.delta.news_delta).toBe(-3);
    expect(m.delta.clean_text_delta).toBe(-1);
  });

  it('12. MED-A y MED-B se calculan de forma separada, sin contaminarse (batch)', () => {
    const evidence = fakeRunValidationEvidence({
      media: [
        fakeMediaValidationRecord('MED-A', {
          persistence: fakePersistenceEvidence('MED-A', { after: fakeMediaSnapshot('MED-A', { status: 'COMPLETE', total_news: 10, clean_text_count: 9, body_count: 9 }) }),
        }),
        fakeMediaValidationRecord('MED-B', {
          persistence: fakePersistenceEvidence('MED-B', { after: fakeMediaSnapshot('MED-B', { status: 'COMPLETE', total_news: 10, clean_text_count: 1, body_count: 0 }) }),
        }),
      ],
    });
    const [a, b] = computeQualityMetricsForRun(evidence);
    expect(a!.medio_id).toBe('MED-A');
    expect(a!.ratios.persisted_clean_text_ratio.value).toBe(0.9);
    expect(b!.medio_id).toBe('MED-B');
    expect(b!.ratios.persisted_clean_text_ratio.value).toBe(0.1);
  });

  it('13. source_method se preserva de crawl.source_method', () => {
    const record = fakeMediaValidationRecord('MED-1', {
      run_evidence: fakeMediaEvidence('MED-1', { crawl: fakeCrawlEvidence({ source_method: 'rss' }) }),
    });
    const m = computeMediaQualityMetrics(record, CTX);
    expect(m.source_method).toBe('rss');
  });

  it('14. dry_run se preserva de enrich.dry_run (incluyendo null)', () => {
    const recordTrue = fakeMediaValidationRecord('MED-1', {
      run_evidence: fakeMediaEvidence('MED-1', { enrich: fakeEnrichEvidence({ dry_run: true }) }),
    });
    const recordNull = fakeMediaValidationRecord('MED-2', {
      run_evidence: fakeMediaEvidence('MED-2', { enrich: fakeEnrichEvidence({ dry_run: null }) }),
    });
    expect(computeMediaQualityMetrics(recordTrue, CTX).evidence_snapshot.dry_run).toBe(true);
    expect(computeMediaQualityMetrics(recordNull, CTX).evidence_snapshot.dry_run).toBeNull();
  });

  it('15. mismo input → mismo output (determinismo)', () => {
    const record = fakeMediaValidationRecord('MED-1', {
      persistence: fakePersistenceEvidence('MED-1', { after: fakeMediaSnapshot('MED-1', { status: 'COMPLETE', total_news: 5, clean_text_count: 3, body_count: 2 }) }),
    });
    const m1 = computeMediaQualityMetrics(record, CTX);
    const m2 = computeMediaQualityMetrics(record, CTX);
    expect(m1).toEqual(m2);
  });

  it('context_id se propaga desde el parámetro de contexto, no se inventa', () => {
    const record = fakeMediaValidationRecord('MED-1');
    const m = computeMediaQualityMetrics(record, { context_id: 'CTX-CUSTOM', context_identity: 'MISMATCH' });
    expect(m.context_id).toBe('CTX-CUSTOM');
    expect(m.gates.context_identity).toBe('MISMATCH');
  });

  it('schema_version es 1', () => {
    const m = computeMediaQualityMetrics(fakeMediaValidationRecord('MED-1'), CTX);
    expect(m.schema_version).toBe(1);
  });
});
