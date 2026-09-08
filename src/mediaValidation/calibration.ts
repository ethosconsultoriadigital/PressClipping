/**
 * Calibration Engine — Media Validation & Certification, FASE 1E.
 *
 * Convierte observaciones etiquetadas (`MediaQualityMetrics` + `ReferenceLabel`
 * + `label_source`) en un `CalibrationReport` (distribuciones, missingness,
 * class balance, candidatos de threshold determinísticos) y una `DRAFT
 * CalibrationProfile` — NUNCA una `APPROVED` (§30/§58 del prompt: la
 * aprobación es SIEMPRE una acción humana explícita posterior, nunca
 * automatizada por este módulo).
 *
 * REGLA ABSOLUTA (§26 del prompt): ningún threshold se hardcodea en
 * TypeScript. Los "candidate thresholds" de este módulo son FRONTERAS
 * OBSERVADAS en los datos reales (§28 — nunca números elegidos por
 * intuición) y se exponen TODOS, nunca se elige uno silenciosamente como
 * "el mejor". Un `CalibrationProfile.status='DRAFT'` generado aquí SIEMPRE
 * tiene `rules: []` — ninguna regla operativa se activa hasta que un humano
 * la copie explícitamente a un profile `APPROVED`.
 *
 * SIN DATOS SUFICIENTES (§52/§59): nunca se inventa un threshold. Se marca
 * `INSUFFICIENT_CALIBRATION_DATA` de forma explícita.
 */
import { getMetricValue, METRIC_KIND, type MediaQualityMetrics, type MediaQualityRatios } from './qualityMetrics.js';
import {
  POSITIVE_REFERENCE_LABEL,
  PROBLEM_REFERENCE_LABELS,
  type LabelSource,
  type ReferenceLabel,
} from './referenceLabels.js';
import { computeCalibrationEligibility, type CalibrationExclusionReason } from './calibrationEligibility.js';

export const CALIBRATION_REPORT_SCHEMA_VERSION = 1;
export const CALIBRATION_PROFILE_SCHEMA_VERSION = 1;

// ─────────────────────────────────────────────────────────────────────────────
// Input — una observación = una (medio_id, context_id) etiquetada.
// ─────────────────────────────────────────────────────────────────────────────

export interface LabeledObservation {
  medio_id: string;
  context_id: string;
  label: ReferenceLabel;
  label_source: LabelSource;
  metrics: MediaQualityMetrics;
}

/**
 * Identidad de observación (Hardening focal, B3DE/§12): `(context_id,
 * medio_id)`. Dos context_id distintos para el mismo medio_id son
 * observaciones DISTINTAS y legítimas (§15 del prompt de hardening) — NUNCA
 * se dedupe por `medio_id` solamente.
 */
function observationIdentity(obs: Pick<LabeledObservation, 'context_id' | 'medio_id'>): string {
  return `${obs.context_id}::${obs.medio_id}`;
}

/**
 * Rechaza (nunca dedupe silenciosamente) identidades de observación
 * duplicadas ANTES de cualquier cómputo de distributions/candidate
 * thresholds (Hardening focal, B3DE/§13-14: "defense in depth" — esta
 * comprobación vive en la función PURA, no solo en el CLI, para que una
 * llamada programática futura tampoco pueda sesgar calibración).
 */
function assertNoDuplicateObservations(observations: LabeledObservation[]): void {
  const seen = new Set<string>();
  for (const obs of observations) {
    const identity = observationIdentity(obs);
    if (seen.has(identity)) {
      throw new Error(
        `buildCalibrationReport: observación duplicada detectada — identidad (context_id='${obs.context_id}', ` +
          `medio_id='${obs.medio_id}') aparece más de una vez en el input de calibración (Hardening B3DE). ` +
          'No se dedupe silenciosamente: dos observaciones con la MISMA identidad pero contenido potencialmente ' +
          'distinto sesgarían class_balance/metric_distributions/candidate_thresholds por doble conteo. Revisa el ' +
          'input (¿el mismo archivo --evidence se pasó dos veces? ¿dos RunValidationEvidence distintos comparten ' +
          'context_id?) antes de recalibrar. Un mismo medio_id con un context_id DISTINTO sigue siendo válido ' +
          '(observation-level calibration, §15).',
      );
    }
    seen.add(identity);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Estadística descriptiva determinista — sin dependencias externas (§22).
// ─────────────────────────────────────────────────────────────────────────────

export interface CohortStats {
  count: number;
  available_count: number;
  missing_count: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  median: number | null;
  p10: number | null;
  p25: number | null;
  p75: number | null;
  p90: number | null;
}

/**
 * Percentil determinista por interpolación lineal (método "R-7"/Excel
 * `PERCENTILE.INC`, ampliamente documentado y reproducible). `values` DEBE
 * venir ya ordenado ascendente y sin `null`.
 */
export function percentile(sortedValues: number[], p: number): number | null {
  const n = sortedValues.length;
  if (n === 0) return null;
  if (n === 1) return sortedValues[0]!;
  const rank = (p / 100) * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const frac = rank - lo;
  if (lo === hi) return sortedValues[lo]!;
  return sortedValues[lo]! + (sortedValues[hi]! - sortedValues[lo]!) * frac;
}

/** `values` puede incluir `null` (se cuentan como missing, nunca como 0 — §8). */
export function computeCohortStats(values: (number | null)[]): CohortStats {
  const available = values.filter((v): v is number => v !== null && Number.isFinite(v));
  const sorted = [...available].sort((a, b) => a - b);
  const n = sorted.length;

  const mean = n > 0 ? sorted.reduce((acc, v) => acc + v, 0) / n : null;

  return {
    count: values.length,
    available_count: n,
    missing_count: values.length - n,
    min: n > 0 ? sorted[0]! : null,
    max: n > 0 ? sorted[n - 1]! : null,
    mean,
    median: percentile(sorted, 50),
    p10: percentile(sorted, 10),
    p25: percentile(sorted, 25),
    p75: percentile(sorted, 75),
    p90: percentile(sorted, 90),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Class balance / missingness / source-method support (§21/§23/§24)
// ─────────────────────────────────────────────────────────────────────────────

export interface ClassBalanceEntry {
  label: ReferenceLabel;
  /** Nº de `medio_id` DISTINTOS con este label (§21: distinguir medio de observación). RAW — incluye observaciones excluidas de calibración. */
  number_of_media: number;
  /** Nº total de observaciones (medio_id, context_id) con este label — puede ser > number_of_media. RAW — incluye observaciones excluidas de calibración. */
  number_of_observations: number;
  /**
   * Subconjunto de `number_of_observations` que pasó los hard evidence
   * gates (Hardening focal, §8/§9: "eligible_for_calibration=true") y por
   * tanto SÍ participa en `metric_distributions`/`candidate_thresholds`.
   */
  eligible_observations: number;
  /** `number_of_observations - eligible_observations` — nunca se oculta la exclusión (§8 del prompt de hardening). */
  excluded_observations: number;
}

export type SourceScope = 'GLOBAL' | 'RSS' | 'SITEMAP';

/** Resuelve el `source_method` real de un medio al scope de calibración/validación correspondiente (§24/§54). */
export function scopeOf(sourceMethod: string | null): SourceScope {
  if (sourceMethod === 'rss') return 'RSS';
  if (sourceMethod === 'sitemap') return 'SITEMAP';
  return 'GLOBAL';
}

export interface SourceMethodSupportEntry {
  source_scope: SourceScope;
  number_of_media: number;
  number_of_observations: number;
}

function buildClassBalance(observations: LabeledObservation[]): ClassBalanceEntry[] {
  const byLabel = new Map<ReferenceLabel, { media: Set<string>; observations: number; eligible: number }>();
  for (const obs of observations) {
    const entry = byLabel.get(obs.label) ?? { media: new Set<string>(), observations: 0, eligible: 0 };
    entry.media.add(obs.medio_id);
    entry.observations += 1;
    if (computeCalibrationEligibility(obs.metrics).eligible) entry.eligible += 1;
    byLabel.set(obs.label, entry);
  }
  const result: ClassBalanceEntry[] = [];
  for (const [label, entry] of byLabel) {
    result.push({
      label,
      number_of_media: entry.media.size,
      number_of_observations: entry.observations,
      eligible_observations: entry.eligible,
      excluded_observations: entry.observations - entry.eligible,
    });
  }
  result.sort((a, b) => a.label.localeCompare(b.label));
  return result;
}

function buildSourceMethodSupport(observations: LabeledObservation[]): SourceMethodSupportEntry[] {
  const byScope = new Map<SourceScope, { media: Set<string>; observations: number }>();
  for (const obs of observations) {
    const scope = scopeOf(obs.metrics.source_method);
    const entry = byScope.get(scope) ?? { media: new Set<string>(), observations: 0 };
    entry.media.add(obs.medio_id);
    entry.observations += 1;
    byScope.set(scope, entry);
  }
  const result: SourceMethodSupportEntry[] = [];
  for (const [scope, entry] of byScope) {
    result.push({ source_scope: scope, number_of_media: entry.media.size, number_of_observations: entry.observations });
  }
  result.sort((a, b) => a.source_scope.localeCompare(b.source_scope));
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Metric distributions por label × scope (§9/§24)
// ─────────────────────────────────────────────────────────────────────────────

/** Solo se calibran las ratios candidatas del contrato de Fase 1D (§9 del prompt de 1D). */
export const CALIBRATABLE_METRICS: readonly (keyof MediaQualityRatios)[] = [
  'persisted_clean_text_ratio',
  'persisted_body_ratio',
  'run_clean_text_ratio',
  'run_body_ratio',
  'enrich_failure_ratio',
];

export interface MetricCohortEntry {
  label: ReferenceLabel;
  source_scope: SourceScope;
  stats: CohortStats;
}

export interface MetricDistribution {
  metric: string;
  metric_kind: 'PRIMARY' | 'DIAGNOSTIC';
  by_label: MetricCohortEntry[];
}

function metricValuesFor(observations: LabeledObservation[], metricKey: string): (number | null)[] {
  return observations.map((obs) => {
    const lookup = getMetricValue(obs.metrics, metricKey);
    return lookup.available ? lookup.value : null;
  });
}

function buildMetricDistributions(observations: LabeledObservation[]): MetricDistribution[] {
  const distributions: MetricDistribution[] = [];
  for (const metric of CALIBRATABLE_METRICS) {
    const metricKey = `ratios.${metric}`;
    const byLabel: MetricCohortEntry[] = [];

    const labelScopePairs = new Map<string, LabeledObservation[]>();
    for (const obs of observations) {
      const scope = scopeOf(obs.metrics.source_method);
      const key = `${obs.label}::${scope}`;
      const list = labelScopePairs.get(key) ?? [];
      list.push(obs);
      labelScopePairs.set(key, list);
    }
    // GLOBAL por label (todas las scopes combinadas) + RSS/SITEMAP por label (§24).
    const byLabelOnly = new Map<ReferenceLabel, LabeledObservation[]>();
    for (const obs of observations) {
      const list = byLabelOnly.get(obs.label) ?? [];
      list.push(obs);
      byLabelOnly.set(obs.label, list);
    }
    for (const [label, list] of byLabelOnly) {
      byLabel.push({ label, source_scope: 'GLOBAL', stats: computeCohortStats(metricValuesFor(list, metricKey)) });
    }
    for (const [key, list] of labelScopePairs) {
      const [label, scope] = key.split('::') as [ReferenceLabel, SourceScope];
      if (scope === 'GLOBAL') continue; // ya cubierto arriba (GLOBAL agrega TODAS las scopes, no solo los sin scope conocido)
      byLabel.push({ label, source_scope: scope, stats: computeCohortStats(metricValuesFor(list, metricKey)) });
    }
    byLabel.sort((a, b) => (a.label === b.label ? a.source_scope.localeCompare(b.source_scope) : a.label.localeCompare(b.label)));

    distributions.push({ metric, metric_kind: METRIC_KIND[metric], by_label: byLabel });
  }
  return distributions;
}

// ─────────────────────────────────────────────────────────────────────────────
// Candidate thresholds — determinista, sin elegir un "ganador" (§28)
// ─────────────────────────────────────────────────────────────────────────────

export interface ConfusionMatrixAtThreshold {
  threshold: number;
  /** Predicción positiva = `valor >= threshold` (siempre esta dirección — las ratios candidatas son todas "más alto es mejor"). */
  tp: number;
  fp: number;
  tn: number;
  fn: number;
  precision: number | null;
  recall: number | null;
  balanced_accuracy: number | null;
}

export type CandidateThresholdsStatus = 'CANDIDATES_AVAILABLE' | 'INSUFFICIENT_CALIBRATION_DATA';

export interface CandidateThresholds {
  metric: string;
  source_scope: SourceScope;
  positive_label: ReferenceLabel;
  negative_labels: ReferenceLabel[];
  status: CandidateThresholdsStatus;
  reason: string | null;
  /** TODOS los candidatos observados, ordenados por `balanced_accuracy` desc SOLO para lectura — nunca implica una elección automática. */
  candidates: ConfusionMatrixAtThreshold[];
}

function confusionMatrixAt(
  threshold: number,
  positiveValues: number[],
  negativeValues: number[],
): ConfusionMatrixAtThreshold {
  let tp = 0;
  let fn = 0;
  for (const v of positiveValues) {
    if (v >= threshold) tp++;
    else fn++;
  }
  let fp = 0;
  let tn = 0;
  for (const v of negativeValues) {
    if (v >= threshold) fp++;
    else tn++;
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : null;
  const recall = tp + fn > 0 ? tp / (tp + fn) : null;
  const specificity = tn + fp > 0 ? tn / (tn + fp) : null;
  const balanced_accuracy = recall !== null && specificity !== null ? (recall + specificity) / 2 : null;

  return { threshold, tp, fp, tn, fn, precision, recall, balanced_accuracy };
}

function buildCandidateThresholds(observations: LabeledObservation[]): CandidateThresholds[] {
  const out: CandidateThresholds[] = [];

  for (const metric of CALIBRATABLE_METRICS) {
    const metricKey = `ratios.${metric}`;
    for (const scope of ['GLOBAL', 'RSS', 'SITEMAP'] as const) {
      const scoped = scope === 'GLOBAL' ? observations : observations.filter((o) => scopeOf(o.metrics.source_method) === scope);

      const positiveValues: number[] = [];
      const negativeValues: number[] = [];
      for (const obs of scoped) {
        const lookup = getMetricValue(obs.metrics, metricKey);
        if (!lookup.available || lookup.value === null) continue; // §8: nunca se fabrica un valor para calibrar
        if (obs.label === POSITIVE_REFERENCE_LABEL) positiveValues.push(lookup.value);
        else if ((PROBLEM_REFERENCE_LABELS as readonly ReferenceLabel[]).includes(obs.label)) negativeValues.push(lookup.value);
      }

      // §52/§24/§25: guard NO inventado — la única condición es la necesidad
      // lógica de tener AL MENOS una observación de cada clase para que una
      // matriz de confusión tenga sentido. NO se exige un tamaño mínimo
      // arbitrario (eso viviría en un CalibrationProfile aprobado, no aquí).
      if (positiveValues.length === 0 || negativeValues.length === 0) {
        out.push({
          metric,
          source_scope: scope,
          positive_label: POSITIVE_REFERENCE_LABEL,
          negative_labels: [...PROBLEM_REFERENCE_LABELS],
          status: 'INSUFFICIENT_CALIBRATION_DATA',
          reason: `cohortes insuficientes para ${scope}/${metric}: positivos=${positiveValues.length}, problema=${negativeValues.length} (se requiere >=1 de cada clase).`,
          candidates: [],
        });
        continue;
      }

      // Fronteras OBSERVADAS (§28) — nunca un valor inventado.
      const distinctValues = [...new Set([...positiveValues, ...negativeValues])].sort((a, b) => a - b);
      const candidates = distinctValues.map((t) => confusionMatrixAt(t, positiveValues, negativeValues));
      // Orden de LECTURA (balanced_accuracy desc; empates por threshold asc para determinismo) — NO es una selección.
      candidates.sort((a, b) => {
        const ba = a.balanced_accuracy ?? -1;
        const bb = b.balanced_accuracy ?? -1;
        if (ba !== bb) return bb - ba;
        return a.threshold - b.threshold;
      });

      out.push({
        metric,
        source_scope: scope,
        positive_label: POSITIVE_REFERENCE_LABEL,
        negative_labels: [...PROBLEM_REFERENCE_LABELS],
        status: 'CANDIDATES_AVAILABLE',
        reason: null,
        candidates,
      });
    }
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Overlap notes (§53) — nunca fingir una frontera perfecta.
// ─────────────────────────────────────────────────────────────────────────────

function buildOverlapNotes(distributions: MetricDistribution[]): string[] {
  const notes: string[] = [];
  for (const dist of distributions) {
    const good = dist.by_label.find((e) => e.label === 'GOOD_REFERENCE' && e.source_scope === 'GLOBAL');
    for (const problemLabel of PROBLEM_REFERENCE_LABELS) {
      const bad = dist.by_label.find((e) => e.label === problemLabel && e.source_scope === 'GLOBAL');
      if (!good || !bad) continue;
      if (good.stats.available_count === 0 || bad.stats.available_count === 0) continue;
      const goodMin = good.stats.min!;
      const goodMax = good.stats.max!;
      const badMin = bad.stats.min!;
      const badMax = bad.stats.max!;
      const overlaps = goodMin <= badMax && badMin <= goodMax;
      if (overlaps) {
        notes.push(
          `${dist.metric}: distribución de ${POSITIVE_REFERENCE_LABEL} [${goodMin.toFixed(3)}, ${goodMax.toFixed(3)}] se superpone con ` +
            `${problemLabel} [${badMin.toFixed(3)}, ${badMax.toFixed(3)}] — no existe una frontera perfecta observada (§53); ` +
            'considerar una banda REVIEW más amplia en vez de un único threshold binario.',
        );
      }
    }
  }
  return notes;
}

// ─────────────────────────────────────────────────────────────────────────────
// CalibrationReport
// ─────────────────────────────────────────────────────────────────────────────

export interface RejectedLabelSummary {
  medio_id: string;
  reason: string;
}

/**
 * Diagnóstico de UNA observación excluida de calibración (Hardening focal,
 * §7/§44 del prompt: "qué se excluyó, por qué, de qué cohort" — trazable al
 * menos por `context_id`/`medio_id`/`label`, sin duplicar el objeto
 * `MediaQualityMetrics` completo).
 */
export interface ExcludedObservationSummary {
  medio_id: string;
  context_id: string;
  label: ReferenceLabel;
  reasons: CalibrationExclusionReason[];
}

/**
 * Metadata explícita de ponderación (Hardening focal, §15-16 del prompt):
 * las estadísticas de este report están ponderadas POR OBSERVACIÓN
 * (context_id, medio_id), no por medio_id único — varios context_id del
 * mismo medio_id pesan varias veces. Se expone en el JSON para que sea
 * autoexplicativo, no solo un comentario de código fuente.
 */
export type CalibrationWeighting = 'PER_OBSERVATION';

export interface CalibrationReport {
  schema_version: typeof CALIBRATION_REPORT_SCHEMA_VERSION;
  calibration_id: string;
  generated_at: string;
  weighting: CalibrationWeighting;
  input_summary: {
    /** RAW — todas las observaciones etiquetadas, incluidas las excluidas de calibración. */
    number_of_media: number;
    /** RAW — todas las observaciones etiquetadas, incluidas las excluidas de calibración. */
    number_of_observations: number;
    /** Subconjunto de `number_of_observations` que pasó los hard evidence gates (Hardening B1DE). */
    eligible_observations: number;
    /** `number_of_observations - eligible_observations`. */
    excluded_observations: number;
    label_sources: LabelSource[];
  };
  class_balance: ClassBalanceEntry[];
  source_method_support: SourceMethodSupportEntry[];
  /** SOLO observaciones `eligible_for_calibration=true` (Hardening B1DE/§9). */
  metric_distributions: MetricDistribution[];
  /** SOLO observaciones `eligible_for_calibration=true` (Hardening B1DE/§10). */
  candidate_thresholds: CandidateThresholds[];
  overlap_notes: string[];
  /** Diagnóstico explícito de cada observación excluida y su(s) razón(es) (Hardening B1DE/§7/§44). */
  excluded_observations: ExcludedObservationSummary[];
  warnings: string[];
}

export interface BuildCalibrationReportOptions {
  calibrationId: string;
  /** Inyectable para tests deterministas — nunca influye en las decisiones, solo es metadata (§49). */
  generatedAt?: string;
}

function buildExcludedObservationsSummary(observations: LabeledObservation[]): ExcludedObservationSummary[] {
  const excluded: ExcludedObservationSummary[] = [];
  for (const obs of observations) {
    const eligibility = computeCalibrationEligibility(obs.metrics);
    if (!eligibility.eligible) {
      excluded.push({
        medio_id: obs.medio_id,
        context_id: obs.context_id,
        label: obs.label,
        reasons: eligibility.exclusion_reasons,
      });
    }
  }
  return excluded;
}

export function buildCalibrationReport(
  observations: LabeledObservation[],
  opts: BuildCalibrationReportOptions,
): CalibrationReport {
  // Hardening B3DE/§13-14: rechazar identidades de observación duplicadas
  // ANTES de cualquier cómputo — defense in depth, esta función pura es la
  // única barrera obligatoria (el CLI puede dar un mensaje mejor, pero no
  // es la única línea de defensa).
  assertNoDuplicateObservations(observations);

  const warnings: string[] = [];
  if (observations.length === 0) {
    warnings.push('no se proveyeron observaciones etiquetadas — CalibrationReport vacío, todos los candidatos serán INSUFFICIENT_CALIBRATION_DATA.');
  }

  const numberOfMedia = new Set(observations.map((o) => o.medio_id)).size;
  const labelSources = [...new Set(observations.map((o) => o.label_source))].sort();

  // Hardening B1DE (§5-10 del prompt de hardening): SOLO observaciones que
  // pasan los mismos hard evidence gates que protegen PASS (via
  // `computeCalibrationEligibility`, helper compartido con
  // `shadowValidator.ts`) alimentan distributions/candidate thresholds. Una
  // ratio "AVAILABLE" con evidencia no confiable (context MISMATCH,
  // persistence no VERIFIED, run evidence no COMPLETE, invalid/unsupported/
  // conflict) NUNCA entra como muestra legítima — se reporta en
  // `excluded_observations`, nunca se descarta en silencio.
  const eligibleObservations = observations.filter((o) => computeCalibrationEligibility(o.metrics).eligible);
  const excludedObservations = observations.length - eligibleObservations.length;
  const metricDistributions = buildMetricDistributions(eligibleObservations);

  if (excludedObservations > 0) {
    warnings.push(
      `${excludedObservations} de ${observations.length} observación(es) etiquetada(s) EXCLUIDA(s) de calibración por ` +
        'no pasar los hard evidence gates (Hardening B1DE) — ver excluded_observations para el detalle por observación.',
    );
  }

  return {
    schema_version: CALIBRATION_REPORT_SCHEMA_VERSION,
    calibration_id: opts.calibrationId,
    generated_at: opts.generatedAt ?? new Date().toISOString(),
    weighting: 'PER_OBSERVATION',
    input_summary: {
      number_of_media: numberOfMedia,
      number_of_observations: observations.length,
      eligible_observations: eligibleObservations.length,
      excluded_observations: excludedObservations,
      label_sources: labelSources,
    },
    class_balance: buildClassBalance(observations),
    source_method_support: buildSourceMethodSupport(observations),
    metric_distributions: metricDistributions,
    candidate_thresholds: buildCandidateThresholds(eligibleObservations),
    overlap_notes: buildOverlapNotes(metricDistributions),
    excluded_observations: buildExcludedObservationsSummary(observations),
    warnings,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CalibrationProfile — DRAFT (nunca APPROVED desde este módulo, §30/§58)
// ─────────────────────────────────────────────────────────────────────────────

export type CalibrationProfileStatus = 'DRAFT' | 'APPROVED';
export type RuleOperator = '>=' | '>' | '<=' | '<';
export type SourceMethodScope = 'GLOBAL' | 'RSS' | 'SITEMAP';

export interface ThresholdRule {
  rule_id: string;
  kind: 'THRESHOLD';
  metric: string;
  operator: RuleOperator;
  /** Cruzar este threshold (con `operator`) implica PASS de la regla. */
  pass_threshold: number;
  /**
   * Cruzar la dirección OPUESTA de este threshold implica FAIL de la regla
   * (§43: FAIL exige evidencia suficiente Y cruce explícito de un fail
   * threshold APROBADO). `null` = nunca se emite FAIL por esta regla, solo
   * PASS/REVIEW (banda REVIEW abierta hacia el lado "malo", §53).
   */
  fail_threshold: number | null;
  source_method_scope: SourceMethodScope;
}

export interface MinimumSampleRule {
  rule_id: string;
  kind: 'MINIMUM_SAMPLE';
  metric: string;
  minimum: number;
  source_method_scope: SourceMethodScope;
}

export type CalibrationRule = ThresholdRule | MinimumSampleRule;

export interface CalibrationProfile {
  schema_version: typeof CALIBRATION_PROFILE_SCHEMA_VERSION;
  calibration_id: string;
  status: CalibrationProfileStatus;
  created_at: string;
  source: {
    label_sources: LabelSource[];
    based_on_calibration_id: string | null;
  };
  cohort_sizes: ClassBalanceEntry[];
  /** SIEMPRE `[]` cuando lo genera `buildDraftCalibrationProfile` (§27/§30). Solo un humano las llena para APPROVED. */
  rules: CalibrationRule[];
}

export interface BuildDraftCalibrationProfileOptions {
  calibrationId: string;
  createdAt?: string;
}

/**
 * Genera un `CalibrationProfile` `DRAFT` a partir de un `CalibrationReport`
 * ya calculado. `rules` SIEMPRE queda vacío — ningún threshold candidato se
 * promueve automáticamente a regla operativa (§27: "status='DRAFT' NO es
 * una autorización automática"; §58: "NO automatizar aprobación").
 */
export function buildDraftCalibrationProfile(
  report: CalibrationReport,
  opts: BuildDraftCalibrationProfileOptions,
): CalibrationProfile {
  return {
    schema_version: CALIBRATION_PROFILE_SCHEMA_VERSION,
    calibration_id: opts.calibrationId,
    status: 'DRAFT',
    created_at: opts.createdAt ?? new Date().toISOString(),
    source: {
      label_sources: report.input_summary.label_sources,
      based_on_calibration_id: report.calibration_id,
    },
    cohort_sizes: report.class_balance,
    rules: [],
  };
}
