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

export const COVERAGE_DEBT_LIFECYCLES = [
  'OPEN_AUTOMATIC',
  'IN_PROGRESS',
  'RESOLVED',
  'ESCALATED_MANUAL',
] as const;
export type CoverageDebtLifecycle = (typeof COVERAGE_DEBT_LIFECYCLES)[number];

export interface CoverageDebtRecord {
  medio_id: string;
  window_start: string;
  window_end: string;
  status: CoverageDebtLifecycle;
  lifecycle: CoverageDebtLifecycle;
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
  last_result?: string | null;
  owner_id?: string | null;
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

export function normalizeDebtLifecycle(raw: { lifecycle?: string; status?: string }): CoverageDebtLifecycle {
  if (COVERAGE_DEBT_LIFECYCLES.includes(raw.lifecycle as CoverageDebtLifecycle)) {
    return raw.lifecycle as CoverageDebtLifecycle;
  }
  if (COVERAGE_DEBT_LIFECYCLES.includes(raw.status as CoverageDebtLifecycle)) {
    return raw.status as CoverageDebtLifecycle;
  }
  return 'OPEN_AUTOMATIC';
}

export function isSilentExhaustedDebt(debt: CoverageDebtRecord | null | undefined): boolean {
  return Boolean(
    debt &&
      debt.automatic &&
      debt.attempt_count >= MAX_COVERAGE_DEBT_ATTEMPTS &&
      debt.lifecycle !== 'ESCALATED_MANUAL' &&
      debt.lifecycle !== 'RESOLVED',
  );
}

export function isResumableDebt(debt: CoverageDebtRecord | null | undefined): boolean {
  return Boolean(
    debt &&
      debt.automatic &&
      debt.attempt_count < MAX_COVERAGE_DEBT_ATTEMPTS &&
      (debt.lifecycle === 'OPEN_AUTOMATIC' || debt.lifecycle === 'IN_PROGRESS') &&
      !isSilentExhaustedDebt(debt),
  );
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
    const raw = JSON.parse(obs.reject_reason) as CoverageDebtRecord & { status?: string };
    if (!raw?.medio_id) return null;
    const lifecycle = normalizeDebtLifecycle(raw);
    return {
      ...raw,
      lifecycle,
      status: lifecycle,
      automatic: lifecycle === 'ESCALATED_MANUAL' ? false : Boolean(raw.automatic),
    };
  } catch {
    return null;
  }
}

export async function persistCoverageDebt(
  store: CaptureReliabilityStore,
  debt: CoverageDebtRecord,
): Promise<CoverageDebtRecord> {
  await store.recordObservation(toObservation(debt));
  return debt;
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
  if (prev?.lifecycle === 'RESOLVED' || prev?.lifecycle === 'ESCALATED_MANUAL') {
    return persistCoverageDebt(store, { ...prev, source_status: state.status, updated_at: nowIso });
  }
  const policy = classifyCoverageDebt(state, catalog);
  const lifecycle: CoverageDebtLifecycle = prev?.lifecycle === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'OPEN_AUTOMATIC';
  const debt: CoverageDebtRecord = {
    medio_id: state.medio_id,
    window_start: state.window_start,
    window_end: state.window_end,
    status: lifecycle,
    lifecycle,
    reason: policy.reason,
    next_action: policy.next_action,
    follow_up: policy.follow_up,
    automatic: policy.automatic,
    attempt_count: prev?.attempt_count ?? 0,
    source_status: state.status,
    last_error: state.last_error,
    cursor: state.cursor ?? prev?.cursor ?? null,
    created_at: prev?.created_at ?? nowIso,
    updated_at: nowIso,
    last_result: prev?.last_result ?? null,
    owner_id: prev?.owner_id ?? null,
  };
  return persistCoverageDebt(store, debt);
}

export async function incrementCoverageDebtAttempt(
  store: CaptureReliabilityStore,
  state: Pick<SourceReconcileState, 'medio_id' | 'window_start' | 'window_end'>,
  nowIso: string,
): Promise<CoverageDebtRecord | null> {
  const prev = await getCoverageDebt(store, state.medio_id, state.window_start, state.window_end);
  if (!prev) return null;
  const attempt_count = prev.attempt_count + 1;
  const exhausted = attempt_count >= MAX_COVERAGE_DEBT_ATTEMPTS && prev.lifecycle !== 'RESOLVED';
  const lifecycle: CoverageDebtLifecycle = exhausted ? 'ESCALATED_MANUAL' : prev.lifecycle === 'RESOLVED' ? 'RESOLVED' : 'IN_PROGRESS';
  const next: CoverageDebtRecord = {
    ...prev,
    attempt_count,
    lifecycle,
    status: lifecycle,
    automatic: lifecycle === 'ESCALATED_MANUAL' ? false : prev.automatic,
    last_result: exhausted ? 'ESCALATED_AFTER_MAX_ATTEMPTS' : prev.last_result ?? 'ATTEMPT_STARTED',
    updated_at: nowIso,
  };
  return persistCoverageDebt(store, next);
}

export async function markCoverageDebtInProgress(
  store: CaptureReliabilityStore,
  state: Pick<SourceReconcileState, 'medio_id' | 'window_start' | 'window_end' | 'cursor'>,
  nowIso: string,
  ownerId?: string | null,
): Promise<CoverageDebtRecord | null> {
  const prev = await getCoverageDebt(store, state.medio_id, state.window_start, state.window_end);
  if (!prev || prev.lifecycle === 'RESOLVED' || prev.lifecycle === 'ESCALATED_MANUAL') return prev;
  return persistCoverageDebt(store, {
    ...prev,
    lifecycle: 'IN_PROGRESS',
    status: 'IN_PROGRESS',
    cursor: state.cursor ?? prev.cursor,
    owner_id: ownerId ?? prev.owner_id ?? null,
    updated_at: nowIso,
  });
}

export async function finalizeCoverageDebt(
  store: CaptureReliabilityStore,
  state: Pick<SourceReconcileState, 'medio_id' | 'window_start' | 'window_end' | 'cursor' | 'last_error' | 'status'>,
  nowIso: string,
  outcome: CoverageDebtLifecycle | 'OPEN_AUTOMATIC',
  result: string,
  patch?: Partial<Pick<CoverageDebtRecord, 'follow_up' | 'next_action'>>,
): Promise<CoverageDebtRecord | null> {
  const prev = await getCoverageDebt(store, state.medio_id, state.window_start, state.window_end);
  if (!prev) return null;
  let lifecycle: CoverageDebtLifecycle = outcome;
  if (outcome !== 'RESOLVED' && prev.attempt_count >= MAX_COVERAGE_DEBT_ATTEMPTS) {
    lifecycle = 'ESCALATED_MANUAL';
  }
  return persistCoverageDebt(store, {
    ...prev,
    ...patch,
    lifecycle,
    status: lifecycle,
    automatic: lifecycle === 'ESCALATED_MANUAL' || lifecycle === 'RESOLVED' ? false : prev.automatic,
    cursor: state.cursor ?? prev.cursor,
    source_status: state.status,
    last_error: state.last_error,
    last_result: result,
    owner_id: lifecycle === 'IN_PROGRESS' ? prev.owner_id : null,
    updated_at: nowIso,
  });
}

export function coverageDebtAccountsForIncomplete(
  state: SourceReconcileState,
  debt: CoverageDebtRecord | null | undefined,
): boolean {
  if (state.status !== 'INCOMPLETE') return false;
  if (!debt) return false;
  if (debt.medio_id !== state.medio_id || debt.window_start !== state.window_start || debt.window_end !== state.window_end) {
    return false;
  }
  if (isSilentExhaustedDebt(debt)) return false;
  return COVERAGE_DEBT_LIFECYCLES.includes(debt.lifecycle);
}

export interface CoverageDebtBacklog {
  byLifecycle: Record<string, number>;
  byReason: Record<string, number>;
  byMedio: Record<string, number>;
  agingHours: { lt6: number; h6to24: number; h24to72: number; gt72: number };
  silentExhausted: number;
}

export function reportCoverageDebtBacklog(debts: CoverageDebtRecord[], nowMs: number): CoverageDebtBacklog {
  const byLifecycle: Record<string, number> = {};
  const byReason: Record<string, number> = {};
  const byMedio: Record<string, number> = {};
  const agingHours = { lt6: 0, h6to24: 0, h24to72: 0, gt72: 0 };
  let silentExhausted = 0;
  for (const d of debts) {
    byLifecycle[d.lifecycle] = (byLifecycle[d.lifecycle] ?? 0) + 1;
    byReason[d.reason] = (byReason[d.reason] ?? 0) + 1;
    byMedio[d.medio_id] = (byMedio[d.medio_id] ?? 0) + 1;
    const ageH = Math.max(0, (nowMs - Date.parse(d.created_at)) / 3_600_000);
    if (ageH < 6) agingHours.lt6 += 1;
    else if (ageH < 24) agingHours.h6to24 += 1;
    else if (ageH < 72) agingHours.h24to72 += 1;
    else agingHours.gt72 += 1;
    if (isSilentExhaustedDebt(d)) silentExhausted += 1;
  }
  return { byLifecycle, byReason, byMedio, agingHours, silentExhausted };
}
