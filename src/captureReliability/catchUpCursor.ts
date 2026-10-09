import {
  type CaptureCycle,
  type CaptureCycleMode,
  contiguousCatchUpWindows,
} from './cycle.js';
import type { CaptureReliabilityStore } from './captureRecoveryRepository.js';
import {
  coverageDebtAccountsForIncomplete,
  listCoverageDebt,
  type CoverageDebtRecord,
} from './coverageDebt.js';
import type { ReconcileRun, RecoveryRecord, RecoveryStatus, SourceReconcileState } from './types.js';

export const CATCH_UP_CURSOR_PREFIX = 'caprel-cursor-';
export const DEBT_STATUSES = ['BLOCKED', 'RETRY', 'MANUAL_REVIEW'] as const;
export const BLOCKING_PENDING = ['QUEUED', 'FETCH_TO_CLASSIFY', 'FETCHING'] as const satisfies readonly RecoveryStatus[];
export const RECOVERY_PAGE_SIZE = 1000;
export const RECOVERY_READ_CAP = 200_000;

export function catchUpCursorRunId(mode: CaptureCycleMode): string {
  return `${CATCH_UP_CURSOR_PREFIX}${mode === 'auditor' ? '24h' : mode}`;
}

export function catchUpMode(mode: CaptureCycleMode): '24h' | '72h' {
  return mode === 'auditor' ? '24h' : mode;
}

export interface WindowSafety {
  safeComplete: boolean;
  canAdvance: boolean;
  blockingPending: number;
  sourcesOpen: number;
  debt: Record<(typeof DEBT_STATUSES)[number], number>;
  reason: string;
}

export interface ResolvedCatchUp {
  cycle: CaptureCycle | null;
  generated: CaptureCycle[];
  remaining: number;
  lastSafeWindowEnd: string | null;
  reason: string;
}

function inWindow(iso: string | null | undefined, start: string, end: string): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t >= Date.parse(start) && t <= Date.parse(end);
}

export function recoveryBelongsToWindow(rec: RecoveryRecord, start: string, end: string): boolean {
  return inWindow(rec.published_at, start, end) || inWindow(rec.first_discovered_at, start, end);
}

export function tallyDebt(rows: RecoveryRecord[]): Record<(typeof DEBT_STATUSES)[number], number> {
  const debt = { BLOCKED: 0, RETRY: 0, MANUAL_REVIEW: 0 };
  for (const r of rows) {
    if (r.status === 'BLOCKED' || r.status === 'RETRY' || r.status === 'MANUAL_REVIEW') {
      debt[r.status] += 1;
    }
  }
  return debt;
}

export interface CompleteRecoveryRead {
  rows: RecoveryRecord[];
  complete: boolean;
  counted: number;
  scanned: number;
  pageSize: number;
  reason: string;
}

export async function loadCompleteRecovery(store: CaptureReliabilityStore): Promise<CompleteRecoveryRead> {
  const pageSize = RECOVERY_PAGE_SIZE;
  const counted = await store.countRecovery();
  const rows: RecoveryRecord[] = [];
  let offset = 0;
  let lastLen = 0;
  while (offset < RECOVERY_READ_CAP) {
    const page = await store.listRecoveryPage({ offset, pageSize });
    lastLen = page.length;
    rows.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  const complete = rows.length === counted && lastLen < pageSize;
  return {
    rows,
    complete,
    counted,
    scanned: rows.length,
    pageSize,
    reason: complete ? 'QUEUE_READ_COMPLETE' : 'QUEUE_READ_INCOMPLETE',
  };
}

export function evaluateWindowSafety(opts: {
  sourceStates: SourceReconcileState[];
  recovery: RecoveryRecord[];
  failed?: boolean;
  coverageComplete?: boolean;
  expectedMedioIds?: string[];
  queueReadComplete?: boolean;
  coverageDebts?: CoverageDebtRecord[];
}): WindowSafety {
  const debt = tallyDebt(opts.recovery);
  if (opts.queueReadComplete === false) {
    return {
      safeComplete: false,
      canAdvance: false,
      blockingPending: 0,
      sourcesOpen: 0,
      debt,
      reason: 'QUEUE_READ_INCOMPLETE',
    };
  }
  if (opts.failed || opts.coverageComplete === false) {
    return {
      safeComplete: false,
      canAdvance: false,
      blockingPending: 0,
      sourcesOpen: opts.sourceStates.filter((s) => s.status === 'PENDING' || s.status === 'IN_PROGRESS').length,
      debt,
      reason: opts.coverageComplete === false ? 'COVERAGE_INCOMPLETE' : 'WINDOW_FAILED',
    };
  }
  if (opts.expectedMedioIds?.length) {
    const byId = new Map(opts.sourceStates.map((s) => [s.medio_id, s]));
    const debts = new Map((opts.coverageDebts ?? []).map((d) => [d.medio_id, d]));
    const missing = opts.expectedMedioIds.filter((id) => !byId.has(id));
    const unaccounted = opts.expectedMedioIds.filter((id) => {
      const st = byId.get(id);
      if (!st) return true;
      if (st.status === 'COMPLETE') return false;
      if (st.status === 'INCOMPLETE') return !coverageDebtAccountsForIncomplete(st, debts.get(id));
      return true;
    });
    if (missing.length > 0 || unaccounted.length > 0) {
      return {
        safeComplete: false,
        canAdvance: false,
        blockingPending: 0,
        sourcesOpen: missing.length + unaccounted.filter((id) => !missing.includes(id)).length,
        debt,
        reason: 'CATALOG_INCOMPLETE',
      };
    }
  }
  const sourcesOpen = opts.sourceStates.filter((s) => s.status === 'PENDING' || s.status === 'IN_PROGRESS').length;
  const blocking = opts.recovery.filter((r) =>
    (BLOCKING_PENDING as readonly RecoveryStatus[]).includes(r.status),
  );
  if (opts.sourceStates.length === 0) {
    return {
      safeComplete: false,
      canAdvance: false,
      blockingPending: blocking.length,
      sourcesOpen,
      debt,
      reason: 'NO_SOURCE_STATES',
    };
  }
  if (sourcesOpen > 0) {
    return {
      safeComplete: false,
      canAdvance: false,
      blockingPending: blocking.length,
      sourcesOpen,
      debt,
      reason: 'SOURCES_OPEN',
    };
  }
  if (blocking.length > 0) {
    return {
      safeComplete: false,
      canAdvance: false,
      blockingPending: blocking.length,
      sourcesOpen,
      debt,
      reason: 'CLAIMABLE_PENDING',
    };
  }
  return {
    safeComplete: true,
    canAdvance: true,
    blockingPending: 0,
    sourcesOpen: 0,
    debt,
    reason: 'SAFE_COMPLETE',
  };
}

export async function loadLastSafeWindowEnd(
  store: CaptureReliabilityStore,
  mode: CaptureCycleMode,
): Promise<string | null> {
  const run = await store.getRun(catchUpCursorRunId(mode));
  const end = run?.window_end?.trim();
  return end || null;
}

export async function seedCatchUpCursor(
  store: CaptureReliabilityStore,
  opts: { mode: CaptureCycleMode; lastSafeWindowEnd: string; nowIso: string },
): Promise<ReconcileRun> {
  const mode = catchUpMode(opts.mode);
  const run: ReconcileRun = {
    run_id: catchUpCursorRunId(opts.mode),
    cycle_id: catchUpCursorRunId(opts.mode),
    mode,
    window_start: opts.lastSafeWindowEnd,
    window_end: opts.lastSafeWindowEnd,
    shard_index: 0,
    shard_count: 1,
    status: 'DONE',
    created_at: opts.nowIso,
    updated_at: opts.nowIso,
  };
  return store.upsertRun(run);
}

export async function resolveNextCatchUpWindow(opts: {
  store: CaptureReliabilityStore;
  mode: CaptureCycleMode;
  now: Date;
  lastSafeWindowEnd?: string | null;
}): Promise<ResolvedCatchUp> {
  const mode = catchUpMode(opts.mode);
  const lastSafe = opts.lastSafeWindowEnd ?? (await loadLastSafeWindowEnd(opts.store, opts.mode));
  if (!lastSafe) {
    return {
      cycle: null,
      generated: [],
      remaining: 0,
      lastSafeWindowEnd: null,
      reason: 'NO_SAFE_CURSOR',
    };
  }
  const generated = contiguousCatchUpWindows({
    lastCompletedWindowEnd: lastSafe,
    now: opts.now,
    mode,
  });
  for (const cycle of generated) {
    const states = await opts.store.listSourceStates(cycle.window_start, cycle.window_end);
    const read = await loadCompleteRecovery(opts.store);
    const recovery = read.rows.filter((r) => recoveryBelongsToWindow(r, cycle.window_start, cycle.window_end));
    const coverageDebts = await listCoverageDebt(opts.store, cycle.window_start, cycle.window_end);
    const safety = evaluateWindowSafety({
      sourceStates: states,
      recovery,
      queueReadComplete: read.complete,
      coverageDebts,
    });
    if (!safety.safeComplete) {
      return {
        cycle,
        generated,
        remaining: generated.filter((w) => Date.parse(w.window_end) >= Date.parse(cycle.window_end)).length,
        lastSafeWindowEnd: lastSafe,
        reason: safety.reason === 'NO_SOURCE_STATES' ? 'NEXT_WINDOW' : `RESUME:${safety.reason}`,
      };
    }
  }
  return {
    cycle: null,
    generated,
    remaining: 0,
    lastSafeWindowEnd: lastSafe,
    reason: generated.length ? 'ALL_SAFE_COMPLETE' : 'CAUGHT_UP',
  };
}

export async function markWindowSafeComplete(
  store: CaptureReliabilityStore,
  cycle: CaptureCycle,
  nowIso: string,
  opts?: {
    allowCursorAdvance?: boolean;
    coverageComplete?: boolean;
    expectedMedioIds?: string[];
  },
): Promise<WindowSafety> {
  const states = await store.listSourceStates(cycle.window_start, cycle.window_end);
  const read = await loadCompleteRecovery(store);
  const recovery = read.rows.filter((r) => recoveryBelongsToWindow(r, cycle.window_start, cycle.window_end));
  const coverageDebts = await listCoverageDebt(store, cycle.window_start, cycle.window_end);
  const safety = evaluateWindowSafety({
    sourceStates: states,
    recovery,
    coverageComplete: opts?.coverageComplete,
    expectedMedioIds: opts?.expectedMedioIds,
    queueReadComplete: read.complete,
    coverageDebts,
  });
  if (!safety.safeComplete) return safety;
  if (opts?.allowCursorAdvance === false) {
    return {
      ...safety,
      safeComplete: false,
      canAdvance: false,
      reason: 'LIMITED_DISPATCH_NO_CURSOR',
    };
  }
  await store.upsertRun({
    run_id: cycle.cycle_id,
    cycle_id: cycle.cycle_id,
    mode: catchUpMode(cycle.mode),
    window_start: cycle.window_start,
    window_end: cycle.window_end,
    shard_index: 0,
    shard_count: cycle.shard_count,
    status: 'DONE',
    created_at: nowIso,
    updated_at: nowIso,
  });
  await seedCatchUpCursor(store, {
    mode: cycle.mode,
    lastSafeWindowEnd: cycle.window_end,
    nowIso,
  });
  return safety;
}

export interface CatchUpExecutionReport {
  generated: string[];
  executed: string[];
  skipped: string[];
  crashed_at: string | null;
  lastSafeWindowEnd: string | null;
  remaining: number;
  debtPreserved: Record<(typeof DEBT_STATUSES)[number], number>;
  duplicateSourceClaims: number;
}

export async function executeCatchUpWindows(opts: {
  store: CaptureReliabilityStore;
  mode: CaptureCycleMode;
  now: Date;
  nowIso: string;
  lastSafeWindowEnd?: string | null;
  runWindow: (cycle: CaptureCycle) => Promise<void>;
  crashAfterFirst?: boolean;
}): Promise<CatchUpExecutionReport> {
  if (opts.lastSafeWindowEnd && !(await loadLastSafeWindowEnd(opts.store, opts.mode))) {
    await seedCatchUpCursor(opts.store, {
      mode: opts.mode,
      lastSafeWindowEnd: opts.lastSafeWindowEnd,
      nowIso: opts.nowIso,
    });
  }
  const first = await resolveNextCatchUpWindow({
    store: opts.store,
    mode: opts.mode,
    now: opts.now,
    lastSafeWindowEnd: opts.lastSafeWindowEnd,
  });
  const report: CatchUpExecutionReport = {
    generated: first.generated.map((w) => w.window_end),
    executed: [],
    skipped: [],
    crashed_at: null,
    lastSafeWindowEnd: first.lastSafeWindowEnd,
    remaining: first.remaining,
    debtPreserved: { BLOCKED: 0, RETRY: 0, MANUAL_REVIEW: 0 },
    duplicateSourceClaims: 0,
  };
  let crashArmed = opts.crashAfterFirst === true;
  while (true) {
    const next = await resolveNextCatchUpWindow({
      store: opts.store,
      mode: opts.mode,
      now: opts.now,
    });
    if (!next.cycle) {
      report.remaining = 0;
      report.lastSafeWindowEnd = await loadLastSafeWindowEnd(opts.store, opts.mode);
      break;
    }
    const beforeStates = await opts.store.listSourceStates(next.cycle.window_start, next.cycle.window_end);
    try {
      await opts.runWindow(next.cycle);
    } catch (err) {
      report.crashed_at = next.cycle.window_end;
      report.remaining = next.remaining;
      report.lastSafeWindowEnd = await loadLastSafeWindowEnd(opts.store, opts.mode);
      throw err;
    }
    const afterStates = await opts.store.listSourceStates(next.cycle.window_start, next.cycle.window_end);
    if (beforeStates.length > 0 && afterStates.length !== beforeStates.length) {
      report.duplicateSourceClaims += Math.max(0, afterStates.length - beforeStates.length);
    }
    const read = await loadCompleteRecovery(opts.store);
    const windowRows = read.rows.filter((r) =>
      recoveryBelongsToWindow(r, next.cycle!.window_start, next.cycle!.window_end),
    );
    const safety = await markWindowSafeComplete(opts.store, next.cycle, opts.nowIso);
    const debt = tallyDebt(windowRows);
    report.debtPreserved.BLOCKED += debt.BLOCKED;
    report.debtPreserved.RETRY += debt.RETRY;
    report.debtPreserved.MANUAL_REVIEW += debt.MANUAL_REVIEW;
    if (!safety.safeComplete) {
      report.remaining = next.remaining;
      report.lastSafeWindowEnd = await loadLastSafeWindowEnd(opts.store, opts.mode);
      break;
    }
    report.executed.push(next.cycle.window_end);
    if (crashArmed) {
      crashArmed = false;
      report.crashed_at = next.cycle.window_end;
      report.remaining = next.remaining - 1;
      report.lastSafeWindowEnd = next.cycle.window_end;
      throw new Error(`CATCH_UP_CRASH_AFTER:${next.cycle.window_end}`);
    }
  }
  const generatedSet = new Set(report.generated);
  report.skipped = [...generatedSet].filter((end) => !report.executed.includes(end));
  return report;
}
