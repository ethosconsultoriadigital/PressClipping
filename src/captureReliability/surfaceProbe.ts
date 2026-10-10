import { hostOf } from './urlIndex.js';

const SKIP = /(?:javascript:|mailto:|#$|\.(?:css|js|png|jpe?g|gif|svg|webp|ico|pdf|zip)(?:\?|$))/i;

export function extractListingHrefs(html: string, baseUrl: string): string[] {
  const hrefs = [...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1] ?? '').filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  let origin: URL;
  try {
    origin = new URL(baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`);
  } catch {
    return [];
  }
  for (const raw of hrefs) {
    if (SKIP.test(raw)) continue;
    let abs: URL;
    try {
      abs = new URL(raw, origin);
    } catch {
      continue;
    }
    if (abs.protocol !== 'http:' && abs.protocol !== 'https:') continue;
    if (hostOf(abs.href) !== hostOf(origin.href) && !abs.hostname.endsWith(`.${origin.hostname}`)) continue;
    const href = abs.href.split('#')[0] ?? abs.href;
    if (seen.has(href)) continue;
    seen.add(href);
    out.push(href);
  }
  return out;
}

export function listingAttemptResult(
  analyzed: number,
  failed: number,
  targetCount: number,
): 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'UNAVAILABLE' {
  if (targetCount <= 0) return 'UNAVAILABLE';
  if (analyzed === 0 && failed > 0) return 'FAILED';
  if (analyzed > 0 && failed > 0) return 'PARTIAL';
  if (analyzed > 0 && failed === 0) return 'SUCCESS';
  return 'UNAVAILABLE';
}

export function encodeListingCursor(pendingTargets: string[]): string {
  return `lst2|${pendingTargets.map((t) => encodeURIComponent(t)).join(',')}`;
}

export function parseListingCursor(raw: string | null | undefined): string[] | null {
  if (!raw?.startsWith('lst2|')) return null;
  const body = raw.slice(5);
  if (!body) return [];
  return body.split(',').map((p) => decodeURIComponent(p)).filter(Boolean);
}

export async function fetchAndParseListingTargets(
  targets: string[],
  fetchFn: (url: string) => Promise<string>,
): Promise<{
  urls: string[];
  analyzed: number;
  failed: number;
  failedTargets: string[];
  analyzedTargets: string[];
  foundKind: 'listing' | 'home' | 'section' | null;
}> {
  const urls: string[] = [];
  const seen = new Set<string>();
  const failedTargets: string[] = [];
  const analyzedTargets: string[] = [];
  let foundKind: 'listing' | 'home' | 'section' | null = null;
  for (const target of targets) {
    try {
      const html = await fetchFn(target);
      analyzedTargets.push(target);
      const hrefs = extractListingHrefs(html, target);
      foundKind = foundKind ?? classifyProbedSurface(target);
      for (const href of hrefs) {
        if (seen.has(href)) continue;
        seen.add(href);
        urls.push(href);
      }
    } catch {
      failedTargets.push(target);
    }
  }
  return {
    urls,
    analyzed: analyzedTargets.length,
    failed: failedTargets.length,
    failedTargets,
    analyzedTargets,
    foundKind,
  };
}

export function listingTargetsFromCatalog(row: { url_base: string | null; secciones_urls?: string | null }): string[] {
  const targets: string[] = [];
  if (row.url_base) {
    targets.push(row.url_base.startsWith('http') ? row.url_base : `https://${row.url_base}`);
  }
  if (row.secciones_urls) {
    targets.push(
      ...row.secciones_urls
        .split(/[\n,|]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }
  return [...new Set(targets)];
}

export function classifyProbedSurface(url: string): 'listing' | 'home' | 'section' {
  const path = (() => {
    try {
      return new URL(url).pathname.replace(/\/+$/, '') || '/';
    } catch {
      return '/';
    }
  })();
  if (path === '/' || path === '') return 'home';
  if (/seccion|section|categoria|category|tag|tema/i.test(path)) return 'section';
  return 'listing';
}
