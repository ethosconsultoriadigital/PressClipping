import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidenceRank, loadAstraCsvFile, loadAstraCsvRowCount } from './csv.js';
import { canonicalizeUrl, foldName, hostnameOf } from './identity.js';
import type { AstraCandidateRow, EvidenceTier } from './types.js';

export const ASTRA_BASE_FILE = 'CANDIDATAS_ACUMULADAS_V2_V3.csv';
export const ASTRA_ENRICH_30D_FILE = 'CON_MUESTRA_30D_V3.csv';
export const ASTRA_ENRICH_CDMX_FILE = 'CDMX_EDOMEX_ADICIONALES_V3.csv';
export const ASTRA_SUMMARY_FILE = 'COBERTURA_32_ENTIDADES_V3.csv';

export function preferFilled(a: string | null, b: string | null): string | null {
  if (a && a.trim()) return a.trim();
  if (b && b.trim()) return b.trim();
  return null;
}

function laterDate(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (!Number.isFinite(ta)) return b;
  if (!Number.isFinite(tb)) return a;
  return tb >= ta ? b : a;
}

export function lookupKeys(row: AstraCandidateRow): string[] {
  const keys: string[] = [];
  if (row.candidate_id) keys.push(`id:${row.candidate_id.trim()}`);
  if (row.canonical_key) keys.push(`ck:${foldName(row.canonical_key)}`);
  const url = canonicalizeUrl(row.url);
  if (url) keys.push(`url:${url}`);
  const host = hostnameOf(row.url);
  if (host) keys.push(`hn:${host}|${foldName(row.name)}`);
  keys.push(`name:${foldName(row.name)}|${foldName(row.estado ?? '')}`);
  return keys;
}

/** Nunca degrada evidencia. Enrich puede subir a RECENT_30D. */
export function mergeCandidatePair(base: AstraCandidateRow, enrich: AstraCandidateRow): AstraCandidateRow {
  const recent = base.sample_within_30d || enrich.sample_within_30d;
  const betterTier: EvidenceTier =
    evidenceRank(enrich.evidence_tier) >= evidenceRank(base.evidence_tier)
      ? enrich.evidence_tier
      : base.evidence_tier;
  const evidence_tier: EvidenceTier =
    recent && evidenceRank(betterTier) < 3 ? 'RECENT_30D' : betterTier;
  return {
    ...base,
    name: preferFilled(base.name, enrich.name) ?? base.name,
    url: preferFilled(base.url, enrich.url),
    domain: preferFilled(enrich.canonical_key, preferFilled(base.domain, enrich.domain)),
    estado: preferFilled(base.estado, enrich.estado),
    municipio: preferFilled(enrich.municipio, base.municipio),
    categoria: preferFilled(base.categoria, enrich.categoria),
    source_kind_hint: preferFilled(enrich.source_kind_hint, base.source_kind_hint),
    content_origin_hint: preferFilled(enrich.content_origin_hint, base.content_origin_hint),
    evidence_tier,
    astra_batch: preferFilled(base.astra_batch, enrich.astra_batch) ?? base.astra_batch,
    sample_within_30d: recent,
    notes: [base.notes, enrich.notes].filter(Boolean).join(' | ') || null,
    facebook_url: preferFilled(base.facebook_url, enrich.facebook_url),
    candidate_id: preferFilled(base.candidate_id, enrich.candidate_id),
    canonical_key: preferFilled(enrich.canonical_key, base.canonical_key),
    sample_url: preferFilled(enrich.sample_url, base.sample_url),
    sample_date: laterDate(base.sample_date, enrich.sample_date),
    evidence_level: preferFilled(enrich.evidence_level, base.evidence_level),
    evidence_urls: preferFilled(enrich.evidence_urls, base.evidence_urls),
    estado_revision: preferFilled(enrich.estado_revision, base.estado_revision),
    capture_feasibility: preferFilled(enrich.capture_feasibility, base.capture_feasibility),
    technical_probe_status: preferFilled(enrich.technical_probe_status, base.technical_probe_status),
    platform_hint: preferFilled(base.platform_hint, enrich.platform_hint),
    status: preferFilled(base.status, enrich.status),
    has_website: enrich.has_website ?? base.has_website,
    social_only: enrich.social_only ?? base.social_only,
  };
}

export interface AstraMergeStats {
  base_rows: number;
  base_unique: number;
  enrich_rows_30d: number;
  enrich_rows_cdmx_edomex: number;
  summary_rows: number;
  summary_parsed_as_sources: number;
  merged_unique: number;
  enrich_matched: number;
  enrich_unmatched: number;
  internal_duplicates: number;
}

export function mergeAstraCandidates(
  base: AstraCandidateRow[],
  enrich: AstraCandidateRow[],
): {
  merged: AstraCandidateRow[];
  internalDuplicates: number;
  enrichMatched: number;
  enrichUnmatched: number;
} {
  const rows = new Map<string, AstraCandidateRow>();
  const index = new Map<string, string>();
  let nextId = 0;
  let internalDuplicates = 0;

  const attach = (primary: string, row: AstraCandidateRow) => {
    for (const k of lookupKeys(row)) index.set(k, primary);
    rows.set(primary, row);
  };

  const findPrimary = (row: AstraCandidateRow): string | null => {
    for (const k of lookupKeys(row)) {
      const hit = index.get(k);
      if (hit) return hit;
    }
    return null;
  };

  for (const row of base) {
    const existing = findPrimary(row);
    if (existing) {
      internalDuplicates += 1;
      const merged = mergeCandidatePair(rows.get(existing)!, row);
      attach(existing, merged);
      continue;
    }
    const primary = `p${nextId++}`;
    attach(primary, row);
  }

  let enrichMatched = 0;
  let enrichUnmatched = 0;
  for (const row of enrich) {
    const existing = findPrimary(row);
    if (existing) {
      enrichMatched += 1;
      attach(existing, mergeCandidatePair(rows.get(existing)!, row));
    } else {
      enrichUnmatched += 1;
      const primary = `p${nextId++}`;
      attach(primary, row);
    }
  }

  return { merged: [...rows.values()], internalDuplicates, enrichMatched, enrichUnmatched };
}

export function loadAstraV3Package(dir = 'data/source-registry'): {
  filesFound: string[];
  missing: string[];
  base: AstraCandidateRow[];
  enrich30d: AstraCandidateRow[];
  enrichCdmx: AstraCandidateRow[];
  merged: AstraCandidateRow[];
  stats: AstraMergeStats;
} {
  const required = [ASTRA_BASE_FILE, ASTRA_ENRICH_30D_FILE, ASTRA_ENRICH_CDMX_FILE, ASTRA_SUMMARY_FILE];
  const filesFound = required.map((f) => resolve(dir, f)).filter((p) => existsSync(p));
  const missing = required.filter((f) => !existsSync(resolve(dir, f)));
  const basePath = resolve(dir, ASTRA_BASE_FILE);
  const p30 = resolve(dir, ASTRA_ENRICH_30D_FILE);
  const pCdmx = resolve(dir, ASTRA_ENRICH_CDMX_FILE);
  const pSum = resolve(dir, ASTRA_SUMMARY_FILE);
  const base = loadAstraCsvFile(basePath);
  const enrich30d = loadAstraCsvFile(p30);
  const enrichCdmx = loadAstraCsvFile(pCdmx);
  const summaryRows = loadAstraCsvRowCount(pSum);
  const summaryParsedAsSources = loadAstraCsvFile(pSum).length;
  const { merged, internalDuplicates, enrichMatched, enrichUnmatched } = mergeAstraCandidates(base, [
    ...enrich30d,
    ...enrichCdmx,
  ]);
  const baseIds = new Set(base.map((r) => r.candidate_id).filter((id): id is string => Boolean(id)));
  return {
    filesFound,
    missing,
    base,
    enrich30d,
    enrichCdmx,
    merged,
    stats: {
      base_rows: loadAstraCsvRowCount(basePath),
      base_unique: baseIds.size || new Set(base.map((r) => lookupKeys(r)[0])).size,
      enrich_rows_30d: loadAstraCsvRowCount(p30),
      enrich_rows_cdmx_edomex: loadAstraCsvRowCount(pCdmx),
      summary_rows: summaryRows,
      summary_parsed_as_sources: summaryParsedAsSources,
      merged_unique: merged.length,
      enrich_matched: enrichMatched,
      enrich_unmatched: enrichUnmatched,
      internal_duplicates: internalDuplicates,
    },
  };
}
