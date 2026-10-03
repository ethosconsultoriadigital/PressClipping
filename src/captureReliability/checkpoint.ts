import type { Checkpoint, SourceReconcileState, SourceJobStatus, CompletenessFlag } from './types.js';

export function emptyCheckpoint(partial: Omit<Checkpoint, 'processed_medio_ids' | 'updated_at' | 'cap_hit' | 'time_budget_hit' | 'last_medio_id'> & {
  last_medio_id?: string | null;
}): Checkpoint {
  return {
    ...partial,
    last_medio_id: partial.last_medio_id ?? null,
    processed_medio_ids: [],
    cap_hit: false,
    time_budget_hit: false,
    updated_at: new Date().toISOString(),
  };
}

export function persistProgress(cp: Checkpoint, medioId: string, nowIso: string): Checkpoint {
  const ids = cp.processed_medio_ids.includes(medioId)
    ? cp.processed_medio_ids
    : [...cp.processed_medio_ids, medioId];
  return { ...cp, last_medio_id: medioId, processed_medio_ids: ids, updated_at: nowIso };
}

export function timeBudgetExceeded(startedMs: number, budgetMs: number, nowMs: number): boolean {
  return nowMs - startedMs >= budgetMs;
}

export function resumeFrom(cp: Checkpoint, catalog: string[]): string[] {
  const done = new Set(cp.processed_medio_ids);
  return catalog.filter((id) => !done.has(id));
}

export function emptySourceState(opts: {
  medioId: string;
  windowStart: string;
  windowEnd: string;
}): SourceReconcileState {
  return {
    medio_id: opts.medioId,
    window_start: opts.windowStart,
    window_end: opts.windowEnd,
    status: 'PENDING',
    cursor: null,
    started_at: null,
    completed_at: null,
    last_error: null,
    discovery_surfaces: [],
    rss_span_covered: 'UNKNOWN',
    sitemap_span_covered: 'UNKNOWN',
    listing_span_covered: 'UNKNOWN',
    sitemap_runtime_completeness_invoked: false,
    urls_discovered: 0,
    urls_known: 0,
    urls_queued: 0,
    urls_persisted: 0,
    urls_rejected: 0,
    urls_blocked: 0,
    urls_failed: 0,
    unexplained_missing: 0,
    cap_hit: false,
    time_budget_hit: false,
    complete: false,
  };
}

export function sourceIsComplete(state: SourceReconcileState): boolean {
  if (state.cap_hit || state.time_budget_hit) return false;
  if (state.unexplained_missing > 0) return false;
  if (state.discovery_surfaces.includes('NO_DISCOVERY_SURFACE')) return false;
  if (state.status === 'INCOMPLETE' || state.status === 'PENDING' || state.status === 'IN_PROGRESS') return false;
  return state.complete;
}

export function markSourceTerminal(
  state: SourceReconcileState,
  status: SourceJobStatus,
  nowIso: string,
): SourceReconcileState {
  const complete =
    status === 'COMPLETE' &&
    !state.cap_hit &&
    !state.time_budget_hit &&
    state.unexplained_missing === 0 &&
    !state.discovery_surfaces.includes('NO_DISCOVERY_SURFACE');
  return {
    ...state,
    status: complete ? 'COMPLETE' : status === 'COMPLETE' ? 'INCOMPLETE' : status,
    complete,
    completed_at: nowIso,
  };
}

export function asCheckpoint(opts: {
  runId: string;
  mode: '24h' | '72h' | 'auditor';
  windowStart: string;
  windowEnd: string;
  states: SourceReconcileState[];
}): Checkpoint {
  const processed = opts.states.filter((s) => s.status === 'COMPLETE' || s.status === 'INCOMPLETE');
  return {
    run_id: opts.runId,
    mode: opts.mode,
    window_start: opts.windowStart,
    window_end: opts.windowEnd,
    last_medio_id: processed.at(-1)?.medio_id ?? null,
    processed_medio_ids: processed.map((s) => s.medio_id),
    cap_hit: opts.states.some((s) => s.cap_hit),
    time_budget_hit: opts.states.some((s) => s.time_budget_hit),
    updated_at: new Date().toISOString(),
  };
}

export type { CompletenessFlag };
