import { captureCanonicalUrl, captureUrlHashes, primaryHash } from './urlIndex.js';

export interface LakeRow {
  hash_url: string;
  url_original: string | null;
  url_canonica: string | null;
  texto_cuerpo_nota: string | null;
  texto_nota_limpia: string | null;
  noticia_id?: string | null;
}

export interface LakeLookupHit {
  url: string;
  hashUrl: string;
  existing: LakeRow | null;
}

export type HashQueryFn = (hashes: string[]) => Promise<LakeRow[]>;

function indexRows(rows: LakeRow[]): Map<string, LakeRow> {
  const map = new Map<string, LakeRow>();
  for (const row of rows) {
    map.set(row.hash_url, row);
    for (const extra of [row.url_original, row.url_canonica].filter(Boolean) as string[]) {
      for (const h of captureUrlHashes(extra)) map.set(h, row);
    }
  }
  return map;
}

/**
 * Lookup batch contra News Lake por hashes canónicos.
 * Sin preload por hostname. Funciona para cualquier medio.
 */
export async function lookupExistingNewsByHashes(
  urls: string[],
  queryHashes: HashQueryFn,
  chunkSize = 120,
): Promise<Map<string, LakeRow | null>> {
  const hashes = [...new Set(urls.flatMap((u) => captureUrlHashes(u)))];
  const found: LakeRow[] = [];
  for (let i = 0; i < hashes.length; i += chunkSize) {
    const chunk = hashes.slice(i, i + chunkSize);
    if (!chunk.length) continue;
    found.push(...(await queryHashes(chunk)));
  }
  const byHash = indexRows(found);
  const out = new Map<string, LakeRow | null>();
  for (const url of urls) {
    const hit = captureUrlHashes(url).map((h) => byHash.get(h)).find(Boolean) ?? null;
    out.set(captureCanonicalUrl(url), hit);
    out.set(url, hit);
    out.set(primaryHash(url), hit);
  }
  return out;
}

export function lakeRowNeedsEnrich(row: LakeRow | undefined | null): boolean {
  if (!row) return false;
  const body = (row.texto_cuerpo_nota ?? '').trim();
  const clean = (row.texto_nota_limpia ?? '').trim();
  return body.length < 40 && clean.length < 40;
}
