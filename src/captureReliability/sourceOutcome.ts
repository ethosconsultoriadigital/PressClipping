import type { SourceReconcileState } from './types.js';

export const SOURCE_READINESS_CLASSES = [
  'COMPLETE',
  'CAP_REACHED_WINDOW_COVERED',
  'CAP_REACHED_WINDOW_UNCERTAIN',
  'NEEDS_SITEMAP_PAGINATION',
  'NEEDS_SECOND_SURFACE',
  'TRANSIENT_TIMEOUT',
  'SOURCE_LIMITATION',
  'FAILED',
  'PENDING',
] as const;

export type SourceReadinessClass = (typeof SOURCE_READINESS_CLASSES)[number];

/** Reporting classifier. INCOMPLETE from sitemap cap is not FAILED. */
export function classifySourceReadiness(state: SourceReconcileState): SourceReadinessClass {
  if (state.status === 'PENDING' || state.status === 'IN_PROGRESS') return 'PENDING';
  const err = (state.last_error ?? '').toUpperCase();
  if (err.includes('SOURCE_TIMEOUT') || err === 'TIMEOUT') return 'TRANSIENT_TIMEOUT';
  if (state.discovery_surfaces.includes('NO_DISCOVERY_SURFACE') || err === 'NO_DISCOVERY_SURFACE') {
    return 'SOURCE_LIMITATION';
  }
  if (state.cap_hit && state.coverage_verdict === 'COVERAGE_CONFIRMED') return 'CAP_REACHED_WINDOW_COVERED';
  if (state.cap_hit && (state.sitemap_span_covered === 'UNKNOWN' || state.coverage_verdict === 'COVERAGE_UNKNOWN')) {
    return 'CAP_REACHED_WINDOW_UNCERTAIN';
  }
  if (state.cap_hit || state.sitemap_span_covered === 'NO') return 'NEEDS_SITEMAP_PAGINATION';
  const rssOnly = state.discovery_surfaces.length > 0 && state.discovery_surfaces.every((s) => s === 'rss');
  if (rssOnly && state.status === 'INCOMPLETE') return 'NEEDS_SECOND_SURFACE';
  if (state.status === 'COMPLETE' && state.complete) return 'COMPLETE';
  if (state.last_error && state.status === 'INCOMPLETE') return 'FAILED';
  return state.status === 'COMPLETE' ? 'COMPLETE' : 'NEEDS_SITEMAP_PAGINATION';
}

export function tallySourceReadiness(states: SourceReconcileState[]): Record<SourceReadinessClass, number> {
  const out = Object.fromEntries(SOURCE_READINESS_CLASSES.map((k) => [k, 0])) as Record<SourceReadinessClass, number>;
  for (const s of states) out[classifySourceReadiness(s)] += 1;
  return out;
}
