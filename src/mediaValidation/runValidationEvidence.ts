/**
 * Run Validation Evidence — Media Validation & Certification, FASE 1C
 * (HARDENING FINAL: B5C — "context_identity=MISMATCH puede coexistir con
 * persistence=VERIFIED").
 *
 * Composición final: por medio_id, une RUN EVIDENCE (Fase 1B) con
 * PERSISTENCE EVIDENCE (Fase 1C — `newsLakeSnapshot.ts` + `mediaDelta.ts`)
 * bajo un `RunContext` común (`runContext.ts`). NO decide PASS/REVIEW/FAIL,
 * NO aplica umbrales de calidad. Solo COMPONE evidencia ya calculada,
 * preservando cualquier discrepancia como señal, no como veredicto.
 *
 * ── HARDENING FINAL (B5C) ──────────────────────────────────────────────────
 *
 * Antes, `persistence.status` se calculaba SOLO a partir de
 * `before.status`/`after.status`, ignorando si `context_identity` era
 * `MATCH` o `MISMATCH`. Eso permitía que un `MISMATCH` (before/after de
 * contextos distintos, roles intercambiados, ventanas distintas, orden
 * temporal inválido...) coexistiera con `persistence.status='VERIFIED'` —
 * una afirmación de verificación FALSA. Ahora `derivePersistenceEvidence`
 * recibe también el resultado de `checkRunContextIdentity` (calculado UNA
 * vez, a nivel de todo el run, en `composeRunValidationEvidence`) y
 * `'VERIFIED'` solo puede emitirse cuando TODAS estas condiciones se
 * cumplen simultáneamente (§29 del prompt de hardening):
 *
 *   1. `context_identity.status === 'MATCH'`;
 *   2. `before.status === 'COMPLETE'` Y `after.status === 'COMPLETE'`;
 *   3. `delta.status === 'COMPUTED'` (se deriva automáticamente de (2));
 *   4. ningún drift observable (`before.consistency !== 'POSSIBLE_DRIFT'`
 *      Y `after.consistency !== 'POSSIBLE_DRIFT'` — §34 del prompt: un
 *      drift de paginación nunca se esconde detrás de "VERIFIED").
 *
 * Los artifacts ya fueron validados en runtime ANTES de llegar aquí (ver
 * `artifactSchemas.ts` + `scripts/media-validation-compose.ts`) — esta
 * capa nunca vuelve a validar JSON, solo compone tipos ya construidos.
 */
import type { RunEvidence, MediaEvidence } from './runEvidenceAggregator.js';
import type { RunContext } from './runContext.js';
import { checkRunContextIdentity, type ContextMatchResult } from './runContext.js';
import type { MediaSnapshot, SnapshotResult } from './newsLakeSnapshot.js';
import { computeMediaDelta, type MediaDelta } from './mediaDelta.js';

/** Versión del contrato `RunValidationEvidence` — metadata para una fase futura que lo consuma como input; hoy nada dentro de esta fase lo vuelve a leer. */
export const RUN_VALIDATION_EVIDENCE_SCHEMA_VERSION = 1;

// ─────────────────────────────────────────────────────────────────────────────
// Persistence evidence
// ─────────────────────────────────────────────────────────────────────────────

export type PersistenceStatus = 'VERIFIED' | 'UNVERIFIED' | 'INDETERMINATE';

export interface MediaPersistenceEvidence {
  medio_id: string;
  status: PersistenceStatus;
  before: MediaSnapshot;
  after: MediaSnapshot;
  delta: MediaDelta;
  reason: string | null;
}

/**
 * `contextIdentityStatus` se calcula UNA vez a nivel de run (no por medio) —
 * es la misma decisión estructural para todos los medios del mismo
 * before/after (B5C: nunca se recalcula distinto por medio_id).
 */
function derivePersistenceEvidence(
  before: MediaSnapshot,
  after: MediaSnapshot,
  contextIdentityStatus: ContextMatchResult['status'],
): MediaPersistenceEvidence {
  const delta = computeMediaDelta(before, after);
  let status: PersistenceStatus;
  let reason: string | null;

  if (contextIdentityStatus !== 'MATCH') {
    status = 'INDETERMINATE';
    reason =
      'context_identity=MISMATCH — no se puede afirmar persistencia VERIFICADA sobre un contexto inconsistente ' +
      '(B5C: before/after podrían pertenecer a contextos, roles o ventanas temporales distintas).';
  } else if (before.status === 'COMPLETE' && after.status === 'COMPLETE') {
    if (before.consistency === 'POSSIBLE_DRIFT' || after.consistency === 'POSSIBLE_DRIFT') {
      status = 'INDETERMINATE';
      reason =
        'drift de paginación observado (duplicate_rows_skipped>0) en before y/o after — el dataset se movió ' +
        'durante la lectura paginada; no se exagera certeza point-in-time (§33-34 del prompt de hardening).';
    } else {
      status = 'VERIFIED';
      reason = null;
    }
  } else if (before.status === 'ERROR' || after.status === 'ERROR') {
    status = 'INDETERMINATE';
    reason = `no se puede verificar persistencia: snapshot con ERROR (before.status=${before.status}, after.status=${after.status}).`;
  } else {
    status = 'INDETERMINATE';
    reason = `no se puede verificar persistencia: snapshot incompleto (before.status=${before.status}, after.status=${after.status}).`;
  }

  return { medio_id: before.medio_id, status, before, after, delta, reason };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconciliación: discrepancias observables entre contadores de EJECUCIÓN
// (Fase 1B) y delta PERSISTIDO (Fase 1C), sin heurísticas ni veredicto.
// ─────────────────────────────────────────────────────────────────────────────

export type ReconciliationDimension = 'news_count' | 'clean_text_count';

export interface ReconciliationSignal {
  dimension: ReconciliationDimension;
  run_counter: number | null;
  observed_delta: number | null;
  matches: boolean | null;
  note: string;
}

function buildReconciliationSignals(runEvidence: MediaEvidence, delta: MediaDelta): ReconciliationSignal[] {
  const observedNewsDelta = delta.status === 'COMPUTED' ? delta.news_delta : null;
  const observedCleanTextDelta = delta.status === 'COMPUTED' ? delta.clean_text_delta : null;

  const insertedRun = runEvidence.crawl.inserted;
  const cleanTextRun = runEvidence.enrich.clean_text_count;

  return [
    {
      dimension: 'news_count',
      run_counter: insertedRun,
      observed_delta: observedNewsDelta,
      matches: insertedRun !== null && observedNewsDelta !== null ? insertedRun === observedNewsDelta : null,
      note:
        '`crawl.inserted` (contador de EJECUCIÓN, Fase 1B) vs `news_delta` (persistencia OBSERVADA, Fase 1C). ' +
        'Pueden diferir legítimamente por duplicados, contenido preexistente, límites de captura u otras causas — ' +
        'una discrepancia NO implica que el run haya fallado.',
    },
    {
      dimension: 'clean_text_count',
      run_counter: cleanTextRun,
      observed_delta: observedCleanTextDelta,
      matches: cleanTextRun !== null && observedCleanTextDelta !== null ? cleanTextRun === observedCleanTextDelta : null,
      note:
        '`enrich.clean_text_count` (contador de PROCESAMIENTO, Fase 1B — NO prueba persistencia) vs ' +
        '`clean_text_delta` (persistencia OBSERVADA, Fase 1C). Pueden diferir legítimamente.',
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Composición final por medio_id + a nivel de run
// ─────────────────────────────────────────────────────────────────────────────

export interface MediaValidationRecord {
  medio_id: string;
  /** Referencia directa al `MediaEvidence` de Fase 1B — nunca copiado/mutado. */
  run_evidence: MediaEvidence;
  persistence: MediaPersistenceEvidence;
  reconciliation: ReconciliationSignal[];
}

export interface RunValidationEvidence {
  schema_version: typeof RUN_VALIDATION_EVIDENCE_SCHEMA_VERSION;
  context: RunContext;
  context_identity: ContextMatchResult;
  media: MediaValidationRecord[];
  unattributed_enrich: RunEvidence['unattributed_enrich'];
  warnings: string[];
}

export interface ComposeRunValidationEvidenceInput {
  context: RunContext;
  runEvidence: RunEvidence;
  before: SnapshotResult;
  after: SnapshotResult;
}

/**
 * Compone la evidencia final. NUNCA decide PASS/REVIEW/FAIL. `context_identity`
 * se calcula UNA sola vez (no por medio) y gobierna si `persistence.status`
 * puede llegar a `'VERIFIED'` para CUALQUIER medio de este run (B5C).
 */
export function composeRunValidationEvidence(input: ComposeRunValidationEvidenceInput): RunValidationEvidence {
  const { context, runEvidence, before, after } = input;
  const warnings: string[] = [];

  const contextIdentity = checkRunContextIdentity({ context, before, after });
  if (contextIdentity.status === 'MISMATCH') {
    warnings.push(
      `context_identity=MISMATCH: ningún medio de este run puede reportar persistence='VERIFIED' (B5C). ` +
        `Detalle: ${contextIdentity.issues.join('; ')}`,
    );
  }

  const beforeByMedio = new Map(before.media.map((m) => [m.medio_id, m]));
  const afterByMedio = new Map(after.media.map((m) => [m.medio_id, m]));

  const media: MediaValidationRecord[] = [];

  for (const runMedia of runEvidence.media) {
    const medioId = runMedia.medio_id;
    const beforeSnap = beforeByMedio.get(medioId);
    const afterSnap = afterByMedio.get(medioId);

    if (!beforeSnap || !afterSnap) {
      warnings.push(
        `medio_id=${medioId}: hay evidencia de ejecución (Fase 1B) pero falta snapshot ${!beforeSnap ? "'before'" : "'after'"} — ` +
          'no se compone persistence evidence para este medio_id.',
      );
      continue;
    }

    const persistence = derivePersistenceEvidence(beforeSnap, afterSnap, contextIdentity.status);
    const reconciliation = buildReconciliationSignals(runMedia, persistence.delta);

    media.push({ medio_id: medioId, run_evidence: runMedia, persistence, reconciliation });
  }

  // medio_id solicitados en el contexto (universo CONOCIDO, no null) pero
  // ausentes de runEvidence.media: señal de inconsistencia en la llamada al
  // Aggregator de 1B — nunca se fabrica un `MediaEvidence`.
  const runMediaIds = new Set(runEvidence.media.map((m) => m.medio_id));
  for (const medioId of context.requested_media_ids ?? []) {
    if (!runMediaIds.has(medioId)) {
      warnings.push(
        `medio_id=${medioId}: está en context.requested_media_ids pero NO tiene entrada en runEvidence.media — ` +
          'verifica que aggregateRunEvidence() se haya llamado con requestedMediaIds === context.requested_media_ids.',
      );
    }
  }

  media.sort((a, b) => a.medio_id.localeCompare(b.medio_id));

  return {
    schema_version: RUN_VALIDATION_EVIDENCE_SCHEMA_VERSION,
    context,
    context_identity: contextIdentity,
    media,
    unattributed_enrich: runEvidence.unattributed_enrich,
    warnings,
  };
}
