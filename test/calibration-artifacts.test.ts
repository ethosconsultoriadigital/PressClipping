import { describe, expect, it } from 'vitest';
import {
  validateReferenceLabelManifest,
  validateCalibrationProfile,
  validateCalibrationReport,
  validateShadowValidationReport,
  validateRunValidationEvidenceEnvelope,
} from '../src/mediaValidation/calibrationSchemas.js';
import { buildCalibrationReport, buildDraftCalibrationProfile, type LabeledObservation } from '../src/mediaValidation/calibration.js';
import { computeMediaQualityMetrics, computeQualityMetricsForRun } from '../src/mediaValidation/qualityMetrics.js';
import { evaluateMedia, evaluateRun } from '../src/mediaValidation/shadowValidator.js';
import { fakeMediaSnapshot, fakeMediaValidationRecord, fakePersistenceEvidence, fakeRunValidationEvidence } from './fixtures/validationEvidenceFixtures.js';
import { fakeCrawlEvidence, fakeEnrichEvidence, fakeMediaEvidence } from './fixtures/runEvidenceFixtures.js';
import type { CalibrationProfile } from '../src/mediaValidation/calibration.js';

const CTX = { context_id: 'CTX-ART', context_identity: 'MATCH' as const };

describe('ReferenceLabelManifest — validación runtime (§34-35 de tests)', () => {
  it('34. schema_version=1 aceptado', () => {
    expect(() =>
      validateReferenceLabelManifest({ schema_version: 1, label_source: 'human_review', entries: [{ medio_id: 'MED-1', label: 'GOOD_REFERENCE' }] }),
    ).not.toThrow();
  });

  it('35. schema_version futura rechazada', () => {
    expect(() => validateReferenceLabelManifest({ schema_version: 2, label_source: 'human_review', entries: [] })).toThrow();
  });

  it('label desconocido rechazado', () => {
    expect(() =>
      validateReferenceLabelManifest({ schema_version: 1, label_source: 'human_review', entries: [{ medio_id: 'MED-1', label: 'BLOQUEADO' }] }),
    ).toThrow();
  });

  it('label_source desconocido rechazado (nunca se acepta uno inventado)', () => {
    expect(() =>
      validateReferenceLabelManifest({ schema_version: 1, label_source: 'ia_guess', entries: [] }),
    ).toThrow();
  });

  it('medio_id vacío/blanco rechazado', () => {
    expect(() =>
      validateReferenceLabelManifest({ schema_version: 1, label_source: 'human_review', entries: [{ medio_id: '   ', label: 'GOOD_REFERENCE' }] }),
    ).toThrow();
  });
});

describe('CalibrationProfile — validación runtime (§36-43 de tests)', () => {
  const baseProfile = () => ({
    schema_version: 1,
    calibration_id: 'CAL-1',
    status: 'DRAFT' as const,
    created_at: '2026-01-01T00:00:00.000Z',
    source: { label_sources: ['human_review'], based_on_calibration_id: null },
    cohort_sizes: [],
    rules: [] as unknown[],
  });

  it('36. DRAFT profile reconocido, sin reglas', () => {
    expect(() => validateCalibrationProfile(baseProfile())).not.toThrow();
  });

  it('37. APPROVED profile con >=1 regla reconocido', () => {
    const p = {
      ...baseProfile(),
      status: 'APPROVED' as const,
      rules: [
        {
          rule_id: 'R1',
          kind: 'THRESHOLD',
          metric: 'ratios.persisted_clean_text_ratio',
          operator: '>=',
          pass_threshold: 0.8,
          fail_threshold: 0.5,
          source_method_scope: 'GLOBAL',
        },
      ],
    };
    expect(() => validateCalibrationProfile(p)).not.toThrow();
  });

  it('APPROVED sin reglas se rechaza (aprobado sin nada que evaluar)', () => {
    expect(() => validateCalibrationProfile({ ...baseProfile(), status: 'APPROVED' })).toThrow();
  });

  it('38. threshold inválido (rango imposible) rechazado', () => {
    const p = {
      ...baseProfile(),
      rules: [
        {
          rule_id: 'R1',
          kind: 'THRESHOLD',
          metric: 'ratios.persisted_clean_text_ratio',
          operator: '>=',
          pass_threshold: 0.5,
          fail_threshold: 0.9, // fail por encima de pass en régimen "más alto mejor" → imposible
          source_method_scope: 'GLOBAL',
        },
      ],
    };
    expect(() => validateCalibrationProfile(p)).toThrow();
  });

  it('39. NaN/Infinity rechazados', () => {
    const p = {
      ...baseProfile(),
      rules: [
        { rule_id: 'R1', kind: 'THRESHOLD', metric: 'x', operator: '>=', pass_threshold: Number.NaN, fail_threshold: null, source_method_scope: 'GLOBAL' },
      ],
    };
    expect(() => validateCalibrationProfile(p)).toThrow();
    const p2 = {
      ...baseProfile(),
      rules: [
        { rule_id: 'R1', kind: 'THRESHOLD', metric: 'x', operator: '>=', pass_threshold: Number.POSITIVE_INFINITY, fail_threshold: null, source_method_scope: 'GLOBAL' },
      ],
    };
    expect(() => validateCalibrationProfile(p2)).toThrow();
  });

  it('40. rango imposible simétrico (operator lower-is-better) rechazado', () => {
    const p = {
      ...baseProfile(),
      rules: [
        { rule_id: 'R1', kind: 'THRESHOLD', metric: 'x', operator: '<=', pass_threshold: 0.5, fail_threshold: 0.1, source_method_scope: 'GLOBAL' },
      ],
    };
    expect(() => validateCalibrationProfile(p)).toThrow();
  });

  it('41. campo requerido faltante (metric) manejado — rechazado', () => {
    const p = { ...baseProfile(), rules: [{ rule_id: 'R1', kind: 'THRESHOLD', operator: '>=', pass_threshold: 0.5, fail_threshold: null, source_method_scope: 'GLOBAL' }] };
    expect(() => validateCalibrationProfile(p)).toThrow();
  });

  it('42. calibration_id se preserva a través de la validación', () => {
    const parsed = validateCalibrationProfile(baseProfile());
    expect(parsed.calibration_id).toBe('CAL-1');
  });

  it('43. source_method_scope explícito requerido (RSS/SITEMAP/GLOBAL)', () => {
    const p = {
      ...baseProfile(),
      rules: [
        { rule_id: 'R1', kind: 'MINIMUM_SAMPLE', metric: 'persisted.after_total_news', minimum: 5, source_method_scope: 'UNKNOWN_SCOPE' },
      ],
    };
    expect(() => validateCalibrationProfile(p)).toThrow();
  });

  it('MINIMUM_SAMPLE con minimum negativo rechazado', () => {
    const p = { ...baseProfile(), rules: [{ rule_id: 'R1', kind: 'MINIMUM_SAMPLE', metric: 'x', minimum: -1, source_method_scope: 'GLOBAL' }] };
    expect(() => validateCalibrationProfile(p)).toThrow();
  });
});

describe('CalibrationReport / ShadowValidationReport — self-check de artifacts propios', () => {
  it('CalibrationReport generado por el engine siempre pasa su propio schema', () => {
    const observations: LabeledObservation[] = [];
    const report = buildCalibrationReport(observations, { calibrationId: 'CAL-SELF', generatedAt: '2026-01-01T00:00:00.000Z' });
    expect(() => validateCalibrationReport(report)).not.toThrow();
  });

  it('DRAFT profile generado por el engine siempre pasa su propio schema', () => {
    const report = buildCalibrationReport([], { calibrationId: 'CAL-SELF' });
    const profile = buildDraftCalibrationProfile(report, { calibrationId: 'CAL-SELF' });
    expect(() => validateCalibrationProfile(profile)).not.toThrow();
  });

  it('ShadowValidationReport generado por evaluateMedia siempre pasa su propio schema', () => {
    const metrics = computeMediaQualityMetrics(fakeMediaValidationRecord('MED-1'), CTX);
    const report = evaluateMedia(metrics, null);
    expect(() => validateShadowValidationReport(report)).not.toThrow();
  });

  it('malformed CalibrationProfile artifact rechazado (falta rules)', () => {
    expect(() => validateCalibrationProfile({ schema_version: 1, calibration_id: 'X', status: 'DRAFT', created_at: 'x', source: { label_sources: [], based_on_calibration_id: null }, cohort_sizes: [] })).toThrow();
  });

  it('malformed ReferenceLabelManifest artifact rechazado (entries no es array)', () => {
    expect(() => validateReferenceLabelManifest({ schema_version: 1, label_source: 'human_review', entries: 'oops' })).toThrow();
  });

  it('malformed ShadowValidationReport rechazado (validation_result fuera de enum)', () => {
    expect(() =>
      validateShadowValidationReport({
        schema_version: 1,
        calibration_id: null,
        context_id: 'CTX-1',
        medio_id: 'MED-1',
        source_method: null,
        evaluation_status: 'CALIBRATION_REQUIRED',
        validation_result: 'MAYBE',
        recommendation: null,
        dry_run: null,
        simulated: false,
        would_be_result_if_approved: null,
        gates_failed: [],
        rules_evaluated: [],
        issues: [],
      }),
    ).toThrow();
  });
});

describe('RunValidationEvidence — envelope mínimo (§74)', () => {
  it('artifact válido (fixture) pasa el envelope', () => {
    const evidence = fakeRunValidationEvidence({
      media: [fakeMediaValidationRecord('MED-1', { persistence: fakePersistenceEvidence('MED-1', { after: fakeMediaSnapshot('MED-1') }) })],
    });
    expect(() => validateRunValidationEvidenceEnvelope(evidence)).not.toThrow();
  });

  it('malformed RunValidationEvidence (schema_version futura) rechazado', () => {
    const evidence = fakeRunValidationEvidence();
    expect(() => validateRunValidationEvidenceEnvelope({ ...evidence, schema_version: 2 })).toThrow();
  });

  it('malformed RunValidationEvidence (media no es array) rechazado', () => {
    const evidence = fakeRunValidationEvidence();
    expect(() => validateRunValidationEvidenceEnvelope({ ...evidence, media: 'oops' })).toThrow();
  });

  it('malformed RunValidationEvidence (persistence.status desconocido) rechazado', () => {
    const evidence = fakeRunValidationEvidence({
      media: [fakeMediaValidationRecord('MED-1', { persistence: fakePersistenceEvidence('MED-1', { status: 'SORT_OF' as never }) })],
    });
    expect(() => validateRunValidationEvidenceEnvelope(evidence)).toThrow();
  });

  it('artifact JSON no es un objeto (bad JSON shape) rechazado', () => {
    expect(() => validateRunValidationEvidenceEnvelope('not-an-object')).toThrow();
    expect(() => validateRunValidationEvidenceEnvelope(null)).toThrow();
    expect(() => validateRunValidationEvidenceEnvelope(42)).toThrow();
  });

  it('roundtrip: computeQualityMetricsForRun funciona tras validar el envelope', () => {
    const evidence = fakeRunValidationEvidence({
      media: [fakeMediaValidationRecord('MED-1')],
    });
    validateRunValidationEvidenceEnvelope(evidence);
    const metrics = computeQualityMetricsForRun(evidence);
    expect(metrics).toHaveLength(1);
  });

  it('mismo profile inválido rechazado también en evaluateRun (defensivo, no lanza en runtime de evaluación en sí)', () => {
    const metrics = computeQualityMetricsForRun(fakeRunValidationEvidence({ media: [fakeMediaValidationRecord('MED-1')] }));
    const reports = evaluateRun(metrics, null);
    expect(reports).toHaveLength(1);
    for (const r of reports) expect(() => validateShadowValidationReport(r)).not.toThrow();
  });
});

describe('§48. TESTS — RUNTIME INPUT (Hardening B2DE: run_evidence ya NO es z.record(z.unknown()))', () => {
  it('19. run_evidence={} rechazado (nunca TypeError downstream)', () => {
    const evidence = fakeRunValidationEvidence({ media: [fakeMediaValidationRecord('MED-1')] });
    const malformed = { ...evidence, media: [{ ...evidence.media[0], run_evidence: {} }] };
    expect(() => validateRunValidationEvidenceEnvelope(malformed)).toThrow();
  });

  it('20. crawl.detected="CIEN" (string en campo numérico) rechazado — nunca alcanza MediaQualityMetrics', () => {
    const evidence = fakeRunValidationEvidence({
      media: [
        fakeMediaValidationRecord('MED-1', {
          run_evidence: fakeMediaEvidence('MED-1', { crawl: fakeCrawlEvidence({ detected: 'CIEN' as never }) }),
        }),
      ],
    });
    expect(() => validateRunValidationEvidenceEnvelope(evidence)).toThrow();
  });

  it('21. evidence_status=COMPLETE con crawl/enrich que NO lo respaldan (shape mínima real faltante) rechazado', () => {
    const evidence = fakeRunValidationEvidence({
      media: [
        fakeMediaValidationRecord('MED-1', {
          run_evidence: fakeMediaEvidence('MED-1', { evidence_status: 'COMPLETE', crawl: fakeCrawlEvidence(), enrich: fakeEnrichEvidence() }),
        }),
      ],
    });
    expect(() => validateRunValidationEvidenceEnvelope(evidence)).toThrow();
  });

  it('22. evidence_status fuera del enum real de Fase 1B (\'DONE\') rechazado', () => {
    const evidence = fakeRunValidationEvidence({
      media: [fakeMediaValidationRecord('MED-1', { run_evidence: fakeMediaEvidence('MED-1', { evidence_status: 'DONE' as never }) })],
    });
    expect(() => validateRunValidationEvidenceEnvelope(evidence)).toThrow();
  });

  it('23. invalid_event_count negativo rechazado', () => {
    const evidence = fakeRunValidationEvidence({
      media: [
        fakeMediaValidationRecord('MED-1', {
          run_evidence: fakeMediaEvidence('MED-1', { crawl: fakeCrawlEvidence({ invalid_event_count: -1 }) }),
        }),
      ],
    });
    expect(() => validateRunValidationEvidenceEnvelope(evidence)).toThrow();
  });

  it('24. enrich.presence fuera del enum real de Fase 1B (\'MAYBE\') rechazado', () => {
    const evidence = fakeRunValidationEvidence({
      media: [
        fakeMediaValidationRecord('MED-1', { run_evidence: fakeMediaEvidence('MED-1', { enrich: fakeEnrichEvidence({ presence: 'MAYBE' as never }) }) }),
      ],
    });
    expect(() => validateRunValidationEvidenceEnvelope(evidence)).toThrow();
  });

  it('25. persistence.after.status=COMPLETE con total_news=null (contador fabricado/faltante) rechazado', () => {
    const evidence = fakeRunValidationEvidence({
      media: [
        fakeMediaValidationRecord('MED-1', {
          persistence: fakePersistenceEvidence('MED-1', { after: fakeMediaSnapshot('MED-1', { status: 'COMPLETE', total_news: null as never }) }),
        }),
      ],
    });
    expect(() => validateRunValidationEvidenceEnvelope(evidence)).toThrow();
  });

  it('§24 cross-field: clean_text_count > total_news (violación de invariante 1C) rechazado', () => {
    const evidence = fakeRunValidationEvidence({
      media: [
        fakeMediaValidationRecord('MED-1', {
          persistence: fakePersistenceEvidence('MED-1', {
            after: fakeMediaSnapshot('MED-1', { status: 'COMPLETE', total_news: 5, clean_text_count: 9, body_count: 1 }),
          }),
        }),
      ],
    });
    expect(() => validateRunValidationEvidenceEnvelope(evidence)).toThrow();
  });

  it('26. artifact legítimo (fixture limpia de 1C) sigue aceptado (regresión)', () => {
    const evidence = fakeRunValidationEvidence({
      media: [fakeMediaValidationRecord('MED-1', { persistence: fakePersistenceEvidence('MED-1', { after: fakeMediaSnapshot('MED-1') }) })],
    });
    expect(() => validateRunValidationEvidenceEnvelope(evidence)).not.toThrow();
  });
});

describe('§49. TEST — FALSE PASS EXPLOIT (reproducción exacta del hallazgo de auditoría, Hardening B2DE)', () => {
  it('27. artifact fabricado (evidence_status=COMPLETE sin respaldo) + profile APPROVED → rechazado ANTES de metrics; nunca PASS/ELIGIBLE_FOR_PROMOTION', () => {
    // Exactamente el exploit auditado: declarar evidence_status='COMPLETE'
    // con crawl/enrich que NO lo respaldan (crawl sin provenance real,
    // enrich.presence='MISSING') para intentar fabricar un hard gate
    // "limpio" y alcanzar PASS con un CalibrationProfile APPROVED real.
    const malicious = fakeRunValidationEvidence({
      media: [
        fakeMediaValidationRecord('MED-EXPLOIT', {
          run_evidence: fakeMediaEvidence('MED-EXPLOIT', {
            evidence_status: 'COMPLETE', // fabricado
            crawl: fakeCrawlEvidence(), // provenance='NONE' — NO respalda COMPLETE
            enrich: fakeEnrichEvidence(), // presence='MISSING' — NO respalda COMPLETE
          }),
          persistence: fakePersistenceEvidence('MED-EXPLOIT', {
            status: 'VERIFIED',
            after: fakeMediaSnapshot('MED-EXPLOIT', { status: 'COMPLETE', total_news: 100, clean_text_count: 100, body_count: 100 }),
          }),
        }),
      ],
    });

    const approvedProfile: CalibrationProfile = {
      schema_version: 1,
      calibration_id: 'CAL-EXPLOIT',
      status: 'APPROVED',
      created_at: '2026-01-01T00:00:00.000Z',
      source: { label_sources: ['human_review'], based_on_calibration_id: null },
      cohort_sizes: [],
      rules: [
        {
          rule_id: 'R-CLEAN',
          kind: 'THRESHOLD',
          metric: 'ratios.persisted_clean_text_ratio',
          operator: '>=',
          pass_threshold: 0, // cualquier ratio no-negativo pasaría, de alcanzarse este punto
          fail_threshold: null,
          source_method_scope: 'GLOBAL',
        },
      ],
    };

    let reachedMetrics = false;
    let reports: unknown[] | null = null;
    function runMaliciousPipeline() {
      // Orden correcto (§29 del prompt de hardening): JSON.parse → validate → compute → evaluate.
      validateRunValidationEvidenceEnvelope(malicious);
      reachedMetrics = true; // si llegamos aquí, el hardening FALLÓ.
      const metrics = computeQualityMetricsForRun(malicious);
      reports = evaluateRun(metrics, approvedProfile);
    }

    expect(() => runMaliciousPipeline()).toThrow();
    // El artifact se rechaza ANTES de computeQualityMetricsForRun — nunca se llega a calcular métricas.
    expect(reachedMetrics).toBe(false);
    // Por tanto nunca existe un ShadowValidationReport para este artifact.
    expect(reports).toBeNull();
  });
});

describe('§50. TESTS — PROFILE HARDENING (M1DE duplicate rule_id / M2DE unknown metric / §32 PRIMARY-only)', () => {
  const baseProfile = () => ({
    schema_version: 1 as const,
    calibration_id: 'CAL-HARD',
    status: 'DRAFT' as const,
    created_at: '2026-01-01T00:00:00.000Z',
    source: { label_sources: ['human_review'], based_on_calibration_id: null },
    cohort_sizes: [],
    rules: [] as unknown[],
  });

  it('28. duplicate rule_id rechazado', () => {
    const p = {
      ...baseProfile(),
      status: 'APPROVED' as const,
      rules: [
        { rule_id: 'R1', kind: 'THRESHOLD', metric: 'ratios.persisted_clean_text_ratio', operator: '>=', pass_threshold: 0.8, fail_threshold: 0.5, source_method_scope: 'GLOBAL' },
        { rule_id: 'R1', kind: 'THRESHOLD', metric: 'ratios.persisted_body_ratio', operator: '>=', pass_threshold: 0.7, fail_threshold: 0.4, source_method_scope: 'GLOBAL' },
      ],
    };
    expect(() => validateCalibrationProfile(p)).toThrow(/rule_id duplicado/i);
  });

  it('29. metric desconocida/typo (\'ratios.persisted_clean_txt_ratio\') rechazada en runtime, nunca degrada a REVIEW silencioso', () => {
    const p = {
      ...baseProfile(),
      status: 'APPROVED' as const,
      rules: [{ rule_id: 'R1', kind: 'THRESHOLD', metric: 'ratios.persisted_clean_txt_ratio', operator: '>=', pass_threshold: 0.8, fail_threshold: 0.5, source_method_scope: 'GLOBAL' }],
    };
    expect(() => validateCalibrationProfile(p)).toThrow();
  });

  it('30. métrica DIAGNOSTIC (run_clean_text_ratio) como ThresholdRule de certificación rechazada (V1 política PRIMARY-only, §32)', () => {
    const p = {
      ...baseProfile(),
      status: 'APPROVED' as const,
      rules: [{ rule_id: 'R1', kind: 'THRESHOLD', metric: 'ratios.run_clean_text_ratio', operator: '>=', pass_threshold: 0.8, fail_threshold: 0.5, source_method_scope: 'GLOBAL' }],
    };
    expect(() => validateCalibrationProfile(p)).toThrow();
  });

  it('31. regla THRESHOLD válida sobre persisted_clean_text_ratio (PRIMARY) aceptada', () => {
    const p = {
      ...baseProfile(),
      status: 'APPROVED' as const,
      rules: [{ rule_id: 'R1', kind: 'THRESHOLD', metric: 'ratios.persisted_clean_text_ratio', operator: '>=', pass_threshold: 0.8, fail_threshold: 0.5, source_method_scope: 'GLOBAL' }],
    };
    expect(() => validateCalibrationProfile(p)).not.toThrow();
  });

  it('32. regla THRESHOLD válida sobre persisted_body_ratio (PRIMARY) aceptada', () => {
    const p = {
      ...baseProfile(),
      status: 'APPROVED' as const,
      rules: [{ rule_id: 'R1', kind: 'THRESHOLD', metric: 'ratios.persisted_body_ratio', operator: '>=', pass_threshold: 0.7, fail_threshold: 0.4, source_method_scope: 'GLOBAL' }],
    };
    expect(() => validateCalibrationProfile(p)).not.toThrow();
  });

  it('33. validación lógica higher-is-better existente sigue funcionando (regresión, sin cambios de comportamiento)', () => {
    const ok = {
      ...baseProfile(),
      status: 'APPROVED' as const,
      rules: [{ rule_id: 'R1', kind: 'THRESHOLD', metric: 'ratios.persisted_clean_text_ratio', operator: '>=', pass_threshold: 0.8, fail_threshold: 0.5, source_method_scope: 'GLOBAL' }],
    };
    expect(() => validateCalibrationProfile(ok)).not.toThrow();
  });

  it('34. rango imposible (fail_threshold > pass_threshold en higher-is-better) sigue rechazado (regresión)', () => {
    const p = {
      ...baseProfile(),
      status: 'APPROVED' as const,
      rules: [{ rule_id: 'R1', kind: 'THRESHOLD', metric: 'ratios.persisted_clean_text_ratio', operator: '>=', pass_threshold: 0.5, fail_threshold: 0.9, source_method_scope: 'GLOBAL' }],
    };
    expect(() => validateCalibrationProfile(p)).toThrow();
  });

  it('35. APPROVED con rules=[] sigue rechazado (regresión)', () => {
    expect(() => validateCalibrationProfile({ ...baseProfile(), status: 'APPROVED' as const, rules: [] })).toThrow();
  });

  it('MinimumSampleRule con metric desconocida también rechazada (allowlist, §33)', () => {
    const p = { ...baseProfile(), rules: [{ rule_id: 'R1', kind: 'MINIMUM_SAMPLE', metric: 'persisted.after_total_news_typo', minimum: 5, source_method_scope: 'GLOBAL' }] };
    expect(() => validateCalibrationProfile(p)).toThrow();
  });
});
