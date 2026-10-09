import { processRecoveryRecord, type RecoveryFetchExtract, type RecoveryPersist } from './recoveryWorker.js';
import { HostConcurrencyLimiter, mapWithConcurrency } from './hostLimiter.js';
import { timeBudgetExceeded } from './checkpoint.js';
import type { CaptureReliabilityStore } from './captureRecoveryRepository.js';
import type { RecoveryRecord, RecoveryStatus } from './types.js';

export interface RecoveryDrainOpts {
  store: CaptureReliabilityStore;
  workerId: string;
  nowIso: string;
  nowMs?: number;
  startedMs?: number;
  batchSize: number;
  maxBatches: number;
  concurrency: number;
  globalConcurrency: number;
  perHostConcurrency: number;
  timeBudgetMs: number;
  writesAllowed: boolean;
  fetchExtract: RecoveryFetchExtract;
  persistNews?: RecoveryPersist;
  maxAttempts?: number;
  onlyHashes?: Set<string>;
  windowStart?: string;
  windowEnd?: string;
}

export interface RecoveryDrainReport {
  RECOVERY_QUEUE_TOTAL: number;
  RECOVERY_QUEUE_CLAIMABLE: number;
  RECOVERY_PROCESSED_THIS_RUN: number;
  RECOVERY_PERSISTED: number;
  RECOVERY_PERSISTED_GLOBAL: number;
  NEW_WRITES_THIS_RUN: number;
  KNOWN_THIS_RUN: number;
  REJECTED_THIS_RUN: number;
  RETRY_THIS_RUN: number;
  BLOCKED_THIS_RUN: number;
  RECOVERY_KNOWN: number;
  RECOVERY_REJECTED: number;
  RECOVERY_RETRY: number;
  RECOVERY_BLOCKED: number;
  RECOVERY_FAILED: number;
  RECOVERY_REMAINING: number;
  RECOVERY_WOULD_PERSIST: number;
  TIME_BUDGET_HIT: boolean;
}

const CLAIMABLE: RecoveryStatus[] = ['QUEUED', 'RETRY', 'FETCH_TO_CLASSIFY'];

export function recoveryMetrics(rows: RecoveryRecord[]): Pick<
  RecoveryDrainReport,
  | 'RECOVERY_QUEUE_TOTAL'
  | 'RECOVERY_QUEUE_CLAIMABLE'
  | 'RECOVERY_PERSISTED'
  | 'RECOVERY_PERSISTED_GLOBAL'
  | 'RECOVERY_KNOWN'
  | 'RECOVERY_REJECTED'
  | 'RECOVERY_RETRY'
  | 'RECOVERY_BLOCKED'
  | 'RECOVERY_FAILED'
  | 'RECOVERY_REMAINING'
  | 'RECOVERY_WOULD_PERSIST'
> {
  const claimable = rows.filter((r) => CLAIMABLE.includes(r.status) && !r.claimed_at).length;
  const persisted = rows.filter((r) => r.status === 'PERSISTED').length;
  return {
    RECOVERY_QUEUE_TOTAL: rows.length,
    RECOVERY_QUEUE_CLAIMABLE: claimable,
    RECOVERY_PERSISTED: persisted,
    RECOVERY_PERSISTED_GLOBAL: persisted,
    RECOVERY_KNOWN: rows.filter((r) => r.status === 'KNOWN_IN_LAKE').length,
    RECOVERY_REJECTED: rows.filter((r) => r.status === 'REJECTED_NON_ARTICLE').length,
    RECOVERY_RETRY: rows.filter((r) => r.status === 'RETRY').length,
    RECOVERY_BLOCKED: rows.filter((r) => r.status === 'BLOCKED').length,
    RECOVERY_FAILED: rows.filter((r) => r.status === 'FAILED_RETRY_EXHAUSTED' || r.status === 'MANUAL_REVIEW').length,
    RECOVERY_REMAINING: claimable + rows.filter((r) => r.status === 'FETCHING').length,
    RECOVERY_WOULD_PERSIST: rows.filter((r) => r.last_dry_run_result === 'WOULD_PERSIST').length,
  };
}

export function assertCanaryWriteBudget(onlyHashes: Set<string> | undefined, newWrites: number): void {
  if (onlyHashes && onlyHashes.size === 1 && newWrites > 1) {
    throw new Error(`CANARY_WRITE_OVERFLOW: expected<=1 got=${newWrites}`);
  }
}

export async function drainRecoveryQueue(opts: RecoveryDrainOpts): Promise<RecoveryDrainReport> {
  const startedMs = opts.startedMs ?? opts.nowMs ?? Date.now();
  const nowMs = () => opts.nowMs ?? Date.now();
  const limiter = new HostConcurrencyLimiter({
    globalLimit: opts.globalConcurrency,
    perHostLimit: opts.perHostConcurrency,
  });
  let processed = 0;
  let newWrites = 0;
  let known = 0;
  let rejected = 0;
  let retry = 0;
  let blocked = 0;
  const seen = new Set<string>();
  let timeBudgetHit = false;
  for (let batch = 0; batch < opts.maxBatches; batch += 1) {
    if (timeBudgetExceeded(startedMs, opts.timeBudgetMs, nowMs())) {
      timeBudgetHit = true;
      break;
    }
    const claimed = await opts.store.claimBatch({
      workerId: opts.workerId,
      limit: opts.batchSize,
      nowIso: opts.nowIso,
      skipHashes: seen,
      onlyHashes: opts.onlyHashes,
    });
    if (!claimed.length) break;
    for (const r of claimed) seen.add(r.hash_url);
    const after = await mapWithConcurrency(claimed, opts.concurrency, async (rec) => {
      if (timeBudgetExceeded(startedMs, opts.timeBudgetMs, nowMs())) {
        timeBudgetHit = true;
        return rec;
      }
      return limiter.run(rec.discovered_url, () =>
        processRecoveryRecord({
          record: rec,
          store: opts.store,
          fetchExtract: opts.fetchExtract,
          persistNews: opts.writesAllowed ? opts.persistNews : undefined,
          writesAllowed: opts.writesAllowed,
          nowIso: opts.nowIso,
          maxAttempts: opts.maxAttempts,
          windowStart: opts.windowStart,
          windowEnd: opts.windowEnd,
          targeted: Boolean(opts.onlyHashes && opts.onlyHashes.size > 0),
        }),
      );
    });
    for (const rec of after) {
      if (rec.status === 'PERSISTED') newWrites += 1;
      else if (rec.status === 'KNOWN_IN_LAKE') known += 1;
      else if (rec.status === 'REJECTED_NON_ARTICLE') rejected += 1;
      else if (rec.status === 'RETRY') retry += 1;
      else if (rec.status === 'BLOCKED') blocked += 1;
    }
    processed += claimed.length;
  }
  assertCanaryWriteBudget(opts.onlyHashes, newWrites);
  const snap = await opts.store.snapshot();
  return {
    ...recoveryMetrics(snap),
    RECOVERY_PROCESSED_THIS_RUN: processed,
    NEW_WRITES_THIS_RUN: newWrites,
    KNOWN_THIS_RUN: known,
    REJECTED_THIS_RUN: rejected,
    RETRY_THIS_RUN: retry,
    BLOCKED_THIS_RUN: blocked,
    TIME_BUDGET_HIT: timeBudgetHit,
  };
}
