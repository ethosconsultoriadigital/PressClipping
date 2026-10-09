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

export async function fetchAndParseListingTargets(
  targets: string[],
  fetchFn: (url: string) => Promise<string>,
): Promise<{
  urls: string[];
  analyzed: number;
  failed: number;
  foundKind: 'listing' | 'home' | 'section' | null;
}> {
  const urls: string[] = [];
  const seen = new Set<string>();
  let analyzed = 0;
  let failed = 0;
  let foundKind: 'listing' | 'home' | 'section' | null = null;
  for (const target of targets) {
    try {
      const html = await fetchFn(target);
      analyzed += 1;
      const hrefs = extractListingHrefs(html, target);
      foundKind = foundKind ?? classifyProbedSurface(target);
      for (const href of hrefs) {
        if (seen.has(href)) continue;
        seen.add(href);
        urls.push(href);
      }
    } catch {
      failed += 1;
    }
  }
  return { urls, analyzed, failed, foundKind };
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
