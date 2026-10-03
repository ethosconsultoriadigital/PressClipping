import { existsSync, readFileSync } from 'node:fs';
import { captureCanonicalUrl, hostOf, primaryHash } from './urlIndex.js';
import { applyProducerSource } from './sourceResolve.js';
import type { ChannelCatalogRow, GapCandidate } from './types.js';

export interface AgentBGapCandidateV7 {
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
  discovered_url?: string;
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  if (typeof v === 'string' && v.trim()) return v.split(/[|,]/).map((s) => s.trim()).filter(Boolean);
  return [];
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

export function recoveryTargetUrl(input: {
  publisher_final_url?: string | null;
  discovered_url?: string | null;
}): string {
  const pub = (input.publisher_final_url ?? '').trim();
  if (pub) return stripTracking(captureCanonicalUrl(pub));
  return stripTracking(captureCanonicalUrl((input.discovered_url ?? '').trim()));
}

export function gapCandidateFromB(input: AgentBGapCandidateV7, catalog?: ChannelCatalogRow[]): GapCandidate {
  const publisher = recoveryTargetUrl(input);
  const original = (input.discovered_url ?? '').trim();
  const discovered = original && captureCanonicalUrl(original) === captureCanonicalUrl(publisher)
    ? original
    : publisher || original;
  const hash = input.canonical_hash || primaryHash(publisher);
  let medioId = input.medio_id ?? null;
  if (catalog?.length) {
    const resolved = applyProducerSource(publisher, catalog, medioId);
    if (resolved.kind === 'resolved') medioId = resolved.medioId;
    if (resolved.kind === 'ambiguous') medioId = null;
    if (resolved.kind === 'unknown') medioId = catalog.some((c) => c.medio_id === medioId) ? medioId : null;
  }
  return {
    candidate_id: hash,
    discovered_url: discovered,
    publisher_final_url: publisher,
    hostname: input.hostname ?? hostOf(publisher),
    discovered_via: input.discovered_via || 'GOOGLE_NEWS_RADAR',
    discovered_at: input.last_discovered_at || input.first_discovered_at,
    canonical_hash: hash,
    discovered_urls: [...new Set([discovered, publisher, ...input.google_item_urls].filter(Boolean))],
    medio_id: medioId,
    fuente_id: input.fuente_id ?? null,
    candidate_medio_ids: input.candidate_medio_ids ?? [],
    candidate_fuente_ids: input.candidate_fuente_ids ?? [],
    cliente_ids: input.cliente_ids ?? [],
    keyword_ids: input.keyword_ids ?? [],
    queries: input.queries ?? [],
    google_item_urls: input.google_item_urls ?? [],
    first_discovered_at: input.first_discovered_at,
    last_discovered_at: input.last_discovered_at,
    discovery_status: input.discovery_status ?? null,
  };
}

export function gapCandidateFromUrl(input: {
  discovered_url: string;
  publisher_final_url?: string | null;
  hostname?: string | null;
  discovered_via?: string;
  discovered_at?: string;
  medio_id?: string | null;
  fuente_id?: string | null;
  discovered_urls?: string[];
  candidate_medio_ids?: string[];
  candidate_fuente_ids?: string[];
  cliente_ids?: string[];
  keyword_ids?: string[];
  queries?: string[];
  google_item_urls?: string[];
  first_discovered_at?: string;
  last_discovered_at?: string;
  discovery_status?: string | null;
}): GapCandidate {
  return gapCandidateFromB({
    publisher_final_url: input.publisher_final_url || input.discovered_url,
    canonical_hash: '',
    hostname: input.hostname ?? null,
    medio_id: input.medio_id ?? null,
    candidate_medio_ids: input.candidate_medio_ids ?? [],
    fuente_id: input.fuente_id ?? null,
    candidate_fuente_ids: input.candidate_fuente_ids ?? [],
    cliente_ids: input.cliente_ids ?? [],
    keyword_ids: input.keyword_ids ?? [],
    queries: input.queries ?? [],
    google_item_urls: input.google_item_urls ?? [],
    first_discovered_at: input.first_discovered_at ?? input.discovered_at ?? new Date().toISOString(),
    last_discovered_at: input.last_discovered_at ?? input.discovered_at ?? new Date().toISOString(),
    discovered_via: input.discovered_via ?? 'gap_candidate',
    discovery_status: input.discovery_status ?? 'MISSING_KNOWN_SOURCE',
    discovered_url: input.discovered_url,
  });
}

export function parseGapCandidatesJson(raw: unknown, catalog?: ChannelCatalogRow[]): GapCandidate[] {
  const arr = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { candidates?: unknown }).candidates)
      ? (raw as { candidates: unknown[] }).candidates
      : [];
  const out: GapCandidate[] = [];
  for (const row of arr) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const publisher = String(r.publisher_final_url ?? r.discovered_url ?? r.url ?? '').trim();
    if (!publisher) continue;
    out.push(
      gapCandidateFromB(
        {
          publisher_final_url: publisher,
          canonical_hash: String(r.canonical_hash ?? ''),
          hostname: r.hostname ? String(r.hostname) : null,
          medio_id: r.medio_id ? String(r.medio_id) : null,
          candidate_medio_ids: asStringArray(r.candidate_medio_ids),
          fuente_id: r.fuente_id ? String(r.fuente_id) : null,
          candidate_fuente_ids: asStringArray(r.candidate_fuente_ids),
          cliente_ids: asStringArray(r.cliente_ids),
          keyword_ids: asStringArray(r.keyword_ids),
          queries: asStringArray(r.queries),
          google_item_urls: asStringArray(r.google_item_urls),
          first_discovered_at: String(r.first_discovered_at ?? r.discovered_at ?? new Date().toISOString()),
          last_discovered_at: String(r.last_discovered_at ?? r.discovered_at ?? new Date().toISOString()),
          discovered_via: String(r.discovered_via ?? 'gap_candidate'),
          discovery_status: String(r.discovery_status ?? 'MISSING_KNOWN_SOURCE'),
          discovered_url: r.discovered_url ? String(r.discovered_url) : undefined,
        },
        catalog,
      ),
    );
  }
  return out;
}

export function loadGapCandidatesFromFile(path: string | null | undefined, catalog?: ChannelCatalogRow[]): GapCandidate[] {
  if (!path || !existsSync(path)) return [];
  return parseGapCandidatesJson(JSON.parse(readFileSync(path, 'utf8')), catalog);
}
