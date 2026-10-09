import { describe, expect, it } from 'vitest';
import { MemoryCaptureReliabilityStore } from '../src/captureReliability/captureRecoveryRepository.js';
import { emptySourceState, markSourceTerminal } from '../src/captureReliability/checkpoint.js';
import {
  getCoverageDebt,
  incrementCoverageDebtAttempt,
  isResumableDebt,
  isSilentExhaustedDebt,
  registerCoverageDebt,
  reportCoverageDebtBacklog,
} from '../src/captureReliability/coverageDebt.js';
import { executeCoverageDebtFollowUp } from '../src/captureReliability/coverageDebtExecutor.js';
import { encodeSitemapAfterCursor, encodeSitemapPageCursor, sliceSitemapFromCursor } from '../src/captureReliability/sitemapCursor.js';
import { extractListingHrefs } from '../src/captureReliability/surfaceProbe.js';
import { drainRecoveryQueue, assertCanaryWriteBudget } from '../src/captureReliability/recoveryDrain.js';
import { baseRecoveryRecord } from '../src/captureReliability/reconcile.js';
import { primaryHash } from '../src/captureReliability/urlIndex.js';
import { classifySoloGoogleFollowUp, groupSoloGoogleSample, SOLO_GOOGLE_SAMPLE } from '../src/captureReliability/googleSampleAudit.js';
import { markWindowSafeComplete, seedCatchUpCursor, loadLastSafeWindowEnd } from '../src/captureReliability/catchUpCursor.js';
import { computeFixedCycle } from '../src/captureReliability/cycle.js';
import type { ChannelCatalogRow, DiscoveredUrl, RecoveryRecord } from '../src/captureReliability/types.js';
import type { SourceDiscovery } from '../src/captureReliability/engine.js';
import { okExtract } from './capture-reliability.test.js';

const NOW = '2026-10-05T18:05:00.000Z';
const WS = '2026-10-01T18:00:00.000Z';
const WE = '2026-10-02T18:00:00.000Z';
const CYCLE = computeFixedCycle({ mode: '24h', windowStart: WS, windowEnd: WE });

function catalog(over: Partial<ChannelCatalogRow> = {}): ChannelCatalogRow {
  return {
    medio_id: 'MED-PAGE',
    url_base: 'https://example.com',
    rss_url: null,
    sitemap_url: 'https://example.com/sitemap.xml',
    hostname: 'example.com',
    secciones_urls: null,
    ...over,
  };
}

function disc(url: string, via = 'sitemap'): DiscoveredUrl {
  return {
    url,
    canonicalUrl: url,
    hashUrl: primaryHash(url),
    medioId: 'MED-PAGE',
    fuenteId: null,
    hostname: 'example.com',
    discoveredVia: via,
    publishedAt: '2026-10-02T12:00:00.000Z',
    titulo: 'Nota',
    resumen: null,
    body: null,
    windowMembership: 'IN_WINDOW',
  };
}

function discoveryFor(urls: DiscoveredUrl[], over: Partial<SourceDiscovery> = {}): SourceDiscovery {
  return {
    urls,
    surfaces: over.surfaces ?? ['sitemap'],
    rssSpanCovered: 'UNKNOWN',
    sitemapSpanCovered: over.sitemapSpanCovered ?? 'NO',
    listingSpanCovered: 'UNKNOWN',
    sitemapRuntimeCompletenessInvoked: true,
    capHit: over.capHit ?? false,
    noDiscoverySurface: over.noDiscoverySurface ?? false,
    cursor: over.cursor ?? null,
    pageExhausted: over.pageExhausted ?? false,
    probedSurface: over.probedSurface ?? null,
    probeEvaluated: over.probeEvaluated ?? false,
    resumedFromCursor: over.resumedFromCursor ?? null,
    ...over,
  };
}

async function seedDebt(
  store: MemoryCaptureReliabilityStore,
  medioId: string,
  patch: Parameters<typeof registerCoverageDebt>[1] extends infer _ ? Partial<import('../src/captureReliability/types.js').SourceReconcileState> : never,
) {
  const st = markSourceTerminal(
    {
      ...emptySourceState({ medioId, windowStart: WS, windowEnd: WE }),
      ...patch,
    },
    'INCOMPLETE',
    NOW,
  );
  await store.upsertSourceState(st);
  const debt = await registerCoverageDebt(store, st, NOW);
  return { st, debt };
}

describe('coverage debt executor + observability', () => {
  it('two workers claiming the same INCOMPLETE debt yield one owner', async () => {
    const store = new MemoryCaptureReliabilityStore();
    await seedDebt(store, 'MED-PAGE', { cap_hit: true, cursor: encodeSitemapPageCursor(1) });
    const [a, b] = await Promise.all([
      store.claimSourceBatch({
        workerId: 'w1',
        windowStart: WS,
        windowEnd: WE,
        medioIds: ['MED-PAGE'],
        limit: 1,
        nowIso: NOW,
        staleBeforeIso: '2026-10-05T17:00:00.000Z',
        resumeIncomplete: true,
      }),
      store.claimSourceBatch({
        workerId: 'w2',
        windowStart: WS,
        windowEnd: WE,
        medioIds: ['MED-PAGE'],
        limit: 1,
        nowIso: NOW,
        staleBeforeIso: '2026-10-05T17:00:00.000Z',
        resumeIncomplete: true,
      }),
    ]);
    const owners = [...a, ...b];
    expect(owners).toHaveLength(1);
    expect(new Set(owners.map((s) => s.worker_id)).size).toBe(1);
  });

  it('stale IN_PROGRESS lease is reclaimed by a second worker', async () => {
    const store = new MemoryCaptureReliabilityStore();
    await seedDebt(store, 'MED-PAGE', { cap_hit: true, cursor: 'page:2' });
    const first = await store.claimSourceBatch({
      workerId: 'w1',
      windowStart: WS,
      windowEnd: WE,
      medioIds: ['MED-PAGE'],
      limit: 1,
      nowIso: '2026-10-05T17:00:00.000Z',
      staleBeforeIso: '2026-10-05T16:00:00.000Z',
      resumeIncomplete: true,
    });
    expect(first[0]?.worker_id).toBe('w1');
    const second = await store.claimSourceBatch({
      workerId: 'w2',
      windowStart: WS,
      windowEnd: WE,
      medioIds: ['MED-PAGE'],
      limit: 1,
      nowIso: NOW,
      staleBeforeIso: '2026-10-05T17:30:00.000Z',
      resumeIncomplete: true,
    });
    expect(second).toHaveLength(1);
    expect(second[0]?.worker_id).toBe('w2');
    expect(second[0]?.window_start).toBe(WS);
    expect(second[0]?.window_end).toBe(WE);
  });

  it('sitemap page 1 writes cursor page 2 and resume starts at page 2', async () => {
    const items = [
      { url: 'https://example.com/a' },
      { url: 'https://example.com/b' },
      { url: 'https://example.com/c' },
      { url: 'https://example.com/d' },
    ];
    const page1 = sliceSitemapFromCursor(items, null, 2);
    expect(page1.items.map((x) => x.url)).toEqual(['https://example.com/a', 'https://example.com/b']);
    expect(page1.startedPage).toBe(1);
    expect(page1.nextCursor).toBe(encodeSitemapAfterCursor('https://example.com/b'));
    const page2 = sliceSitemapFromCursor(items, page1.nextCursor, 2);
    expect(page2.items.map((x) => x.url)).toEqual(['https://example.com/c', 'https://example.com/d']);
    expect(page2.resumedFrom).toBe(page1.nextCursor);
    expect(page2.pageExhausted).toBe(true);

    const store = new MemoryCaptureReliabilityStore();
    const { st, debt } = await seedDebt(store, 'MED-PAGE', {
      cap_hit: true,
      cursor: page1.nextCursor,
      discovery_surfaces: ['sitemap'],
    });
    const seen: Array<string | null | undefined> = [];
    const exec = await executeCoverageDebtFollowUp({
      store,
      catalog: catalog(),
      state: st,
      debt: { ...debt, follow_up: 'PAGINATE_FROM_CURSOR', cursor: page1.nextCursor },
      nowIso: NOW,
      runId: 'run-page',
      queryLakeHashes: async () => [],
      discover: async (_row, _w, opts) => {
        seen.push(opts?.resumeCursor);
        const sliced = sliceSitemapFromCursor(items, opts?.resumeCursor, 2);
        return discoveryFor(
          sliced.items.map((it) => disc(it.url)),
          { cursor: sliced.nextCursor, pageExhausted: sliced.pageExhausted, resumedFromCursor: sliced.resumedFrom },
        );
      },
    });
    expect(seen[0]).toBe(page1.nextCursor);
    expect(exec.cursor).toBeNull();
    expect(exec.resolved).toBe(true);
    expect(exec.lifecycle).toBe('RESOLVED');
    expect((await store.snapshot()).map((r) => r.discovered_url)).toEqual([
      'https://example.com/c',
      'https://example.com/d',
    ]);
  });

  it('RSS_ONLY follow-up uses a different surface', async () => {
    const store = new MemoryCaptureReliabilityStore();
    const { st, debt } = await seedDebt(store, 'MED-RSS', { discovery_surfaces: ['rss'] });
    const exec = await executeCoverageDebtFollowUp({
      store,
      catalog: catalog({
        medio_id: 'MED-RSS',
        rss_url: 'https://example.com/rss',
        sitemap_url: 'https://example.com/sitemap.xml',
      }),
      state: st,
      debt: { ...debt, follow_up: 'SECOND_SURFACE', reason: 'RSS_ONLY' },
      nowIso: NOW,
      runId: 'run-2nd',
      queryLakeHashes: async () => [],
      discover: async (_row, _w, opts) => {
        expect(opts?.onlySurfaces).toEqual(['sitemap']);
        expect(opts?.skipSurfaces).toContain('rss');
        return discoveryFor([disc('https://example.com/from-sitemap', 'sitemap')], {
          surfaces: ['sitemap'],
          pageExhausted: true,
        });
      },
    });
    expect(exec.surface_used).toContain('sitemap');
    expect(exec.surface_used).not.toEqual(['rss']);
    expect(exec.resolved).toBe(true);
  });

  it('NO_DISCOVERY_SURFACE runs a real listing probe', async () => {
    const html = '<html><a href="/nota-atlas-123">Atlas</a><a href="mailto:x">x</a></html>';
    expect(extractListingHrefs(html, 'https://vozenred.com')).toContain('https://vozenred.com/nota-atlas-123');
    const store = new MemoryCaptureReliabilityStore();
    const { st, debt } = await seedDebt(store, 'MED-NONE', {
      discovery_surfaces: ['NO_DISCOVERY_SURFACE'],
      last_error: 'NO_DISCOVERY_SURFACE',
    });
    const exec = await executeCoverageDebtFollowUp({
      store,
      catalog: catalog({
        medio_id: 'MED-NONE',
        rss_url: null,
        sitemap_url: null,
        url_base: 'https://vozenred.com',
        secciones_urls: 'https://vozenred.com/seccion',
      }),
      state: st,
      debt: { ...debt, follow_up: 'SURFACE_PROBE', reason: 'NO_DISCOVERY_SURFACE' },
      nowIso: NOW,
      runId: 'run-probe',
      queryLakeHashes: async () => [],
      discover: async (_row, _w, opts) => {
        expect(opts?.probeListing).toBe(true);
        const hrefs = extractListingHrefs(html, 'https://vozenred.com');
        return discoveryFor(
          hrefs.map((u) => disc(u, 'surface_probe:home')),
          { surfaces: ['listing'], probedSurface: 'home', probeEvaluated: true },
        );
      },
    });
    expect(exec.surface_found).toBe('home');
    expect(exec.resolved).toBe(true);
    expect(await getCoverageDebt(store, 'MED-NONE', WS, WE)).toMatchObject({ lifecycle: 'RESOLVED' });
  });

  it('three failed follow-ups escalate to ESCALATED_MANUAL and never stay silent automatic', async () => {
    const store = new MemoryCaptureReliabilityStore();
    const seeded = await seedDebt(store, 'MED-FAIL', { last_error: 'SOURCE_TIMEOUT' });
    let state = seeded.st;
    let debt = seeded.debt;
    for (let i = 0; i < 3; i += 1) {
      const exec = await executeCoverageDebtFollowUp({
        store,
        catalog: catalog({ medio_id: 'MED-FAIL', sitemap_url: null, rss_url: 'https://example.com/rss' }),
        state,
        debt,
        nowIso: NOW,
        runId: `fail-${i}`,
        queryLakeHashes: async () => [],
        discover: async () =>
          discoveryFor([], { surfaces: ['rss'], capHit: false, noDiscoverySurface: false }),
      });
      debt = (await getCoverageDebt(store, 'MED-FAIL', WS, WE))!;
      state = (await store.getSourceState('MED-FAIL', WS, WE))!;
      if (i < 2) expect(exec.lifecycle).toBe('OPEN_AUTOMATIC');
    }
    const final = await getCoverageDebt(store, 'MED-FAIL', WS, WE);
    expect(final?.lifecycle).toBe('ESCALATED_MANUAL');
    expect(final?.automatic).toBe(false);
    expect(isResumableDebt(final)).toBe(false);
    expect(isSilentExhaustedDebt(final)).toBe(false);
    const backlog = reportCoverageDebtBacklog([final!], Date.parse(NOW));
    expect(backlog.byLifecycle.ESCALATED_MANUAL).toBe(1);
    expect(backlog.silentExhausted).toBe(0);
  });

  it('evaluated follow-up resolves debt without a second noticia_id', async () => {
    const store = new MemoryCaptureReliabilityStore();
    const url = 'https://example.com/same-hash';
    const { st, debt } = await seedDebt(store, 'MED-PAGE', { cap_hit: true, cursor: 'page:2' });
    const once = await executeCoverageDebtFollowUp({
      store,
      catalog: catalog(),
      state: st,
      debt: { ...debt, follow_up: 'PAGINATE_FROM_CURSOR' },
      nowIso: NOW,
      runId: 'dup-1',
      queryLakeHashes: async () => [],
      discover: async () =>
        discoveryFor([disc(url), disc(url)], { pageExhausted: true, cursor: null }),
    });
    expect(once.resolved).toBe(true);
    expect((await store.snapshot()).filter((r) => r.hash_url === primaryHash(url))).toHaveLength(1);
    const again = await executeCoverageDebtFollowUp({
      store,
      catalog: catalog(),
      state: (await store.getSourceState('MED-PAGE', WS, WE))!,
      debt: (await getCoverageDebt(store, 'MED-PAGE', WS, WE))!,
      nowIso: NOW,
      runId: 'dup-2',
      queryLakeHashes: async () => [],
      discover: async () => discoveryFor([disc(url)], { pageExhausted: true, cursor: null }),
    });
    expect((await store.snapshot()).filter((r) => r.hash_url === primaryHash(url))).toHaveLength(1);
    expect(again.duplicate_urls).toBeGreaterThanOrEqual(0);
  });

  it('crash mid-pagination keeps the historical window and resumes from the durable cursor', async () => {
    const store = new MemoryCaptureReliabilityStore();
    const { st, debt } = await seedDebt(store, 'MED-PAGE', {
      cap_hit: true,
      cursor: encodeSitemapPageCursor(2),
      discovery_surfaces: ['sitemap'],
    });
    await expect(
      executeCoverageDebtFollowUp({
        store,
        catalog: catalog(),
        state: st,
        debt: { ...debt, follow_up: 'PAGINATE_FROM_CURSOR', cursor: encodeSitemapPageCursor(2) },
        nowIso: NOW,
        runId: 'crash',
        queryLakeHashes: async () => [],
        discover: async () => {
          throw new Error('crash-after-claim');
        },
      }),
    ).rejects.toThrow('crash-after-claim');
    const mid = await store.getSourceState('MED-PAGE', WS, WE);
    expect(mid?.window_start).toBe(WS);
    expect(mid?.window_end).toBe(WE);
    expect(mid?.status).toBe('IN_PROGRESS');
    expect(mid?.cursor).toBe(encodeSitemapPageCursor(2));
    const live = await getCoverageDebt(store, 'MED-PAGE', WS, WE);
    expect(live?.lifecycle).toBe('IN_PROGRESS');
    expect(live?.window_end).toBe(WE);

    const resumed = await executeCoverageDebtFollowUp({
      store,
      catalog: catalog(),
      state: mid!,
      debt: live!,
      nowIso: '2026-10-05T18:20:00.000Z',
      runId: 'resume',
      queryLakeHashes: async () => [],
      discover: async (_row, _w, opts) => {
        expect(opts?.resumeCursor).toBe(encodeSitemapPageCursor(2));
        return discoveryFor([disc('https://example.com/page-2')], {
          pageExhausted: true,
          cursor: null,
          resumedFromCursor: encodeSitemapPageCursor(2),
        });
      },
    });
    expect(resumed.resolved).toBe(true);
    expect(resumed.window_start).toBe(WS);
  });

  it('same discovery rerun does not resolve debt', async () => {
    const store = new MemoryCaptureReliabilityStore();
    const { st, debt } = await seedDebt(store, 'MED-SLOW', {
      last_error: 'SOURCE_TIMEOUT',
      discovery_surfaces: ['rss'],
    });
    const exec = await executeCoverageDebtFollowUp({
      store,
      catalog: catalog({ medio_id: 'MED-SLOW', rss_url: 'https://example.com/rss', sitemap_url: null }),
      state: st,
      debt: { ...debt, follow_up: 'RESUME_SAME_WINDOW' },
      nowIso: NOW,
      runId: 'noop',
      queryLakeHashes: async () => [],
      discover: async () => discoveryFor([], { surfaces: ['rss'] }),
    });
    expect(exec.noop_rediscovery).toBe(true);
    expect(exec.resolved).toBe(false);
    expect((await getCoverageDebt(store, 'MED-SLOW', WS, WE))?.lifecycle).toBe('OPEN_AUTOMATIC');
  });

  it('limited canary never moves the global cursor after durable debt', async () => {
    const store = new MemoryCaptureReliabilityStore();
    await seedCatchUpCursor(store, { mode: '24h', lastSafeWindowEnd: '2026-10-01T18:00:00.000Z', nowIso: NOW });
    const { st } = await seedDebt(store, 'MED-0001', { last_error: 'SOURCE_TIMEOUT' });
    await store.upsertSourceState(st);
    const safety = await markWindowSafeComplete(store, CYCLE, NOW, {
      allowCursorAdvance: false,
      expectedMedioIds: ['MED-0001'],
    });
    expect(safety.reason).toBe('LIMITED_DISPATCH_NO_CURSOR');
    expect(await loadLastSafeWindowEnd(store, '24h')).toBe('2026-10-01T18:00:00.000Z');
  });

  it('one-hash canary reports NEW_WRITES_THIS_RUN=1 not the persisted global snapshot', async () => {
    const store = new MemoryCaptureReliabilityStore();
    for (let i = 0; i < 20; i += 1) {
      const url = `https://example.com/old-${i}`;
      await store.upsertDiscovered({
        ...baseRecoveryRecord(
          {
            url,
            canonicalUrl: url,
            hashUrl: primaryHash(url),
            medioId: 'MED-0367',
            fuenteId: null,
            hostname: 'example.com',
            discoveredVia: 'rss',
            publishedAt: '2026-10-02T12:00:00.000Z',
            titulo: 'old',
            resumen: null,
            body: null,
          },
          NOW,
        ),
        status: 'PERSISTED',
        noticia_id: `old-${i}`,
      });
    }
    const target = 'https://www.ultranoticias.com.mx/canary-one-hash';
    const queued: RecoveryRecord = {
      ...baseRecoveryRecord(
        {
          url: target,
          canonicalUrl: target,
          hashUrl: primaryHash(target),
          medioId: 'MED-0367',
          fuenteId: null,
          hostname: 'ultranoticias.com.mx',
          discoveredVia: 'rss',
          publishedAt: '2026-10-02T12:00:00.000Z',
          titulo: 'Canario',
          resumen: null,
          body: null,
        },
        NOW,
      ),
      status: 'QUEUED',
      window_membership: 'IN_WINDOW',
    };
    await store.upsertDiscovered(queued);
    const drain = await drainRecoveryQueue({
      store,
      workerId: 'canary',
      nowIso: NOW,
      batchSize: 10,
      maxBatches: 3,
      concurrency: 1,
      globalConcurrency: 1,
      perHostConcurrency: 1,
      timeBudgetMs: 20_000,
      writesAllowed: true,
      onlyHashes: new Set([queued.hash_url]),
      windowStart: WS,
      windowEnd: WE,
      fetchExtract: async () =>
        okExtract({
          titulo: 'Canario Ultra',
          resumen: 'resumen canario',
          texto_extraido: 'RAW body text for article admission. '.repeat(8),
          texto_nota_limpia: 'UNAM SUAyED en el cuerpo. '.repeat(8),
          texto_cuerpo_nota: 'UNAM SUAyED en el cuerpo. '.repeat(8),
          calidad_extraccion: 'alta',
          tipo_nota: 'Educación',
        }),
      persistNews: async () => ({ noticiaId: 'bf0388f9-6905-4f58-9934-94679215410a', outcome: 'inserted' }),
    });
    expect(drain.NEW_WRITES_THIS_RUN).toBe(1);
    expect(drain.RECOVERY_PERSISTED_GLOBAL).toBe(21);
    expect(drain.RECOVERY_PERSISTED).toBe(21);
    expect(drain.NEW_WRITES_THIS_RUN).not.toBe(drain.RECOVERY_PERSISTED_GLOBAL);
    expect(() => assertCanaryWriteBudget(new Set([queued.hash_url]), 2)).toThrow(/CANARY_WRITE_OVERFLOW/);
  });

  it('0021 SQL is additive, skip-locked, and service_role only', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const sql = readFileSync(resolve(import.meta.dirname, '../supabase/migrations/0021_coverage_debt_claim.sql'), 'utf8');
    expect(sql).toContain('claim_capture_source_incomplete_batch');
    expect(sql.toLowerCase()).toContain('for update skip locked');
    expect(sql).toContain('grant execute');
    expect(sql).toContain('service_role');
    expect(sql).toContain('revoke all');
    expect(sql).toContain('from public, anon, authenticated');
    expect(sql).not.toMatch(/grant execute[^\n]+anon/i);
  });

  it('read-only SOLO_GOOGLE sample classifies follow-up without Google redirect', () => {
    expect(SOLO_GOOGLE_SAMPLE).toHaveLength(11);
    for (const row of SOLO_GOOGLE_SAMPLE) {
      expect(classifySoloGoogleFollowUp(row)).toBe(row.path);
      expect(row.url).not.toContain('news.google.com');
    }
    const grouped = groupSoloGoogleSample();
    expect(grouped.pagination).toHaveLength(3);
    expect(grouped.secondSurface).toHaveLength(5);
    expect(grouped.probe).toHaveLength(2);
    expect(grouped.unresolved).toHaveLength(1);
    expect(grouped.unresolved[0]?.medio_id).toBe('MED-0027');
  });

  it('increment after max attempts is explicit escalation, not silent automatic', async () => {
    const store = new MemoryCaptureReliabilityStore();
    const { st } = await seedDebt(store, 'MED-X', { last_error: 'SOURCE_TIMEOUT' });
    await incrementCoverageDebtAttempt(store, st, NOW);
    await incrementCoverageDebtAttempt(store, st, NOW);
    const third = await incrementCoverageDebtAttempt(store, st, NOW);
    expect(third?.lifecycle).toBe('ESCALATED_MANUAL');
    expect(third?.automatic).toBe(false);
    expect(isSilentExhaustedDebt(third)).toBe(false);
  });
});
