import { describe, expect, it } from 'vitest';
import { isAutoWriteEligible } from '../src/captureReliability/writeEligibility.js';
import { discoveryCoverageVerdict } from '../src/captureReliability/coverage.js';
import { applySitemapWindow } from '../src/captureReliability/sitemapWindow.js';
import { sitemapWindowCompleteness } from '../src/captureReliability/rssWindow.js';
import { classifySourceReadiness } from '../src/captureReliability/sourceOutcome.js';
import { emptySourceState, markSourceTerminal, withTimeout, SourceTimeoutError } from '../src/captureReliability/checkpoint.js';
import { MemoryCaptureReliabilityStore } from '../src/captureReliability/captureRecoveryRepository.js';
import { runReconcileEngine, type SourceDiscovery } from '../src/captureReliability/engine.js';
import { baseRecoveryRecord } from '../src/captureReliability/reconcile.js';
import { primaryHash, captureCanonicalUrl } from '../src/captureReliability/urlIndex.js';
import { bGapCandidateToCaptureGapRow, isGoogleNewsUrl } from '../src/matching/bGapCandidateToCaptureGapRow.js';
import { lookupExistingNewsByHashes } from '../src/captureReliability/lakeLookup.js';
import type { ChannelCatalogRow, DiscoveredUrl, SourceReconcileState } from '../src/captureReliability/types.js';

const ENTORNO =
  'https://entornoinformativo.com.mx/plantea-fortalecer-presupuesto-a-universidades-publicas-la-rectora-de-unison-dena-maria-camarena/';
const GOOGLE = 'https://news.google.com/rss/articles/CBMiEXAMPLE';
const NOW = '2026-10-02T18:00:00.000Z';
const W24 = { start: '2026-10-01T18:00:00.000Z', end: '2026-10-02T18:00:00.000Z' };

function rec(over: Parameters<typeof isAutoWriteEligible>[0] extends infer T ? Partial<T> : never = {}) {
  return {
    status: 'QUEUED' as const,
    medio_id: 'MED-0441',
    discovered_via: 'GOOGLE_NEWS_RADAR',
    window_membership: 'WINDOW_MEMBERSHIP_UNKNOWN' as const,
    published_at: null as string | null,
    ...over,
  };
}

function disc(url: string, over: Partial<DiscoveredUrl> = {}): DiscoveredUrl {
  return {
    url,
    canonicalUrl: captureCanonicalUrl(url),
    hashUrl: primaryHash(url),
    medioId: 'MED-1',
    fuenteId: null,
    hostname: 'a.example',
    discoveredVia: 'sitemap',
    publishedAt: '2026-10-02T12:00:00.000Z',
    titulo: 'Nota',
    resumen: null,
    body: null,
    ...over,
  };
}

function discoveryFor(urls: DiscoveredUrl[], over: Partial<SourceDiscovery> = {}): SourceDiscovery {
  return {
    urls,
    surfaces: ['sitemap'],
    rssSpanCovered: 'UNKNOWN',
    sitemapSpanCovered: 'YES',
    listingSpanCovered: 'UNKNOWN',
    sitemapRuntimeCompletenessInvoked: true,
    capHit: false,
    noDiscoverySurface: false,
    ...over,
  };
}

describe('RC1 A News Lake hardening', () => {
  it('A: publication_date null + membership unknown => no bulk persist', () => {
    const e = isAutoWriteEligible(rec({ discovered_via: 'sitemap' }), W24, null);
    expect(e.eligible).toBe(false);
    expect(e.reason).toBe('WINDOW_MEMBERSHIP_UNKNOWN');
  });

  it('B: publication_date null + MISSING_KNOWN_SOURCE targeted => eligible', () => {
    const e = isAutoWriteEligible(rec(), W24, null, { targeted: true });
    expect(e.eligible).toBe(true);
    expect(e.reason).toBe('MISSING_KNOWN_SOURCE');
  });

  it('C: fecha inside window => eligible', () => {
    const e = isAutoWriteEligible(rec({ discovered_via: 'rss', published_at: '2026-10-02T10:00:00.000Z' }), W24, null);
    expect(e.eligible).toBe(true);
    expect(e.reason).toBe('IN_WINDOW_DATE');
  });

  it('D: fecha outside window => reject', () => {
    const e = isAutoWriteEligible(rec({ discovered_via: 'rss', published_at: '2026-09-01T10:00:00.000Z' }), W24, null);
    expect(e.eligible).toBe(false);
    expect(e.reason).toBe('OUTSIDE_WINDOW');
  });

  it('E: sitemap cap + window covered => not failure', () => {
    expect(
      sitemapWindowCompleteness({
        paginationComplete: false,
        datedInWindow: 12,
        indexFollowed: true,
        capHit: true,
        datedOldestMs: Date.parse('2026-10-01T12:00:00.000Z'),
        windowStartMs: Date.parse(W24.start),
      }),
    ).toBe('YES');
    expect(
      discoveryCoverageVerdict({
        rssSpanCovered: 'UNKNOWN',
        sitemapSpanCovered: 'YES',
        listingSpanCovered: 'UNKNOWN',
        paginationComplete: false,
        capHit: true,
        timeBudgetHit: false,
        noDiscoverySurface: false,
        surfaces: ['sitemap'],
      }),
    ).toBe('COVERAGE_CONFIRMED');
    const st: SourceReconcileState = {
      ...emptySourceState({ medioId: 'MED-1', windowStart: W24.start, windowEnd: W24.end }),
      cap_hit: true,
      coverage_verdict: 'COVERAGE_CONFIRMED',
      sitemap_span_covered: 'YES',
      discovery_surfaces: ['sitemap'],
    };
    const marked = markSourceTerminal(st, 'COMPLETE', NOW);
    expect(marked.complete).toBe(true);
    expect(marked.status).toBe('COMPLETE');
    expect(classifySourceReadiness(marked)).toBe('CAP_REACHED_WINDOW_COVERED');
  });

  it('F: sitemap cap + window unknown => needs pagination', () => {
    const r = applySitemapWindow({
      items: Array.from({ length: 50 }, (_, i) => ({
        url: `https://m.example/undated-nota-${i}-articulo-largo/`,
        fecha: null,
        titulo: 'x',
        resumen: null,
      })),
      windowStart: W24.start,
      windowEnd: W24.end,
      paginationComplete: false,
      indexFollowed: true,
      capHit: true,
    });
    expect(r.completeness).toBe('UNKNOWN');
    expect(
      discoveryCoverageVerdict({
        rssSpanCovered: 'UNKNOWN',
        sitemapSpanCovered: 'UNKNOWN',
        listingSpanCovered: 'UNKNOWN',
        paginationComplete: false,
        capHit: true,
        timeBudgetHit: false,
        noDiscoverySurface: false,
        surfaces: ['sitemap'],
      }),
    ).toBe('COVERAGE_PARTIAL');
  });

  it('G: slow source timeout => shard continues', async () => {
    const catalog: ChannelCatalogRow[] = [
      { medio_id: 'MED-SLOW', url_base: 'https://slow.example/', rss_url: 'https://slow.example/rss', sitemap_url: null, hostname: 'slow.example' },
      { medio_id: 'MED-FAST', url_base: 'https://fast.example/', rss_url: 'https://fast.example/rss', sitemap_url: null, hostname: 'fast.example' },
    ];
    const store = new MemoryCaptureReliabilityStore();
    const report = await runReconcileEngine(
      {
        runId: 'to',
        mode: '24h',
        windowStart: W24.start,
        windowEnd: W24.end,
        shardIndex: 0,
        shardCount: 1,
        workerId: 'w',
        maxSourcesThisRun: 10,
        safetyCap: 1000,
        timeBudgetMs: 10_000,
        processRecovery: false,
        dryRun: true,
        nowIso: NOW,
        perSourceTimeoutMs: 40,
      },
      {
        store,
        catalog,
        queryLakeHashes: async () => [],
        discoverSource: async (row) => {
          if (row.medio_id === 'MED-SLOW') {
            await new Promise(() => undefined);
          }
          return discoveryFor([
            disc('https://fast.example/nota-rapida-de-prueba-valida/', { medioId: 'MED-FAST', hostname: 'fast.example', discoveredVia: 'rss' }),
          ], { surfaces: ['rss', 'sitemap'], sitemapSpanCovered: 'YES' });
        },
      },
    );
    expect(report.sourceStates.find((s) => s.medio_id === 'MED-SLOW')?.last_error).toBe('SOURCE_TIMEOUT');
    expect(report.sourceStates.find((s) => s.medio_id === 'MED-FAST')?.status).toBe('COMPLETE');
    expect(report.SOURCES_PENDING).toBe(0);
  });

  it('H: stale claim reclaim is safe', async () => {
    const store = new MemoryCaptureReliabilityStore();
    const record = { ...baseRecoveryRecord(disc(ENTORNO, { medioId: 'MED-0441', hostname: 'entornoinformativo.com.mx' }), NOW), status: 'QUEUED' as const };
    await store.upsertDiscovered(record);
    await store.claimBatch({ workerId: 'dead', limit: 1, nowIso: '2026-10-02T17:00:00.000Z' });
    expect((await store.get(record.hash_url))?.status).toBe('FETCHING');
    const n = await store.releaseStaleClaims('2026-10-02T17:30:00.000Z');
    expect(n).toBe(1);
    expect((await store.get(record.hash_url))?.claimed_at).toBeNull();
    const again = await store.claimBatch({ workerId: 'alive', limit: 1, nowIso: NOW });
    expect(again).toHaveLength(1);
    expect(again[0]?.claimed_by).toBe('alive');
  });

  it('I: rerun same URL/hash does not duplicate lake row', async () => {
    const url = 'https://medio.example/nota-unica-de-prueba-idempotente/';
    const lake = [{
      noticia_id: 'n-1',
      hash_url: primaryHash(url),
      url_original: url,
      url_canonica: captureCanonicalUrl(url),
      texto_cuerpo_nota: 'cuerpo',
      texto_nota_limpia: 'limpia',
    }];
    const map1 = await lookupExistingNewsByHashes([url], async () => lake);
    const map2 = await lookupExistingNewsByHashes([url], async () => lake);
    expect(map1.get(url)?.noticia_id).toBe('n-1');
    expect(map2.get(url)?.noticia_id).toBe('n-1');
  });

  it('J: Google redirect URL is not a publisher recovery target', () => {
    expect(isGoogleNewsUrl(GOOGLE)).toBe(true);
    expect(bGapCandidateToCaptureGapRow({
      publisher_final_url: GOOGLE,
      canonical_hash: 'x',
      hostname: 'news.google.com',
      medio_id: 'MED-0441',
      candidate_medio_ids: ['MED-0441'],
      fuente_id: null,
      candidate_fuente_ids: [],
      cliente_ids: [],
      keyword_ids: [],
      queries: [],
      google_item_urls: [GOOGLE],
      first_discovered_at: NOW,
      last_discovered_at: NOW,
      discovered_via: 'GOOGLE_NEWS_RADAR',
      discovery_status: 'MISSING_KNOWN_SOURCE',
    })).toBeNull();
  });

  it('withTimeout rejects SOURCE_TIMEOUT', async () => {
    await expect(withTimeout(new Promise(() => undefined), 20, 'MED-X')).rejects.toBeInstanceOf(SourceTimeoutError);
  });
});
