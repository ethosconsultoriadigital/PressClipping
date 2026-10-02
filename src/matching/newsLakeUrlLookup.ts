import { canonicalizeUrl } from '../normalizers/url.js';
import { sha256 } from '../utils/hash.js';

export interface NewsLakeUrlKeys {
  original: string;
  canonical: string;
  hash_url: string;
  variants: string[];
}

function wwwFlipCanonical(canonical: string): string | null {
  try {
    const u = new URL(canonical);
    if (!u.hostname) return null;
    u.hostname = u.hostname.startsWith('www.') ? u.hostname.slice(4) : `www.${u.hostname}`;
    return canonicalizeUrl(u.toString());
  } catch {
    return null;
  }
}

export function newsLakeUrlKeys(url: string): NewsLakeUrlKeys {
  const original = url.trim();
  const canonical = canonicalizeUrl(original);
  const flipped = wwwFlipCanonical(canonical);
  const hash_url = sha256(canonical);
  const variants = [...new Set(
    [original, canonical, `${canonical}/`, flipped, flipped ? `${flipped}/` : null].filter(
      (v): v is string => Boolean(v),
    ),
  )];
  return { original, canonical, hash_url, variants };
}

export interface NewsLakeHit {
  noticia_id: string;
  url_original: string | null;
  url_canonica?: string | null;
  hash_url?: string | null;
}

export function matchLakeRowsToPublisher(
  keys: NewsLakeUrlKeys,
  rows: NewsLakeHit[],
): NewsLakeHit | null {
  const canonSet = new Set(keys.variants.map((v) => canonicalizeUrl(v)));
  const hashSet = new Set([...canonSet].map((v) => sha256(v)));
  hashSet.add(keys.hash_url);
  for (const row of rows) {
    if (row.hash_url && hashSet.has(row.hash_url)) return row;
    if (row.url_canonica && canonSet.has(canonicalizeUrl(row.url_canonica))) return row;
    if (row.url_original && canonSet.has(canonicalizeUrl(row.url_original))) return row;
  }
  return null;
}
