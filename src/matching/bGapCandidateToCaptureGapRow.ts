import { canonicalizeUrl } from '../normalizers/url.js';
import { sha256 } from '../utils/hash.js';
import type { GapCandidate } from './gapCandidateSink.js';

export interface CaptureGapRow {
  candidate_id: string;
  discovered_url: string;
  publisher_final_url: string;
  canonical_hash: string;
  hostname: string | null;
  medio_id: string | null;
  candidate_medio_ids: string[];
  fuente_id: string | null;
  candidate_fuente_ids: string[];
  cliente_ids: string[];
  keyword_ids: string[];
  queries: string[];
  google_item_urls: string[];
  first_discovered_at: string;
  last_discovered_at: string;
  discovered_via: string;
  discovery_status: string;
  discovered_at: string;
}

export function isGoogleNewsUrl(raw: string | null | undefined): boolean {
  const s = String(raw ?? '').toLowerCase();
  return s.includes('news.google.com') || s.includes('google.com/rss') || s.includes('news.google.');
}

export function gapRecoveryEligible(status: string | null | undefined): boolean {
  return (status ?? 'MISSING_KNOWN_SOURCE').trim() === 'MISSING_KNOWN_SOURCE';
}

export function shouldInsertGapCandidate(status: string | null | undefined): boolean {
  const s = (status ?? '').trim();
  if (s === 'ALREADY_IN_LAKE') return false;
  return true;
}

/** Shared B V7 → A capture_gap_candidates row. Never uses Google as recovery target. */
export function bGapCandidateToCaptureGapRow(c: GapCandidate): CaptureGapRow | null {
  const publisherRaw = (c.publisher_final_url ?? '').trim();
  if (!publisherRaw || isGoogleNewsUrl(publisherRaw)) return null;
  if (!shouldInsertGapCandidate(c.discovery_status)) return null;
  const publisher = canonicalizeUrl(publisherRaw) || publisherRaw;
  const hash = (c.canonical_hash ?? '').trim() || sha256(publisher);
  const now = new Date().toISOString();
  const first = c.first_discovered_at || now;
  const last = c.last_discovered_at || first;
  return {
    candidate_id: hash,
    discovered_url: publisher,
    publisher_final_url: publisher,
    canonical_hash: hash,
    hostname: c.hostname ?? null,
    medio_id: c.medio_id ?? null,
    candidate_medio_ids: [...(c.candidate_medio_ids ?? [])],
    fuente_id: c.fuente_id ?? null,
    candidate_fuente_ids: [...(c.candidate_fuente_ids ?? [])],
    cliente_ids: [...(c.cliente_ids ?? [])],
    keyword_ids: [...(c.keyword_ids ?? [])],
    queries: [...(c.queries ?? [])],
    google_item_urls: [...(c.google_item_urls ?? [])],
    first_discovered_at: first,
    last_discovered_at: last,
    discovered_via: c.discovered_via || 'GOOGLE_NEWS_RADAR',
    discovery_status: c.discovery_status || 'MISSING_KNOWN_SOURCE',
    discovered_at: last,
  };
}
