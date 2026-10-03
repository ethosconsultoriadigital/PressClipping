import { configuredSurfaceKinds } from './catalog.js';
import type { ChannelCatalogRow, CoverageVerdict, SourceReconcileState } from './types.js';

export interface CoverageRemediationRow {
  medio_id: string;
  available_surfaces: string[];
  coverage_verdict: CoverageVerdict;
  reason: string;
  recommended_next_discovery_surface: string;
  priority: 'high' | 'normal';
}

export function coverageRemediationReason(state: SourceReconcileState, row: ChannelCatalogRow | undefined): string {
  if (state.discovery_surfaces.includes('NO_DISCOVERY_SURFACE') || !state.discovery_surfaces.length) {
    return 'NO_DISCOVERY_SURFACE';
  }
  if (state.cap_hit) return 'CAP_HIT';
  if (state.time_budget_hit) return 'TIME_BUDGET_HIT';
  const surfaces = configuredSurfaceKinds(row ?? {
    medio_id: state.medio_id,
    url_base: null,
    rss_url: null,
    sitemap_url: null,
    hostname: null,
  });
  if (surfaces.length === 1 && surfaces[0] === 'rss') return 'RSS_ONLY';
  if (state.sitemap_span_covered === 'NO') return 'SITEMAP_SPAN_NO';
  if (state.sitemap_span_covered === 'UNKNOWN') return 'SITEMAP_SPAN_UNKNOWN';
  if (state.listing_span_covered === 'UNKNOWN' && surfaces.includes('listing')) return 'LISTING_NOT_FETCHED';
  return state.coverage_verdict ?? 'COVERAGE_UNKNOWN';
}

export function recommendedSurface(surfaces: string[], reason: string): string {
  if (reason === 'NO_DISCOVERY_SURFACE') return 'configure_rss_or_sitemap';
  if (reason === 'RSS_ONLY') return 'robots_or_configured_sitemap';
  if (reason === 'LISTING_NOT_FETCHED') return 'reuse_existing_listing_parser_if_any';
  if (reason === 'SITEMAP_SPAN_NO' || reason === 'SITEMAP_SPAN_UNKNOWN') return 'windowed_sitemap_index';
  if (surfaces.includes('sitemap')) return 'sitemap';
  if (surfaces.includes('rss')) return 'rss';
  if (surfaces.includes('listing')) return 'listing';
  return 'none';
}

export function buildCoverageRemediation(opts: {
  states: SourceReconcileState[];
  catalog: ChannelCatalogRow[];
  highVolumeMedioIds?: string[];
}): CoverageRemediationRow[] {
  const catalog = new Map(opts.catalog.map((c) => [c.medio_id, c]));
  const high = new Set(opts.highVolumeMedioIds ?? ['MED-0441']);
  return opts.states
    .filter((s) => s.coverage_verdict !== 'COVERAGE_CONFIRMED')
    .map((s) => {
      const row = catalog.get(s.medio_id);
      const surfaces = configuredSurfaceKinds(row ?? {
        medio_id: s.medio_id,
        url_base: null,
        rss_url: null,
        sitemap_url: null,
        hostname: null,
        secciones_urls: null,
      });
      const reason = coverageRemediationReason(s, row);
      return {
        medio_id: s.medio_id,
        available_surfaces: surfaces.length ? surfaces : s.discovery_surfaces,
        coverage_verdict: s.coverage_verdict ?? 'COVERAGE_UNKNOWN',
        reason,
        recommended_next_discovery_surface: recommendedSurface(surfaces, reason),
        priority: high.has(s.medio_id) ? 'high' : 'normal',
      };
    });
}
