import { describe, expect, it } from 'vitest';
import { computeFixedCycle } from '../src/captureReliability/cycle.js';
import { shardCatalog } from '../src/captureReliability/catalog.js';
import { HostConcurrencyLimiter } from '../src/captureReliability/hostLimiter.js';
import { drainRecoveryQueue } from '../src/captureReliability/recoveryDrain.js';
import { MemoryCaptureReliabilityStore } from '../src/captureReliability/captureRecoveryRepository.js';
import { baseRecoveryRecord } from '../src/captureReliability/reconcile.js';
import { gapCandidateFromB, recoveryTargetUrl } from '../src/captureReliability/gapCandidates.js';
import { classifySchemaPresence } from '../src/captureReliability/schemaReady.js';
import { applySitemapWindow } from '../src/captureReliability/sitemapWindow.js';
import { runReconcileEngine } from '../src/captureReliability/engine.js';
import { processRecoveryRecord } from '../src/captureReliability/recoveryWorker.js';
import { selectTrustedBody } from '../src/matching/trustedBody.js';
import { buildRecoveredNewsPayload } from '../src/captureReliability/recoveryPayload.js';
import { primaryHash } from '../src/captureReliability/urlIndex.js';
import { okExtract } from './capture-reliability.test.js';
import type { FetchExtractResult } from '../src/extractors/html.js';
import type { RecoveryRecord } from '../src/captureReliability/types.js';

const ENTORNO =
  'https://entornoinformativo.com.mx/plantea-fortalecer-presupuesto-a-universidades-publicas-la-rectora-de-unison-dena-maria-camarena/';
const NOW = '2026-10-02T18:00:00.000Z';
const W24 = { start: '2026-10-01T18:00:00.000Z', end: '2026-10-02T18:00:00.000Z' };

function rec(url: string, status: RecoveryRecord['status'] = 'QUEUED'): RecoveryRecord {
  return {
    ...baseRecoveryRecord(
      {
        url,
        canonicalUrl: url,
        hashUrl: primaryHash(url),
        medioId: 'MED-1',
        fuenteId: null,
        hostname: 'medio.example',
        discoveredVia: 'rss',
        publishedAt: NOW,
        titulo: 'Nota',
        resumen: null,
        body: null,
      },
      NOW,
    ),
    status,
  };
}

function extract(): FetchExtractResult {
  const body = 'Merilyn Gómez Pozos presentó la propuesta presupuestal de la universidad pública en Sonora. '.repeat(6);
  return okExtract({
    titulo: 'Plantea fortalecer presupuesto',
    resumen: 'La rectora habló.',
    texto_extraido: 'RAW ' + body,
    texto_nota_limpia: body,
    texto_cuerpo_nota: body,
    calidad_extraccion: 'alta',
    tipo_nota: 'Política',
  });
}

describe('Capture reliability V5', () => {
  it('T57 fixed cycle id shared across shards', () => {
    const a = computeFixedCycle({
      mode: '24h',
      windowStart: W24.start,
      windowEnd: W24.end,
      shardCount: 8,
    });
    const b = computeFixedCycle({
      mode: '24h',
      windowStart: W24.start,
      windowEnd: W24.end,
      shardCount: 8,
    });
    expect(a.cycle_id).toBe(b.cycle_id);
    expect(a.window_start).toBe(W24.start);
    expect(a.window_end).toBe(W24.end);
    expect(a.cycle_id).toBe('caprel-24h-20261002T180000Z');
  });

  it('T58 569 sources map uniquely onto 8 shards', () => {
    const catalog = Array.from({ length: 569 }, (_, i) => ({ medio_id: `MED-${String(i).padStart(4, '0')}` }));
    const parts = Array.from({ length: 8 }, (_, i) => shardCatalog(catalog, i, 8));
    const ids = parts.flat().map((r) => r.medio_id).sort();
    expect(ids).toHaveLength(569);
    expect(new Set(ids).size).toBe(569);
    expect(parts.every((p) => p.length === 71 || p.length === 72)).toBe(true);
  });

  it('T59 recovery multi-batch drain processes more than 50', async () => {
    const store = new MemoryCaptureReliabilityStore();
    for (let i = 0; i < 60; i += 1) {
      await store.upsertDiscovered(rec(`https://medio.example/nota-${i}-importante-de-presupuesto/`));
    }
    const drain = await drainRecoveryQueue({
      store,
      workerId: 'w',
      nowIso: NOW,
      batchSize: 20,
      maxBatches: 10,
      concurrency: 4,
      globalConcurrency: 8,
      perHostConcurrency: 2,
      timeBudgetMs: 60_000,
      writesAllowed: false,
      fetchExtract: async () => extract(),
    });
    expect(drain.RECOVERY_PROCESSED_THIS_RUN).toBe(60);
    expect(drain.RECOVERY_REMAINING).toBe(60);
    expect(drain.RECOVERY_WOULD_PERSIST).toBe(60);
  });

  it('T60 per-host concurrency never exceeds 2', async () => {
    const lim = new HostConcurrencyLimiter({ globalLimit: 8, perHostLimit: 2 });
    let current = 0;
    let max = 0;
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        lim.run(`https://host.example/n${i}`, async () => {
          current += 1;
          max = Math.max(max, current);
          await new Promise((r) => setTimeout(r, 15));
          current -= 1;
        }),
      ),
    );
    expect(max).toBeLessThanOrEqual(2);
  });

  it('T61 schema ready requires 5 tables and 3 RPCs', () => {
    expect(classifySchemaPresence([true, true, true, true, true], true, true)).toBe('FULLY_READY');
    expect(classifySchemaPresence([true, true, true, true, true], false, true)).toBe('PARTIAL_SCHEMA');
    expect(classifySchemaPresence([false, false, false, false, false], false, false)).toBe('NONE_PRESENT');
  });

  it('T62 B V7 candidate queues publisher_final_url not Google URL', async () => {
    const catalog = [
      {
        medio_id: 'MED-0441',
        url_base: 'https://entornoinformativo.com.mx/',
        rss_url: 'https://entornoinformativo.com.mx/feed/',
        sitemap_url: null,
        hostname: 'entornoinformativo.com.mx',
      },
    ];
    const b = gapCandidateFromB(
      {
        publisher_final_url: ENTORNO,
        canonical_hash: primaryHash(ENTORNO.replace(/\/$/, '')),
        hostname: 'entornoinformativo.com.mx',
        medio_id: 'MED-0441',
        candidate_medio_ids: ['MED-0441'],
        fuente_id: null,
        candidate_fuente_ids: [],
        cliente_ids: ['C1'],
        keyword_ids: ['K1'],
        queries: ['mery'],
        google_item_urls: ['https://news.google.com/rss/articles/ABC'],
        first_discovered_at: NOW,
        last_discovered_at: NOW,
        discovered_via: 'GOOGLE_NEWS_RADAR',
        discovery_status: 'MISSING_KNOWN_SOURCE',
      },
      catalog,
    );
    expect(recoveryTargetUrl(b)).not.toContain('news.google.com');
    expect(b.publisher_final_url).toContain('entornoinformativo.com.mx');
    const store = new MemoryCaptureReliabilityStore();
    const report = await runReconcileEngine(
      {
        runId: 'r-b',
        cycleId: 'caprel-24h-test',
        mode: '24h',
        windowStart: W24.start,
        windowEnd: W24.end,
        shardIndex: 0,
        shardCount: 1,
        workerId: 'w',
        maxSourcesThisRun: 1,
        safetyCap: 100,
        timeBudgetMs: 30_000,
        processRecovery: true,
        dryRun: true,
        nowIso: NOW,
        gapCandidates: [b],
        maxRecoveryBatches: 5,
      },
      {
        store,
        catalog,
        discoverSource: async () => ({
          urls: [],
          surfaces: ['rss'],
          rssSpanCovered: 'NO',
          sitemapSpanCovered: 'UNKNOWN',
          listingSpanCovered: 'UNKNOWN',
          sitemapRuntimeCompletenessInvoked: false,
          capHit: false,
          noDiscoverySurface: false,
        }),
        queryLakeHashes: async () => [],
        fetchExtract: async (url) => {
          expect(url).not.toContain('news.google.com');
          return extract();
        },
      },
    );
    const queued = (await store.snapshot()).find((r) => r.discovered_url.includes('plantea-fortalecer'));
    expect(queued?.last_dry_run_result).toBe('WOULD_PERSIST');
    expect(queued?.medio_id).toBe('MED-0441');
    const payload = buildRecoveredNewsPayload({
      url: ENTORNO,
      medioId: 'MED-0441',
      extract: extract(),
    });
    const trusted = selectTrustedBody(
      {
        texto_cuerpo_nota: payload.enrichment.texto_cuerpo_nota ?? null,
        texto_nota_limpia: payload.enrichment.texto_nota_limpia ?? null,
        calidad_extraccion: payload.enrichment.calidad_extraccion ?? null,
      },
      'body_high',
    );
    expect(trusted.status).toBe('BODY_TRUSTED');
    expect(trusted.text).toContain('Merilyn Gómez Pozos');
    expect(report.CYCLE_STATUS).toBe('DRAINED');
  });

  it('T63 undated sitemap items are WINDOW_MEMBERSHIP_UNKNOWN', () => {
    const r = applySitemapWindow({
      items: [
        { url: 'https://m.example/a-slug-largo-de-nota/', titulo: 'A', fecha: null, resumen: null },
        { url: 'https://m.example/b-slug-largo-de-nota/', titulo: 'B', fecha: '2026-10-02T10:00:00.000Z', resumen: null },
      ],
      windowStart: W24.start,
      windowEnd: W24.end,
      paginationComplete: true,
      indexFollowed: true,
      capHit: false,
    });
    expect(r.undatedKept).toBe(1);
    expect(r.datedInWindow).toBe(1);
  });

  it('T64 dual-gate still dry without secret', async () => {
    const rec0 = rec(ENTORNO);
    const store = new MemoryCaptureReliabilityStore();
    await store.upsertDiscovered(rec0);
    const out = await processRecoveryRecord({
      record: rec0,
      store,
      fetchExtract: async () => extract(),
      writesAllowed: false,
      nowIso: NOW,
    });
    expect(out.status).toBe('QUEUED');
    expect(out.last_dry_run_result).toBe('WOULD_PERSIST');
  });
});
