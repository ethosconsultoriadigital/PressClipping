import type { Platform } from './types.js';

const TRACKING = /^(utm_|fbclid|gclid|mc_|ref)$/i;

export function foldName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function canonicalizeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const u = new URL(withProto);
    u.hash = '';
    u.hostname = u.hostname.replace(/^www\./i, '').toLowerCase();
    const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k));
    params.sort(([a], [b]) => a.localeCompare(b));
    u.search = '';
    for (const [k, v] of params) u.searchParams.append(k, v);
    let path = u.pathname.replace(/\/+$/, '') || '/';
    u.pathname = path;
    return u.toString();
  } catch {
    return trimmed.toLowerCase();
  }
}

export function hostnameOf(raw: string | null | undefined): string | null {
  const canon = canonicalizeUrl(raw);
  if (!canon) return null;
  try {
    return new URL(canon).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return null;
  }
}

export function registrableDomain(host: string | null): string | null {
  if (!host) return null;
  const h = host.replace(/^www\./i, '').toLowerCase();
  const parts = h.split('.').filter(Boolean);
  if (parts.length < 2) return h;
  const last2 = parts.slice(-2).join('.');
  const last3 = parts.slice(-3).join('.');
  if (/\.(com|gob|org|net|edu)\.mx$/i.test(h) && parts.length >= 3) return last3;
  return last2;
}

export function platformFromUrl(raw: string | null | undefined): Platform {
  const host = hostnameOf(raw) ?? '';
  if (/facebook\.com|fb\.com|fb\.watch/i.test(host)) return 'FACEBOOK';
  if (/instagram\.com/i.test(host)) return 'INSTAGRAM';
  if (/tiktok\.com/i.test(host)) return 'TIKTOK';
  if (/youtube\.com|youtu\.be/i.test(host)) return 'YOUTUBE';
  if (/t\.me|telegram\./i.test(host)) return 'TELEGRAM';
  if (/change\.org|citizengo\.org/i.test(host)) return 'PETITION';
  return 'WEB';
}

export function uniquenessKey(opts: {
  hostname: string | null;
  platform: Platform;
  canonicalName: string;
  estado: string | null;
  pathHint?: string | null;
}): string {
  const name = foldName(opts.canonicalName);
  if (opts.platform !== 'WEB') {
    return `${opts.platform}|${opts.hostname ?? 'none'}|${name}`;
  }
  const host = opts.hostname ?? 'nohost';
  const estado = foldName(opts.estado ?? '');
  const path = (opts.pathHint ?? '').replace(/\/+$/, '').toLowerCase();
  return `WEB|${host}|${estado}|${path}|${name}`;
}
