import type { CompletenessFlag, CoverageVerdict } from './types.js';

export function discoveryCoverageVerdict(input: {
  rssSpanCovered: CompletenessFlag;
  sitemapSpanCovered: CompletenessFlag;
  listingSpanCovered: CompletenessFlag;
  paginationComplete: boolean;
  capHit: boolean;
  timeBudgetHit: boolean;
  noDiscoverySurface: boolean;
  surfaces: string[];
}): CoverageVerdict {
  if (input.noDiscoverySurface || input.surfaces.includes('NO_DISCOVERY_SURFACE') || input.surfaces.length === 0) {
    return 'COVERAGE_UNKNOWN';
  }
  const windowProven = input.sitemapSpanCovered === 'YES' || input.listingSpanCovered === 'YES';
  if (input.timeBudgetHit) return 'COVERAGE_PARTIAL';
  if ((input.capHit || !input.paginationComplete) && !windowProven) return 'COVERAGE_PARTIAL';
  const rssOnly = input.surfaces.every((s) => s === 'rss');
  if (rssOnly) return 'COVERAGE_PARTIAL';
  if (input.sitemapSpanCovered === 'NO') return 'COVERAGE_PARTIAL';
  if (input.sitemapSpanCovered === 'YES' || input.listingSpanCovered === 'YES') return 'COVERAGE_CONFIRMED';
  if (input.sitemapSpanCovered === 'UNKNOWN' || input.rssSpanCovered === 'UNKNOWN') return 'COVERAGE_UNKNOWN';
  return 'COVERAGE_PARTIAL';
}
