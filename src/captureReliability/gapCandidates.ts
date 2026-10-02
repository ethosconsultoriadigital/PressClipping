import { existsSync, readFileSync } from 'node:fs';
import { hostOf } from './urlIndex.js';
import type { GapCandidate } from './types.js';

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
    out.push({
      discovered_url: url,
      publisher_final_url: r.publisher_final_url ? String(r.publisher_final_url) : null,
      hostname: r.hostname ? String(r.hostname) : hostOf(url) || null,
      discovered_via: String(r.discovered_via ?? 'gap_candidate'),
      discovered_at: String(r.discovered_at ?? new Date().toISOString()),
      cliente_ids: Array.isArray(r.cliente_ids) ? r.cliente_ids.map(String) : null,
      keyword_ids: Array.isArray(r.keyword_ids) ? r.keyword_ids.map(String) : null,
    });
  }
  return out;
}

export function loadGapCandidatesFromFile(path: string | null | undefined): GapCandidate[] {
  if (!path || !existsSync(path)) return [];
  return parseGapCandidatesJson(JSON.parse(readFileSync(path, 'utf8')));
}
