import { describe, expect, it } from 'vitest';
import { bGapCandidateToCaptureGapRow, gapRecoveryEligible, isGoogleNewsUrl } from '../src/matching/bGapCandidateToCaptureGapRow.js';
import { ArtifactGapCandidateSink, SupabaseGapCandidateSink, type GapCandidate } from '../src/matching/gapCandidateSink.js';
import { googleGapDbWritesAllowed } from '../src/matching/googleGapWrites.js';
import { isAutoWriteEligible } from '../src/captureReliability/writeEligibility.js';
import { MemoryCaptureReliabilityStore } from '../src/captureReliability/captureRecoveryRepository.js';
import { drainRecoveryQueue } from '../src/captureReliability/recoveryDrain.js';
import { baseRecoveryRecord } from '../src/captureReliability/reconcile.js';
import { primaryHash } from '../src/captureReliability/urlIndex.js';
import { parseReconciliationArgs } from '../scripts/mentions-master-reconciliation.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RecoveryRecord } from '../src/captureReliability/types.js';
import { okExtract } from './capture-reliability.test.js';

const ENTORNO =
  'https://entornoinformativo.com.mx/plantea-fortalecer-presupuesto-a-universidades-publicas-la-rectora-de-unison-dena-maria-camarena/';
const GOOGLE = 'https://news.google.com/rss/articles/CBMiEXAMPLE';
const NOW = '2026-10-02T18:00:00.000Z';
const W24 = { start: '2026-10-01T18:00:00.000Z', end: '2026-10-02T18:00:00.000Z' };

function bCandidate(over: Partial<GapCandidate> = {}): GapCandidate {
  return {
    publisher_final_url: ENTORNO,
    canonical_hash: primaryHash(ENTORNO),
    hostname: 'entornoinformativo.com.mx',
    medio_id: 'MED-0441',
    candidate_medio_ids: ['MED-0441'],
    fuente_id: null,
    candidate_fuente_ids: [],
    cliente_ids: ['CLI-MERY-TEST'],
    keyword_ids: ['KEY-0040'],
    queries: ['mery pozo'],
    google_item_urls: [GOOGLE],
    first_discovered_at: NOW,
    last_discovered_at: NOW,
    discovered_via: 'GOOGLE_NEWS_RADAR',
    discovery_status: 'MISSING_KNOWN_SOURCE',
    ...over,
  };
}

function rec(over: Partial<RecoveryRecord> = {}): RecoveryRecord {
  return {
    ...baseRecoveryRecord(
      {
        url: ENTORNO,
        canonicalUrl: ENTORNO,
        hashUrl: primaryHash(ENTORNO),
        medioId: 'MED-0441',
        fuenteId: null,
        hostname: 'entornoinformativo.com.mx',
        discoveredVia: 'GOOGLE_NEWS_RADAR',
        publishedAt: null,
        titulo: 'Nota',
        resumen: null,
        body: null,
      },
      NOW,
    ),
    status: 'QUEUED',
    ...over,
  };
}

describe('RC1 A↔B contract', () => {
  it('maps B V7 candidate to A gap row without Google recovery target', () => {
    const row = bGapCandidateToCaptureGapRow(bCandidate());
    expect(row).not.toBeNull();
    expect(row!.candidate_id).toBe(primaryHash(ENTORNO));
    expect(row!.discovered_url).toBe(row!.publisher_final_url);
    expect(row!.publisher_final_url).toContain('entornoinformativo.com.mx');
    expect(row!.canonical_hash).toBe(row!.candidate_id);
    expect(isGoogleNewsUrl(row!.publisher_final_url)).toBe(false);
    expect(row!.google_item_urls[0]).toContain('news.google.com');
    expect(row!.candidate_medio_ids).toEqual(['MED-0441']);
  });

  it('does not map Google-only publisher_final_url', () => {
    expect(bGapCandidateToCaptureGapRow(bCandidate({ publisher_final_url: GOOGLE }))).toBeNull();
  });

  it('does not insert ALREADY_IN_LAKE', () => {
    expect(bGapCandidateToCaptureGapRow(bCandidate({ discovery_status: 'ALREADY_IN_LAKE' }))).toBeNull();
  });

  it('routes gap statuses', () => {
    expect(gapRecoveryEligible('MISSING_KNOWN_SOURCE')).toBe(true);
    expect(gapRecoveryEligible('KNOWN_AMBIGUOUS')).toBe(false);
    expect(gapRecoveryEligible('UNKNOWN_SOURCE')).toBe(false);
    expect(gapRecoveryEligible('ALREADY_IN_LAKE')).toBe(false);
  });

  it('Entorno gap is auto-write eligible without published_at', () => {
    const e = isAutoWriteEligible(rec(), W24, null);
    expect(e.eligible).toBe(true);
    expect(e.reason).toBe('MISSING_KNOWN_SOURCE');
  });

  it('undated sitemap is not bulk-write eligible', () => {
    const e = isAutoWriteEligible(
      rec({ discovered_via: 'sitemap', window_membership: 'WINDOW_MEMBERSHIP_UNKNOWN', published_at: null, medio_id: 'MED-1' }),
      W24,
      null,
    );
    expect(e.eligible).toBe(false);
    expect(e.reason).toBe('WINDOW_MEMBERSHIP_UNKNOWN');
  });

  it('targeted recovery hashes skip other queued URLs', async () => {
    const store = new MemoryCaptureReliabilityStore();
    const keep = rec();
    const other = rec({
      hash_url: primaryHash('https://other.example/nota-larga-de-prueba/'),
      discovered_url: 'https://other.example/nota-larga-de-prueba/',
      canonical_url: 'https://other.example/nota-larga-de-prueba/',
      discovered_via: 'rss',
      medio_id: 'MED-1',
    });
    await store.upsertDiscovered(keep);
    await store.upsertDiscovered(other);
    const drain = await drainRecoveryQueue({
      store,
      workerId: 'w',
      nowIso: NOW,
      batchSize: 10,
      maxBatches: 5,
      concurrency: 1,
      globalConcurrency: 2,
      perHostConcurrency: 1,
      timeBudgetMs: 10_000,
      writesAllowed: false,
      onlyHashes: new Set([keep.hash_url]),
      fetchExtract: async () => okExtract({
        titulo: 'x',
        resumen: 'y',
        texto_extraido: 'RAW body text for article admission. '.repeat(8),
        texto_nota_limpia: 'Merilyn Gómez Pozos en el cuerpo. '.repeat(8),
        texto_cuerpo_nota: 'Merilyn Gómez Pozos en el cuerpo. '.repeat(8),
        calidad_extraccion: 'alta',
        tipo_nota: 'Política',
      }),
    });
    expect(drain.RECOVERY_PROCESSED_THIS_RUN).toBe(1);
    const snap = await store.snapshot();
    expect(snap.find((r) => r.hash_url === other.hash_url)?.status).toBe('QUEUED');
  });

  it('parses noticia-ids for B reconciliation', () => {
    const args = parseReconciliationArgs([
      '--dry-run',
      '--noticia-ids=7a790fdf-49bb-47c9-8153-d341614c14a7,c00957ec-4bb7-4f66-85ba-e4965e02678b,cde2e64c-767d-41a0-ac31-793ea9cff836',
    ]);
    expect(args.noticiaIds).toHaveLength(3);
    expect(args.dryRun).toBe(true);
  });

  it('gap DB writes fail closed without secret', () => {
    expect(googleGapDbWritesAllowed({ ALLOW_GOOGLE_GAP_DB_WRITES: undefined })).toBe(false);
    expect(googleGapDbWritesAllowed({ ALLOW_GOOGLE_GAP_DB_WRITES: 'true' })).toBe(true);
  });

  it('Supabase sink upserts mapped rows by candidate_id', async () => {
    const upserts: unknown[] = [];
    const sink = new SupabaseGapCandidateSink(true, {
      from: () => ({
        upsert: async (rows: unknown) => {
          upserts.push(rows);
          return { error: null };
        },
      }),
    });
    const out = await sink.emit([bCandidate(), bCandidate({ discovery_status: 'ALREADY_IN_LAKE' })]);
    expect(out.backend).toBe('supabase');
    expect(out.written).toBe(1);
    const rows = upserts[0] as Array<{ candidate_id: string; publisher_final_url: string }>;
    expect(rows?.[0]?.candidate_id).toBe(primaryHash(ENTORNO));
    expect(rows?.[0]?.publisher_final_url).not.toContain('news.google.com');
  });

  it('artifact sink remains available when DB disabled', async () => {
    let wrote = 0;
    const sink = new ArtifactGapCandidateSink(() => {
      wrote += 1;
    });
    await sink.emit([bCandidate()]);
    expect(wrote).toBe(1);
  });

  it('schedule workflows use supabase cursor and dual-gate secrets', () => {
    const radar = readFileSync(join(process.cwd(), '.github/workflows/google-news-gap-radar.yml'), 'utf8');
    expect(radar).toContain('GOOGLE_RADAR_CURSOR_BACKEND: supabase');
    expect(radar).toContain('ALLOW_GOOGLE_GAP_DB_WRITES');
    const rec24 = readFileSync(join(process.cwd(), '.github/workflows/mentions-master-reconciliation-24h.yml'), 'utf8');
    expect(rec24).toContain('noticia_ids');
    expect(rec24).toContain('ALLOW_MENTIONS_RECOVERY_WRITES');
    const cap = readFileSync(join(process.cwd(), '.github/workflows/capture-reliability.yml'), 'utf8');
    expect(cap).toContain('recovery_hashes');
    expect(cap).toContain('recovery_urls');
  });
});
