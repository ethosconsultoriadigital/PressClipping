import type { CaptureReliabilityStore } from './captureRecoveryRepository.js';
import type { ChannelCatalogRow, RecoveryObservation, SourceReconcileState } from './types.js';

export const COVERAGE_DEBT_VIA = 'coverage_debt';
export const MAX_COVERAGE_DEBT_ATTEMPTS = 3;

export const COVERAGE_DEBT_REASONS = [
  'SOURCE_TIMEOUT',
  'TIME_BUDGET_HIT',
  'PAGINATION_PENDING',
  'NO_DISCOVERY_SURFACE',
  'RSS_ONLY',
  'COVERAGE_UNKNOWN',
] as const;
export type CoverageDebtReason = (typeof COVERAGE_DEBT_REASONS)[number];

export const COVERAGE_FOLLOW_UPS = [
  'RESUME_SAME_WINDOW',
  'PAGINATE_FROM_CURSOR',
  'SECOND_SURFACE',
  'SURFACE_PROBE',
] as const;
export type CoverageFollowUp = (typeof COVERAGE_FOLLOW_UPS)[number];

export interface CoverageDebtRecord {
  medio_id: string;
  window_start: string;
  window_end: string;
  status: 'INCOMPLETE';
  reason: CoverageDebtReason;
  next_action: string;
  follow_up: CoverageFollowUp;
  automatic: boolean;
  attempt_count: number;
  source_status: SourceReconcileState['status'];
  last_error: string | null;
  cursor: string | null;
  created_at: string;
  updated_at: string;
}

export function coverageDebtId(medioId: string, windowStart: string, windowEnd: string): string {
  return `covdebt:${medioId}:${windowStart}:${windowEnd}`;
}

export function classifyCoverageDebt(
  state: SourceReconcileState,
  _catalog?: ChannelCatalogRow,
): Pick<CoverageDebtRecord, 'reason' | 'next_action' | 'follow_up' | 'automatic'> {
  const err = (state.last_error ?? '').toUpperCase();
  if (err.includes('SOURCE_TIMEOUT') || err === 'TIMEOUT') {
    return {
      reason: 'SOURCE_TIMEOUT',
      next_action: 'resume_source_discovery',
      follow_up: 'RESUME_SAME_WINDOW',
      automatic: true,
    };
  }
  if (state.time_budget_hit) {
    return {
      reason: 'TIME_BUDGET_HIT',
      next_action: 'resume_source_discovery',
      follow_up: 'RESUME_SAME_WINDOW',
      automatic: true,
    };
  }
  if (state.discovery_surfaces.includes('NO_DISCOVERY_SURFACE') || err === 'NO_DISCOVERY_SURFACE') {
    return {
      reason: 'NO_DISCOVERY_SURFACE',
      next_action: 'probe_listing_or_homepage',
      follow_up: 'SURFACE_PROBE',
      automatic: true,
    };
  }
  if (state.cap_hit || state.sitemap_span_covered === 'NO') {
    return {
      reason: 'PAGINATION_PENDING',
      next_action: 'continue_sitemap_from_cursor',
      follow_up: 'PAGINATE_FROM_CURSOR',
      automatic: true,
    };
  }
  const rssOnly = state.discovery_surfaces.length > 0 && state.discovery_surfaces.every((s) => s === 'rss');
  if (rssOnly) {
    return {
      reason: 'RSS_ONLY',
      next_action: 'try_sitemap_or_listing',
      follow_up: 'SECOND_SURFACE',
      automatic: true,
    };
  }
  return {
    reason: 'COVERAGE_UNKNOWN',
    next_action: 'resume_source_discovery',
    follow_up: 'RESUME_SAME_WINDOW',
    automatic: true,
  };
}

export function isResumableDebt(debt: CoverageDebtRecord | null | undefined): boolean {
  return Boolean(debt && debt.automatic && debt.attempt_count < MAX_COVERAGE_DEBT_ATTEMPTS);
}

function toObservation(debt: CoverageDebtRecord): RecoveryObservation {
  const id = coverageDebtId(debt.medio_id, debt.window_start, debt.window_end);
  return {
    run_id: id,
    hash_url: id,
    medio_id: debt.medio_id,
    window_start: debt.window_start,
    window_end: debt.window_end,
    discovered_via: COVERAGE_DEBT_VIA,
    observed_status: 'NEEDS_ENRICH',
    observed_at: debt.updated_at,
    reject_reason: JSON.stringify(debt),
  };
}

export function parseCoverageDebt(obs: RecoveryObservation): CoverageDebtRecord | null {
  if (obs.discovered_via !== COVERAGE_DEBT_VIA || !obs.reject_reason) return null;
  try {
    const raw = JSON.parse(obs.reject_reason) as CoverageDebtRecord;
    if (!raw?.medio_id || raw.status !== 'INCOMPLETE') return null;
    return raw;
  } catch {
    return null;
  }
}

export async function listCoverageDebt(
  store: CaptureReliabilityStore,
  windowStart: string,
  windowEnd: string,
): Promise<CoverageDebtRecord[]> {
  const obs = await store.listObservations(windowStart, windowEnd);
  const out: CoverageDebtRecord[] = [];
  const seen = new Set<string>();
  for (const row of obs) {
    const debt = parseCoverageDebt(row);
    if (!debt) continue;
    const id = coverageDebtId(debt.medio_id, debt.window_start, debt.window_end);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(debt);
  }
  return out;
}

export async function getCoverageDebt(
  store: CaptureReliabilityStore,
  medioId: string,
  windowStart: string,
  windowEnd: string,
): Promise<CoverageDebtRecord | null> {
  const rows = await listCoverageDebt(store, windowStart, windowEnd);
  return rows.find((d) => d.medio_id === medioId) ?? null;
}

export async function registerCoverageDebt(
  store: CaptureReliabilityStore,
  state: SourceReconcileState,
  nowIso: string,
  catalog?: ChannelCatalogRow,
): Promise<CoverageDebtRecord> {
  const prev = await getCoverageDebt(store, state.medio_id, state.window_start, state.window_end);
  const policy = classifyCoverageDebt(state, catalog);
  const debt: CoverageDebtRecord = {
    medio_id: state.medio_id,
    window_start: state.window_start,
    window_end: state.window_end,
    status: 'INCOMPLETE',
    reason: policy.reason,
    next_action: policy.next_action,
    follow_up: policy.follow_up,
    automatic: policy.automatic,
    attempt_count: prev?.attempt_count ?? 0,
    source_status: state.status,
    last_error: state.last_error,
    cursor: state.cursor,
    created_at: prev?.created_at ?? nowIso,
    updated_at: nowIso,
  };
  await store.recordObservation(toObservation(debt));
  return debt;
}

export async function incrementCoverageDebtAttempt(
  store: CaptureReliabilityStore,
  state: Pick<SourceReconcileState, 'medio_id' | 'window_start' | 'window_end'>,
  nowIso: string,
): Promise<CoverageDebtRecord | null> {
  const prev = await getCoverageDebt(store, state.medio_id, state.window_start, state.window_end);
  if (!prev) return null;
  const next: CoverageDebtRecord = {
    ...prev,
    attempt_count: prev.attempt_count + 1,
    updated_at: nowIso,
  };
  await store.recordObservation(toObservation(next));
  return next;
}

export function coverageDebtAccountsForIncomplete(
  state: SourceReconcileState,
  debt: CoverageDebtRecord | null | undefined,
): boolean {
  if (state.status !== 'INCOMPLETE') return false;
  return Boolean(
    debt &&
      debt.automatic &&
      debt.medio_id === state.medio_id &&
      debt.window_start === state.window_start &&
      debt.window_end === state.window_end,
  );
}
