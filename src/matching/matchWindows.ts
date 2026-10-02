export const LIVE_WINDOW_HOURS = 2;
export const RECOVERY_WINDOW_HOURS = 24;
export const DEEP_RECOVERY_WINDOW_HOURS = 72;

export function windowSinceHours(hours: number, now = new Date()): string {
  return new Date(now.getTime() - hours * 3600_000).toISOString();
}

export function inWindow(fechaCaptura: string | null | undefined, sinceIso: string): boolean {
  return Boolean(fechaCaptura && fechaCaptura >= sinceIso);
}

export function simulatedCronGapRecovered(opts: {
  lastRunAgoHours: number;
  recoveryWindowHours: number;
  noticiaCapturaIso: string;
  now?: Date;
}): boolean {
  const now = opts.now ?? new Date();
  const since = windowSinceHours(opts.recoveryWindowHours, now);
  return opts.lastRunAgoHours > 2 && inWindow(opts.noticiaCapturaIso, since);
}
