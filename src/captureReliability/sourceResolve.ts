import { hostOf } from './urlIndex.js';
import type { ChannelCatalogRow } from './types.js';

export type SourceResolveResult =
  | { kind: 'resolved'; medioId: string }
  | { kind: 'ambiguous'; medioIds: string[] }
  | { kind: 'unknown' };

function hostOfRow(row: ChannelCatalogRow): string {
  return (row.hostname || hostOf(row.url_base ?? '') || hostOf(row.rss_url ?? '') || hostOf(row.sitemap_url ?? '')).replace(
    /^www\./i,
    '',
  );
}

function pathPrefix(url: string | null): string {
  if (!url) return '/';
  try {
    const u = new URL(/^https?:/i.test(url) ? url : `https://${url}`);
    const p = u.pathname.replace(/\/+$/, '') || '/';
    return p;
  } catch {
    return '/';
  }
}

/**
 * Resolución determinista host→medio. Nunca last-write-wins.
 * Si varios medio_id comparten host sin path/channel distintivo → AMBIGUOUS.
 */
export function resolveSourceForUrl(url: string, catalog: ChannelCatalogRow[]): SourceResolveResult {
  const host = hostOf(url).replace(/^www\./i, '');
  if (!host) return { kind: 'unknown' };
  const matches = catalog.filter((r) => hostOfRow(r) === host);
  if (matches.length === 0) return { kind: 'unknown' };
  if (matches.length === 1) return { kind: 'resolved', medioId: matches[0]!.medio_id };

  const urlPath = pathPrefix(url);
  const scored = matches.map((m) => {
    const basePath = pathPrefix(m.url_base);
    const hit = basePath !== '/' && (urlPath === basePath || urlPath.startsWith(`${basePath}/`));
    return { m, score: hit ? basePath.length : 0 };
  });
  const best = Math.max(...scored.map((s) => s.score));
  const winners = scored.filter((s) => s.score === best && best > 0).map((s) => s.m);
  if (winners.length === 1) return { kind: 'resolved', medioId: winners[0]!.medio_id };

  const uniqueIds = [...new Set(matches.map((m) => m.medio_id))].sort();
  if (uniqueIds.length === 1) return { kind: 'resolved', medioId: uniqueIds[0]! };
  return { kind: 'ambiguous', medioIds: uniqueIds };
}

/**
 * Identidad de productor solo se acepta si el catálogo la confirma.
 * Host duplicado sin medio_id válido sigue AMBIGUOUS: no se elige uno al azar.
 */
export function applyProducerSource(
  url: string,
  catalog: ChannelCatalogRow[],
  producerMedioId: string | null,
): SourceResolveResult {
  const resolved = resolveSourceForUrl(url, catalog);
  if (!producerMedioId) return resolved;
  if (resolved.kind === 'resolved') {
    if (resolved.medioId === producerMedioId) return resolved;
    return { kind: 'ambiguous', medioIds: [resolved.medioId, producerMedioId].sort() };
  }
  if (resolved.kind === 'ambiguous') {
    if (resolved.medioIds.includes(producerMedioId)) return { kind: 'resolved', medioId: producerMedioId };
    return resolved;
  }
  if (catalog.some((c) => c.medio_id === producerMedioId)) return { kind: 'resolved', medioId: producerMedioId };
  return resolved;
}

export function hostnameIndex(catalog: ChannelCatalogRow[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const row of catalog) {
    const h = hostOfRow(row);
    if (!h) continue;
    const cur = map.get(h) ?? [];
    if (!cur.includes(row.medio_id)) cur.push(row.medio_id);
    map.set(h, cur);
  }
  return map;
}
