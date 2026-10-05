import type { CompletenessFlag } from './types.js';
import { sitemapWindowCompleteness } from './rssWindow.js';
import type { RawItem } from '../normalizers/noticia.js';

export interface SitemapWindowResult {
  items: RawItem[];
  datedInWindow: number;
  undatedKept: number;
  paginationComplete: boolean;
  indexFollowed: boolean;
  capHit: boolean;
  completeness: CompletenessFlag;
  sitemapRuntimeCompletenessInvoked: true;
}

const UNDATED_BOUND = 40;

/**
 * Filtra sitemap por ventana de reconciliación.
 * lastmod/fecha confiable → filtro duro.
 * Sin fecha → cota bounded (no dump masivo, no pérdida silenciosa del cap).
 */
export function applySitemapWindow(opts: {
  items: RawItem[];
  windowStart: string;
  windowEnd: string;
  paginationComplete: boolean;
  indexFollowed: boolean;
  capHit: boolean;
  undatedBound?: number;
}): SitemapWindowResult {
  const start = Date.parse(opts.windowStart);
  const end = Date.parse(opts.windowEnd);
  const dated: RawItem[] = [];
  const undated: RawItem[] = [];
  for (const it of opts.items) {
    const ts = it.fecha ? Date.parse(it.fecha) : NaN;
    if (Number.isFinite(ts)) {
      if (ts >= start && ts <= end) dated.push(it);
    } else {
      undated.push(it);
    }
  }
  const bound = opts.undatedBound ?? UNDATED_BOUND;
  const undatedKept = undated.slice(0, bound);
  const datedOldestMs = dated.length
    ? Math.min(...dated.map((it) => Date.parse(it.fecha!)).filter((n) => Number.isFinite(n)))
    : null;
  const completeness = sitemapWindowCompleteness({
    paginationComplete: opts.paginationComplete,
    datedInWindow: dated.length,
    indexFollowed: opts.indexFollowed,
    capHit: opts.capHit || undated.length > bound,
    datedOldestMs,
    windowStartMs: Number.isFinite(start) ? start : null,
  });
  return {
    items: [...dated, ...undatedKept],
    datedInWindow: dated.length,
    undatedKept: undatedKept.length,
    paginationComplete: opts.paginationComplete,
    indexFollowed: opts.indexFollowed,
    capHit: opts.capHit || undated.length > bound,
    completeness,
    sitemapRuntimeCompletenessInvoked: true,
  };
}
