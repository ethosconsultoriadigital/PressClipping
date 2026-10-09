/** Fail-closed recovery writes. Schedule and canary are separate permissions. */

export type CaptureWriteEvent = 'schedule' | 'dispatch' | string;

export function recoveryWritesAllowed(opts: {
  dryRun: boolean;
  allowEnv?: string | null;
  canaryAllowEnv?: string | null;
  eventName?: CaptureWriteEvent;
  limitedScope?: boolean;
}): boolean {
  if (opts.dryRun !== false) return false;
  if (opts.allowEnv === 'true') return true;
  const event = opts.eventName ?? 'dispatch';
  if (event === 'schedule') return false;
  return opts.limitedScope === true && opts.canaryAllowEnv === 'true';
}

export function isLimitedCanaryScope(opts: { medioIds?: string[]; recoveryHashes?: string[] }): boolean {
  return (opts.medioIds?.length ?? 0) > 0 || (opts.recoveryHashes?.length ?? 0) > 0;
}

export function scheduleWritesUseFullGateOnly(): boolean {
  return true;
}
