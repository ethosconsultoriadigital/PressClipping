import { describe, expect, it } from 'vitest';
import { evaluateMedia, evaluateRun } from '../src/mediaValidation/shadowValidator.js';
import { computeMediaQualityMetrics } from '../src/mediaValidation/qualityMetrics.js';
import type { CalibrationProfile, ThresholdRule, MinimumSampleRule } from '../src/mediaValidation/calibration.js';
import { fakeCrawlEvidence, fakeEnrichEvidence, fakeMediaEvidence } from './fixtures/runEvidenceFixtures.js';
import { fakeMediaSnapshot, fakeMediaValidationRecord, fakePersistenceEvidence } from './fixtures/validationEvidenceFixtures.js';

const CTX = { context_id: 'CTX-VAL', context_identity: 'MATCH' as const };

function goodMetrics(overridesAfter: Partial<Parameters<typeof fakeMediaSnapshot>[1]> = {}, overridesEnrich: Partial<ReturnType<typeof fakeEnrichEvidence>> = {}) {
  const record = fakeMediaValidationRecord('MED-1', {
    run_evidence: fakeMediaEvidence('MED-1', {
      evidence_status: 'COMPLETE',
      crawl: fakeCrawlEvidence({ source_method: 'rss', status: 'ok', detected: 10, items: 10, inserted: 9 }),
      enrich: fakeEnrichEvidence({
        presence: 'PRESENT',
        requested: true,
        processed: 10,
        updated: 9,
        unchanged: 0,
        failed: 1,
        clean_text_count: 9,
        body_count: 9,
        dry_run: false,
        content_persistence: 'UNVERIFIED',
        raw_summary_event_count: 1,
        ...overridesEnrich,
      }),
    }),
    persistence: fakePersistenceEvidence('MED-1', {
      status: 'VERIFIED',
      after: fakeMediaSnapshot('MED-1', { status: 'COMPLETE', total_news: 10, clean_text_count: 9, body_count: 9, ...overridesAfter }),
    }),
  });
  return computeMediaQualityMetrics(record, CTX);
}

function approvedThresholdProfile(rules: (ThresholdRule | MinimumSampleRule)[], status: 'DRAFT' | 'APPROVED' = 'APPROVED'): CalibrationProfile {
  return {
    schema_version: 1,
    calibration_id: 'CAL-TEST',
    status,
    created_at: '2026-01-01T00:00:00.000Z',
    source: { label_sources: ['human_review'], based_on_calibration_id: null },
    cohort_sizes: [],
    rules,
  };
}

const CLEAN_TEXT_RULE: ThresholdRule = {
  rule_id: 'R-CLEAN',
  kind: 'THRESHOLD',
  metric: 'ratios.persisted_clean_text_ratio',
  operator: '>=',
  pass_threshold: 0.8,
  fail_threshold: 0.5,
  source_method_scope: 'GLOBAL',
};

describe('evaluateMedia — hard gates (§68, 44-55)', () => {
  it('44. sin CalibrationProfile → CALIBRATION_REQUIRED', () => {
    const r = evaluateMedia(goodMetrics(), null);
    expect(r.evaluation_status).toBe('CALIBRATION_REQUIRED');
    expect(r.validation_result).toBeNull();
    expect(r.recommendation).toBeNull();
    expect(r.calibration_id).toBeNull();
  });

  it('45. DRAFT profile con reglas que pasarían → nunca ELIGIBLE_FOR_PROMOTION', () => {
    const profile = approvedThresholdProfile([CLEAN_TEXT_RULE], 'DRAFT');
    const r = evaluateMedia(goodMetrics(), profile);
    expect(r.evaluation_status).toBe('EVALUATED');
    expect(r.validation_result).toBe('REVIEW');
    expect(r.recommendation).toBe('REVIEW_REQUIRED');
    expect(r.would_be_result_if_approved).toBe('PASS');
  });

  it('46. context mismatch → NO PASS', () => {
    const metrics = goodMetrics();
    const mismatched = { ...metrics, gates: { ...metrics.gates, context_identity: 'MISMATCH' as const } };
    const r = evaluateMedia(mismatched, approvedThresholdProfile([CLEAN_TEXT_RULE]));
    expect(r.evaluation_status).toBe('NOT_EVALUABLE');
    expect(r.validation_result).toBe('REVIEW');
    expect(r.gates_failed).toContain('context_identity_mismatch');
  });

  it('47. persistence INDETERMINATE → NO PASS', () => {
    const metrics = goodMetrics();
    const bad = { ...metrics, gates: { ...metrics.gates, persistence_status: 'INDETERMINATE' as const } };
    const r = evaluateMedia(bad, approvedThresholdProfile([CLEAN_TEXT_RULE]));
    expect(r.validation_result).toBe('REVIEW');
    expect(r.gates_failed).toContain('persistence_not_verified');
  });

  it('48. run evidence PARTIAL → NO PASS', () => {
    const metrics = goodMetrics();
    const bad = { ...metrics, gates: { ...metrics.gates, run_evidence_status: 'PARTIAL' as const } };
    const r = evaluateMedia(bad, approvedThresholdProfile([CLEAN_TEXT_RULE]));
    expect(r.validation_result).toBe('REVIEW');
    expect(r.gates_failed).toContain('run_evidence_not_complete');
  });

  it('49. run evidence MISSING → NO PASS', () => {
    const metrics = goodMetrics();
    const bad = { ...metrics, gates: { ...metrics.gates, run_evidence_status: 'MISSING' as const } };
    const r = evaluateMedia(bad, approvedThresholdProfile([CLEAN_TEXT_RULE]));
    expect(r.validation_result).toBe('REVIEW');
  });

  it('50. invalid evidence → NO PASS', () => {
    const metrics = goodMetrics();
    const bad = { ...metrics, gates: { ...metrics.gates, has_invalid_evidence: true } };
    const r = evaluateMedia(bad, approvedThresholdProfile([CLEAN_TEXT_RULE]));
    expect(r.validation_result).toBe('REVIEW');
    expect(r.gates_failed).toContain('invalid_evidence_present');
  });

  it('51. unsupported evidence → NO PASS', () => {
    const metrics = goodMetrics();
    const bad = { ...metrics, gates: { ...metrics.gates, has_unsupported_evidence: true } };
    const r = evaluateMedia(bad, approvedThresholdProfile([CLEAN_TEXT_RULE]));
    expect(r.validation_result).toBe('REVIEW');
    expect(r.gates_failed).toContain('unsupported_evidence_present');
  });

  it('52. unresolved conflict → NO PASS', () => {
    const metrics = goodMetrics();
    const bad = { ...metrics, gates: { ...metrics.gates, has_unresolved_evidence_conflict: true } };
    const r = evaluateMedia(bad, approvedThresholdProfile([CLEAN_TEXT_RULE]));
    expect(r.validation_result).toBe('REVIEW');
    expect(r.gates_failed).toContain('unresolved_evidence_conflict');
  });

  it('53. missing mandatory metric → REVIEW/NOT_EVALUABLE, nunca PASS optimista', () => {
    // enrich MISSING (no PRESENT) hace que la métrica del rule quede UNAVAILABLE si se usara run_clean_text_ratio.
    const record = fakeMediaValidationRecord('MED-1', {
      run_evidence: fakeMediaEvidence('MED-1', { evidence_status: 'PARTIAL', enrich: fakeEnrichEvidence({ presence: 'MISSING' }) }),
      persistence: fakePersistenceEvidence('MED-1', { status: 'VERIFIED' }),
    });
    const metrics = computeMediaQualityMetrics(record, CTX);
    const rule: ThresholdRule = { ...CLEAN_TEXT_RULE, metric: 'ratios.run_clean_text_ratio' };
    const r = evaluateMedia(metrics, approvedThresholdProfile([rule]));
    // run_evidence_status=PARTIAL ya es un hard gate, así que esto cae en NOT_EVALUABLE por el gate.
    expect(r.validation_result).toBe('REVIEW');
  });

  it('missing mandatory metric SIN fallo de hard gates → rule outcome NOT_EVALUABLE, combinado REVIEW', () => {
    const metrics = goodMetrics();
    const rule: ThresholdRule = { ...CLEAN_TEXT_RULE, metric: 'ratios.enrich_failure_ratio', operator: '<=', pass_threshold: 0, fail_threshold: null };
    // Forzamos metric inexistente para simular "no disponible" sin tocar gates:
    const brokenMetrics = { ...metrics, ratios: { ...metrics.ratios, enrich_failure_ratio: { availability: 'UNAVAILABLE' as const, value: null, numerator: null, denominator: null, issue: 'RUN_EVIDENCE_INCOMPLETE' as const } } };
    const r = evaluateMedia(brokenMetrics, approvedThresholdProfile([rule]));
    expect(r.evaluation_status).toBe('EVALUATED');
    expect(r.validation_result).toBe('REVIEW');
    expect(r.rules_evaluated[0]!.outcome).toBe('NOT_EVALUABLE');
  });

  it('54. muestra insuficiente (MINIMUM_SAMPLE) → REVIEW, nunca FAIL directo', () => {
    const rule: MinimumSampleRule = { rule_id: 'R-MIN', kind: 'MINIMUM_SAMPLE', metric: 'persisted.after_total_news', minimum: 100, source_method_scope: 'GLOBAL' };
    const r = evaluateMedia(goodMetrics(), approvedThresholdProfile([rule]));
    expect(r.validation_result).toBe('REVIEW');
    expect(r.rules_evaluated[0]!.outcome).toBe('NOT_EVALUABLE');
    expect(r.rules_evaluated[0]!.reason).toContain('INSUFFICIENT_SAMPLE');
  });

  it('55. zero news no auto-fail sin regla explícita — con profile que NO define ninguna regla sobre after_total_news, sigue evaluándose por otras reglas', () => {
    const metrics = goodMetrics({ total_news: 0, clean_text_count: 0, body_count: 0 });
    // persisted_clean_text_ratio será NOT_APPLICABLE (zero denominator) — la regla queda NOT_EVALUABLE, nunca FAIL.
    const r = evaluateMedia(metrics, approvedThresholdProfile([CLEAN_TEXT_RULE]));
    expect(r.validation_result).toBe('REVIEW');
    expect(r.rules_evaluated[0]!.outcome).toBe('NOT_EVALUABLE');
  });

  it('zero news CON regla explícita aprobada sobre el propio contador → puede evaluarse (no auto-fail, pero sí gobernado)', () => {
    const metrics = goodMetrics({ total_news: 0, clean_text_count: 0, body_count: 0 });
    const rule: MinimumSampleRule = { rule_id: 'R-ZERO', kind: 'MINIMUM_SAMPLE', metric: 'persisted.after_total_news', minimum: 1, source_method_scope: 'GLOBAL' };
    const r = evaluateMedia(metrics, approvedThresholdProfile([rule]));
    expect(r.rules_evaluated[0]!.outcome).toBe('NOT_EVALUABLE'); // §40: insuficiente, no FAIL.
    expect(r.validation_result).toBe('REVIEW');
  });
});

describe('evaluateMedia — PASS/REVIEW/FAIL (§69, 56-66)', () => {
  it('56/57. todas las reglas PASS → PASS + ELIGIBLE_FOR_PROMOTION', () => {
    const r = evaluateMedia(goodMetrics(), approvedThresholdProfile([CLEAN_TEXT_RULE]));
    expect(r.validation_result).toBe('PASS');
    expect(r.recommendation).toBe('ELIGIBLE_FOR_PROMOTION');
    expect(r.calibration_id).toBe('CAL-TEST');
  });

  it('58/59. banda REVIEW (borderline) → REVIEW + REVIEW_REQUIRED', () => {
    // observado=0.6, pass=0.8, fail=0.5 → no pasa, no cruza fail → REVIEW.
    const metrics = goodMetrics({ total_news: 10, clean_text_count: 6, body_count: 6 });
    const r = evaluateMedia(metrics, approvedThresholdProfile([CLEAN_TEXT_RULE]));
    expect(r.validation_result).toBe('REVIEW');
    expect(r.recommendation).toBe('REVIEW_REQUIRED');
  });

  it('60/61. threshold de FAIL explícito cruzado con evidencia suficiente → FAIL + REPAIR_AND_RETEST', () => {
    const metrics = goodMetrics({ total_news: 10, clean_text_count: 3, body_count: 3 }); // 0.3 < fail_threshold=0.5
    const r = evaluateMedia(metrics, approvedThresholdProfile([CLEAN_TEXT_RULE]));
    expect(r.validation_result).toBe('FAIL');
    expect(r.recommendation).toBe('REPAIR_AND_RETEST');
  });

  it('62. BLOCKED_FAIL nunca se emite sin señal explícita de bloqueo', () => {
    const results = [
      evaluateMedia(goodMetrics(), null),
      evaluateMedia(goodMetrics({ total_news: 10, clean_text_count: 3, body_count: 3 }), approvedThresholdProfile([CLEAN_TEXT_RULE])),
      evaluateMedia(goodMetrics(), approvedThresholdProfile([CLEAN_TEXT_RULE])),
    ];
    for (const r of results) expect(r.recommendation).not.toBe('BLOCKED_FAIL');
  });

  it('63. boundary exacto de PASS (observado === pass_threshold con operator >=)', () => {
    const metrics = goodMetrics({ total_news: 10, clean_text_count: 8, body_count: 8 }); // 0.8 === pass_threshold
    const r = evaluateMedia(metrics, approvedThresholdProfile([CLEAN_TEXT_RULE]));
    expect(r.rules_evaluated[0]!.outcome).toBe('PASS');
    expect(r.validation_result).toBe('PASS');
  });

  it('63b. boundary exacto justo por debajo de pass_threshold (epsilon) → no PASS', () => {
    const metrics = goodMetrics({ total_news: 1000, clean_text_count: 799, body_count: 799 }); // 0.799 < 0.8
    const r = evaluateMedia(metrics, approvedThresholdProfile([CLEAN_TEXT_RULE]));
    expect(r.rules_evaluated[0]!.outcome).not.toBe('PASS');
  });

  it('64. boundary exacto de FAIL (observado === fail_threshold con operator >=)', () => {
    const metrics = goodMetrics({ total_news: 10, clean_text_count: 5, body_count: 5 }); // 0.5 === fail_threshold
    const r = evaluateMedia(metrics, approvedThresholdProfile([CLEAN_TEXT_RULE]));
    // observed < fail_threshold es la condición de FAIL; observed===fail_threshold NO cruza (no es <) → REVIEW, no FAIL.
    expect(r.rules_evaluated[0]!.outcome).toBe('REVIEW');
  });

  it('64b. boundary justo por debajo de fail_threshold (epsilon) → FAIL', () => {
    const metrics = goodMetrics({ total_news: 1000, clean_text_count: 499, body_count: 499 }); // 0.499 < 0.5
    const r = evaluateMedia(metrics, approvedThresholdProfile([CLEAN_TEXT_RULE]));
    expect(r.rules_evaluated[0]!.outcome).toBe('FAIL');
  });

  it('65. una métrica PASS + otra FAIL → combinado FAIL (política explícita: cualquier FAIL domina)', () => {
    const metrics = goodMetrics({ total_news: 10, clean_text_count: 9, body_count: 3 }); // clean=0.9 (pass), body=0.3 (fail si aplica regla similar)
    const bodyRule: ThresholdRule = { rule_id: 'R-BODY', kind: 'THRESHOLD', metric: 'ratios.persisted_body_ratio', operator: '>=', pass_threshold: 0.8, fail_threshold: 0.5, source_method_scope: 'GLOBAL' };
    const r = evaluateMedia(metrics, approvedThresholdProfile([CLEAN_TEXT_RULE, bodyRule]));
    expect(r.rules_evaluated).toHaveLength(2);
    expect(r.validation_result).toBe('FAIL');
  });

  it('66. una métrica no disponible → nunca PASS optimista aunque las demás pasen', () => {
    const metrics = goodMetrics();
    const brokenMetrics = { ...metrics, ratios: { ...metrics.ratios, persisted_body_ratio: { availability: 'UNAVAILABLE' as const, value: null, numerator: null, denominator: null, issue: 'DENOMINATOR_UNAVAILABLE' as const } } };
    const bodyRule: ThresholdRule = { rule_id: 'R-BODY', kind: 'THRESHOLD', metric: 'ratios.persisted_body_ratio', operator: '>=', pass_threshold: 0.8, fail_threshold: 0.5, source_method_scope: 'GLOBAL' };
    const r = evaluateMedia(brokenMetrics, approvedThresholdProfile([CLEAN_TEXT_RULE, bodyRule]));
    expect(r.validation_result).toBe('REVIEW');
    expect(r.validation_result).not.toBe('PASS');
  });
});

describe('evaluateMedia — dry_run (§70, 67-70)', () => {
  it('67/68/69. dry_run=true nunca produce ELIGIBLE_FOR_PROMOTION; se marca simulated y se preserva dry_run', () => {
    const metrics = goodMetrics({}, { dry_run: true });
    const r = evaluateMedia(metrics, approvedThresholdProfile([CLEAN_TEXT_RULE]));
    expect(r.dry_run).toBe(true);
    expect(r.simulated).toBe(true);
    expect(r.validation_result).toBe('PASS'); // report-only: el resultado técnico se preserva.
    expect(r.recommendation).toBe('REVIEW_REQUIRED'); // nunca ELIGIBLE_FOR_PROMOTION bajo dry_run.
  });

  it('70. dry_run=false (o null) nunca ejecuta ninguna mutación — sigue siendo puro/report-only (ausencia de I/O verificada por diseño)', () => {
    const metrics = goodMetrics({}, { dry_run: false });
    const r = evaluateMedia(metrics, approvedThresholdProfile([CLEAN_TEXT_RULE]));
    expect(r.dry_run).toBe(false);
    expect(r.simulated).toBe(false);
    expect(r.recommendation).toBe('ELIGIBLE_FOR_PROMOTION');
  });
});

describe('evaluateMedia — determinismo, batch y calibration_id (§49/§60-61/§48)', () => {
  it('mismo input → mismo output', () => {
    const metrics = goodMetrics();
    const profile = approvedThresholdProfile([CLEAN_TEXT_RULE]);
    expect(evaluateMedia(metrics, profile)).toEqual(evaluateMedia(metrics, profile));
  });

  it('calibration_id se preserva en cada decisión evaluada (§48)', () => {
    const r = evaluateMedia(goodMetrics(), approvedThresholdProfile([CLEAN_TEXT_RULE]));
    expect(r.calibration_id).toBe('CAL-TEST');
  });

  it('evaluateRun acepta una colección de medios (§60/§61)', () => {
    const m1 = goodMetrics();
    const m2 = goodMetrics({ total_news: 10, clean_text_count: 3, body_count: 3 });
    const reports = evaluateRun([m1, m2], approvedThresholdProfile([CLEAN_TEXT_RULE]));
    expect(reports).toHaveLength(2);
    expect(reports[0]!.validation_result).toBe('PASS');
    expect(reports[1]!.validation_result).toBe('FAIL');
  });

  it('source-specific fallback (§54): regla RSS no aplica a medio sitemap; cae a GLOBAL si existe, o queda sin regla aplicable', () => {
    const record = fakeMediaValidationRecord('MED-1', {
      run_evidence: fakeMediaEvidence('MED-1', {
        evidence_status: 'COMPLETE',
        crawl: fakeCrawlEvidence({ source_method: 'sitemap' }),
        enrich: fakeEnrichEvidence({ presence: 'PRESENT', requested: true, processed: 10, updated: 9, unchanged: 0, failed: 1, clean_text_count: 9, body_count: 9, dry_run: false, content_persistence: 'UNVERIFIED', raw_summary_event_count: 1 }),
      }),
      persistence: fakePersistenceEvidence('MED-1', { status: 'VERIFIED', after: fakeMediaSnapshot('MED-1', { status: 'COMPLETE', total_news: 10, clean_text_count: 9, body_count: 9 }) }),
    });
    const metrics = computeMediaQualityMetrics(record, CTX);
    const rssOnlyRule: ThresholdRule = { ...CLEAN_TEXT_RULE, source_method_scope: 'RSS' };
    const r = evaluateMedia(metrics, approvedThresholdProfile([rssOnlyRule]));
    // Ninguna regla aplica (RSS-only, medio es sitemap, sin GLOBAL) → NOT_EVALUABLE/REVIEW, nunca PASS silencioso.
    expect(r.evaluation_status).toBe('NOT_EVALUABLE');
    expect(r.validation_result).toBe('REVIEW');
  });

  it('regla GLOBAL se usa como fallback cuando no hay regla específica para el scope del medio', () => {
    const metrics = goodMetrics(); // source_method='rss'
    const globalRule: ThresholdRule = { ...CLEAN_TEXT_RULE, source_method_scope: 'GLOBAL' };
    const r = evaluateMedia(metrics, approvedThresholdProfile([globalRule]));
    expect(r.evaluation_status).toBe('EVALUATED');
    expect(r.validation_result).toBe('PASS');
  });

  it('profile con rules=[] → CALIBRATION_REQUIRED aunque exista (APPROVED vacío bloqueado antes por schema, pero motor también lo maneja defensivamente)', () => {
    const profile = approvedThresholdProfile([], 'DRAFT');
    const r = evaluateMedia(goodMetrics(), profile);
    expect(r.evaluation_status).toBe('CALIBRATION_REQUIRED');
  });
});
