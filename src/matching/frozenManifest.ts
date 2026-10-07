/**
 * Conjunto congelado de IDs/hashes para reconciliación exacta.
 * No usa ventana móvil. Dedup determinista. Batching PostgREST.
 */
import { readFileSync } from 'node:fs';

export const MANIFEST_QUERY_BATCH = 80;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH_RE = /^[0-9a-f]{32,128}$/i;

export interface ManifestParseResult {
  ids: string[];
  hashes: string[];
  requested: number;
  unique: number;
  duplicates_removed: number;
  invalid: string[];
  source: 'noticia_ids' | 'hashes' | 'mixed' | 'a72_scale_json';
}

export function chunkManifest<T>(items: T[], batchSize = MANIFEST_QUERY_BATCH): T[][] {
  const size = Math.max(1, batchSize);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function uniquePreserve<T>(items: T[]): { unique: T[]; duplicates: number } {
  const seen = new Set<string>();
  const unique: T[] = [];
  let duplicates = 0;
  for (const item of items) {
    const key = String(item).trim().toLowerCase();
    if (!key) continue;
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    unique.push(item);
  }
  return { unique, duplicates };
}

export function parseTokenList(raw: string): string[] {
  const text = raw.trim();
  if (!text) return [];
  if (text.startsWith('[') || text.startsWith('{')) {
    const parsed = JSON.parse(text) as unknown;
    return flattenJsonTokens(parsed);
  }
  return text
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function flattenJsonTokens(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap(flattenJsonTokens);
  if (value && typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    const out: string[] = [];
    for (const key of ['noticia_ids', 'ids', 'hashes', 'hash_urls', 'WRITTEN_HASHES']) {
      if (key in rec) out.push(...flattenJsonTokens(rec[key]));
    }
    for (const wave of ['wave1500', 'wave3000', 'residual']) {
      const block = rec[wave];
      if (block && typeof block === 'object') {
        out.push(...flattenJsonTokens((block as { WRITTEN_HASHES?: unknown }).WRITTEN_HASHES));
      }
    }
    return out;
  }
  return [];
}

export function classifyManifestTokens(tokens: string[]): ManifestParseResult {
  const invalid: string[] = [];
  const idsRaw: string[] = [];
  const hashesRaw: string[] = [];
  for (const token of tokens) {
    const t = token.trim();
    if (UUID_RE.test(t)) idsRaw.push(t.toLowerCase());
    else if (HASH_RE.test(t)) hashesRaw.push(t.toLowerCase());
    else invalid.push(t);
  }
  const ids = uniquePreserve(idsRaw);
  const hashes = uniquePreserve(hashesRaw);
  const requested = tokens.filter((t) => t.trim()).length;
  const unique = ids.unique.length + hashes.unique.length;
  const source: ManifestParseResult['source'] =
    ids.unique.length && hashes.unique.length ? 'mixed' : hashes.unique.length ? 'hashes' : 'noticia_ids';
  return {
    ids: ids.unique,
    hashes: hashes.unique,
    requested,
    unique,
    duplicates_removed: ids.duplicates + hashes.duplicates,
    invalid,
    source,
  };
}

export function loadManifestFile(path: string): ManifestParseResult {
  const raw = readFileSync(path, 'utf8');
  const parsed = classifyManifestTokens(parseTokenList(raw));
  let source = parsed.source;
  try {
    const json = JSON.parse(raw) as Record<string, unknown>;
    if (json.wave1500 || json.wave3000 || json.residual) source = 'a72_scale_json';
  } catch {
    /* listado plano */
  }
  return { ...parsed, source };
}

export function extractA72WrittenHashes(scale: {
  wave1500?: { WRITTEN_HASHES?: string[] };
  wave3000?: { WRITTEN_HASHES?: string[] };
  residual?: { WRITTEN_HASHES?: string[] };
}): string[] {
  const tokens = [
    ...(scale.wave1500?.WRITTEN_HASHES ?? []),
    ...(scale.wave3000?.WRITTEN_HASHES ?? []),
    ...(scale.residual?.WRITTEN_HASHES ?? []),
  ];
  return classifyManifestTokens(tokens).hashes;
}
