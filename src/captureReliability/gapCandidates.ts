import { existsSync, readFileSync } from 'node:fs';
import { captureCanonicalUrl, hostOf, primaryHash } from './urlIndex.js';
import type { GapCandidate } from './types.js';

export function gapCandidateFromUrl(input: {
  discovered_url: string;
  publisher_final_url?: string | null;
  hostname?: string | null;
  discovered_via?: string;
  discovered_at?: string;
  medio_id?: string | null;
  fuente_id?: string | null;
  discovered_urls?: string[];
}): GapCandidate {
  const publisher = input.publisher_final_url || input.discovered_url;
  const canonical = stripTracking(captureCanonicalUrl(publisher));
  const hash = primaryHash(canonical);
  return {
    candidate_id: hash,
    discovered_url: input.discovered_url,
    publisher_final_url: canonical,
    hostname: input.hostname ?? hostOf(publisher),
    discovered_via: input.discovered_via ?? 'gap_candidate',
    discovered_at: input.discovered_at ?? new Date().toISOString(),
    canonical_hash: hash,
    discovered_urls: [...new Set([input.discovered_url, ...(input.discovered_urls ?? []), publisher])],
    medio_id: input.medio_id ?? null,
    fuente_id: input.fuente_id ?? null,
  };
}

function stripTracking(raw: string): string {
  try {
    const u = new URL(raw);
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_|ref)/i.test(key)) u.searchParams.delete(key);
    }
    u.hash = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    return raw;
  }
}

export function parseGapCandidatesJson(raw: unknown): GapCandidate[] {
  const arr = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { candidates?: unknown }).candidates)
    ? (raw as { candidates: unknown[] }).candidates
    : [];
  const out: GapCandidate[] = [];
  for (const row of arr) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const url = String(r.discovered_url ?? r.publisher_final_url ?? r.url ?? '').trim();
    if (!url) continue;
    out.push(gapCandidateFromUrl({
      discovered_url: url,
      publisher_final_url: r.publisher_final_url ? String(r.publisher_final_url) : url,
      hostname: r.hostname ? String(r.hostname) : null,
      discovered_via: String(r.discovered_via ?? 'gap_candidate'),
      discovered_at: String(r.discovered_at ?? new Date().toISOString()),
      medio_id: r.medio_id ? String(r.medio_id) : null,
      fuente_id: r.fuente_id ? String(r.fuente_id) : null,
    }));
  }
  return out;
}

export function loadGapCandidatesFromFile(path: string | null | undefined): GapCandidate[] {
  if (!path || !existsSync(path)) return [];
  return parseGapCandidatesJson(JSON.parse(readFileSync(path, 'utf8')));
}
