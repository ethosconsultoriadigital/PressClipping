/**
 * Calibration Artifact Schemas — Media Validation & Certification,
 * FASE 1D/1E (§74 del prompt: "define schemas runtime para las nuevas
 * fronteras JSON").
 *
 * Valida en runtime, con `zod` (dependencia ya presente en el repo — no se
 * agrega ninguna nueva), CADA artifact JSON nuevo que cruza el filesystem en
 * esta fase:
 *
 * - `ReferenceLabelManifest` (input de `media-validation-calibrate.ts`);
 * - `CalibrationProfile`     (input de `media-validation-evaluate.ts`);
 * - `CalibrationReport`      (output de calibrate; auto-validado antes de
 *   escribirse — self-check, no es un input no confiable, pero conviene
 *   detectar un bug de construcción antes de persistirlo);
 * - `ShadowValidationReport` (output de evaluate; mismo self-check).
 *
 * DECISIÓN EXPLÍCITA (documentada en el diagnóstico de entrega, no oculta):
 * `RunValidationEvidence` (Fase 1C, ya escrito a disco por
 * `media-validation-compose.ts`) se convierte AQUÍ, por primera vez, en un
 * INPUT que cruza el filesystem hacia una fase nueva (antes solo era
 * output). Construir un esquema `zod` exhaustivo que espeje CADA campo
 * anidado de `RunEvidence`/`MediaEvidence` (Fase 1B, cerrada) duplicaría un
 * contrato enorme y ya cerrado, con alto riesgo de quedar desincronizado.
 * En su lugar se valida un "envelope" de integridad que SÍ cubre en detalle
 * TODOS los campos DECISIONALES (los que `qualityMetrics.ts`/
 * `shadowValidator.ts`/`calibrationEligibility.ts` leen para calcular
 * métricas, hard gates o elegibilidad de calibración — Hardening focal,
 * B2DE) y acepta con forma laxa (`.passthrough()`) el resto de campos no
 * decisionales de 1B/1C — suficiente para rechazar un archivo corrupto/
 * truncado/de otra fase/fabricado, SIN reabrir ni volver a espejar el
 * contrato completo de 1B/1C. Este archivo es normalmente producido por
 * `media-validation-compose.ts` (Fase 1C, cerrada y auditada), pero desde el
 * Hardening focal el envelope YA NO confía ciegamente en el contenido
 * anidado — valida tipos, enums reales (importados/transcritos de 1B/1C sin
 * reabrirlos) e invariantes cruzados (p.ej. `evidence_status='COMPLETE'`
 * exige que crawl/enrich sean realmente coherentes con esa afirmación,
 * igual que exige `aggregateRunEvidence` en `runEvidenceAggregator.ts`).
 */
import { z } from 'zod';
import { CALIBRATION_EXCLUSION_REASONS } from './calibrationEligibility.js';
import { METRIC_LOOKUP_KEYS } from './qualityMetrics.js';

// ─────────────────────────────────────────────────────────────────────────────
// ReferenceLabelManifest
// ─────────────────────────────────────────────────────────────────────────────

const nonEmptyTrimmed = z.string().refine((s) => s.trim().length > 0, { message: 'no puede estar vacío/blanco' });

const referenceLabelEnum = z.enum([
  'GOOD_REFERENCE',
  'TEXT_BAD_REFERENCE',
  'NO_NEWS_REFERENCE',
  'SOURCE_REPAIR_REFERENCE',
  'OTHER_PROBLEM_REFERENCE',
]);

const labelSourceEnum = z.enum(['human_review', 'legacy_readiness', 'curated_manifest']);

export const referenceLabelManifestSchema = z.object({
  schema_version: z.literal(1),
  label_source: labelSourceEnum,
  entries: z.array(
    z.object({
      medio_id: nonEmptyTrimmed,
      label: referenceLabelEnum,
    }),
  ),
});

export function validateReferenceLabelManifest(json: unknown) {
  const result = referenceLabelManifestSchema.safeParse(json);
  if (!result.success) {
    const detalle = result.error.issues.map((i) => `- [${i.path.join('.') || '(root)'}] ${i.message}`).join('\n');
    throw new Error(`Artifact ReferenceLabelManifest inválido:\n${detalle}`);
  }
  return result.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// CalibrationProfile
// ─────────────────────────────────────────────────────────────────────────────

const ruleOperatorEnum = z.enum(['>=', '>', '<=', '<']);
const sourceMethodScopeEnum = z.enum(['GLOBAL', 'RSS', 'SITEMAP']);
/** `.finite()` es un método nativo de `ZodNumber` (rechaza NaN/±Infinity) — se mantiene encadenable (`.nonnegative()`), a diferencia de un `.refine()` custom que devolvería `ZodEffects` y rompería `z.discriminatedUnion`. */
const finiteNumber = z.number().finite();

/**
 * Hardening focal (M2DE/§31-32/§36 del prompt de hardening): allowlist
 * EXPLÍCITA de métricas válidas para una `ThresholdRule` de certificación.
 * V1: SOLO métricas PRIMARY aprobadas (`persisted_clean_text_ratio`,
 * `persisted_body_ratio` — ver `METRIC_KIND` en `qualityMetrics.ts`).
 * Métricas DIAGNOSTIC (`run_clean_text_ratio`, `run_body_ratio`,
 * `enrich_failure_ratio`, deltas, contadores de crawl) NO pueden
 * convertirse accidentalmente en threshold de certificación (§32). Un
 * typo/nombre desconocido se rechaza aquí en runtime — nunca degrada
 * silenciosamente a REVIEW en el evaluator (§36).
 */
const THRESHOLD_RULE_ALLOWED_METRICS = ['ratios.persisted_clean_text_ratio', 'ratios.persisted_body_ratio'] as const;
const thresholdRuleMetricEnum = z.enum(THRESHOLD_RULE_ALLOWED_METRICS);

/**
 * Allowlist para `MinimumSampleRule.metric` (§33 del prompt de hardening):
 * más permisiva que `ThresholdRule` (una regla de tamaño de muestra no es
 * un threshold de certificación de calidad en sí misma), pero SIGUE
 * restringida a claves de métrica REALES conocidas por
 * `qualityMetrics.ts` (`METRIC_LOOKUP_KEYS`) — nunca acepta un typo
 * silencioso.
 */
const minimumSampleRuleMetricEnum = z.enum(METRIC_LOOKUP_KEYS);

const thresholdRuleBaseSchema = z.object({
  rule_id: nonEmptyTrimmed,
  kind: z.literal('THRESHOLD'),
  metric: thresholdRuleMetricEnum,
  operator: ruleOperatorEnum,
  pass_threshold: finiteNumber,
  fail_threshold: finiteNumber.nullable(),
  source_method_scope: sourceMethodScopeEnum,
});

const minimumSampleRuleSchema = z.object({
  rule_id: nonEmptyTrimmed,
  kind: z.literal('MINIMUM_SAMPLE'),
  metric: minimumSampleRuleMetricEnum,
  minimum: finiteNumber.nonnegative(),
  source_method_scope: sourceMethodScopeEnum,
});

// `discriminatedUnion` exige miembros `ZodObject` planos (sin `.superRefine`
// aplicado a cada miembro individualmente) — la validación de "rango
// imposible" se aplica DESPUÉS, sobre la unión ya resuelta.
const calibrationRuleSchema = z.discriminatedUnion('kind', [thresholdRuleBaseSchema, minimumSampleRuleSchema]).superRefine((rule, ctx) => {
  if (rule.kind !== 'THRESHOLD' || rule.fail_threshold === null) return;
  const higherBetter = rule.operator === '>=' || rule.operator === '>';
  // Rango imposible (§38 del prompt de 1D/1E — "rechazar rango imposible"):
  // en un régimen "más alto es mejor", el fail_threshold (peor) NUNCA puede
  // estar por encima del pass_threshold (mejor); simétrico al revés.
  if (higherBetter && rule.fail_threshold > rule.pass_threshold) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `rule_id=${rule.rule_id}: fail_threshold (${rule.fail_threshold}) no puede ser mayor que pass_threshold (${rule.pass_threshold}) con operator='${rule.operator}' (rango imposible).`,
    });
  }
  if (!higherBetter && rule.fail_threshold < rule.pass_threshold) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `rule_id=${rule.rule_id}: fail_threshold (${rule.fail_threshold}) no puede ser menor que pass_threshold (${rule.pass_threshold}) con operator='${rule.operator}' (rango imposible).`,
    });
  }
});

const calibrationExclusionReasonEnum = z.enum(CALIBRATION_EXCLUSION_REASONS);

const classBalanceEntrySchema = z.object({
  label: referenceLabelEnum,
  number_of_media: z.number().int().nonnegative(),
  number_of_observations: z.number().int().nonnegative(),
  eligible_observations: z.number().int().nonnegative(),
  excluded_observations: z.number().int().nonnegative(),
});

export const calibrationProfileSchema = z
  .object({
    schema_version: z.literal(1),
    calibration_id: nonEmptyTrimmed,
    status: z.enum(['DRAFT', 'APPROVED']),
    created_at: z.string(),
    source: z.object({
      label_sources: z.array(labelSourceEnum),
      based_on_calibration_id: z.string().nullable(),
    }),
    cohort_sizes: z.array(classBalanceEntrySchema),
    rules: z.array(calibrationRuleSchema),
  })
  .superRefine((profile, ctx) => {
    // §30/§58: un profile recién generado por el engine siempre es DRAFT con
    // rules=[]; esto NO se exige aquí a nivel de schema (un humano puede
    // editar manualmente un DRAFT con reglas de preview, ver
    // `shadowValidator.ts`) — pero si status='APPROVED', exigimos que exista
    // AL MENOS una regla, para que "aprobado sin nada que evaluar" no pase
    // silenciosamente como si fuera un profile operativo completo.
    if (profile.status === 'APPROVED' && profile.rules.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `calibration_id=${profile.calibration_id}: status='APPROVED' sin ninguna regla (rules=[]) — un profile aprobado sin reglas no aporta ningún threshold operativo.`,
      });
    }
    // Hardening focal (M1DE/§34-35 del prompt de hardening): rechazar
    // rule_id duplicado — nunca elegir un orden accidental entre reglas con
    // la misma identidad.
    const seenRuleIds = new Set<string>();
    for (const rule of profile.rules) {
      if (seenRuleIds.has(rule.rule_id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `calibration_id=${profile.calibration_id}: rule_id duplicado '${rule.rule_id}' — cada regla de un CalibrationProfile debe tener un rule_id único (M1DE).`,
        });
      }
      seenRuleIds.add(rule.rule_id);
    }
  });

export function validateCalibrationProfile(json: unknown) {
  const result = calibrationProfileSchema.safeParse(json);
  if (!result.success) {
    const detalle = result.error.issues.map((i) => `- [${i.path.join('.') || '(root)'}] ${i.message}`).join('\n');
    throw new Error(`Artifact CalibrationProfile inválido:\n${detalle}`);
  }
  return result.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// CalibrationReport (self-check antes de escribir — §74/§45)
// ─────────────────────────────────────────────────────────────────────────────

const cohortStatsSchema = z.object({
  count: z.number().int().nonnegative(),
  available_count: z.number().int().nonnegative(),
  missing_count: z.number().int().nonnegative(),
  min: finiteNumber.nullable(),
  max: finiteNumber.nullable(),
  mean: finiteNumber.nullable(),
  median: finiteNumber.nullable(),
  p10: finiteNumber.nullable(),
  p25: finiteNumber.nullable(),
  p75: finiteNumber.nullable(),
  p90: finiteNumber.nullable(),
});

const confusionMatrixSchema = z.object({
  threshold: finiteNumber,
  tp: z.number().int().nonnegative(),
  fp: z.number().int().nonnegative(),
  tn: z.number().int().nonnegative(),
  fn: z.number().int().nonnegative(),
  precision: finiteNumber.nullable(),
  recall: finiteNumber.nullable(),
  balanced_accuracy: finiteNumber.nullable(),
});

const excludedObservationSummarySchema = z.object({
  medio_id: nonEmptyTrimmed,
  context_id: nonEmptyTrimmed,
  label: referenceLabelEnum,
  reasons: z.array(calibrationExclusionReasonEnum).min(1),
});

export const calibrationReportSchema = z.object({
  schema_version: z.literal(1),
  calibration_id: nonEmptyTrimmed,
  generated_at: z.string(),
  /** Hardening focal (§15-16): estadísticas ponderadas POR OBSERVACIÓN, nunca por medio_id único. */
  weighting: z.literal('PER_OBSERVATION'),
  input_summary: z.object({
    number_of_media: z.number().int().nonnegative(),
    number_of_observations: z.number().int().nonnegative(),
    eligible_observations: z.number().int().nonnegative(),
    excluded_observations: z.number().int().nonnegative(),
    label_sources: z.array(labelSourceEnum),
  }),
  class_balance: z.array(classBalanceEntrySchema),
  source_method_support: z.array(
    z.object({
      source_scope: sourceMethodScopeEnum,
      number_of_media: z.number().int().nonnegative(),
      number_of_observations: z.number().int().nonnegative(),
    }),
  ),
  metric_distributions: z.array(
    z.object({
      metric: nonEmptyTrimmed,
      metric_kind: z.enum(['PRIMARY', 'DIAGNOSTIC']),
      by_label: z.array(
        z.object({
          label: referenceLabelEnum,
          source_scope: sourceMethodScopeEnum,
          stats: cohortStatsSchema,
        }),
      ),
    }),
  ),
  candidate_thresholds: z.array(
    z.object({
      metric: nonEmptyTrimmed,
      source_scope: sourceMethodScopeEnum,
      positive_label: referenceLabelEnum,
      negative_labels: z.array(referenceLabelEnum),
      status: z.enum(['CANDIDATES_AVAILABLE', 'INSUFFICIENT_CALIBRATION_DATA']),
      reason: z.string().nullable(),
      candidates: z.array(confusionMatrixSchema),
    }),
  ),
  overlap_notes: z.array(z.string()),
  /** Hardening focal (B1DE/§7/§44): diagnóstico explícito de observaciones excluidas de calibración. */
  excluded_observations: z.array(excludedObservationSummarySchema),
  warnings: z.array(z.string()),
});

export function validateCalibrationReport(json: unknown) {
  const result = calibrationReportSchema.safeParse(json);
  if (!result.success) {
    const detalle = result.error.issues.map((i) => `- [${i.path.join('.') || '(root)'}] ${i.message}`).join('\n');
    throw new Error(`Artifact CalibrationReport inválido:\n${detalle}`);
  }
  return result.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// ShadowValidationReport (self-check antes de escribir)
// ─────────────────────────────────────────────────────────────────────────────

const ruleEvaluationSchema = z.object({
  rule_id: nonEmptyTrimmed,
  metric: nonEmptyTrimmed,
  kind: z.enum(['THRESHOLD', 'MINIMUM_SAMPLE']),
  source_method_scope: sourceMethodScopeEnum,
  observed: finiteNumber.nullable(),
  operator: ruleOperatorEnum.nullable(),
  threshold: finiteNumber.nullable(),
  outcome: z.enum(['PASS', 'FAIL', 'REVIEW', 'NOT_EVALUABLE']),
  reason: z.string(),
});

export const shadowValidationReportSchema = z.object({
  schema_version: z.literal(1),
  calibration_id: z.string().nullable(),
  context_id: nonEmptyTrimmed,
  medio_id: nonEmptyTrimmed,
  source_method: z.string().nullable(),
  evaluation_status: z.enum(['EVALUATED', 'NOT_EVALUABLE', 'CALIBRATION_REQUIRED']),
  validation_result: z.enum(['PASS', 'REVIEW', 'FAIL']).nullable(),
  recommendation: z.enum(['ELIGIBLE_FOR_PROMOTION', 'REVIEW_REQUIRED', 'REPAIR_AND_RETEST', 'BLOCKED_FAIL']).nullable(),
  dry_run: z.boolean().nullable(),
  simulated: z.boolean(),
  would_be_result_if_approved: z.enum(['PASS', 'REVIEW', 'FAIL']).nullable(),
  gates_failed: z.array(z.string()),
  rules_evaluated: z.array(ruleEvaluationSchema),
  issues: z.array(z.string()),
});

export function validateShadowValidationReport(json: unknown) {
  const result = shadowValidationReportSchema.safeParse(json);
  if (!result.success) {
    const detalle = result.error.issues.map((i) => `- [${i.path.join('.') || '(root)'}] ${i.message}`).join('\n');
    throw new Error(`Artifact ShadowValidationReport inválido:\n${detalle}`);
  }
  return result.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// RunValidationEvidence — envelope de integridad DECISIONAL (ver nota
// superior). HARDENING FOCAL (B2DE): antes `run_evidence: z.record(z.unknown())`
// permitía que JSON corrupto/fabricado atravesara la frontera; ahora se
// valida en runtime la forma real de `MediaEvidence` (Fase 1B) para TODO
// campo que `qualityMetrics.ts`/`shadowValidator.ts`/
// `calibrationEligibility.ts` usan para calcular métricas, hard gates o
// elegibilidad de calibración (§19 del prompt de hardening).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `MediaSnapshot.status` real (Fase 1C, `newsLakeSnapshot.ts`). Reutilizado
 * también como cross-check para `persistence.status`.
 */
const mediaSnapshotEnvelopeSchema = z
  .object({
    medio_id: nonEmptyTrimmed,
    status: z.enum(['COMPLETE', 'PARTIAL', 'ERROR', 'UNKNOWN']),
    total_news: z.number().int().nonnegative().nullable(),
    clean_text_count: z.number().int().nonnegative().nullable(),
    body_count: z.number().int().nonnegative().nullable(),
    /** `SnapshotConsistency` real (Fase 1C) — necesario para el cross-check de `persistence.status='VERIFIED'` (B5C). */
    consistency: z.enum(['STABLE_OBSERVED', 'POSSIBLE_DRIFT', 'UNKNOWN']),
  })
  .passthrough()
  .superRefine((m, ctx) => {
    // Invariante REAL garantizada por `newsLakeSnapshot.ts` (idéntica a la
    // ya aplicada en `artifactSchemas.ts` para el `SnapshotResult` de
    // entrada de 1C — reconstruida aquí porque no está exportada, §23 del
    // prompt de hardening: "no modificar 1C solo para exportar algo").
    if (m.status === 'COMPLETE') {
      if (m.total_news === null || m.clean_text_count === null || m.body_count === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `medio_id=${m.medio_id}: status='COMPLETE' exige total_news/clean_text_count/body_count no-null (1C nunca produce COMPLETE con contadores null) — posible artifact fabricado/corrupto.`,
        });
        return;
      }
      if (m.clean_text_count > m.total_news) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `medio_id=${m.medio_id}: clean_text_count (${m.clean_text_count}) > total_news (${m.total_news}) — invariante de 1C violada.`,
        });
      }
      if (m.body_count > m.total_news) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `medio_id=${m.medio_id}: body_count (${m.body_count}) > total_news (${m.total_news}) — invariante de 1C violada.`,
        });
      }
    } else if (m.total_news !== null || m.clean_text_count !== null || m.body_count !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `medio_id=${m.medio_id}: status='${m.status}' exige total_news/clean_text_count/body_count === null (1C nunca produce contadores parciales/fallidos como número) — posible artifact fabricado/corrupto.`,
      });
    }
  });

/** `CrawlProvenance` real (Fase 1B, `runEvidenceAggregator.ts`) — exportado, se transcribe idéntico (no diverge). */
const crawlProvenanceEnvelopeEnum = z.enum(['STRUCTURED_V1', 'LEGACY_RECONSTRUCTED', 'INVALID', 'NONE']);
/** `CrawlResult['estado']` real — src/crawlers/index.ts (no exportado como union nombrada; transcrito idéntico, §21 del prompt de hardening). */
const crawlStatusEnvelopeEnum = z.enum(['ok', 'sin_fuente', 'omitido', 'error']);
/** `METODOS_MVP` real — src/crawlers/index.ts (mismo motivo que arriba). */
const crawlSourceMethodEnvelopeEnum = z.enum(['rss', 'sitemap']);
/** `EnrichPresence` real (Fase 1B) — exportado, transcrito idéntico. */
const enrichPresenceEnvelopeEnum = z.enum(['PRESENT', 'MISSING', 'INVALID', 'NOT_EXPECTED']);
/** `EvidenceStatus` real (Fase 1B) — exportado, transcrito idéntico. */
const evidenceStatusEnvelopeEnum = z.enum(['COMPLETE', 'PARTIAL', 'MISSING']);

const nonNegativeIntEnvelope = z.number().int().nonnegative();
const nonNegativeIntEnvelopeNullable = nonNegativeIntEnvelope.nullable();

/**
 * `CrawlMediaEvidence` (Fase 1B) — subconjunto DECISIONAL (§19 del prompt de
 * hardening) usado por `computeMediaQualityMetrics`/hard gates. Campos no
 * decisionales (`terminal_error`, `attempt_errors`, `promoted_diagnostic`,
 * `raw_terminal_event_count`, `invalid_legacy_event_count`,
 * `conflicting_summaries`) se aceptan vía `.passthrough()` — no se
 * duplica/valida el contrato completo de 1B (§18).
 */
const crawlEvidenceEnvelopeSchema = z.object({
  provenance: crawlProvenanceEnvelopeEnum,
  status: crawlStatusEnvelopeEnum.nullable(),
  source_method: crawlSourceMethodEnvelopeEnum.nullable(),
  detected: nonNegativeIntEnvelopeNullable,
  items: nonNegativeIntEnvelopeNullable,
  inserted: nonNegativeIntEnvelopeNullable,
  duplicates: nonNegativeIntEnvelopeNullable,
  invalid_event_count: nonNegativeIntEnvelope,
  ambiguous_terminal_events: z.boolean(),
  ambiguous_source_events: z.boolean(),
  legacy_conflict: z.boolean(),
}).passthrough();

/**
 * `EnrichMediaEvidence` (Fase 1B) — subconjunto DECISIONAL (§19). Mismo
 * criterio que `crawlEvidenceEnvelopeSchema` para campos no leídos por 1D/1E
 * (`requested`, `unchanged`, `content_persistence`, `raw_summary_event_count`,
 * `expectation_basis`, `conflicting_summaries`).
 */
const enrichEvidenceEnvelopeSchema = z
  .object({
    presence: enrichPresenceEnvelopeEnum,
    processed: nonNegativeIntEnvelopeNullable,
    updated: nonNegativeIntEnvelopeNullable,
    failed: nonNegativeIntEnvelopeNullable,
    clean_text_count: nonNegativeIntEnvelopeNullable,
    body_count: nonNegativeIntEnvelopeNullable,
    dry_run: z.boolean().nullable(),
    invalid_event_count: nonNegativeIntEnvelope,
    ambiguous_summary_events: z.boolean(),
    mixed_dry_run: z.boolean(),
  })
  .passthrough()
  .superRefine((e, ctx) => {
    // Invariante REAL de `resolveEnrichGroup` (Fase 1B): `presence='PRESENT'`
    // sin `ambiguous_summary_events` implica que TODOS los contadores
    // resueltos son no-null (nunca `PRESENT` con contadores fabricados/
    // faltantes — cierra el patrón exacto del exploit auditado: declarar
    // `evidence_status='COMPLETE'` sin datos reales subyacentes).
    if (e.presence === 'PRESENT' && !e.ambiguous_summary_events) {
      const anyNull =
        e.processed === null || e.updated === null || e.failed === null ||
        e.clean_text_count === null || e.body_count === null || e.dry_run === null;
      if (anyNull) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "enrich.presence='PRESENT' sin ambiguous_summary_events exige processed/updated/failed/clean_text_count/" +
            'body_count/dry_run no-null (1B nunca produce este estado con contadores null) — posible artifact fabricado/corrupto.',
        });
      }
    }
  });

/**
 * `MediaEvidence` (Fase 1B) — envelope DECISIONAL completo (Hardening B2DE).
 * Reemplaza el antiguo `run_evidence: z.record(z.unknown())`.
 */
const mediaEvidenceEnvelopeSchema = z
  .object({
    medio_id: nonEmptyTrimmed,
    unsupported_event_count: nonNegativeIntEnvelope,
    evidence_status: evidenceStatusEnvelopeEnum,
    crawl: crawlEvidenceEnvelopeSchema,
    enrich: enrichEvidenceEnvelopeSchema,
  })
  .passthrough()
  .superRefine((me, ctx) => {
    // FALSE COMPLETE (Hardening B2DE/§25 del prompt de hardening):
    // `evidence_status='COMPLETE'` solo es honesto si crawl/enrich cumplen
    // EXACTAMENTE la misma condición que `aggregateRunEvidence` (Fase 1B,
    // `runEvidenceAggregator.ts`) exige para producirlo — el string
    // 'COMPLETE' nunca se acepta por sí solo como prueba de evidencia sana.
    if (me.evidence_status !== 'COMPLETE') return;
    const crawlSourceRequirementMet = me.crawl.status !== 'ok' || me.crawl.source_method !== null;
    const crawlFullyValid =
      me.crawl.status !== null &&
      !me.crawl.ambiguous_terminal_events &&
      !me.crawl.ambiguous_source_events &&
      !me.crawl.legacy_conflict &&
      me.crawl.invalid_event_count === 0 &&
      crawlSourceRequirementMet;
    const enrichFullyValid =
      me.enrich.presence === 'PRESENT' &&
      !me.enrich.mixed_dry_run &&
      !me.enrich.ambiguous_summary_events &&
      me.enrich.invalid_event_count === 0;
    if (!crawlFullyValid || !enrichFullyValid || me.unsupported_event_count !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          `medio_id=${me.medio_id}: evidence_status='COMPLETE' es incoherente con los campos crawl/enrich/` +
          'unsupported_event_count observados — Fase 1B nunca produciría COMPLETE en este estado (posible evidencia ' +
          'fabricada/corrupta, Hardening B2DE).',
      });
    }
  });

/** Envelope de `MediaValidationRecord` (Fase 1C). `reconciliation` se acepta con forma laxa (no decisional, §18). */
const mediaValidationRecordEnvelopeSchema = z.object({
  medio_id: nonEmptyTrimmed,
  run_evidence: mediaEvidenceEnvelopeSchema,
  persistence: z
    .object({
      medio_id: nonEmptyTrimmed,
      status: z.enum(['VERIFIED', 'UNVERIFIED', 'INDETERMINATE']),
      before: mediaSnapshotEnvelopeSchema,
      after: mediaSnapshotEnvelopeSchema,
      delta: z.object({
        medio_id: nonEmptyTrimmed,
        status: z.enum(['COMPUTED', 'UNAVAILABLE']),
        news_delta: z.number().nullable(),
        clean_text_delta: z.number().nullable(),
        body_delta: z.number().nullable(),
        reason: z.string().nullable(),
      }),
      reason: z.string().nullable(),
    })
    .superRefine((p, ctx) => {
      // Invariante REAL de `derivePersistenceEvidence` (Fase 1C, B5C):
      // 'VERIFIED' exige before/after COMPLETE y sin POSSIBLE_DRIFT. Cierra
      // una segunda variante del exploit auditado: declarar
      // `persistence.status='VERIFIED'` sin snapshots que lo respalden.
      if (p.status === 'VERIFIED') {
        const ok =
          p.before.status === 'COMPLETE' &&
          p.after.status === 'COMPLETE' &&
          p.before.consistency !== 'POSSIBLE_DRIFT' &&
          p.after.consistency !== 'POSSIBLE_DRIFT';
        if (!ok) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              `medio_id=${p.medio_id}: persistence.status='VERIFIED' exige before/after status='COMPLETE' sin ` +
              'POSSIBLE_DRIFT (1C, B5C) — combinación observada es incoherente con esa garantía (posible artifact fabricado/corrupto).',
          });
        }
      }
    }),
  reconciliation: z.array(z.record(z.unknown())),
});

export const runValidationEvidenceEnvelopeSchema = z
  .object({
    schema_version: z.literal(1),
    context: z.object({
      context_id: nonEmptyTrimmed,
    }).passthrough(),
    context_identity: z.object({
      status: z.enum(['MATCH', 'MISMATCH']),
      issues: z.array(z.string()),
    }),
    media: z.array(mediaValidationRecordEnvelopeSchema),
    unattributed_enrich: z.unknown().nullable(),
    warnings: z.array(z.string()),
  })
  .superRefine((rve, ctx) => {
    // Invariante REAL de `runValidationEvidence.ts` (B5C): ningún medio
    // puede reportar `persistence.status='VERIFIED'` cuando
    // `context_identity.status !== 'MATCH'` — cierra el exploit exacto
    // auditado (evidencia fabricada declarando VERIFIED bajo un MISMATCH).
    if (rve.context_identity.status !== 'MATCH') {
      for (const m of rve.media) {
        if (m.persistence.status === 'VERIFIED') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              `medio_id=${m.medio_id}: persistence.status='VERIFIED' no puede coexistir con ` +
              `context_identity.status='${rve.context_identity.status}' (1C, B5C) — combinación fabricada/incoherente.`,
          });
        }
      }
    }
  });

/**
 * Valida el envelope de un `RunValidationEvidence` leído de disco. Cubre en
 * detalle TODO campo decisional de `MediaEvidence`/`MediaSnapshot`/
 * `MediaPersistenceEvidence` (Hardening focal B2DE) — un artifact corrupto,
 * de otra schema_version, con roles/estados desconocidos, contadores
 * fabricados/tipados incorrectamente, o con `evidence_status='COMPLETE'`/
 * `persistence.status='VERIFIED'` incoherentes con sus propios campos
 * anidados, se rechaza aquí ANTES de llegar a `computeQualityMetricsForRun`.
 */
export function validateRunValidationEvidenceEnvelope(json: unknown) {
  const result = runValidationEvidenceEnvelopeSchema.safeParse(json);
  if (!result.success) {
    const detalle = result.error.issues.map((i) => `- [${i.path.join('.') || '(root)'}] ${i.message}`).join('\n');
    throw new Error(`Artifact RunValidationEvidence inválido (envelope, Fase 1D — Hardening B2DE):\n${detalle}`);
  }
  return result.data;
}
