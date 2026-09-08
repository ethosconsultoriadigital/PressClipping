/**
 * Run Context — Media Validation & Certification, FASE 1C (HARDENING FINAL:
 * identidad temporal + identidad de contexto + universo desconocido≠vacío).
 *
 * Identifica la corrida concreta a la que pertenece una comparación
 * before/after. Consume el contrato de Fase 1B (`RunEvidence.run`) SIN
 * modificar `runEvidenceAggregator.ts` — Fase 1B está cerrada.
 *
 * ── HARDENING FINAL (blockers de la auditoría adversarial) ────────────────
 *
 * B2C — `requested_media_ids: null ≠ []`: la versión anterior colapsaba
 * `runEvidence.run.requested_media_ids ?? []`, perdiendo la distinción
 * entre "universo desconocido" (`null`, cuando 1B no tuvo ninguna fuente de
 * `requested_media_ids`) y "universo explícitamente vacío" (`[]`, cuando el
 * llamador declaró cero medios esperados). Ahora `RunContext.requested_media_ids`
 * es `string[] | null` — igual que en `RunEvidence.run.requested_media_ids` —
 * y se asigna DIRECTAMENTE, sin `?? []`.
 *
 * B4C — identidad: se añade `context_id` (identidad explícita del intento de
 * validación, compartida entre BEFORE/RUN/AFTER — nunca `run_id`, que es
 * metadata de la ejecución del pipeline, no del "paquete" de validación) y
 * `window_anchor` (identidad temporal — ver `temporalWindow.ts`). Ambos son
 * OBLIGATORIOS en `buildRunContextFromRunEvidence`: si el llamador no los
 * conoce, no se inventan (§40 del prompt de hardening).
 *
 * B5C — `checkRunContextIdentity` ahora es la única fuente de verdad para
 * decidir si `persistence.status` puede ser `'VERIFIED'` (ver
 * `runValidationEvidence.ts`): un `MISMATCH` aquí SIEMPRE bloquea `VERIFIED`
 * en la capa de composición.
 */
import type { RunEvidence, RequestedMediaIdsCoverage } from './runEvidenceAggregator.js';
import type { SnapshotResult } from './newsLakeSnapshot.js';
import { isValidIsoTimestamp } from './temporalWindow.js';

// ─────────────────────────────────────────────────────────────────────────────
// Contrato
// ─────────────────────────────────────────────────────────────────────────────

export interface RunContext {
  /** Identidad EXPLÍCITA del intento de validación (BEFORE + RUN + AFTER). Distinta de `run_id` (§21 del prompt). */
  context_id: string;
  /** Igual semántica que `RunEvidence.run.run_id` — metadata externa de la EJECUCIÓN del pipeline, nunca autenticadora de identidad de contexto. */
  run_id: string | null;
  /**
   * `null` = universo desconocido/no disponible (1B no tuvo ninguna fuente
   * de `requested_media_ids`). `[]` = universo EXPLÍCITAMENTE vacío. Un
   * array no vacío = universo conocido. NUNCA se colapsan estos tres casos
   * (B2C) — asignado directamente desde `RunEvidence.run.requested_media_ids`.
   */
  requested_media_ids: string[] | null;
  requested_media_ids_source: RunEvidence['run']['requested_media_ids_source'];
  requested_media_ids_coverage: RequestedMediaIdsCoverage;
  /** Modo de ejecución global, solo cuando puede conocerse sin ambigüedad (ver `deriveRunLevelDryRun`). */
  dry_run: boolean | null;
  /** Identidad temporal explícita (B1C) — mismo valor debe reutilizarse en BEFORE y AFTER. */
  window_anchor: string | null;
  window_days: number | null;
  max_notas: number | null;
  enrich_limit: number | null;
}

export interface BuildRunContextOptions {
  /** Obligatorio, no vacío (B4C) — identidad del intento de validación. */
  contextId: string;
  /**
   * Obligatorio (aunque puede ser `null` si no se aplica ninguna ventana
   * temporal) — nunca se omite silenciosamente ni se sustituye por
   * `Date.now()` en ningún punto de este módulo (B1C).
   */
  windowAnchor: string | null;
  windowDays?: number | null;
  maxNotas?: number | null;
  enrichLimit?: number | null;
}

export function deriveRunLevelDryRun(runEvidence: RunEvidence): boolean | null {
  const values = new Set<boolean>();
  for (const m of runEvidence.media) {
    if (m.enrich.dry_run !== null) values.add(m.enrich.dry_run);
  }
  if (runEvidence.unattributed_enrich !== null && runEvidence.unattributed_enrich.dry_run !== null) {
    values.add(runEvidence.unattributed_enrich.dry_run);
  }
  if (values.size !== 1) return null;
  return [...values][0]!;
}

/**
 * Construye el `RunContext`. Valida en el momento de construcción (fail
 * fast, nunca silencioso):
 * - `contextId` no vacío;
 * - `windowAnchor`, si no es `null`, es un ISO timestamp válido;
 * - si `windowDays` está activo, `windowAnchor` es obligatorio.
 */
export function buildRunContextFromRunEvidence(
  runEvidence: RunEvidence,
  opts: BuildRunContextOptions,
): RunContext {
  if (!opts.contextId || opts.contextId.trim().length === 0) {
    throw new Error('buildRunContextFromRunEvidence: contextId no puede estar vacío (B4C).');
  }
  if (opts.windowAnchor !== null && !isValidIsoTimestamp(opts.windowAnchor)) {
    throw new Error(`buildRunContextFromRunEvidence: windowAnchor inválido: ${JSON.stringify(opts.windowAnchor)}`);
  }
  const windowDays = opts.windowDays ?? null;
  if (windowDays !== null && opts.windowAnchor === null) {
    throw new Error(
      'buildRunContextFromRunEvidence: windowDays está activo pero falta windowAnchor (B1C). No se inventa uno.',
    );
  }

  return {
    context_id: opts.contextId,
    run_id: runEvidence.run.run_id,
    // B2C: asignación DIRECTA, sin `?? []` — preserva null (desconocido) vs [] (vacío explícito).
    requested_media_ids: runEvidence.run.requested_media_ids,
    requested_media_ids_source: runEvidence.run.requested_media_ids_source,
    requested_media_ids_coverage: runEvidence.run.requested_media_ids_coverage,
    dry_run: deriveRunLevelDryRun(runEvidence),
    window_anchor: opts.windowAnchor,
    window_days: windowDays,
    max_notas: opts.maxNotas ?? null,
    enrich_limit: opts.enrichLimit ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Identidad before/after/context — nunca mezclar un before del Run A con un
// after del Run B sin señal explícita de inconsistencia (B4C/B5C).
// ─────────────────────────────────────────────────────────────────────────────

export type ContextMatchStatus = 'MATCH' | 'MISMATCH';

export interface ContextMatchResult {
  status: ContextMatchStatus;
  /** Vacío cuando `status === 'MATCH'`. Cada entrada describe una incompatibilidad concreta. */
  issues: string[];
}

function idSet(ids: string[]): Set<string> {
  return new Set(ids.map((id) => id.trim()).filter((id) => id.length > 0));
}

/** Igualdad de CONJUNTO — mismo universo en distinto orden NO es un mismatch. */
function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

/**
 * Verifica que `before`/`after`/`context` pertenezcan al MISMO contexto de
 * validación. Condiciones (§26 del prompt de hardening) — TODAS deben
 * cumplirse para `MATCH`:
 *
 * 1. `context_id` idéntico en `context`/`before`/`after` (nunca `run_id`
 *    como identidad — §26 explícito).
 * 2. Roles correctos: `before.snapshot_role === 'BEFORE'`,
 *    `after.snapshot_role === 'AFTER'` (nunca intercambiados).
 * 3. Universo de medio_id compatible: `before`/`after` comparten el mismo
 *    conjunto, Y si `context.requested_media_ids` es conocido (no `null`),
 *    coincide con ambos. Si `context.requested_media_ids` es `null`
 *    (universo desconocido), NUNCA se declara `MATCH` pleno en esta
 *    dimensión — universo desconocido ≠ universo vacío (§12/§28 del
 *    prompt: "context=null, before=[], after=[] → NO MATCH pleno").
 * 4. `window_days` idéntico en los tres.
 * 5. `window_anchor` idéntico en los tres (identidad temporal, B1C).
 * 6. Orden temporal válido: `before.capture_completed_at <=
 *    after.capture_started_at` (AFTER no puede haber terminado/empezado
 *    antes de que BEFORE terminara).
 */
export function checkRunContextIdentity(params: {
  context: RunContext;
  before: SnapshotResult;
  after: SnapshotResult;
}): ContextMatchResult {
  const { context, before, after } = params;
  const issues: string[] = [];

  // 1. context_id
  if (!context.context_id || context.context_id.trim().length === 0) {
    issues.push('context.context_id está vacío — no hay identidad de contexto que verificar (B4C).');
  } else {
    if (before.context_id !== context.context_id) {
      issues.push(`before.context_id (${before.context_id}) !== context.context_id (${context.context_id}).`);
    }
    if (after.context_id !== context.context_id) {
      issues.push(`after.context_id (${after.context_id}) !== context.context_id (${context.context_id}).`);
    }
  }

  // 2. roles
  if (before.snapshot_role !== 'BEFORE') {
    issues.push(`before.snapshot_role es '${before.snapshot_role}', se esperaba 'BEFORE' (roles intercambiados o incorrectos).`);
  }
  if (after.snapshot_role !== 'AFTER') {
    issues.push(`after.snapshot_role es '${after.snapshot_role}', se esperaba 'AFTER' (roles intercambiados o incorrectos).`);
  }

  // 3. universo
  const beforeIds = idSet(before.requested_media_ids);
  const afterIds = idSet(after.requested_media_ids);
  if (!setsEqual(beforeIds, afterIds)) {
    issues.push('before.requested_media_ids y after.requested_media_ids no representan el mismo conjunto de medio_id.');
  }
  if (context.requested_media_ids === null) {
    issues.push(
      'context.requested_media_ids es null (universo desconocido) — no se puede confirmar que before/after ' +
        'representen el universo completo de esta validación (universo desconocido ≠ universo vacío).',
    );
  } else {
    const ctxIds = idSet(context.requested_media_ids);
    if (!setsEqual(ctxIds, beforeIds)) {
      issues.push('before.requested_media_ids no coincide (como conjunto) con context.requested_media_ids.');
    }
    if (!setsEqual(ctxIds, afterIds)) {
      issues.push('after.requested_media_ids no coincide (como conjunto) con context.requested_media_ids.');
    }
  }

  // 4. window_days
  if (context.window_days !== before.window_days || context.window_days !== after.window_days) {
    issues.push(
      `window_days no coincide entre context (${JSON.stringify(context.window_days)}), ` +
        `before (${JSON.stringify(before.window_days)}) y after (${JSON.stringify(after.window_days)}).`,
    );
  }

  // 5. window_anchor (identidad temporal, B1C)
  if (context.window_anchor !== before.window_anchor || context.window_anchor !== after.window_anchor) {
    issues.push(
      `window_anchor no coincide entre context (${JSON.stringify(context.window_anchor)}), ` +
        `before (${JSON.stringify(before.window_anchor)}) y after (${JSON.stringify(after.window_anchor)}) — ` +
        'sin la misma identidad temporal antes/después no se puede afirmar la misma ventana (B1C).',
    );
  }

  // 6. orden temporal
  const beforeCompletedMs = new Date(before.capture_completed_at).getTime();
  const afterStartedMs = new Date(after.capture_started_at).getTime();
  if (!Number.isFinite(beforeCompletedMs) || !Number.isFinite(afterStartedMs)) {
    issues.push('capture_completed_at/capture_started_at no son timestamps válidos — no se puede verificar el orden temporal.');
  } else if (beforeCompletedMs > afterStartedMs) {
    issues.push(
      `before.capture_completed_at (${before.capture_completed_at}) es posterior a ` +
        `after.capture_started_at (${after.capture_started_at}) — AFTER no puede haber comenzado antes de que BEFORE terminara.`,
    );
  }

  return { status: issues.length === 0 ? 'MATCH' : 'MISMATCH', issues };
}
