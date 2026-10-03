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
}

export interface RecoveryDrainReport {
  RECOVERY_QUEUE_TOTAL: number;
  RECOVERY_QUEUE_CLAIMABLE: number;
  RECOVERY_PROCESSED_THIS_RUN: number;
  RECOVERY_PERSISTED: number;
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

export function recoveryMetrics(rows: RecoveryRecord[]): Omit<RecoveryDrainReport, 'RECOVERY_PROCESSED_THIS_RUN' | 'TIME_BUDGET_HIT'> {
  const claimable = rows.filter((r) => CLAIMABLE.includes(r.status) && !r.claimed_at).length;
  return {
    RECOVERY_QUEUE_TOTAL: rows.length,
    RECOVERY_QUEUE_CLAIMABLE: claimable,
    RECOVERY_PERSISTED: rows.filter((r) => r.status === 'PERSISTED').length,
    RECOVERY_KNOWN: rows.filter((r) => r.status === 'KNOWN_IN_LAKE').length,
    RECOVERY_REJECTED: rows.filter((r) => r.status === 'REJECTED_NON_ARTICLE').length,
    RECOVERY_RETRY: rows.filter((r) => r.status === 'RETRY').length,
    RECOVERY_BLOCKED: rows.filter((r) => r.status === 'BLOCKED').length,
    RECOVERY_FAILED: rows.filter((r) => r.status === 'FAILED_RETRY_EXHAUSTED' || r.status === 'MANUAL_REVIEW').length,
    RECOVERY_REMAINING: claimable + rows.filter((r) => r.status === 'FETCHING').length,
    RECOVERY_WOULD_PERSIST: rows.filter((r) => r.last_dry_run_result === 'WOULD_PERSIST').length,
  };
}

export async function drainRecoveryQueue(opts: RecoveryDrainOpts): Promise<RecoveryDrainReport> {
  const startedMs = opts.startedMs ?? opts.nowMs ?? Date.now();
  const nowMs = () => opts.nowMs ?? Date.now();
  const limiter = new HostConcurrencyLimiter({
    globalLimit: opts.globalConcurrency,
    perHostLimit: opts.perHostConcurrency,
  });
  let processed = 0;
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
    });
    if (!claimed.length) break;
    for (const r of claimed) seen.add(r.hash_url);
    await mapWithConcurrency(claimed, opts.concurrency, async (rec) => {
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
        }),
      );
    });
    processed += claimed.length;
  }
  const snap = await opts.store.snapshot();
  return {
    ...recoveryMetrics(snap),
    RECOVERY_PROCESSED_THIS_RUN: processed,
    TIME_BUDGET_HIT: timeBudgetHit,
  };
}
