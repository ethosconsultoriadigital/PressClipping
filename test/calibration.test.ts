import { describe, expect, it } from 'vitest';
import {
  buildCalibrationReport,
  buildDraftCalibrationProfile,
  computeCohortStats,
  percentile,
  type LabeledObservation,
} from '../src/mediaValidation/calibration.js';
import { computeMediaQualityMetrics } from '../src/mediaValidation/qualityMetrics.js';
import { fakeCrawlEvidence, fakeMediaEvidence } from './fixtures/runEvidenceFixtures.js';
import { fakeMediaSnapshot, fakeMediaValidationRecord, fakePersistenceEvidence } from './fixtures/validationEvidenceFixtures.js';
import type { ReferenceLabel } from '../src/mediaValidation/referenceLabels.js';

const CTX = { context_id: 'CTX-CAL', context_identity: 'MATCH' as const };

/**
 * Observación con `persisted_clean_text_ratio = cleanCount/10` controlado,
 * `source_method` opcional. `evidence_status: 'COMPLETE'` (Hardening
 * B1DE/focal): estas observaciones representan evidencia ELEGIBLE para
 * calibración (todos los hard gates limpios) — si no lo fueran,
 * `buildCalibrationReport` las excluiría de distributions/candidate
 * thresholds, que es precisamente lo que estos tests NO quieren ejercitar
 * aquí (ver `calibration-eligibility.test.ts` para los tests de exclusión).
 */
function obs(
  medioId: string,
  label: ReferenceLabel,
  cleanCount: number,
  sourceMethod: string | null = null,
  contextIdSuffix: string = medioId,
): LabeledObservation {
  const record = fakeMediaValidationRecord(medioId, {
    run_evidence: fakeMediaEvidence(medioId, { evidence_status: 'COMPLETE', crawl: fakeCrawlEvidence({ source_method: sourceMethod }) }),
    persistence: fakePersistenceEvidence(medioId, {
      status: 'VERIFIED',
      after: fakeMediaSnapshot(medioId, { status: 'COMPLETE', total_news: 10, clean_text_count: cleanCount, body_count: cleanCount }),
    }),
  });
  const metrics = computeMediaQualityMetrics(record, { ...CTX, context_id: `${CTX.context_id}-${contextIdSuffix}` });
  return { medio_id: medioId, context_id: metrics.context_id, label, label_source: 'human_review', metrics };
}

describe('computeCohortStats / percentile — Fase 1E', () => {
  it('18/19. median y percentiles deterministas sobre valores conocidos', () => {
    const stats = computeCohortStats([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(stats.count).toBe(10);
    expect(stats.available_count).toBe(10);
    expect(stats.missing_count).toBe(0);
    expect(stats.min).toBe(1);
    expect(stats.max).toBe(10);
    expect(stats.mean).toBe(5.5);
    expect(stats.median).toBeCloseTo(5.5, 6);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBeCloseTo(5.5, 6);
  });

  it('20. nulls se cuentan como missing, nunca como 0', () => {
    const stats = computeCohortStats([1, null, 3, null, null]);
    expect(stats.count).toBe(5);
    expect(stats.available_count).toBe(2);
    expect(stats.missing_count).toBe(3);
    expect(stats.mean).toBe(2); // (1+3)/2, nunca (1+0+3+0+0)/5
  });

  it('cohorte vacía → todo null, count=0 (nunca lanza)', () => {
    const stats = computeCohortStats([]);
    expect(stats).toEqual({
      count: 0,
      available_count: 0,
      missing_count: 0,
      min: null,
      max: null,
      mean: null,
      median: null,
      p10: null,
      p25: null,
      p75: null,
      p90: null,
    });
  });

  it('mismo input → mismo output (determinismo)', () => {
    expect(computeCohortStats([3, 1, 2])).toEqual(computeCohortStats([3, 1, 2]));
  });
});

describe('buildCalibrationReport — Fase 1E', () => {
  it('16/17. distribuciones GOOD y BAD correctas por separado', () => {
    const report = buildCalibrationReport(
      [obs('MED-G1', 'GOOD_REFERENCE', 9), obs('MED-G2', 'GOOD_REFERENCE', 8), obs('MED-B1', 'TEXT_BAD_REFERENCE', 2)],
      { calibrationId: 'CAL-TEST' },
    );
    const dist = report.metric_distributions.find((d) => d.metric === 'persisted_clean_text_ratio')!;
    const good = dist.by_label.find((e) => e.label === 'GOOD_REFERENCE' && e.source_scope === 'GLOBAL')!;
    const bad = dist.by_label.find((e) => e.label === 'TEXT_BAD_REFERENCE' && e.source_scope === 'GLOBAL')!;
    expect(good.stats.available_count).toBe(2);
    expect(good.stats.min).toBeCloseTo(0.8, 6);
    expect(good.stats.max).toBeCloseTo(0.9, 6);
    expect(bad.stats.available_count).toBe(1);
    expect(bad.stats.min).toBeCloseTo(0.2, 6);
  });

  it('23. class_balance refleja desequilibrio real sin ocultarlo (§23)', () => {
    const report = buildCalibrationReport(
      [
        obs('MED-1', 'GOOD_REFERENCE', 9),
        obs('MED-2', 'GOOD_REFERENCE', 8),
        obs('MED-3', 'GOOD_REFERENCE', 9),
        obs('MED-4', 'TEXT_BAD_REFERENCE', 1),
      ],
      { calibrationId: 'CAL-TEST' },
    );
    const good = report.class_balance.find((c) => c.label === 'GOOD_REFERENCE')!;
    const bad = report.class_balance.find((c) => c.label === 'TEXT_BAD_REFERENCE')!;
    expect(good.number_of_media).toBe(3);
    expect(bad.number_of_media).toBe(1);
  });

  it('21/22 (nivel calibración). number_of_media vs number_of_observations distinguidos cuando el mismo medio aparece en 2 contextos', () => {
    // Hardening B3DE: (context_id, medio_id) es la identidad de observación
    // — dos context_id DISTINTOS para el MISMO medio_id son observaciones
    // legítimas y distintas (nunca se rechazan como duplicado; §15).
    const first = obs('MED-1', 'GOOD_REFERENCE', 9, null, 'MED-1-CTX-A');
    const second = obs('MED-1', 'GOOD_REFERENCE', 8, null, 'MED-1-CTX-B');
    expect(first.context_id).not.toBe(second.context_id);
    const report = buildCalibrationReport([first, second], { calibrationId: 'CAL-TEST' });
    expect(report.input_summary.number_of_media).toBe(1);
    expect(report.input_summary.number_of_observations).toBe(2);
    expect(report.weighting).toBe('PER_OBSERVATION');
  });

  it('24. cohorte positiva vacía → INSUFFICIENT_CALIBRATION_DATA (nunca threshold inventado)', () => {
    const report = buildCalibrationReport([obs('MED-1', 'TEXT_BAD_REFERENCE', 2)], { calibrationId: 'CAL-TEST' });
    const candidate = report.candidate_thresholds.find((c) => c.metric === 'persisted_clean_text_ratio' && c.source_scope === 'GLOBAL')!;
    expect(candidate.status).toBe('INSUFFICIENT_CALIBRATION_DATA');
    expect(candidate.candidates).toEqual([]);
    expect(candidate.reason).toContain('insuficientes');
  });

  it('25. cohorte de problema vacía → INSUFFICIENT_CALIBRATION_DATA', () => {
    const report = buildCalibrationReport([obs('MED-1', 'GOOD_REFERENCE', 9)], { calibrationId: 'CAL-TEST' });
    const candidate = report.candidate_thresholds.find((c) => c.metric === 'persisted_clean_text_ratio' && c.source_scope === 'GLOBAL')!;
    expect(candidate.status).toBe('INSUFFICIENT_CALIBRATION_DATA');
  });

  it('26. distribuciones que se superponen generan overlap_notes (§53), nunca fingen frontera perfecta', () => {
    const report = buildCalibrationReport(
      [obs('MED-1', 'GOOD_REFERENCE', 4), obs('MED-2', 'GOOD_REFERENCE', 9), obs('MED-3', 'TEXT_BAD_REFERENCE', 3), obs('MED-4', 'TEXT_BAD_REFERENCE', 8)],
      { calibrationId: 'CAL-TEST' },
    );
    expect(report.overlap_notes.some((n) => n.includes('persisted_clean_text_ratio'))).toBe(true);
  });

  it('sin overlap → no se genera overlap_note para esa métrica/label', () => {
    const report = buildCalibrationReport(
      [obs('MED-1', 'GOOD_REFERENCE', 9), obs('MED-2', 'GOOD_REFERENCE', 10), obs('MED-3', 'TEXT_BAD_REFERENCE', 1), obs('MED-4', 'TEXT_BAD_REFERENCE', 2)],
      { calibrationId: 'CAL-TEST' },
    );
    expect(report.overlap_notes.some((n) => n.includes('persisted_clean_text_ratio') && n.includes('TEXT_BAD_REFERENCE'))).toBe(false);
  });

  it('27/28/29. source_method separa RSS/SITEMAP/GLOBAL(desconocido) en source_method_support', () => {
    const report = buildCalibrationReport(
      [obs('MED-1', 'GOOD_REFERENCE', 9, 'rss'), obs('MED-2', 'GOOD_REFERENCE', 8, 'sitemap'), obs('MED-3', 'TEXT_BAD_REFERENCE', 2, null)],
      { calibrationId: 'CAL-TEST' },
    );
    const rss = report.source_method_support.find((s) => s.source_scope === 'RSS')!;
    const sitemap = report.source_method_support.find((s) => s.source_scope === 'SITEMAP')!;
    expect(rss.number_of_media).toBe(1);
    expect(sitemap.number_of_media).toBe(1);
    // MED-3 (source_method=null) cuenta como GLOBAL — fuente desconocida, no inventada (§29).
    const dist = report.metric_distributions.find((d) => d.metric === 'persisted_clean_text_ratio')!;
    const rssEntry = dist.by_label.find((e) => e.label === 'GOOD_REFERENCE' && e.source_scope === 'RSS')!;
    expect(rssEntry.stats.available_count).toBe(1);
  });

  it('30/31/32. candidatos de threshold son SOLO fronteras observadas y la matriz de confusión es correcta', () => {
    // positivos (GOOD): 0.9, 0.8 — problema (BAD): 0.2, 0.3
    const report = buildCalibrationReport(
      [
        obs('MED-G1', 'GOOD_REFERENCE', 9),
        obs('MED-G2', 'GOOD_REFERENCE', 8),
        obs('MED-B1', 'TEXT_BAD_REFERENCE', 2),
        obs('MED-B2', 'TEXT_BAD_REFERENCE', 3),
      ],
      { calibrationId: 'CAL-TEST' },
    );
    const candidate = report.candidate_thresholds.find((c) => c.metric === 'persisted_clean_text_ratio' && c.source_scope === 'GLOBAL')!;
    expect(candidate.status).toBe('CANDIDATES_AVAILABLE');
    // Únicos valores observados: 0.2, 0.3, 0.8, 0.9 — nunca un número inventado como 0.5.
    const thresholds = candidate.candidates.map((c) => c.threshold).sort((a, b) => a - b);
    expect(thresholds).toEqual([0.2, 0.3, 0.8, 0.9]);
    // threshold=0.8: predicted positive = valor>=0.8 → TP={0.8,0.9}=2, FN=0; FP={}=0, TN={0.2,0.3}=2.
    const at08 = candidate.candidates.find((c) => c.threshold === 0.8)!;
    expect(at08.tp).toBe(2);
    expect(at08.fn).toBe(0);
    expect(at08.fp).toBe(0);
    expect(at08.tn).toBe(2);
    expect(at08.precision).toBe(1);
    expect(at08.recall).toBe(1);
    expect(at08.balanced_accuracy).toBe(1);
    // threshold=0.9: TP={0.9}=1, FN={0.8}=1 → recall=0.5; FP=0, TN=2 → specificity=1 → balanced_accuracy=0.75.
    const at09 = candidate.candidates.find((c) => c.threshold === 0.9)!;
    expect(at09.tp).toBe(1);
    expect(at09.fn).toBe(1);
    expect(at09.recall).toBe(0.5);
    expect(at09.balanced_accuracy).toBe(0.75);
  });

  it('candidatos ordenados por balanced_accuracy desc (orden de LECTURA, no una elección — §28)', () => {
    const report = buildCalibrationReport(
      [
        obs('MED-G1', 'GOOD_REFERENCE', 9),
        obs('MED-G2', 'GOOD_REFERENCE', 8),
        obs('MED-B1', 'TEXT_BAD_REFERENCE', 2),
        obs('MED-B2', 'TEXT_BAD_REFERENCE', 3),
      ],
      { calibrationId: 'CAL-TEST' },
    );
    const candidate = report.candidate_thresholds.find((c) => c.metric === 'persisted_clean_text_ratio' && c.source_scope === 'GLOBAL')!;
    const accuracies = candidate.candidates.map((c) => c.balanced_accuracy ?? -1);
    expect(accuracies).toEqual([...accuracies].sort((a, b) => b - a));
  });

  it('métrica sin ninguna observación disponible (todas UNAVAILABLE) → INSUFFICIENT_CALIBRATION_DATA, no lanza', () => {
    // enrich MISSING para todos → run_clean_text_ratio siempre UNAVAILABLE.
    const good = obs('MED-1', 'GOOD_REFERENCE', 9);
    const bad = obs('MED-2', 'TEXT_BAD_REFERENCE', 2);
    const report = buildCalibrationReport([good, bad], { calibrationId: 'CAL-TEST' });
    const candidate = report.candidate_thresholds.find((c) => c.metric === 'run_clean_text_ratio' && c.source_scope === 'GLOBAL')!;
    expect(candidate.status).toBe('INSUFFICIENT_CALIBRATION_DATA');
  });

  it('report vacío (0 observaciones) no lanza, todos los candidatos son INSUFFICIENT_CALIBRATION_DATA', () => {
    const report = buildCalibrationReport([], { calibrationId: 'CAL-EMPTY' });
    expect(report.input_summary.number_of_media).toBe(0);
    expect(report.candidate_thresholds.every((c) => c.status === 'INSUFFICIENT_CALIBRATION_DATA')).toBe(true);
    expect(report.warnings.length).toBeGreaterThan(0);
  });

  it('mismo input → mismo output (determinismo, generatedAt inyectado)', () => {
    const observations = [obs('MED-1', 'GOOD_REFERENCE', 9), obs('MED-2', 'TEXT_BAD_REFERENCE', 2)];
    const opts = { calibrationId: 'CAL-DET', generatedAt: '2026-01-01T00:00:00.000Z' };
    expect(buildCalibrationReport(observations, opts)).toEqual(buildCalibrationReport(observations, opts));
  });
});

describe('buildDraftCalibrationProfile — §27/§30/§58', () => {
  it('siempre produce status=DRAFT y rules=[] — nunca autoriza nada automáticamente', () => {
    const report = buildCalibrationReport([obs('MED-1', 'GOOD_REFERENCE', 9), obs('MED-2', 'TEXT_BAD_REFERENCE', 2)], {
      calibrationId: 'CAL-DRAFT',
    });
    const profile = buildDraftCalibrationProfile(report, { calibrationId: 'CAL-DRAFT', createdAt: '2026-01-01T00:00:00.000Z' });
    expect(profile.status).toBe('DRAFT');
    expect(profile.rules).toEqual([]);
    expect(profile.calibration_id).toBe('CAL-DRAFT');
    expect(profile.source.based_on_calibration_id).toBe('CAL-DRAFT');
    expect(profile.cohort_sizes).toEqual(report.class_balance);
  });
});

describe('§33. Label leakage — el label NUNCA es parte de MediaQualityMetrics', () => {
  it('MediaQualityMetrics no contiene ningún campo relacionado con reference labels', () => {
    const o = obs('MED-1', 'GOOD_REFERENCE', 9);
    const keys = JSON.stringify(o.metrics);
    expect(keys).not.toContain('GOOD_REFERENCE');
    expect(keys).not.toContain('label');
  });
});
