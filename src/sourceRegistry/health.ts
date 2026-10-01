import type { HealthStatus } from './types.js';

export const DEAD_FAILURE_THRESHOLD = 5;
export const BLOCKED_FAILURE_THRESHOLD = 3;
export const STALE_DAYS = 30;

export interface LightProbeFacts {
  httpStatus: number | null;
  timeout: boolean;
  networkError: boolean;
  nxdomain: boolean;
  homepageOk: boolean;
  latestContentAt: string | null;
  nowIso: string;
  consecutiveFailuresBefore: number;
}

export interface LightHealthResult {
  health: HealthStatus;
  consecutiveFailures: number;
  success: boolean;
}

/**
 * Determinista. Un solo timeout/500/403 NUNCA marca DEAD.
 */
export function classifyLightHealth(f: LightProbeFacts): LightHealthResult {
  const status = f.httpStatus;
  const blocked = status === 401 || status === 403;
  const gone = status === 404 || status === 410 || f.nxdomain;
  const server = status !== null && status >= 500;
  const ok = status !== null && status >= 200 && status < 400 && f.homepageOk && !f.timeout && !f.networkError;

  if (ok) {
    const stale = isStale(f.latestContentAt, f.nowIso);
    return {
      health: stale ? 'STALE' : 'HEALTHY',
      consecutiveFailures: 0,
      success: true,
    };
  }

  const failures = f.consecutiveFailuresBefore + 1;
  if (gone && failures >= DEAD_FAILURE_THRESHOLD) {
    return { health: 'DEAD', consecutiveFailures: failures, success: false };
  }
  if (blocked) {
    return {
      health: failures >= BLOCKED_FAILURE_THRESHOLD ? 'BLOCKED_EXTERNAL' : 'DEGRADED',
      consecutiveFailures: failures,
      success: false,
    };
  }
  if (f.timeout || server || f.networkError) {
    return { health: 'DEGRADED', consecutiveFailures: failures, success: false };
  }
  if (gone) {
    return { health: 'DEGRADED', consecutiveFailures: failures, success: false };
  }
  return { health: 'UNKNOWN', consecutiveFailures: failures, success: false };
}

export function isStale(latestContentAt: string | null, nowIso: string): boolean {
  if (!latestContentAt) return false;
  const t = Date.parse(latestContentAt);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(t) || !Number.isFinite(now)) return false;
  return now - t > STALE_DAYS * 864e5;
}
