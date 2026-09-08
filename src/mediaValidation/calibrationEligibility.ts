/**
 * Calibration Eligibility — Media Validation & Certification, FASE 1D/1E
 * HARDENING FOCAL (B1DE — "CONTAMINATED CALIBRATION").
 *
 * Una auditoría adversarial READ-ONLY demostró que una observación con
 * `persisted_clean_text_ratio` `AVAILABLE`/calculable pero
 * `persistence_status='INDETERMINATE'` (o cualquier otro hard gate
 * incumplido) entraba en `metric_distributions`/`candidate_thresholds`
 * como si fuera una muestra confiable de calidad. Esto CONTAMINA la
 * calibración: el engine aprendería thresholds a partir de evidencia que ni
 * siquiera pasaría el propio hard gate de `shadowValidator.ts` para PASS.
 *
 * Este módulo introduce `CalibrationEligibility`: un concepto PURO,
 * derivado EXCLUSIVAMENTE de evidencia/metrics (`MediaQualityMetrics.gates`)
 * — NUNCA de `ReferenceLabel` (§11 del prompt de hardening: "labels no
 * cambian eligibility". `GOOD_REFERENCE`/`TEXT_BAD_REFERENCE` no pueden
 * saltarse un gate incumplido).
 *
 * "CALCULABLE != ELIGIBLE" (§6 del prompt de hardening): una ratio puede
 * seguir siendo `availability='AVAILABLE'` con un `value` numérico concreto
 * aunque la observación NO sea elegible para calibración — el número se
 * conserva íntegro (trazabilidad, ver `MediaQualityMetrics.ratios`), pero
 * `eligible=false` impide que ese valor entre en
 * mean/median/quantiles/candidate-thresholds/confusion-matrices
 * (`calibration.ts` filtra por esto antes de construir distributions).
 *
 * HELPER COMPARTIDO (§39 del prompt de hardening): `getEvidenceGateFailures`
 * (definido en `qualityMetrics.ts`) es la ÚNICA fuente de verdad sobre qué
 * cuenta como "evidencia confiable" — la usa tanto `shadowValidator.ts`
 * (para bloquear PASS) como este módulo (para excluir de calibración). Así
 * se evita que ambos consumidores diverjan silenciosamente.
 */
import { getEvidenceGateFailures, type MediaQualityMetrics } from './qualityMetrics.js';

/**
 * Razones de exclusión — taxonomía DELIBERADAMENTE pequeña (§40 del prompt
 * de hardening: "no giant taxonomy"), mapeada 1:1 desde los hard gates de
 * `getEvidenceGateFailures`.
 */
export type CalibrationExclusionReason =
  | 'CONTEXT_IDENTITY_NOT_MATCH'
  | 'PERSISTENCE_NOT_VERIFIED'
  | 'RUN_EVIDENCE_NOT_COMPLETE'
  | 'INVALID_EVIDENCE'
  | 'UNSUPPORTED_EVIDENCE'
  | 'UNRESOLVED_EVIDENCE_CONFLICT';

export const CALIBRATION_EXCLUSION_REASONS = [
  'CONTEXT_IDENTITY_NOT_MATCH',
  'PERSISTENCE_NOT_VERIFIED',
  'RUN_EVIDENCE_NOT_COMPLETE',
  'INVALID_EVIDENCE',
  'UNSUPPORTED_EVIDENCE',
  'UNRESOLVED_EVIDENCE_CONFLICT',
] as const satisfies readonly CalibrationExclusionReason[];

export interface CalibrationEligibility {
  eligible: boolean;
  /** Vacío cuando `eligible === true`. Puede contener más de una razón simultánea. */
  exclusion_reasons: CalibrationExclusionReason[];
}

/** Traduce cada código interno de `getEvidenceGateFailures` a su `CalibrationExclusionReason` correspondiente. */
const GATE_FAILURE_TO_EXCLUSION_REASON: Record<string, CalibrationExclusionReason> = {
  context_identity_mismatch: 'CONTEXT_IDENTITY_NOT_MATCH',
  persistence_not_verified: 'PERSISTENCE_NOT_VERIFIED',
  run_evidence_not_complete: 'RUN_EVIDENCE_NOT_COMPLETE',
  invalid_evidence_present: 'INVALID_EVIDENCE',
  unsupported_evidence_present: 'UNSUPPORTED_EVIDENCE',
  unresolved_evidence_conflict: 'UNRESOLVED_EVIDENCE_CONFLICT',
};

/**
 * Calcula elegibilidad de calibración para UNA observación
 * (`MediaQualityMetrics`). EXCLUSIVAMENTE evidencia/metrics — nunca recibe
 * ni consulta `ReferenceLabel`/`label_source` (§4/§11 del prompt de
 * hardening).
 */
export function computeCalibrationEligibility(metrics: MediaQualityMetrics): CalibrationEligibility {
  const gateFailures = getEvidenceGateFailures(metrics.gates);
  const exclusion_reasons = gateFailures
    .map((f) => GATE_FAILURE_TO_EXCLUSION_REASON[f])
    .filter((r): r is CalibrationExclusionReason => r !== undefined);
  return { eligible: exclusion_reasons.length === 0, exclusion_reasons };
}
