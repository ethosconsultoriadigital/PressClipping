export type FetchClass = 'RETRY' | 'BLOCKED' | 'GONE' | 'OK';

export function classifyFetchFailure(opts: {
  httpStatus: number | null;
  timeout?: boolean;
  networkError?: boolean;
  robotsDisallow?: boolean;
}): FetchClass {
  if (opts.robotsDisallow) return 'BLOCKED';
  if (opts.timeout || opts.networkError) return 'RETRY';
  const s = opts.httpStatus;
  if (s === null) return 'RETRY';
  if (s >= 200 && s < 400) return 'OK';
  if (s === 429) return 'RETRY';
  if (s >= 500) return 'RETRY';
  if (s === 403 || s === 401) return 'BLOCKED';
  if (s === 404 || s === 410) return 'GONE';
  return 'RETRY';
}

export function nextBackoffSeconds(attemptCount: number, maxAttempts = 8): number | null {
  if (attemptCount >= maxAttempts) return null;
  return Math.min(3600, 15 * 2 ** Math.max(0, attemptCount - 1));
}
