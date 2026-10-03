/** Fail-closed recovery writes. Both flags required for production persist. */

export function recoveryWritesAllowed(opts: {
  dryRun: boolean;
  allowEnv?: string | null;
}): boolean {
  return opts.dryRun === false && opts.allowEnv === 'true';
}
