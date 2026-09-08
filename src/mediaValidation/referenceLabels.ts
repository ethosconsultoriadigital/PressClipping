/**
 * Reference Labels — Media Validation & Certification, FASE 1D/1E.
 *
 * Contrato + resolución determinista de `ReferenceLabelManifest` (§17-21 del
 * prompt de Fase 1D/1E). Un label de referencia NUNCA es ground truth
 * científico automático — es una etiqueta de CALIBRACIÓN con `label_source`
 * explícita (§18: "NO presentar legacy_readiness como verdad absoluta").
 *
 * Vocabulario de labels (§17): inspirado en los estados operativos del
 * auditor legacy (`scripts/audit-all-media-clean-capture-readiness.ts`:
 * `LISTO_LEYENDO`, `EN_CRON_TEXTO_MALO`, `EN_CRON_SIN_NOTICIAS`,
 * `NECESITA_REPARAR_FUENTE`) pero NUNCA se reutilizan esos nombres
 * directamente ni se consulta ese script en runtime — el label es una
 * ENTRADA MANUAL/CURADA (`ReferenceLabelManifest`), nunca una consulta en
 * vivo al auditor. `BLOQUEADO`/`PAYWALL_NO_VIABLE` (política/viabilidad) se
 * mantienen fuera del vocabulario de calidad TÉCNICA (§17: "no incluir
 * automáticamente BLOCKED/PAYWALL dentro del mismo problema de calidad
 * técnica").
 *
 * PRINCIPIO DE NO LEAKAGE (§50): estos labels NUNCA entran en
 * `MediaQualityMetrics` (`qualityMetrics.ts` no importa nada de este
 * archivo) — solo se usan aquí, en `calibration.ts`, para agrupar
 * observaciones y calcular estadísticas descriptivas. Usarlos como
 * feature/input de una decisión de validación sería circular.
 */

export const REFERENCE_LABEL_MANIFEST_SCHEMA_VERSION = 1;

/**
 * `GOOD_REFERENCE`: candidato positivo conocido (análogo a `LISTO_LEYENDO`).
 * `TEXT_BAD_REFERENCE`: referencia problemática de TEXTO (análogo a
 * `EN_CRON_TEXTO_MALO`/`NECESITA_REENRICH_RECIENTE`).
 * `NO_NEWS_REFERENCE`: referencia problemática de CAPTURA/volumen (análogo a
 * `EN_CRON_SIN_NOTICIAS`).
 * `SOURCE_REPAIR_REFERENCE`: referencia problemática de FUENTE (análogo a
 * `NECESITA_REPARAR_FUENTE`).
 * `OTHER_PROBLEM_REFERENCE`: problema conocido que no encaja limpiamente en
 * los tres subtipos anteriores — se preserva el subtipo en vez de forzarlo.
 */
export type ReferenceLabel =
  | 'GOOD_REFERENCE'
  | 'TEXT_BAD_REFERENCE'
  | 'NO_NEWS_REFERENCE'
  | 'SOURCE_REPAIR_REFERENCE'
  | 'OTHER_PROBLEM_REFERENCE';

export const REFERENCE_LABEL_VALUES: ReadonlySet<ReferenceLabel> = new Set([
  'GOOD_REFERENCE',
  'TEXT_BAD_REFERENCE',
  'NO_NEWS_REFERENCE',
  'SOURCE_REPAIR_REFERENCE',
  'OTHER_PROBLEM_REFERENCE',
]);

/** Positivo único (§28: "positive_label" para confusion matrix). Los demás labels son negativos/problema. */
export const POSITIVE_REFERENCE_LABEL: ReferenceLabel = 'GOOD_REFERENCE';

export const PROBLEM_REFERENCE_LABELS: readonly ReferenceLabel[] = [
  'TEXT_BAD_REFERENCE',
  'NO_NEWS_REFERENCE',
  'SOURCE_REPAIR_REFERENCE',
  'OTHER_PROBLEM_REFERENCE',
];

/** §18: cada label debe poder decir de dónde vino. `legacy_readiness` NUNCA se presenta como verdad absoluta. */
export type LabelSource = 'human_review' | 'legacy_readiness' | 'curated_manifest';

export const LABEL_SOURCE_VALUES: ReadonlySet<LabelSource> = new Set(['human_review', 'legacy_readiness', 'curated_manifest']);

export interface ReferenceLabelEntry {
  medio_id: string;
  label: ReferenceLabel;
}

export interface ReferenceLabelManifest {
  schema_version: typeof REFERENCE_LABEL_MANIFEST_SCHEMA_VERSION;
  label_source: LabelSource;
  entries: ReferenceLabelEntry[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolución determinista — §20/§21 del prompt.
// ─────────────────────────────────────────────────────────────────────────────

export interface RejectedLabelEntry {
  medio_id: string;
  reason: string;
  labels_seen: ReferenceLabel[];
}

export interface ReferenceLabelResolution {
  /** Un `ResolvedLabel` por `medio_id` — nunca duplicado, nunca conflictivo. */
  resolved: { medio_id: string; label: ReferenceLabel }[];
  /**
   * `medio_id` con labels CONTRADICTORIOS (p.ej. `GOOD_REFERENCE` y
   * `TEXT_BAD_REFERENCE` para el mismo medio) — §20: "NO elegir uno.
   * REJECT/CONFLICT". Excluidos de `resolved`.
   */
  rejected: RejectedLabelEntry[];
  /** `medio_id` con >1 entrada pero MISMO label — deduplicados de forma determinista (§20), no es un conflicto. */
  deduplicated_medio_ids: string[];
}

/**
 * Resuelve un `ReferenceLabelManifest` YA validado en shape (ver
 * `calibrationSchemas.ts`) a un mapa `medio_id → label` sin duplicar ni
 * elegir silenciosamente entre labels contradictorios (§20). Determinista:
 * mismo input → mismo output, sin depender del orden de iteración interno
 * (se ordena `resolved`/`rejected` por `medio_id` al final).
 */
export function resolveReferenceLabelManifest(manifest: ReferenceLabelManifest): ReferenceLabelResolution {
  const byMedio = new Map<string, ReferenceLabel[]>();
  for (const entry of manifest.entries) {
    const list = byMedio.get(entry.medio_id);
    if (list) list.push(entry.label);
    else byMedio.set(entry.medio_id, [entry.label]);
  }

  const resolved: { medio_id: string; label: ReferenceLabel }[] = [];
  const rejected: RejectedLabelEntry[] = [];
  const deduplicatedMedioIds: string[] = [];

  for (const [medioId, labels] of byMedio) {
    const uniqueLabels = [...new Set(labels)];
    if (uniqueLabels.length === 1) {
      resolved.push({ medio_id: medioId, label: uniqueLabels[0]! });
      if (labels.length > 1) deduplicatedMedioIds.push(medioId);
    } else {
      rejected.push({
        medio_id: medioId,
        reason: `medio_id con labels contradictorios en el mismo manifest (${uniqueLabels.join(', ')}) — se rechaza, no se elige uno.`,
        labels_seen: uniqueLabels,
      });
    }
  }

  resolved.sort((a, b) => a.medio_id.localeCompare(b.medio_id));
  rejected.sort((a, b) => a.medio_id.localeCompare(b.medio_id));
  deduplicatedMedioIds.sort((a, b) => a.localeCompare(b));

  return { resolved, rejected, deduplicated_medio_ids: deduplicatedMedioIds };
}
