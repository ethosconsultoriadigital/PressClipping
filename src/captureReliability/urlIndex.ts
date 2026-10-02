import { canonicalizeUrl } from '../normalizers/url.js';
import { canonicalizeUrl as canonicalizeIdentity, hostnameOf } from '../sourceRegistry/identity.js';
import { sha256 } from '../utils/hash.js';

export function captureCanonicalUrl(raw: string): string {
  const a = canonicalizeUrl(raw);
  const b = canonicalizeIdentity(raw);
  return b ?? a;
}

export function captureUrlHashes(raw: string): string[] {
  const variants = new Set<string>();
  variants.add(canonicalizeUrl(raw));
  const id = canonicalizeIdentity(raw);
  if (id) variants.add(id);
  try {
    const u = new URL(/^https?:/i.test(raw) ? raw : `https://${raw}`);
    u.hash = '';
    const withWww = u.toString();
    u.hostname = u.hostname.replace(/^www\./i, '');
    variants.add(canonicalizeUrl(withWww));
    variants.add(canonicalizeUrl(u.toString()));
  } catch {
    /* keep trimmed variants */
  }
  return [...variants].map((v) => sha256(v));
}

export function primaryHash(raw: string): string {
  return sha256(captureCanonicalUrl(raw));
}

export function hostOf(raw: string): string {
  return hostnameOf(raw) ?? '';
}

export function lakeHasUrl(lakeHashes: Set<string>, raw: string): boolean {
  return captureUrlHashes(raw).some((h) => lakeHashes.has(h));
}
