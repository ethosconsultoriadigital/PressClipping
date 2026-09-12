/**
 * Content Sanity Guard — Media Validation & Certification, FASE 1F.
 *
 * Función PURA: rows de la misma ventana 1C → ContentSanitySummary →
 * ContentSanityOutcome. Sin red, sin DB, sin filesystem, sin clock, sin ML.
 *
 * Gate decisional V1 (audit-blocking fix):
 *   blocking = unique union de encoding OR placeholder.
 * Listing y boilerplate se detectan y cuentan (DIAGNOSTIC_ONLY_V1)
 * pero NO entran al aggregate que puede producir REVIEW_CONTENT_SANITY.
 *
 * EMPTY puro NO se cuenta aquí: ya reduce las PRIMARY de presencia.
 *
 * Policy operacional: UNSET hasta aprobación humana. UNSET ⇒ NOT_EVALUABLE
 * ⇒ nunca PASS optimista. Un CalibrationProfile NO puede apagar este guard.
 */
import { z } from 'zod';
import { encodingSospechoso, pareceBoilerplate, pareceListing, parecePlaceholder } from '../comparators/extractionQuality.js';

export const CONTENT_SANITY_SUMMARY_SCHEMA_VERSION = 1 as const;
export const CONTENT_SANITY_POLICY_SCHEMA_VERSION = 1 as const;

export type ContentSanityAvailability = 'AVAILABLE' | 'UNAVAILABLE' | 'NOT_APPLICABLE';

export type ContentSanityIssue =
  | 'ZERO_SAMPLE'
  | 'SNAPSHOT_NOT_COMPLETE'
  | 'EVIDENCE_ABSENT'
  | 'INVALID_SCHEMA'
  | 'SAMPLE_TOTAL_MISMATCH'
  | null;

export type ContentSanityBlockingType = 'encoding' | 'placeholder';
export type ContentSanityDiagnosticType = 'listing' | 'boilerplate';
export type ContentSanityDefectType = ContentSanityBlockingType | ContentSanityDiagnosticType;

export type ContentSanityOutcome = 'PASS' | 'REVIEW' | 'NOT_EVALUABLE';

export type ContentSanityReviewReason =
  | 'REVIEW_CONTENT_SANITY'
  | 'REVIEW_MISSING_SANITY_EVIDENCE'
  | 'REVIEW_CONTENT_SANITY_POLICY_UNSET'
  | 'REVIEW_CONTENT_SANITY_INVALID'
  | 'REVIEW_CONTENT_SANITY_ZERO_SAMPLE'
  | 'REVIEW_CONTENT_SANITY_MISMATCH'
  | null;

export type ContentSanityPolicyStatus = 'UNSET' | 'ACTIVE';

export interface ContentSanitySummary {
  schema_version: typeof CONTENT_SANITY_SUMMARY_SCHEMA_VERSION;
  availability: ContentSanityAvailability;
  issue: ContentSanityIssue;
  sample_total: number | null;
  encoding_suspect_count: number | null;
  listing_suspect_count: number | null;
  boilerplate_suspect_count: number | null;
  placeholder_count: number | null;
  /**
   * Unique union por noticia de encoding OR placeholder.
   * Listing/boilerplate NO participan.
   */
  blocking_defective_count: number | null;
  blocking_defective_rate: number | null;
  /** Hasta 3 noticia_id con hit BLOCKING (no diagnostic-only). */
  example_noticia_ids: string[];
}

export interface ContentSanityPolicy {
  schema_version: typeof CONTENT_SANITY_POLICY_SCHEMA_VERSION;
  policy_id: string;
  status: ContentSanityPolicyStatus;
  /**
   * Bloquea (REVIEW) solo si blocking_defective_count >= este valor
   * Y blocking_defective_rate >= min_blocking_defective_rate.
   * `null` cuando status=UNSET (no se usa). No es cutoff V1 aprobado.
   */
  min_blocking_defective_count: number | null;
  min_blocking_defective_rate: number | null;
}

export interface ContentSanityEvaluation {
  outcome: ContentSanityOutcome;
  review_reason: ContentSanityReviewReason;
  /** Solo encoding/placeholder presentes en el summary — los que pueden disparar REVIEW. */
  blocking_defect_types: ContentSanityBlockingType[];
  /** listing/boilerplate presentes — DIAGNOSTIC_ONLY, nunca disparan REVIEW_CONTENT_SANITY. */
  diagnostic_defect_types: ContentSanityDiagnosticType[];
  policy_id: string;
  policy_status: ContentSanityPolicyStatus;
  summary: ContentSanitySummary;
}

export interface ContentSanityInputRow {
  noticia_id: string;
  url_original: string | null;
  /** Campo PRIMARY de texto limpio (alimenta persisted_clean_text_ratio). */
  texto_nota_limpia: string | null;
}

function vacio(v: string | null | undefined): boolean {
  return v === null || v === undefined || v.trim().length === 0;
}

function absentSummary(issue: ContentSanityIssue): ContentSanitySummary {
  return {
    schema_version: CONTENT_SANITY_SUMMARY_SCHEMA_VERSION,
    availability: 'UNAVAILABLE',
    issue,
    sample_total: null,
    encoding_suspect_count: null,
    listing_suspect_count: null,
    boilerplate_suspect_count: null,
    placeholder_count: null,
    blocking_defective_count: null,
    blocking_defective_rate: null,
    example_noticia_ids: [],
  };
}

function zeroSampleSummary(): ContentSanitySummary {
  return {
    schema_version: CONTENT_SANITY_SUMMARY_SCHEMA_VERSION,
    availability: 'NOT_APPLICABLE',
    issue: 'ZERO_SAMPLE',
    sample_total: 0,
    encoding_suspect_count: 0,
    listing_suspect_count: 0,
    boilerplate_suspect_count: 0,
    placeholder_count: 0,
    blocking_defective_count: 0,
    blocking_defective_rate: null,
    example_noticia_ids: [],
  };
}

/**
 * Policy operacional V1 — UNSET hasta aprobación humana.
 * No contiene cutoff. evaluateContentSanity con esta policy NUNCA da PASS.
 */
export const OPERATIONAL_CONTENT_SANITY_POLICY: ContentSanityPolicy = {
  schema_version: CONTENT_SANITY_POLICY_SCHEMA_VERSION,
  policy_id: 'content-sanity-operational-v1',
  status: 'UNSET',
  min_blocking_defective_count: null,
  min_blocking_defective_rate: null,
};

const nonNegInt = z.number().int().nonnegative();
const nonNegIntNull = nonNegInt.nullable();

export const contentSanitySummarySchema = z
  .object({
    schema_version: z.literal(CONTENT_SANITY_SUMMARY_SCHEMA_VERSION),
    availability: z.enum(['AVAILABLE', 'UNAVAILABLE', 'NOT_APPLICABLE']),
    issue: z
      .enum([
        'ZERO_SAMPLE',
        'SNAPSHOT_NOT_COMPLETE',
        'EVIDENCE_ABSENT',
        'INVALID_SCHEMA',
        'SAMPLE_TOTAL_MISMATCH',
      ])
      .nullable(),
    sample_total: nonNegIntNull,
    encoding_suspect_count: nonNegIntNull,
    listing_suspect_count: nonNegIntNull,
    boilerplate_suspect_count: nonNegIntNull,
    placeholder_count: nonNegIntNull,
    blocking_defective_count: nonNegIntNull,
    blocking_defective_rate: z.number().finite().nullable(),
    example_noticia_ids: z.array(z.string()).max(3),
  })
  .superRefine((s, ctx) => {
    if (s.availability === 'AVAILABLE') {
      if (s.sample_total === null || s.sample_total <= 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'AVAILABLE exige sample_total > 0' });
        return;
      }
      const counts = [
        s.encoding_suspect_count,
        s.listing_suspect_count,
        s.boilerplate_suspect_count,
        s.placeholder_count,
        s.blocking_defective_count,
      ];
      if (counts.some((c) => c === null)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'AVAILABLE exige counts no-null' });
        return;
      }
      for (const c of counts) {
        if (c! > s.sample_total) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `count ${c} > sample_total ${s.sample_total}` });
        }
      }
      if (s.blocking_defective_rate === null || s.blocking_defective_rate < 0 || s.blocking_defective_rate > 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'AVAILABLE exige blocking_defective_rate finito en [0,1]',
        });
      } else {
        const expected = s.blocking_defective_count! / s.sample_total;
        if (Math.abs(s.blocking_defective_rate - expected) > 1e-9) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `blocking_defective_rate ${s.blocking_defective_rate} != blocking/sample ${expected}`,
          });
        }
      }
      const blockingMax = Math.max(s.encoding_suspect_count!, s.placeholder_count!);
      if (s.blocking_defective_count! < blockingMax) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `blocking_defective_count ${s.blocking_defective_count} < max(encoding, placeholder) ${blockingMax}`,
        });
      }
      if (s.blocking_defective_count! > s.encoding_suspect_count! + s.placeholder_count!) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            `blocking_defective_count ${s.blocking_defective_count} > encoding+placeholder ` +
            `${s.encoding_suspect_count! + s.placeholder_count!}`,
        });
      }
    } else if (s.availability === 'NOT_APPLICABLE') {
      if (
        s.issue !== 'ZERO_SAMPLE' ||
        s.sample_total !== 0 ||
        s.blocking_defective_rate !== null ||
        s.blocking_defective_count !== 0
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'NOT_APPLICABLE/ZERO_SAMPLE exige sample_total=0, blocking_count=0 y blocking_rate=null',
        });
      }
    } else if (s.availability === 'UNAVAILABLE') {
      if (
        s.encoding_suspect_count !== null ||
        s.listing_suspect_count !== null ||
        s.boilerplate_suspect_count !== null ||
        s.placeholder_count !== null ||
        s.blocking_defective_count !== null ||
        s.blocking_defective_rate !== null
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'UNAVAILABLE no puede fingir counters decisionales',
        });
      }
    }
  });

export function validateContentSanitySummary(json: unknown): ContentSanitySummary | null {
  const parsed = contentSanitySummarySchema.safeParse(json);
  return parsed.success ? (parsed.data as ContentSanitySummary) : null;
}

function classifyRow(row: ContentSanityInputRow): {
  encoding: boolean;
  listing: boolean;
  boilerplate: boolean;
  placeholder: boolean;
  blocking: boolean;
} {
  // Solo se sanean artículos CON texto limpio presente. EMPTY reduce PRIMARY.
  if (vacio(row.texto_nota_limpia)) {
    return { encoding: false, listing: false, boilerplate: false, placeholder: false, blocking: false };
  }
  const text = row.texto_nota_limpia as string;
  const encoding = encodingSospechoso(text);
  const listing = pareceListing(row.url_original ?? '');
  const boilerplate = pareceBoilerplate(text);
  const placeholder = parecePlaceholder(text);
  return {
    encoding,
    listing,
    boilerplate,
    placeholder,
    blocking: encoding || placeholder,
  };
}

export interface ComputeContentSanityInput {
  snapshotComplete: boolean;
  rows: ContentSanityInputRow[];
}

/**
 * Resume defectos deterministas sobre las rows de UN medio en la ventana 1C.
 * `rows` solo se confían cuando `snapshotComplete === true`.
 */
export function computeContentSanitySummary(input: ComputeContentSanityInput): ContentSanitySummary {
  if (!input.snapshotComplete) {
    return absentSummary('SNAPSHOT_NOT_COMPLETE');
  }
  const sampleTotal = input.rows.length;
  if (sampleTotal === 0) return zeroSampleSummary();

  let encoding = 0;
  let listing = 0;
  let boilerplate = 0;
  let placeholder = 0;
  let blocking = 0;
  const examples: string[] = [];

  for (const row of input.rows) {
    const c = classifyRow(row);
    if (c.encoding) encoding += 1;
    if (c.listing) listing += 1;
    if (c.boilerplate) boilerplate += 1;
    if (c.placeholder) placeholder += 1;
    if (c.blocking) {
      blocking += 1;
      if (examples.length < 3) examples.push(row.noticia_id);
    }
  }

  return {
    schema_version: CONTENT_SANITY_SUMMARY_SCHEMA_VERSION,
    availability: 'AVAILABLE',
    issue: null,
    sample_total: sampleTotal,
    encoding_suspect_count: encoding,
    listing_suspect_count: listing,
    boilerplate_suspect_count: boilerplate,
    placeholder_count: placeholder,
    blocking_defective_count: blocking,
    blocking_defective_rate: blocking / sampleTotal,
    example_noticia_ids: examples,
  };
}

function blockingTypes(summary: ContentSanitySummary): ContentSanityBlockingType[] {
  const out: ContentSanityBlockingType[] = [];
  if ((summary.encoding_suspect_count ?? 0) > 0) out.push('encoding');
  if ((summary.placeholder_count ?? 0) > 0) out.push('placeholder');
  return out;
}

function diagnosticTypes(summary: ContentSanitySummary): ContentSanityDiagnosticType[] {
  const out: ContentSanityDiagnosticType[] = [];
  if ((summary.listing_suspect_count ?? 0) > 0) out.push('listing');
  if ((summary.boilerplate_suspect_count ?? 0) > 0) out.push('boilerplate');
  return out;
}

/**
 * Si `raw` falta (artifact legado) → EVIDENCE_ABSENT.
 * Si schema inválido → INVALID_SCHEMA.
 * Si AVAILABLE.sample_total !== expectedSampleTotal (AFTER COMPLETE) → SAMPLE_TOTAL_MISMATCH.
 */
export function resolveContentSanityFromSnapshot(opts: {
  raw: unknown | undefined | null;
  snapshotComplete: boolean;
  afterTotalNews: number | null;
}): ContentSanitySummary {
  if (opts.raw === undefined || opts.raw === null) {
    return absentSummary('EVIDENCE_ABSENT');
  }
  const validated = validateContentSanitySummary(opts.raw);
  if (!validated) return absentSummary('INVALID_SCHEMA');
  if (
    opts.snapshotComplete &&
    opts.afterTotalNews !== null &&
    validated.availability === 'AVAILABLE' &&
    validated.sample_total !== opts.afterTotalNews
  ) {
    return absentSummary('SAMPLE_TOTAL_MISMATCH');
  }
  if (opts.snapshotComplete && opts.afterTotalNews === 0 && validated.availability === 'AVAILABLE') {
    return absentSummary('SAMPLE_TOTAL_MISMATCH');
  }
  return validated;
}

export function evaluateContentSanity(
  summary: ContentSanitySummary,
  policy: ContentSanityPolicy,
): ContentSanityEvaluation {
  const base = {
    blocking_defect_types: blockingTypes(summary),
    diagnostic_defect_types: diagnosticTypes(summary),
    policy_id: policy.policy_id,
    policy_status: policy.status,
    summary,
  };

  if (summary.availability === 'UNAVAILABLE') {
    const reason: ContentSanityReviewReason =
      summary.issue === 'EVIDENCE_ABSENT'
        ? 'REVIEW_MISSING_SANITY_EVIDENCE'
        : summary.issue === 'SAMPLE_TOTAL_MISMATCH'
          ? 'REVIEW_CONTENT_SANITY_MISMATCH'
          : 'REVIEW_CONTENT_SANITY_INVALID';
    return { outcome: 'NOT_EVALUABLE', review_reason: reason, ...base };
  }

  if (summary.availability === 'NOT_APPLICABLE') {
    return { outcome: 'NOT_EVALUABLE', review_reason: 'REVIEW_CONTENT_SANITY_ZERO_SAMPLE', ...base };
  }

  if (policy.status !== 'ACTIVE') {
    return { outcome: 'NOT_EVALUABLE', review_reason: 'REVIEW_CONTENT_SANITY_POLICY_UNSET', ...base };
  }

  const minCount = policy.min_blocking_defective_count;
  const minRate = policy.min_blocking_defective_rate;
  if (minCount === null || minRate === null) {
    return { outcome: 'NOT_EVALUABLE', review_reason: 'REVIEW_CONTENT_SANITY_POLICY_UNSET', ...base };
  }

  const blocking = summary.blocking_defective_count ?? 0;
  const rate = summary.blocking_defective_rate ?? 0;
  const blocks = blocking >= minCount && rate >= minRate;
  if (blocks) {
    return { outcome: 'REVIEW', review_reason: 'REVIEW_CONTENT_SANITY', ...base };
  }
  return { outcome: 'PASS', review_reason: null, ...base };
}
