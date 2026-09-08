/**
 * Hardening focal (B1DE — "CONTAMINATED CALIBRATION" / B3DE — "DUPLICATE
 * OBSERVATIONS"): tests exactos de las secciones 45-47 del prompt de
 * hardening. Verifican que evidencia NO confiable (hard gates incumplidos)
 * jamás participe en `metric_distributions`/`candidate_thresholds`, que
 * quede visible en `excluded_observations`, y que observaciones duplicadas
 * `(context_id, medio_id)` se rechacen — nunca se pesen dos veces.
 */
import { describe, expect, it } from 'vitest';
import { buildCalibrationReport, type LabeledObservation } from '../src/mediaValidation/calibration.js';
import { computeCalibrationEligibility } from '../src/mediaValidation/calibrationEligibility.js';
import { computeMediaQualityMetrics } from '../src/mediaValidation/qualityMetrics.js';
import { fakeCrawlEvidence, fakeEnrichEvidence, fakeMediaEvidence } from './fixtures/runEvidenceFixtures.js';
import { fakeMediaSnapshot, fakeMediaValidationRecord, fakePersistenceEvidence } from './fixtures/validationEvidenceFixtures.js';
import type { ReferenceLabel } from '../src/mediaValidation/referenceLabels.js';
import type { ContextMatchStatus } from '../src/mediaValidation/runContext.js';

interface ObsOverrides {
  contextIdentity?: ContextMatchStatus;
  persistenceStatus?: 'VERIFIED' | 'UNVERIFIED' | 'INDETERMINATE';
  evidenceStatus?: 'COMPLETE' | 'PARTIAL' | 'MISSING';
  invalidEventCount?: number;
  unsupportedEventCount?: number;
  ambiguousTerminalEvents?: boolean;
  totalNews?: number;
  cleanCount?: number;
}

/** Observación con `persisted_clean_text_ratio = cleanCount/totalNews` y gates controlados explícitamente. */
function makeObs(medioId: string, contextId: string, label: ReferenceLabel, overrides: ObsOverrides = {}): LabeledObservation {
  const {
    contextIdentity = 'MATCH',
    persistenceStatus = 'VERIFIED',
    evidenceStatus = 'COMPLETE',
    invalidEventCount = 0,
    unsupportedEventCount = 0,
    ambiguousTerminalEvents = false,
    totalNews = 10,
    cleanCount = 9,
  } = overrides;

  const record = fakeMediaValidationRecord(medioId, {
    run_evidence: fakeMediaEvidence(medioId, {
      evidence_status: evidenceStatus,
      unsupported_event_count: unsupportedEventCount,
      crawl: fakeCrawlEvidence({ invalid_event_count: invalidEventCount, ambiguous_terminal_events: ambiguousTerminalEvents }),
      enrich: fakeEnrichEvidence(),
    }),
    persistence: fakePersistenceEvidence(medioId, {
      status: persistenceStatus,
      after: fakeMediaSnapshot(medioId, { status: 'COMPLETE', total_news: totalNews, clean_text_count: cleanCount, body_count: cleanCount }),
    }),
  });
  const metrics = computeMediaQualityMetrics(record, { context_id: contextId, context_identity: contextIdentity });
  return { medio_id: medioId, context_id: contextId, label, label_source: 'human_review', metrics };
}

describe('§45. TESTS — CONTAMINATED CALIBRATION (Hardening B1DE)', () => {
  it('1. GOOD_REFERENCE con persistence INDETERMINATE + ratio 0.95 AVAILABLE → excluded', () => {
    const o = makeObs('MED-1', 'CTX-1', 'GOOD_REFERENCE', { persistenceStatus: 'INDETERMINATE', totalNews: 20, cleanCount: 19 });
    expect(o.metrics.ratios.persisted_clean_text_ratio.availability).toBe('AVAILABLE');
    expect(o.metrics.ratios.persisted_clean_text_ratio.value).toBeCloseTo(0.95, 6);
    const eligibility = computeCalibrationEligibility(o.metrics);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.exclusion_reasons).toContain('PERSISTENCE_NOT_VERIFIED');
  });

  it('2/3. esa observación 0.95 NO aparece en distribution GOOD ni en candidate thresholds', () => {
    const contaminant = makeObs('MED-1', 'CTX-1', 'GOOD_REFERENCE', { persistenceStatus: 'INDETERMINATE', totalNews: 20, cleanCount: 19 });
    const cleanGood = makeObs('MED-2', 'CTX-2', 'GOOD_REFERENCE', { totalNews: 10, cleanCount: 8 });
    const cleanBad = makeObs('MED-3', 'CTX-3', 'TEXT_BAD_REFERENCE', { totalNews: 10, cleanCount: 2 });
    const report = buildCalibrationReport([contaminant, cleanGood, cleanBad], { calibrationId: 'CAL-B1DE' });

    const dist = report.metric_distributions.find((d) => d.metric === 'persisted_clean_text_ratio')!;
    const good = dist.by_label.find((e) => e.label === 'GOOD_REFERENCE' && e.source_scope === 'GLOBAL')!;
    // Solo cleanGood (0.8) es elegible — 0.95 del contaminante NUNCA entra.
    expect(good.stats.available_count).toBe(1);
    expect(good.stats.max).toBeCloseTo(0.8, 6);
    expect(good.stats.min).toBeCloseTo(0.8, 6);

    const candidate = report.candidate_thresholds.find((c) => c.metric === 'persisted_clean_text_ratio' && c.source_scope === 'GLOBAL')!;
    const thresholds = candidate.candidates.map((c) => c.threshold);
    expect(thresholds).not.toContain(0.95);
  });

  it('4. la observación contaminada aparece en excluded_observations con su razón', () => {
    const contaminant = makeObs('MED-1', 'CTX-1', 'GOOD_REFERENCE', { persistenceStatus: 'INDETERMINATE', totalNews: 20, cleanCount: 19 });
    const report = buildCalibrationReport([contaminant], { calibrationId: 'CAL-B1DE' });
    expect(report.excluded_observations).toHaveLength(1);
    expect(report.excluded_observations[0]).toMatchObject({ medio_id: 'MED-1', context_id: 'CTX-1', label: 'GOOD_REFERENCE' });
    expect(report.excluded_observations[0]!.reasons).toContain('PERSISTENCE_NOT_VERIFIED');
  });

  it('5. context MISMATCH → excluded', () => {
    const o = makeObs('MED-1', 'CTX-1', 'GOOD_REFERENCE', { contextIdentity: 'MISMATCH' });
    expect(computeCalibrationEligibility(o.metrics)).toMatchObject({ eligible: false, exclusion_reasons: ['CONTEXT_IDENTITY_NOT_MATCH'] });
  });

  it('6. run evidence PARTIAL → excluded', () => {
    const o = makeObs('MED-1', 'CTX-1', 'GOOD_REFERENCE', { evidenceStatus: 'PARTIAL' });
    const e = computeCalibrationEligibility(o.metrics);
    expect(e.eligible).toBe(false);
    expect(e.exclusion_reasons).toContain('RUN_EVIDENCE_NOT_COMPLETE');
  });

  it('7. run evidence MISSING → excluded', () => {
    const o = makeObs('MED-1', 'CTX-1', 'GOOD_REFERENCE', { evidenceStatus: 'MISSING' });
    const e = computeCalibrationEligibility(o.metrics);
    expect(e.eligible).toBe(false);
    expect(e.exclusion_reasons).toContain('RUN_EVIDENCE_NOT_COMPLETE');
  });

  it('8. invalid evidence → excluded', () => {
    const o = makeObs('MED-1', 'CTX-1', 'GOOD_REFERENCE', { invalidEventCount: 1 });
    const e = computeCalibrationEligibility(o.metrics);
    expect(e.eligible).toBe(false);
    expect(e.exclusion_reasons).toContain('INVALID_EVIDENCE');
  });

  it('9. unsupported evidence → excluded', () => {
    const o = makeObs('MED-1', 'CTX-1', 'GOOD_REFERENCE', { unsupportedEventCount: 1 });
    const e = computeCalibrationEligibility(o.metrics);
    expect(e.eligible).toBe(false);
    expect(e.exclusion_reasons).toContain('UNSUPPORTED_EVIDENCE');
  });

  it('10. unresolved conflict → excluded', () => {
    const o = makeObs('MED-1', 'CTX-1', 'GOOD_REFERENCE', { ambiguousTerminalEvents: true });
    const e = computeCalibrationEligibility(o.metrics);
    expect(e.eligible).toBe(false);
    expect(e.exclusion_reasons).toContain('UNRESOLVED_EVIDENCE_CONFLICT');
  });

  it('11. evidencia limpia (todos los gates OK) → eligible', () => {
    const o = makeObs('MED-1', 'CTX-1', 'GOOD_REFERENCE');
    expect(computeCalibrationEligibility(o.metrics)).toEqual({ eligible: true, exclusion_reasons: [] });
  });
});

describe('§46. TESTS — ELIGIBLE BUT METRIC MISSING (distinto de EXCLUDED)', () => {
  it('12. gates limpios + total_news=0 → eligible, pero persisted ratio NOT_APPLICABLE (no confundir con excluded)', () => {
    const o = makeObs('MED-1', 'CTX-1', 'GOOD_REFERENCE', { totalNews: 0, cleanCount: 0 });
    expect(computeCalibrationEligibility(o.metrics).eligible).toBe(true);
    expect(o.metrics.ratios.persisted_clean_text_ratio.availability).toBe('NOT_APPLICABLE');
  });

  it('13. cohorte elegible con métrica faltante → missing_count incrementa en la distribution', () => {
    const zeroNews = makeObs('MED-1', 'CTX-1', 'GOOD_REFERENCE', { totalNews: 0, cleanCount: 0 });
    const withNews = makeObs('MED-2', 'CTX-2', 'GOOD_REFERENCE', { totalNews: 10, cleanCount: 8 });
    const bad = makeObs('MED-3', 'CTX-3', 'TEXT_BAD_REFERENCE', { totalNews: 10, cleanCount: 2 });
    const report = buildCalibrationReport([zeroNews, withNews, bad], { calibrationId: 'CAL-MISSING' });
    const dist = report.metric_distributions.find((d) => d.metric === 'persisted_clean_text_ratio')!;
    const good = dist.by_label.find((e) => e.label === 'GOOD_REFERENCE' && e.source_scope === 'GLOBAL')!;
    // 2 observaciones GOOD elegibles: 1 con métrica disponible (0.8), 1 con NOT_APPLICABLE (missing).
    expect(good.stats.count).toBe(2);
    expect(good.stats.available_count).toBe(1);
    expect(good.stats.missing_count).toBe(1);
  });

  it('14. observación excluida NO incrementa el missing_count de la distribution como si fuera elegible', () => {
    const excluded = makeObs('MED-1', 'CTX-1', 'GOOD_REFERENCE', { persistenceStatus: 'INDETERMINATE', totalNews: 20, cleanCount: 19 });
    const eligible = makeObs('MED-2', 'CTX-2', 'GOOD_REFERENCE', { totalNews: 10, cleanCount: 8 });
    const bad = makeObs('MED-3', 'CTX-3', 'TEXT_BAD_REFERENCE', { totalNews: 10, cleanCount: 2 });
    const report = buildCalibrationReport([excluded, eligible, bad], { calibrationId: 'CAL-EXCL-VS-MISSING' });
    const dist = report.metric_distributions.find((d) => d.metric === 'persisted_clean_text_ratio')!;
    const good = dist.by_label.find((e) => e.label === 'GOOD_REFERENCE' && e.source_scope === 'GLOBAL')!;
    // La distribution SOLO ve la observación elegible (count=1), no la excluida (count=2 sería incorrecto).
    expect(good.stats.count).toBe(1);
    expect(good.stats.available_count).toBe(1);
    expect(good.stats.missing_count).toBe(0);
    // Pero class_balance (RAW) sigue viendo las 2 observaciones GOOD, con el desglose eligible/excluded.
    const classBalance = report.class_balance.find((c) => c.label === 'GOOD_REFERENCE')!;
    expect(classBalance.number_of_observations).toBe(2);
    expect(classBalance.eligible_observations).toBe(1);
    expect(classBalance.excluded_observations).toBe(1);
  });
});

describe('§47. TESTS — DUPLICATE OBSERVATIONS (Hardening B3DE)', () => {
  it('15. misma (context_id, medio_id) dos veces → reject', () => {
    const first = makeObs('MED-1', 'CTX-DUP', 'GOOD_REFERENCE', { cleanCount: 9 });
    const second = makeObs('MED-1', 'CTX-DUP', 'GOOD_REFERENCE', { cleanCount: 3 });
    expect(() => buildCalibrationReport([first, second], { calibrationId: 'CAL-DUP' })).toThrow(/duplicad/i);
  });

  it('16. mismo medio_id + context_id DISTINTO → aceptado como dos observaciones', () => {
    const first = makeObs('MED-1', 'CTX-A', 'GOOD_REFERENCE', { cleanCount: 9 });
    const second = makeObs('MED-1', 'CTX-B', 'GOOD_REFERENCE', { cleanCount: 8 });
    expect(() => buildCalibrationReport([first, second], { calibrationId: 'CAL-NODUP' })).not.toThrow();
  });

  it('17. class_balance: number_of_media=1, number_of_observations=2 para el caso anterior', () => {
    const first = makeObs('MED-1', 'CTX-A', 'GOOD_REFERENCE', { cleanCount: 9 });
    const second = makeObs('MED-1', 'CTX-B', 'GOOD_REFERENCE', { cleanCount: 8 });
    const report = buildCalibrationReport([first, second], { calibrationId: 'CAL-NODUP' });
    const cb = report.class_balance.find((c) => c.label === 'GOOD_REFERENCE')!;
    expect(cb.number_of_media).toBe(1);
    expect(cb.number_of_observations).toBe(2);
  });

  it('18. weighting metadata = PER_OBSERVATION en todo CalibrationReport', () => {
    const report = buildCalibrationReport([], { calibrationId: 'CAL-EMPTY' });
    expect(report.weighting).toBe('PER_OBSERVATION');
  });
});
