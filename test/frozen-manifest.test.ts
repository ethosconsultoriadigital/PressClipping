import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  chunkManifest,
  classifyManifestTokens,
  extractA72WrittenHashes,
  loadManifestFile,
  MANIFEST_QUERY_BATCH,
} from '../src/matching/frozenManifest.js';
import { parseReconciliationArgs } from '../scripts/mentions-master-reconciliation.js';

describe('frozen manifest batching', () => {
  it('N — archivo de IDs/hashes con duplicados se deduplica', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rc1-manifest-'));
    const path = join(dir, 'ids.txt');
    const a = '7a790fdf-49bb-47c9-8153-d341614c14a7';
    const b = 'c00957ec-4bb7-4f66-85ba-e4965e02678b';
    writeFileSync(path, `${a}\n${a}\n${b}\n${b}\n`);
    const loaded = loadManifestFile(path);
    expect(loaded.ids).toEqual([a, b]);
    expect(loaded.duplicates_removed).toBe(2);
    const args = parseReconciliationArgs([`--noticia-ids-file=${path}`]);
    expect(args.noticiaIds).toEqual([a, b]);
  });

  it('O — manifiesto grande se parte sin pérdida', () => {
    const hashes = Array.from({ length: 4437 }, (_, i) => i.toString(16).padStart(64, '0'));
    const parsed = classifyManifestTokens(hashes.concat(hashes.slice(0, 10)));
    expect(parsed.hashes).toHaveLength(4437);
    expect(parsed.duplicates_removed).toBe(10);
    const batches = chunkManifest(parsed.hashes, MANIFEST_QUERY_BATCH);
    expect(batches.every((b) => b.length <= MANIFEST_QUERY_BATCH)).toBe(true);
    expect(batches.flat()).toEqual(parsed.hashes);
    expect(batches.flat().length).toBe(4437);
  });

  it('extrae WRITTEN_HASHES del scale JSON A72', () => {
    const h1 = 'a'.repeat(64);
    const h2 = 'b'.repeat(64);
    const h3 = 'c'.repeat(64);
    expect(extractA72WrittenHashes({
      wave1500: { WRITTEN_HASHES: [h1] },
      wave3000: { WRITTEN_HASHES: [h2, h1] },
      residual: { WRITTEN_HASHES: [h3] },
    })).toEqual([h1, h2, h3]);
  });
});
