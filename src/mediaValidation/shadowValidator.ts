/**
 * Shadow Validator V1 — Media Validation & Certification, FASE 1E.
 *
 * Consume `MediaQualityMetrics` (Fase 1D) + `CalibrationProfile` (este
 * módulo, `calibration.ts`) y produce, REPORT-ONLY, un `ShadowValidationReport`
 * con `evaluation_status` + `validation_result` (PASS/REVIEW/FAIL/null) +
 * `recommendation`. NUNCA promueve un medio, NUNCA escribe Supabase/Sheets/
 * cron, NUNCA envía alertas — es una recomendación (§33 del prompt).
 *
 * HARD GATES (§35-38) — SIEMPRE se evalúan ANTES de mirar cualquier regla de
 * calibración, independientemente de si hay un profile APPROVED disponible:
 * `context_identity != MATCH`, `persistence.status != VERIFIED`,
 * `run_evidence.evidence_status != COMPLETE`, evidencia inválida/conflicto/
 * no soportada sin resolver. Cualquiera de estos bloquea PASS de forma
 * incondicional — nunca se convierte en un FAIL "inventado", siempre en
 * REVIEW/NOT_EVALUABLE (§43).
 *
 * THRESHOLDS (§26): ninguno se hardcodea aquí. Todos los números
 * (`pass_threshold`, `fail_threshold`, `minimum`) vienen del
 * `CalibrationProfile` que recibe esta función como parámetro.
 *
 * DRAFT vs APPROVED (§30/§58/AH): un profile `DRAFT` NUNCA puede producir
 * `recommendation='ELIGIBLE_FOR_PROMOTION'` — incluso si todas las reglas
 * "pasarían", el resultado se degrada a `REVIEW`/`REVIEW_REQUIRED` y se
 * expone el resultado hipotético en `would_be_result_if_approved`.
 *
 * DETERMINISMO (§49): sin `Date.now()`, sin `Math.random()`, sin red, sin
 * LLM. Mismo input → mismo output siempre.
 */
import type { MediaQualityMetrics } from './qualityMetrics.js';
import { getMetricValue, getEvidenceGateFailures } from './qualityMetrics.js';
import type { CalibrationProfile, CalibrationRule, RuleOperator, SourceMethodScope } from './calibration.js';
import { scopeOf } from './calibration.js';

export const SHADOW_VALIDATION_REPORT_SCHEMA_VERSION = 1;

export type EvaluationStatus = 'EVALUATED' | 'NOT_EVALUABLE' | 'CALIBRATION_REQUIRED';
export type ValidationResult = 'PASS' | 'REVIEW' | 'FAIL' | null;
/**
 * `BLOCKED_FAIL` se conserva en el tipo (§32) pero esta implementación NUNCA
 * lo emite: ninguna fuente de evidencia de 1B/1C/1D transporta hoy una señal
 * explícita de bloqueo/paywall (eso vive en el dominio NO relacionado de
 * `src/comparators/replacementReadiness.ts`/`estado_fuente`, que este módulo
 * NUNCA consulta). Se reevaluará en una fase futura si se define un input
 * explícito de bloqueo — nunca se infiere de ratios bajos.
 */
export type Recommendation = 'ELIGIBLE_FOR_PROMOTION' | 'REVIEW_REQUIRED' | 'REPAIR_AND_RETEST' | 'BLOCKED_FAIL' | null;

export type RuleOutcome = 'PASS' | 'FAIL' | 'REVIEW' | 'NOT_EVALUABLE';

export interface RuleEvaluation {
  rule_id: string;
  metric: string;
  kind: 'THRESHOLD' | 'MINIMUM_SAMPLE';
  source_method_scope: SourceMethodScope;
  observed: number | null;
  operator: RuleOperator | null;
  threshold: number | null;
  outcome: RuleOutcome;
  reason: string;
}

export interface ShadowValidationReport {
  schema_version: typeof SHADOW_VALIDATION_REPORT_SCHEMA_VERSION;
  /** `null` únicamente cuando `evaluation_status === 'CALIBRATION_REQUIRED'` por ausencia total de profile. */
  calibration_id: string | null;
  context_id: string;
  medio_id: string;
  source_method: string | null;
  evaluation_status: EvaluationStatus;
  validation_result: ValidationResult;
  recommendation: Recommendation;
  dry_run: boolean | null;
  /** `true` cuando `dry_run===true` — señal inequívoca de que ninguna recomendación es accionable como promoción real (§34). */
  simulated: boolean;
  /**
   * Resultado hipotético SI el profile usado (actualmente `DRAFT`) fuera
   * `APPROVED` tal cual — SOLO se completa cuando el profile es `DRAFT` y
   * tenía reglas para evaluar; `null` en cualquier otro caso (§27/§30).
   */
  would_be_result_if_approved: ValidationResult;
  /** Nombres de hard gates que bloquearon la evaluación (§35-38). Vacío si ninguno falló. */
  gates_failed: string[];
  rules_evaluated: RuleEvaluation[];
  issues: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Hard gates (§35-38) — HARDENING: la lógica vive ahora en
// `getEvidenceGateFailures` (qualityMetrics.ts), reutilizada aquí y por
// `calibrationEligibility.ts` (§39 del prompt de hardening: helper puro
// compartido para que validator y calibration nunca diverjan).
// ─────────────────────────────────────────────────────────────────────────────
// Selección de reglas aplicables por scope (§54) — GLOBAL nunca se aplica si
// existe una regla más específica (RSS/SITEMAP) para el MISMO metric+kind Y
// coincide con el scope real del medio; una regla RSS/SITEMAP nunca aplica a
// un medio cuyo scope real es distinto (ni siquiera GLOBAL) — política
// explícita, documentada, nunca silenciosa.
// ─────────────────────────────────────────────────────────────────────────────

function selectApplicableRules(rules: CalibrationRule[], mediumScope: SourceMethodScope): CalibrationRule[] {
  const groups = new Map<string, CalibrationRule[]>();
  for (const r of rules) {
    const key = `${r.metric}::${r.kind}`;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }

  const applicable: CalibrationRule[] = [];
  for (const group of groups.values()) {
    const specific = mediumScope !== 'GLOBAL' ? group.filter((r) => r.source_method_scope === mediumScope) : [];
    if (specific.length > 0) {
      applicable.push(...specific);
      continue;
    }
    applicable.push(...group.filter((r) => r.source_method_scope === 'GLOBAL'));
    // Reglas RSS/SITEMAP que no coinciden con `mediumScope` se excluyen
    // deliberadamente (fallback GLOBAL explícito, §54) — nunca se aplican a
    // un medio de otra fuente.
  }
  return applicable;
}

function evaluateOperator(observed: number, op: RuleOperator, threshold: number): boolean {
  switch (op) {
    case '>=':
      return observed >= threshold;
    case '>':
      return observed > threshold;
    case '<=':
      return observed <= threshold;
    case '<':
      return observed < threshold;
  }
}

function evaluateRule(rule: CalibrationRule, metrics: MediaQualityMetrics): RuleEvaluation {
  const lookup = getMetricValue(metrics, rule.metric);

  if (rule.kind === 'MINIMUM_SAMPLE') {
    if (!lookup.available || lookup.value === null) {
      return {
        rule_id: rule.rule_id,
        metric: rule.metric,
        kind: rule.kind,
        source_method_scope: rule.source_method_scope,
        observed: null,
        operator: '>=',
        threshold: rule.minimum,
        outcome: 'NOT_EVALUABLE',
        reason: 'métrica no disponible para evaluar tamaño mínimo de muestra — nunca se asume 0 (§8).',
      };
    }
    if (lookup.value >= rule.minimum) {
      return {
        rule_id: rule.rule_id,
        metric: rule.metric,
        kind: rule.kind,
        source_method_scope: rule.source_method_scope,
        observed: lookup.value,
        operator: '>=',
        threshold: rule.minimum,
        outcome: 'PASS',
        reason: `tamaño de muestra suficiente (observado=${lookup.value} >= minimum=${rule.minimum}).`,
      };
    }
    // §40: muestra insuficiente → NOT_EVALUABLE (nunca FAIL directo por esto).
    return {
      rule_id: rule.rule_id,
      metric: rule.metric,
      kind: rule.kind,
      source_method_scope: rule.source_method_scope,
      observed: lookup.value,
      operator: '>=',
      threshold: rule.minimum,
      outcome: 'NOT_EVALUABLE',
      reason: `INSUFFICIENT_SAMPLE: observado=${lookup.value} < minimum=${rule.minimum} — REVIEW, no FAIL (§40).`,
    };
  }

  // THRESHOLD
  if (!lookup.available || lookup.value === null) {
    return {
      rule_id: rule.rule_id,
      metric: rule.metric,
      kind: rule.kind,
      source_method_scope: rule.source_method_scope,
      observed: null,
      operator: rule.operator,
      threshold: rule.pass_threshold,
      outcome: 'NOT_EVALUABLE',
      reason: 'métrica no disponible (UNAVAILABLE/NOT_APPLICABLE) — nunca PASS optimista (§53 del prompt de 1D / §66 de 1E).',
    };
  }

  const observed = lookup.value;
  if (evaluateOperator(observed, rule.operator, rule.pass_threshold)) {
    return {
      rule_id: rule.rule_id,
      metric: rule.metric,
      kind: rule.kind,
      source_method_scope: rule.source_method_scope,
      observed,
      operator: rule.operator,
      threshold: rule.pass_threshold,
      outcome: 'PASS',
      reason: `observado=${observed} ${rule.operator} pass_threshold=${rule.pass_threshold}.`,
    };
  }

  if (rule.fail_threshold !== null) {
    const higherBetter = rule.operator === '>=' || rule.operator === '>';
    const crossesFail = higherBetter ? observed < rule.fail_threshold : observed > rule.fail_threshold;
    if (crossesFail) {
      return {
        rule_id: rule.rule_id,
        metric: rule.metric,
        kind: rule.kind,
        source_method_scope: rule.source_method_scope,
        observed,
        operator: rule.operator,
        threshold: rule.fail_threshold,
        outcome: 'FAIL',
        reason: `observado=${observed} cruza fail_threshold=${rule.fail_threshold} — evidencia suficiente + threshold APROBADO (§43).`,
      };
    }
  }

  // Banda REVIEW (§53): ni cumple pass_threshold ni cruza fail_threshold
  // (o no hay fail_threshold definido) — distribuciones con overlap real,
  // nunca se fuerza una frontera perfecta inexistente.
  return {
    rule_id: rule.rule_id,
    metric: rule.metric,
    kind: rule.kind,
    source_method_scope: rule.source_method_scope,
    observed,
    operator: rule.operator,
    threshold: rule.pass_threshold,
    outcome: 'REVIEW',
    reason: `observado=${observed} no alcanza pass_threshold=${rule.pass_threshold} pero tampoco cruza fail_threshold=${rule.fail_threshold ?? 'null'} — banda REVIEW.`,
  };
}

/**
 * Combina outcomes de reglas individuales en un único `ValidationResult`.
 * Precedencia EXPLÍCITA (política declarada, no accidental): cualquier regla
 * `NOT_EVALUABLE` domina (§66: "no optimistic PASS" ante métrica faltante);
 * si no, cualquier `FAIL` domina (§65: "one metric pass + one fail → FAIL");
 * si no, cualquier `REVIEW` domina; solo si TODAS las reglas son `PASS` el
 * resultado combinado es `PASS`.
 */
function combineRuleOutcomes(rules: RuleEvaluation[]): ValidationResult {
  if (rules.length === 0) return null;
  if (rules.some((r) => r.outcome === 'NOT_EVALUABLE')) return 'REVIEW';
  if (rules.some((r) => r.outcome === 'FAIL')) return 'FAIL';
  if (rules.some((r) => r.outcome === 'REVIEW')) return 'REVIEW';
  return 'PASS';
}

function recommendationFor(result: ValidationResult): Recommendation {
  switch (result) {
    case 'PASS':
      return 'ELIGIBLE_FOR_PROMOTION';
    case 'REVIEW':
      return 'REVIEW_REQUIRED';
    case 'FAIL':
      return 'REPAIR_AND_RETEST';
    case null:
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// evaluateMedia — entrada principal
// ─────────────────────────────────────────────────────────────────────────────

export function evaluateMedia(metrics: MediaQualityMetrics, profile: CalibrationProfile | null): ShadowValidationReport {
  const base = {
    schema_version: SHADOW_VALIDATION_REPORT_SCHEMA_VERSION as typeof SHADOW_VALIDATION_REPORT_SCHEMA_VERSION,
    context_id: metrics.context_id,
    medio_id: metrics.medio_id,
    source_method: metrics.source_method,
    dry_run: metrics.evidence_snapshot.dry_run,
  };

  // §59: sin profile en absoluto → CALIBRATION_REQUIRED. El engine está
  // listo, pero no hay ninguna calibración con la que evaluar.
  if (profile === null) {
    return {
      ...base,
      calibration_id: null,
      evaluation_status: 'CALIBRATION_REQUIRED',
      validation_result: null,
      recommendation: null,
      simulated: false,
      would_be_result_if_approved: null,
      gates_failed: [],
      rules_evaluated: [],
      issues: ['no se proveyó ningún CalibrationProfile — CALIBRATION_REQUIRED (§59: no se inventan thresholds).'],
    };
  }

  const issues: string[] = [];

  // Hard gates (§35-38) — SIEMPRE antes de mirar reglas, con o sin profile APPROVED.
  const gatesFailed = getEvidenceGateFailures(metrics.gates);
  if (gatesFailed.length > 0) {
    for (const g of gatesFailed) issues.push(`hard gate fallido: ${g}`);
    return {
      ...base,
      calibration_id: profile.calibration_id,
      evaluation_status: 'NOT_EVALUABLE',
      validation_result: 'REVIEW',
      recommendation: 'REVIEW_REQUIRED',
      simulated: false,
      would_be_result_if_approved: null,
      gates_failed: gatesFailed,
      rules_evaluated: [],
      issues,
    };
  }

  if (profile.rules.length === 0) {
    return {
      ...base,
      calibration_id: profile.calibration_id,
      evaluation_status: 'CALIBRATION_REQUIRED',
      validation_result: null,
      recommendation: null,
      simulated: false,
      would_be_result_if_approved: null,
      gates_failed: [],
      rules_evaluated: [],
      issues: [
        `CalibrationProfile '${profile.calibration_id}' (status=${profile.status}) no tiene reglas (rules=[]) — ` +
          'nada que evaluar todavía (§27: DRAFT sin reglas no autoriza nada; un profile sin reglas nunca produce PASS/FAIL).',
      ],
    };
  }

  const mediumScope = scopeOf(metrics.source_method);
  const applicableRules = selectApplicableRules(profile.rules, mediumScope);

  if (applicableRules.length === 0) {
    return {
      ...base,
      calibration_id: profile.calibration_id,
      evaluation_status: 'NOT_EVALUABLE',
      validation_result: 'REVIEW',
      recommendation: 'REVIEW_REQUIRED',
      simulated: false,
      would_be_result_if_approved: null,
      gates_failed: [],
      rules_evaluated: [],
      issues: [`ninguna regla del profile aplica al scope de este medio (source_method resuelto=${mediumScope}, §54).`],
    };
  }

  const rulesEvaluated = applicableRules.map((r) => evaluateRule(r, metrics));
  const combined = combineRuleOutcomes(rulesEvaluated);

  let validationResult: ValidationResult = combined;
  let wouldBeResultIfApproved: ValidationResult = null;

  // §30/§58/AH: DRAFT nunca produce PASS operativo. Se degrada a REVIEW y se
  // conserva el resultado hipotético para preview (FAIL/REVIEW no se
  // degradan — solo PASS, que es lo único que podría confundirse con una
  // certificación real).
  if (profile.status === 'DRAFT') {
    wouldBeResultIfApproved = combined;
    if (combined === 'PASS') {
      validationResult = 'REVIEW';
      issues.push(
        `profile '${profile.calibration_id}' está en status=DRAFT — un DRAFT nunca puede producir PASS operativo/` +
          'ELIGIBLE_FOR_PROMOTION (§30/§58/AH); resultado degradado a REVIEW. Ver would_be_result_if_approved para el preview.',
      );
    }
  }

  let recommendation = recommendationFor(validationResult);
  let simulated = false;

  // §34: dry_run nunca puede producir una recomendación indistinguible de
  // promoción real.
  if (metrics.evidence_snapshot.dry_run === true) {
    simulated = true;
    if (recommendation === 'ELIGIBLE_FOR_PROMOTION') {
      recommendation = 'REVIEW_REQUIRED';
      issues.push('dry_run=true — recommendation degradada de ELIGIBLE_FOR_PROMOTION a REVIEW_REQUIRED (simulación, §34).');
    }
  }

  return {
    ...base,
    calibration_id: profile.calibration_id,
    evaluation_status: 'EVALUATED',
    validation_result: validationResult,
    recommendation,
    simulated,
    would_be_result_if_approved: wouldBeResultIfApproved,
    gates_failed: [],
    rules_evaluated: rulesEvaluated,
    issues,
  };
}

/** Batch — acepta una colección de `MediaQualityMetrics` (§60/§61, O(N×R)). */
export function evaluateRun(metrics: MediaQualityMetrics[], profile: CalibrationProfile | null): ShadowValidationReport[] {
  return metrics.map((m) => evaluateMedia(m, profile));
}
