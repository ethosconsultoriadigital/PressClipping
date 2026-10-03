/** Fail-closed: missing/false/empty secret never writes. */
export function recoveryWritesEnabled(
  dryRun: boolean,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (dryRun) return false;
  const raw = String(env.ALLOW_MENTIONS_RECOVERY_WRITES ?? '').trim().toLowerCase();
  return raw === 'true' || raw === '1';
}

/** Fail-closed: sin flag, un job de recovery nunca escribe aunque --no-dry-run. */
export function effectiveRecoveryDryRun(
  requestedDryRun: boolean,
  env: NodeJS.ProcessEnv = process.env,
): { dryRun: boolean; fail_closed: boolean; writes_enabled: boolean } {
  const writes = recoveryWritesEnabled(requestedDryRun, env);
  if (requestedDryRun) return { dryRun: true, fail_closed: false, writes_enabled: false };
  if (writes) return { dryRun: false, fail_closed: false, writes_enabled: true };
  return { dryRun: true, fail_closed: true, writes_enabled: false };
}
