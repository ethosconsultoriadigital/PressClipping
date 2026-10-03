/** Fail-closed: gap DB metadata writes never happen unless the secret is exactly true. */

export function googleGapDbWritesAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.ALLOW_GOOGLE_GAP_DB_WRITES ?? '').trim().toLowerCase() === 'true';
}
