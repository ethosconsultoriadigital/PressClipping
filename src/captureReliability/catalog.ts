import type { ChannelCatalogRow } from './types.js';

export function shardCatalog<T extends { medio_id: string }>(
  rows: T[],
  shardIndex: number,
  shardCount: number,
): T[] {
  const count = Math.max(1, shardCount);
  const index = ((shardIndex % count) + count) % count;
  return [...rows].sort((a, b) => a.medio_id.localeCompare(b.medio_id)).filter((_, i) => i % count === index);
}

export function sourceJobKey(medioId: string, windowStart: string, windowEnd: string): string {
  return `${medioId}|${windowStart}|${windowEnd}`;
}

export function catalogCoverage(opts: {
  totalActive: number;
  processed: number;
  pending: number;
}): { ok: boolean; total: number } {
  return {
    ok: opts.totalActive === opts.processed + opts.pending,
    total: opts.totalActive,
  };
}

export function configuredSurfaceKinds(row: ChannelCatalogRow): string[] {
  const surfaces: string[] = [];
  if (row.rss_url) surfaces.push('rss');
  if (row.sitemap_url) surfaces.push('sitemap');
  if (row.secciones_urls?.trim()) surfaces.push('listing');
  return surfaces;
}

export function hasConfiguredDiscoverySurface(row: ChannelCatalogRow): boolean {
  return configuredSurfaceKinds(row).length > 0;
}
