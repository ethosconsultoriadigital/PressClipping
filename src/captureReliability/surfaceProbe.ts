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
