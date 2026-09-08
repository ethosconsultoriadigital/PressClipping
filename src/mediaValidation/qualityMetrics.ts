/**
 * Quality Metrics — Media Validation & Certification, FASE 1D.
 *
 * Capa PURA y DETERMINISTA que convierte `RunValidationEvidence` (Fase 1C —
 * ya combina RUN EVIDENCE de Fase 1B + PERSISTENCE EVIDENCE de Fase 1C) en
 * `MediaQualityMetrics` por `medio_id`. NO decide PASS/REVIEW/FAIL (eso es
 * Fase 1E — `shadowValidator.ts`), NO aplica ningún threshold, NO consulta
 * Supabase ni ninguna fuente adicional — cada campo se deriva EXCLUSIVAMENTE
 * de los contratos ya cerrados de 1B/1C, nunca del auditor legacy
 * (`scripts/audit-all-media-clean-capture-readiness.ts`).
 *
 * PRINCIPIO (§8 del prompt de Fase 1D): una métrica calculable es un número
 * real; una métrica sin evidencia suficiente es `null` + `issue`/`availability`
 * explícito. NUNCA `null → 0`, NUNCA `division by zero → 0%`, NUNCA `NaN`,
 * NUNCA `Infinity`. Toda ratio exige numerador Y denominador semánticamente
 * válidos (y denominador > 0 para poder calcularse).
 *
 * SEPARACIÓN DE CAPAS (§2/§16 del prompt): este módulo NUNCA mezcla
 * "evidencia suficiente para evaluar" (gates) con "calidad observada"
 * (ratios) — ambas dimensiones se exponen SEPARADAS en el contrato
 * (`gates` vs `ratios`) para que Fase 1E pueda aplicar HARD GATES antes de
 * mirar cualquier número de calidad, sin que este módulo tenga que decidir
 * nada al respecto.
 */
import type { CrawlProvenance, EnrichPresence, EvidenceStatus } from './runEvidenceAggregator.js';
import type { MediaValidationRecord, RunValidationEvidence, PersistenceStatus } from './runValidationEvidence.js';
import type { ContextMatchStatus } from './runContext.js';
import type { DeltaStatus } from './mediaDelta.js';

export const MEDIA_QUALITY_METRICS_SCHEMA_VERSION = 1;

// ─────────────────────────────────────────────────────────────────────────────
// Metric availability — §15 del prompt: nunca dejar que un consumidor tenga
// que adivinar por qué una métrica es null.
// ─────────────────────────────────────────────────────────────────────────────

export type MetricAvailability = 'AVAILABLE' | 'UNAVAILABLE' | 'NOT_APPLICABLE';

/**
 * Taxonomía DELIBERADAMENTE pequeña (§15: "no hagas una taxonomía
 * gigantesca"). `PERSISTENCE_NOT_VERIFIED` coexiste con
 * `availability === 'AVAILABLE'` (es un matiz, no un bloqueo): se usa
 * exclusivamente en ratios derivadas de contadores de EJECUCIÓN de enrich
 * (Fase 1B), que ese mismo contrato ya marca `content_persistence:
 * 'UNVERIFIED'` (Hardening Pass 1, B7) — el valor SÍ se calcula, pero mide
 * PROCESAMIENTO, no persistencia confirmada en Supabase.
 */
export type MetricIssue =
  | 'ZERO_DENOMINATOR'
  | 'DENOMINATOR_UNAVAILABLE'
  | 'NUMERATOR_UNAVAILABLE'
  | 'RUN_EVIDENCE_INCOMPLETE'
  | 'PERSISTENCE_NOT_VERIFIED'
  | null;

export interface RatioMetric {
  availability: MetricAvailability;
  /** `null` salvo que `availability === 'AVAILABLE'`. Nunca 0 fabricado, nunca NaN/Infinity. */
  value: number | null;
  /** Conservado siempre que se conozca (incluso si `availability !== 'AVAILABLE'`) — trazabilidad (§12/§14). */
  numerator: number | null;
  denominator: number | null;
  issue: MetricIssue;
}

/** §13 del prompt: distinguir PRIMARY de DIAGNOSTIC. Confirmado aquí, no asumido. */
export type MetricKind = 'PRIMARY' | 'DIAGNOSTIC';

// ─────────────────────────────────────────────────────────────────────────────
// Contrato — MediaQualityMetrics (§14 del prompt)
// ─────────────────────────────────────────────────────────────────────────────

export interface MediaQualityGates {
  context_identity: ContextMatchStatus;
  persistence_status: PersistenceStatus;
  run_evidence_status: EvidenceStatus;
  /** crawl.provenance==='INVALID' || crawl.invalid_event_count>0 || enrich.presence==='INVALID' || enrich.invalid_event_count>0. */
  has_invalid_evidence: boolean;
  /** crawl.ambiguous_terminal_events || crawl.ambiguous_source_events || crawl.legacy_conflict || enrich.ambiguous_summary_events || enrich.mixed_dry_run. */
  has_unresolved_evidence_conflict: boolean;
  /** unsupported_event_count > 0. */
  has_unsupported_evidence: boolean;
}

/**
 * Hard evidence gates — nombres EXACTOS ya usados por `shadowValidator.ts`
 * (§35-38 del prompt de 1D/1E) para bloquear PASS. Extraído aquí como
 * HELPER PURO COMPARTIDO (Hardening focal, §39: "una función pura canónica
 * ... evita que validator diga gate bad pero calibration diga eligible")
 * para que `calibrationEligibility.ts` reutilice EXACTAMENTE la misma
 * semántica de "evidencia confiable" que protege PASS, sin duplicar lógica
 * que pudiera desincronizarse con el tiempo.
 */
export function getEvidenceGateFailures(gates: MediaQualityGates): string[] {
  const failed: string[] = [];
  if (gates.context_identity !== 'MATCH') failed.push('context_identity_mismatch');
  if (gates.persistence_status !== 'VERIFIED') failed.push('persistence_not_verified');
  if (gates.run_evidence_status !== 'COMPLETE') failed.push('run_evidence_not_complete');
  if (gates.has_invalid_evidence) failed.push('invalid_evidence_present');
  if (gates.has_unresolved_evidence_conflict) failed.push('unresolved_evidence_conflict');
  if (gates.has_unsupported_evidence) failed.push('unsupported_evidence_present');
  return failed;
}

export interface MediaQualityEvidenceSnapshot {
  dry_run: boolean | null;
  crawl_provenance: CrawlProvenance;
  crawl_status: string | null;
  enrich_presence: EnrichPresence;
}

export interface MediaQualityPersisted {
  before_total_news: number | null;
  after_total_news: number | null;
  after_clean_text_count: number | null;
  after_body_count: number | null;
}

export interface MediaQualityRun {
  enrich_processed: number | null;
  enrich_failed: number | null;
  enrich_clean_text_count: number | null;
  enrich_body_count: number | null;
  crawl_detected: number | null;
  crawl_items: number | null;
  crawl_inserted: number | null;
}

export interface MediaQualityDelta {
  status: DeltaStatus;
  news_delta: number | null;
  clean_text_delta: number | null;
  body_delta: number | null;
}

export interface MediaQualityRatios {
  /** PRIMARY — after_clean_text_count / after_total_news (PERSISTIDO). */
  persisted_clean_text_ratio: RatioMetric;
  /** PRIMARY — after_body_count / after_total_news (PERSISTIDO). */
  persisted_body_ratio: RatioMetric;
  /** DIAGNOSTIC — enrich.clean_text_count / enrich.processed (EJECUCIÓN, no prueba persistencia). */
  run_clean_text_ratio: RatioMetric;
  /** DIAGNOSTIC — enrich.body_count / enrich.processed (EJECUCIÓN, no prueba persistencia). */
  run_body_ratio: RatioMetric;
  /** DIAGNOSTIC — enrich.failed / enrich.processed. */
  enrich_failure_ratio: RatioMetric;
}

export const METRIC_KIND: Record<keyof MediaQualityRatios, MetricKind> = {
  persisted_clean_text_ratio: 'PRIMARY',
  persisted_body_ratio: 'PRIMARY',
  run_clean_text_ratio: 'DIAGNOSTIC',
  run_body_ratio: 'DIAGNOSTIC',
  enrich_failure_ratio: 'DIAGNOSTIC',
};

export interface MediaQualityMetrics {
  schema_version: typeof MEDIA_QUALITY_METRICS_SCHEMA_VERSION;
  medio_id: string;
  /** Identidad del intento de validación (§14: "trazabilidad suficiente para saber DE DÓNDE salió cada métrica"). */
  context_id: string;
  /** Diagnóstico — de `crawl.source_method` resuelto (STRUCTURED_V1 o LEGACY_RECONSTRUCTED). `null` si no se conoce. */
  source_method: string | null;
  gates: MediaQualityGates;
  evidence_snapshot: MediaQualityEvidenceSnapshot;
  persisted: MediaQualityPersisted;
  run: MediaQualityRun;
  delta: MediaQualityDelta;
  ratios: MediaQualityRatios;
}

// ─────────────────────────────────────────────────────────────────────────────
// buildRatio — helper puro compartido por todas las ratios candidatas.
// ─────────────────────────────────────────────────────────────────────────────

interface BuildRatioParams {
  numerator: number | null;
  denominator: number | null;
  numeratorAvailable: boolean;
  denominatorAvailable: boolean;
  /** true cuando la evidencia de origen (p.ej. enrich) ni siquiera está PRESENTE/válida — domina sobre cualquier otro chequeo. */
  runEvidenceIncomplete?: boolean;
  /** true cuando el valor, si se calcula, debe llevar el matiz `PERSISTENCE_NOT_VERIFIED` (contadores de EJECUCIÓN, no de persistencia). */
  persistenceCaveat?: boolean;
}

function buildRatio(params: BuildRatioParams): RatioMetric {
  const { numerator, denominator, numeratorAvailable, denominatorAvailable, runEvidenceIncomplete, persistenceCaveat } = params;

  if (runEvidenceIncomplete) {
    return {
      availability: 'UNAVAILABLE',
      value: null,
      numerator: numeratorAvailable ? numerator : null,
      denominator: denominatorAvailable ? denominator : null,
      issue: 'RUN_EVIDENCE_INCOMPLETE',
    };
  }

  if (!denominatorAvailable || denominator === null) {
    return {
      availability: 'UNAVAILABLE',
      value: null,
      numerator: numeratorAvailable ? numerator : null,
      denominator: null,
      issue: 'DENOMINATOR_UNAVAILABLE',
    };
  }

  if (!numeratorAvailable || numerator === null) {
    return { availability: 'UNAVAILABLE', value: null, numerator: null, denominator, issue: 'NUMERATOR_UNAVAILABLE' };
  }

  // Denominador semánticamente válido pero cero: NUNCA se fabrica un 0%
  // (§11 del prompt: total_news=0 no implica FAIL, la ratio es NOT_APPLICABLE).
  if (denominator === 0) {
    return { availability: 'NOT_APPLICABLE', value: null, numerator, denominator: 0, issue: 'ZERO_DENOMINATOR' };
  }

  const value = numerator / denominator;
  // Defensivo: nunca se emite NaN/Infinity aunque las validaciones previas
  // ya deberían impedirlo con los invariantes reales de 1B/1C.
  if (!Number.isFinite(value)) {
    return { availability: 'UNAVAILABLE', value: null, numerator, denominator, issue: 'DENOMINATOR_UNAVAILABLE' };
  }

  return { availability: 'AVAILABLE', value, numerator, denominator, issue: persistenceCaveat ? 'PERSISTENCE_NOT_VERIFIED' : null };
}

// ─────────────────────────────────────────────────────────────────────────────
// computeMediaQualityMetrics — por medio_id
// ─────────────────────────────────────────────────────────────────────────────

export interface QualityMetricsRunContext {
  context_id: string;
  context_identity: ContextMatchStatus;
}

/**
 * Deriva `MediaQualityMetrics` para UN `MediaValidationRecord` (Fase 1C).
 * `context_identity` se recibe explícitamente (es una decisión a nivel de
 * TODO el run, no por medio — igual que en `runValidationEvidence.ts`,
 * B5C) para no recalcularla distinto por medio_id.
 */
export function computeMediaQualityMetrics(
  record: MediaValidationRecord,
  context: QualityMetricsRunContext,
): MediaQualityMetrics {
  const { crawl, enrich } = record.run_evidence;
  const { before, after, delta, status: persistenceStatus } = record.persistence;

  const afterComplete = after.status === 'COMPLETE';
  const enrichPresent = enrich.presence === 'PRESENT';

  const gates: MediaQualityGates = {
    context_identity: context.context_identity,
    persistence_status: persistenceStatus,
    run_evidence_status: record.run_evidence.evidence_status,
    has_invalid_evidence:
      crawl.provenance === 'INVALID' || crawl.invalid_event_count > 0 || enrich.presence === 'INVALID' || enrich.invalid_event_count > 0,
    has_unresolved_evidence_conflict:
      crawl.ambiguous_terminal_events ||
      crawl.ambiguous_source_events ||
      crawl.legacy_conflict ||
      enrich.ambiguous_summary_events ||
      enrich.mixed_dry_run,
    has_unsupported_evidence: record.run_evidence.unsupported_event_count > 0,
  };

  const evidenceSnapshot: MediaQualityEvidenceSnapshot = {
    dry_run: enrich.dry_run,
    crawl_provenance: crawl.provenance,
    crawl_status: crawl.status,
    enrich_presence: enrich.presence,
  };

  const persisted: MediaQualityPersisted = {
    before_total_news: before.status === 'COMPLETE' ? before.total_news : null,
    after_total_news: afterComplete ? after.total_news : null,
    after_clean_text_count: afterComplete ? after.clean_text_count : null,
    after_body_count: afterComplete ? after.body_count : null,
  };

  const run: MediaQualityRun = {
    enrich_processed: enrich.processed,
    enrich_failed: enrich.failed,
    enrich_clean_text_count: enrich.clean_text_count,
    enrich_body_count: enrich.body_count,
    crawl_detected: crawl.detected,
    crawl_items: crawl.items,
    crawl_inserted: crawl.inserted,
  };

  const deltaOut: MediaQualityDelta = {
    status: delta.status,
    news_delta: delta.news_delta,
    clean_text_delta: delta.clean_text_delta,
    body_delta: delta.body_delta,
  };

  const ratios: MediaQualityRatios = {
    persisted_clean_text_ratio: buildRatio({
      numerator: persisted.after_clean_text_count,
      denominator: persisted.after_total_news,
      numeratorAvailable: afterComplete,
      denominatorAvailable: afterComplete,
    }),
    persisted_body_ratio: buildRatio({
      numerator: persisted.after_body_count,
      denominator: persisted.after_total_news,
      numeratorAvailable: afterComplete,
      denominatorAvailable: afterComplete,
    }),
    run_clean_text_ratio: buildRatio({
      numerator: enrich.clean_text_count,
      denominator: enrich.processed,
      numeratorAvailable: enrichPresent,
      denominatorAvailable: enrichPresent,
      runEvidenceIncomplete: !enrichPresent,
      persistenceCaveat: true,
    }),
    run_body_ratio: buildRatio({
      numerator: enrich.body_count,
      denominator: enrich.processed,
      numeratorAvailable: enrichPresent,
      denominatorAvailable: enrichPresent,
      runEvidenceIncomplete: !enrichPresent,
      persistenceCaveat: true,
    }),
    enrich_failure_ratio: buildRatio({
      numerator: enrich.failed,
      denominator: enrich.processed,
      numeratorAvailable: enrichPresent,
      denominatorAvailable: enrichPresent,
      runEvidenceIncomplete: !enrichPresent,
    }),
  };

  return {
    schema_version: MEDIA_QUALITY_METRICS_SCHEMA_VERSION,
    medio_id: record.medio_id,
    context_id: context.context_id,
    source_method: crawl.source_method,
    gates,
    evidence_snapshot: evidenceSnapshot,
    persisted,
    run,
    delta: deltaOut,
    ratios,
  };
}

/**
 * Batch — acepta `RunValidationEvidence.media[]` directamente (§60 del
 * prompt: "evita APIs estrictamente single-media si no hay razón").
 * Complejidad O(N) donde N = medios del run (§61).
 */
export function computeQualityMetricsForRun(evidence: RunValidationEvidence): MediaQualityMetrics[] {
  const context: QualityMetricsRunContext = {
    context_id: evidence.context.context_id,
    context_identity: evidence.context_identity.status,
  };
  return evidence.media.map((record) => computeMediaQualityMetrics(record, context));
}

// ─────────────────────────────────────────────────────────────────────────────
// getMetricValue — lookup plano usado por calibration.ts y shadowValidator.ts
// para referenciar cualquier métrica por nombre de forma genérica (p.ej.
// desde un `CalibrationRule.metric` en un `CalibrationProfile` JSON), sin
// que ninguno de esos módulos necesite conocer la forma anidada exacta de
// `MediaQualityMetrics`.
// ─────────────────────────────────────────────────────────────────────────────

export interface MetricLookupResult {
  available: boolean;
  value: number | null;
}

/** Claves soportadas — mantener sincronizado con el contrato de arriba. */
export const METRIC_LOOKUP_KEYS = [
  'ratios.persisted_clean_text_ratio',
  'ratios.persisted_body_ratio',
  'ratios.run_clean_text_ratio',
  'ratios.run_body_ratio',
  'ratios.enrich_failure_ratio',
  'persisted.before_total_news',
  'persisted.after_total_news',
  'persisted.after_clean_text_count',
  'persisted.after_body_count',
  'run.enrich_processed',
  'run.enrich_failed',
  'run.enrich_clean_text_count',
  'run.enrich_body_count',
  'run.crawl_detected',
  'run.crawl_items',
  'run.crawl_inserted',
  'delta.news_delta',
  'delta.clean_text_delta',
  'delta.body_delta',
] as const;

export type MetricLookupKey = (typeof METRIC_LOOKUP_KEYS)[number];

export function isKnownMetricKey(key: string): key is MetricLookupKey {
  return (METRIC_LOOKUP_KEYS as readonly string[]).includes(key);
}

/**
 * Resuelve una clave de métrica plana contra un `MediaQualityMetrics` ya
 * calculado. Claves desconocidas devuelven `{available:false, value:null}`
 * — nunca lanzan (el llamador decide si eso es un error de configuración
 * del profile).
 */
export function getMetricValue(metrics: MediaQualityMetrics, key: string): MetricLookupResult {
  if (key.startsWith('ratios.')) {
    const ratioKey = key.slice('ratios.'.length) as keyof MediaQualityRatios;
    const ratio = metrics.ratios[ratioKey];
    if (!ratio) return { available: false, value: null };
    return { available: ratio.availability === 'AVAILABLE', value: ratio.availability === 'AVAILABLE' ? ratio.value : null };
  }
  if (key.startsWith('persisted.')) {
    const k = key.slice('persisted.'.length) as keyof MediaQualityPersisted;
    const v = metrics.persisted[k];
    return v === undefined ? { available: false, value: null } : { available: v !== null, value: v ?? null };
  }
  if (key.startsWith('run.')) {
    const k = key.slice('run.'.length) as keyof MediaQualityRun;
    const v = metrics.run[k];
    return v === undefined ? { available: false, value: null } : { available: v !== null, value: v ?? null };
  }
  if (key.startsWith('delta.')) {
    const k = key.slice('delta.'.length) as keyof MediaQualityDelta;
    const v = metrics.delta[k as 'news_delta' | 'clean_text_delta' | 'body_delta'];
    if (typeof v !== 'number' && v !== null) return { available: false, value: null };
    return { available: v !== null, value: v ?? null };
  }
  return { available: false, value: null };
}