/** Fail-closed recovery writes. Schedule and canary are separate permissions. */

export type CaptureWriteEvent = 'schedule' | 'dispatch' | string;

export function normalizeRecoveryHashes(hashes?: string[] | null): string[] {
  return [...new Set((hashes ?? []).map((h) => h.trim()).filter(Boolean))];
}

export function isCanaryHashScope(hashes?: string[] | null): boolean {
  return normalizeRecoveryHashes(hashes).length > 0;
}

/** Catalog narrowing only. medio_ids alone is not a write authorization. */
export function isLimitedCanaryScope(opts: { medioIds?: string[]; recoveryHashes?: string[] }): boolean {
  return (opts.medioIds?.length ?? 0) > 0 || isCanaryHashScope(opts.recoveryHashes);
}

export function recoveryWritesAllowed(opts: {
  dryRun: boolean;
  allowEnv?: string | null;
  canaryAllowEnv?: string | null;
  eventName?: CaptureWriteEvent;
  limitedScope?: boolean;
  recoveryHashes?: string[];
}): boolean {
  if (opts.dryRun !== false) return false;
  if (opts.allowEnv === 'true') return true;
  const event = opts.eventName ?? 'dispatch';
  if (event === 'schedule') return false;
  if (!isCanaryHashScope(opts.recoveryHashes)) return false;
  return opts.canaryAllowEnv === 'true';
}

export function scheduleWritesUseFullGateOnly(): boolean {
  return true;
}

export function assertCanaryHashesForWrite(opts: {
  wantsWrites: boolean;
  allowEnv?: string | null;
  canaryAllowEnv?: string | null;
  recoveryHashes?: string[];
}): void {
  if (!opts.wantsWrites) return;
  if (opts.allowEnv === 'true') return;
  if (opts.canaryAllowEnv === 'true' && !isCanaryHashScope(opts.recoveryHashes)) {
    throw new Error('CANARY_HASHES_REQUIRED: medio_ids alone cannot authorize canary writes; pass an explicit hash set');
  }
}

/** Empty onlyHashes must abort the RPC so p_only_hashes is never omitted on a canary claim. */
export function buildClaimBatchRpcArgs(opts: {
  workerId: string;
  limit: number;
  nowIso: string;
  onlyHashes?: Set<string>;
}): { abort: boolean; args: Record<string, unknown> } {
  if (opts.onlyHashes !== undefined && opts.onlyHashes.size === 0) {
    return { abort: true, args: {} };
  }
  const args: Record<string, unknown> = {
    p_worker_id: opts.workerId,
    p_limit: opts.limit,
    p_now: opts.nowIso,
  };
  if (opts.onlyHashes !== undefined) {
    args.p_only_hashes = [...opts.onlyHashes];
  }
  return { abort: false, args };
}

export function canaryClaimHashes(opts: {
  canaryScoped: boolean;
  hashes: Set<string>;
}): Set<string> | undefined {
  if (opts.canaryScoped) return opts.hashes;
  return opts.hashes.size ? opts.hashes : undefined;
}
