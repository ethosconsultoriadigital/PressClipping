export type CaptureCycleMode = '24h' | '72h' | 'auditor';

export interface CaptureCycle {
  cycle_id: string;
  mode: CaptureCycleMode;
  window_start: string;
  window_end: string;
  shard_count: number;
  status: 'OPEN' | 'DRAINED' | 'PAUSED';
}

export const DEFAULT_SHARD_COUNT = 8;

export function floorToUtcHour(d: Date): Date {
  const out = new Date(d.getTime());
  out.setUTCMinutes(0, 0, 0);
  return out;
}

export function cycleStamp(iso: string): string {
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function computeFixedCycle(opts: {
  mode: CaptureCycleMode;
  now?: Date;
  windowStart?: string | null;
  windowEnd?: string | null;
  cycleId?: string | null;
  shardCount?: number;
}): CaptureCycle {
  const hours = opts.mode === '72h' ? 72 : 24;
  const now = opts.now ?? new Date();
  const end = opts.windowEnd ? new Date(opts.windowEnd) : floorToUtcHour(now);
  const start = opts.windowStart ? new Date(opts.windowStart) : new Date(end.getTime() - hours * 3600_000);
  const window_start = start.toISOString();
  const window_end = end.toISOString();
  const cycle_id = opts.cycleId?.trim() || `caprel-${opts.mode}-${cycleStamp(window_end)}`;
  return {
    cycle_id,
    mode: opts.mode,
    window_start,
    window_end,
    shard_count: Math.max(1, opts.shardCount ?? DEFAULT_SHARD_COUNT),
    status: 'OPEN',
  };
}

export function cycleIsDrained(pending: number): boolean {
  return pending === 0;
}

/** Contiguous UTC windows after the last completed cycle. Never skips a slice, even after >72h. */
export function contiguousCatchUpWindows(opts: {
  lastCompletedWindowEnd: string;
  now: Date;
  mode: CaptureCycleMode;
}): CaptureCycle[] {
  const hours = opts.mode === '72h' ? 72 : 24;
  const stepMs = hours * 3600_000;
  const lastEnd = Date.parse(opts.lastCompletedWindowEnd);
  if (!Number.isFinite(lastEnd)) throw new Error(`invalid lastCompletedWindowEnd ${opts.lastCompletedWindowEnd}`);
  const nowEnd = floorToUtcHour(opts.now).getTime();
  const out: CaptureCycle[] = [];
  let start = lastEnd;
  while (start + stepMs <= nowEnd) {
    const window_start = new Date(start).toISOString();
    const window_end = new Date(start + stepMs).toISOString();
    out.push({
      cycle_id: `caprel-${opts.mode}-${cycleStamp(window_end)}`,
      mode: opts.mode,
      window_start,
      window_end,
      shard_count: DEFAULT_SHARD_COUNT,
      status: 'OPEN',
    });
    start += stepMs;
  }
  return out;
}
