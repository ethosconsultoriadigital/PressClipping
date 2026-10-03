import type { CompletenessFlag } from './types.js';

export interface DatedItem {
  publishedAt: string | null;
}

export function rssWindowCompleteness(
  items: DatedItem[],
  windowStartIso: string,
  windowEndIso: string,
): { flag: CompletenessFlag; oldest: string | null; newest: string | null; itemCount: number } {
  const dates = items
    .map((i) => (i.publishedAt ? Date.parse(i.publishedAt) : NaN))
    .filter((n) => Number.isFinite(n)) as number[];
  if (!items.length) return { flag: 'UNKNOWN', oldest: null, newest: null, itemCount: 0 };
  if (!dates.length) return { flag: 'UNKNOWN', oldest: null, newest: null, itemCount: items.length };
  const oldestMs = Math.min(...dates);
  const newestMs = Math.max(...dates);
  const start = Date.parse(windowStartIso);
  const end = Date.parse(windowEndIso);
  const oldest = new Date(oldestMs).toISOString();
  const newest = new Date(newestMs).toISOString();
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return { flag: 'UNKNOWN', oldest, newest, itemCount: items.length };
  }
  // El feed cubre la ventana si el ítem más viejo llega al menos a window_start.
  const flag: CompletenessFlag = oldestMs <= start ? 'YES' : 'NO';
  return { flag, oldest, newest, itemCount: items.length };
}

export function sitemapWindowCompleteness(opts: {
  paginationComplete: boolean;
  datedInWindow: number;
  indexFollowed: boolean;
  capHit: boolean;
}): CompletenessFlag {
  if (opts.capHit) return 'NO';
  if (!opts.paginationComplete) return 'NO';
  if (!opts.indexFollowed && opts.datedInWindow === 0) return 'UNKNOWN';
  return 'YES';
}
