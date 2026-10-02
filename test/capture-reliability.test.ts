import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { admitDiscoveredArticle } from '../src/captureReliability/articleAdmission.js';
import { rssWindowCompleteness } from '../src/captureReliability/rssWindow.js';
import { applySitemapWindow } from '../src/captureReliability/sitemapWindow.js';
import { classifyFetchFailure, nextBackoffSeconds } from '../src/captureReliability/retry.js';
import { decideDiscoveredUrl, decideFetchError, unionDiscovery } from '../src/captureReliability/reconcile.js';
import { lakeHasUrl, primaryHash, captureCanonicalUrl } from '../src/captureReliability/urlIndex.js';
import { lookupExistingNewsByHashes, type LakeRow } from '../src/captureReliability/lakeLookup.js';
import { resolveSourceForUrl } from '../src/captureReliability/sourceResolve.js';
import {
  createJsonCaptureRecoveryRepository,
  MemoryCaptureReliabilityStore,
  type CaptureReliabilityStore,
} from '../src/captureReliability/captureRecoveryRepository.js';
import { runReconcileEngine, type SourceDiscovery } from '../src/captureReliability/engine.js';
import { processRecoveryRecord } from '../src/captureReliability/recoveryWorker.js';
import { recoveryWritesAllowed } from '../src/captureReliability/writesGuard.js';
import { baseRecoveryRecord } from '../src/captureReliability/reconcile.js';
import { shardCatalog } from '../src/captureReliability/catalog.js';
import type { ChannelCatalogRow, DiscoveredUrl } from '../src/captureReliability/types.js';
import type { FetchExtractResult } from '../src/extractors/html.js';
import type { NoticiaInsert } from '../src/normalizers/noticia.js';

const AFONDO =
  'https://afondojalisco.com/monreal-arropa-a-mery-pozos-durante-su-informe-fortalece-su-presencia-rumbo-a-guadalajara/';
const CONCIENCIA = 'https://concienciapublica.com.mx/2026/10/02/monreal-mery-pozos/';
const ENTORNO =
  'https://entornoinformativo.com.mx/plantea-fortalecer-presupuesto-a-universidades-publicas-la-rectora-de-unison-dena-maria-camarena/';

const W24 = { start: '2026-10-01T18:00:00.000Z', end: '2026-10-02T18:00:00.000Z' };
const W72 = { start: '2026-09-29T18:00:00.000Z', end: '2026-10-02T18:00:00.000Z' };
const NOW = '2026-10-02T18:00:00.000Z';

function disc(over: Partial<DiscoveredUrl> & { url: string }): DiscoveredUrl {
  return {
    canonicalUrl: captureCanonicalUrl(over.url),
    hashUrl: primaryHash(over.url),
    medioId: over.medioId ?? 'MED-0202',
    fuenteId: null,
    hostname: over.hostname ?? 'afondojalisco.com',
    discoveredVia: over.discoveredVia ?? 'rss',
    publishedAt: over.publishedAt ?? '2026-10-02T14:20:00.000Z',
    titulo: over.titulo ?? 'Nota',
    resumen: over.resumen ?? null,
    body: over.body ?? null,
    ...over,
  };
}

function row(id: string, host: string, extra: Partial<ChannelCatalogRow> = {}): ChannelCatalogRow {
  return {
    medio_id: id,
    url_base: `https://${host}/`,
    rss_url: extra.rss_url === undefined ? `https://${host}/feed` : extra.rss_url,
    sitemap_url: extra.sitemap_url === undefined ? null : extra.sitemap_url,
    hostname: host,
    ...extra,
  };
}

function okExtract(over: Partial<FetchExtractResult> = {}): FetchExtractResult {
  const body = over.texto_cuerpo_nota ?? 'Cuerpo editorial válido de la nota recuperada. '.repeat(12);
  return {
    error: null,
    titulo: over.titulo === undefined ? 'Titulo recuperado' : over.titulo,
    resumen: over.resumen === undefined ? 'Resumen' : over.resumen,
    texto_extraido: body,
    texto_nota_limpia: body,
    extracto_nota_1300: body.slice(0, 200),
    calidad_extraccion: 'alta',
    texto_limpio_chars: body.length,
    texto_cuerpo_nota: body,
    extracto_cuerpo_1300: body.slice(0, 200),
    cuerpo_nota_chars: body.length,
    tipo_nota: null,
    imagen: null,
    autor: null,
    seccion: null,
    metodo_titulo: 'html_og',
    metodo_texto: 'html_article',
    ...over,
    ok: over.ok ?? true,
  };
}

function discoveryFor(urls: DiscoveredUrl[], over: Partial<SourceDiscovery> = {}): SourceDiscovery {
  return {
    urls,
    surfaces: over.surfaces ?? ['rss', 'sitemap'],
    rssSpanCovered: over.rssSpanCovered ?? 'YES',
    sitemapSpanCovered: over.sitemapSpanCovered ?? 'YES',
    listingSpanCovered: over.listingSpanCovered ?? 'UNKNOWN',
    sitemapRuntimeCompletenessInvoked: over.sitemapRuntimeCompletenessInvoked ?? true,
    capHit: over.capHit ?? false,
    noDiscoverySurface: over.noDiscoverySurface ?? false,
  };
}

async function runEngine(opts: {
  catalog: ChannelCatalogRow[];
  store?: CaptureReliabilityStore;
  discover: (row: ChannelCatalogRow) => SourceDiscovery | Promise<SourceDiscovery>;
  lake?: LakeRow[];
  maxSourcesThisRun?: number;
  safetyCap?: number;
  timeBudgetMs?: number;
  nowMs?: number;
  startedMs?: number;
  processRecovery?: boolean;
  dryRun?: boolean;
  allowWritesEnv?: string | null;
  gapCandidates?: { discovered_url: string; publisher_final_url: string | null; hostname: string | null; discovered_via: string; discovered_at: string }[];
  fetchExtract?: (url: string) => Promise<FetchExtractResult>;
  persistNews?: (item: NoticiaInsert) => Promise<{ noticiaId: string | null; inserted: boolean }>;
  window?: { start: string; end: string };
  shardIndex?: number;
  shardCount?: number;
  runId?: string;
}) {
  const store = opts.store ?? new MemoryCaptureReliabilityStore();
  const lake = opts.lake ?? [];
  const report = await runReconcileEngine(
    {
      runId: opts.runId ?? 'r1',
      mode: '24h',
      windowStart: (opts.window ?? W24).start,
      windowEnd: (opts.window ?? W24).end,
      shardIndex: opts.shardIndex ?? 0,
      shardCount: opts.shardCount ?? 1,
      workerId: 'test-worker',
      maxSourcesThisRun: opts.maxSourcesThisRun ?? 10_000,
      safetyCap: opts.safetyCap ?? 10_000,
      timeBudgetMs: opts.timeBudgetMs ?? 60_000,
      processRecovery: opts.processRecovery ?? false,
      dryRun: opts.dryRun ?? true,
      allowWritesEnv: opts.allowWritesEnv ?? null,
      gapCandidates: opts.gapCandidates,
      nowIso: NOW,
      nowMs: opts.nowMs,
      startedMs: opts.startedMs,
    },
    {
      store,
      catalog: opts.catalog,
      discoverSource: async (row) => opts.discover(row),
      queryLakeHashes: async (hashes) => lake.filter((r) => hashes.includes(r.hash_url)),
      fetchExtract: opts.fetchExtract,
      persistNews: opts.persistNews,
    },
  );
  return { report, store };
}

describe('Capture reliability V3', () => {
  it('T1 full-catalog pagination/sharding', async () => {
    const catalog = Array.from({ length: 30 }, (_, i) => row(`MED-${String(i).padStart(4, '0')}`, `s${i}.example.com`));
    const store = new MemoryCaptureReliabilityStore();
    const discover = (r: ChannelCatalogRow) =>
      discoveryFor([disc({ url: `https://${r.hostname}/nota-larga-de-prueba-${r.medio_id}/`, medioId: r.medio_id, hostname: r.hostname! })]);
    const a = await runEngine({ catalog, store, discover, maxSourcesThisRun: 10, runId: 'a' });
    expect(a.report.TOTAL_ACTIVE_SOURCES).toBe(30);
    expect(a.report.SOURCES_PROCESSED + a.report.SOURCES_PENDING).toBe(30);
    const b = await runEngine({ catalog, store, discover, maxSourcesThisRun: 10, runId: 'b' });
    expect(b.report.SOURCES_PROCESSED + b.report.SOURCES_PENDING).toBe(30);
    const c = await runEngine({ catalog, store, discover, maxSourcesThisRun: 10, runId: 'c' });
    expect(c.report.SOURCES_PENDING).toBe(0);
    expect(c.report.SOURCES_PROCESSED).toBe(30);
    expect(shardCatalog(catalog, 0, 3).length + shardCatalog(catalog, 1, 3).length + shardCatalog(catalog, 2, 3).length).toBe(30);
  });

  it('T2 process restart persistence', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'caprel-'));
    const path = join(dir, 'store.json');
    const catalog = [row('MED-0001', 'a.com'), row('MED-0002', 'b.com')];
    const discover = (r: ChannelCatalogRow) =>
      discoveryFor([disc({ url: `https://${r.hostname}/articulo-persistente-restart/`, medioId: r.medio_id, hostname: r.hostname! })]);
    const store1 = createJsonCaptureRecoveryRepository(path);
    await runEngine({ catalog, store: store1, discover, maxSourcesThisRun: 1 });
    const store2 = createJsonCaptureRecoveryRepository(path);
    const r2 = await runEngine({ catalog, store: store2, discover, maxSourcesThisRun: 1, runId: 'r2' });
    expect(r2.report.SOURCES_PROCESSED).toBe(2);
    expect(r2.report.SOURCES_PENDING).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it('T3 DB queue survives restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'caprelq-'));
    const path = join(dir, 'store.json');
    const store1 = createJsonCaptureRecoveryRepository(path);
    const rec = baseRecoveryRecord(disc({ url: ENTORNO, medioId: 'MED-0441', hostname: 'entornoinformativo.com.mx' }), NOW);
    rec.status = 'QUEUED';
    await store1.upsertDiscovered(rec);
    const store2 = createJsonCaptureRecoveryRepository(path);
    const loaded = await store2.get(rec.hash_url);
    expect(loaded?.status).toBe('QUEUED');
    expect(loaded?.canonical_url).toBe(captureCanonicalUrl(ENTORNO));
    rmSync(dir, { recursive: true, force: true });
  });

  it('T4 checkpoint survives restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'caprelc-'));
    const path = join(dir, 'store.json');
    const catalog = [row('MED-0001', 'a.com'), row('MED-0002', 'b.com'), row('MED-0003', 'c.com')];
    const discover = (r: ChannelCatalogRow) =>
      discoveryFor([disc({ url: `https://${r.hostname}/nota-checkpoint-durable-ok/`, medioId: r.medio_id, hostname: r.hostname! })]);
    const s1 = createJsonCaptureRecoveryRepository(path);
    await runEngine({ catalog, store: s1, discover, maxSourcesThisRun: 1 });
    const s2 = createJsonCaptureRecoveryRepository(path);
    const st = await s2.getSourceState('MED-0001', W24.start, W24.end);
    expect(st).not.toBeNull();
    expect(st?.status === 'COMPLETE' || st?.status === 'INCOMPLETE').toBe(true);
    const r2 = await runEngine({ catalog, store: s2, discover, maxSourcesThisRun: 10, runId: 'cont' });
    expect(r2.report.SOURCES_PENDING).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it('T5 lake lookup works arbitrary hostname', async () => {
    const url = 'https://random-publisher.example/una-nota-cualquiera-de-prueba/';
    const rowLake: LakeRow = {
      hash_url: primaryHash(url),
      url_original: url,
      url_canonica: captureCanonicalUrl(url),
      texto_cuerpo_nota: 'x'.repeat(80),
      texto_nota_limpia: 'x'.repeat(80),
    };
    const map = await lookupExistingNewsByHashes([url], async (hashes) => (hashes.includes(rowLake.hash_url) ? [rowLake] : []));
    expect(map.get(captureCanonicalUrl(url))?.hash_url).toBe(rowLake.hash_url);
  });

  it('T6 50 known + 50 missing exact', async () => {
    const urls = Array.from({ length: 100 }, (_, i) => `https://medio.example/nota-lookup-${i}-suficientemente-larga/`);
    const known = urls.slice(0, 50);
    const lake: LakeRow[] = known.map((u) => ({
      hash_url: primaryHash(u),
      url_original: u,
      url_canonica: captureCanonicalUrl(u),
      texto_cuerpo_nota: 'body'.repeat(20),
      texto_nota_limpia: 'body'.repeat(20),
    }));
    const catalog = [row('MED-9', 'medio.example')];
    const map = await lookupExistingNewsByHashes(urls, async (hashes) => lake.filter((r) => hashes.includes(r.hash_url)));
    let k = 0;
    let q = 0;
    for (const u of urls) {
      const dec = decideDiscoveredUrl(disc({ url: u, medioId: 'MED-9', hostname: 'medio.example' }), {
        nowIso: NOW,
        lakeByCanonical: map,
        catalog,
      });
      if (dec.record.status === 'KNOWN_IN_LAKE') k += 1;
      if (dec.record.status === 'QUEUED') q += 1;
    }
    expect(k).toBe(50);
    expect(q).toBe(50);
  });

  it('T7 duplicate host ambiguity', () => {
    const catalog = [
      row('MED-0119', 'concienciapublica.com.mx'),
      row('MED-0201', 'concienciapublica.com.mx'),
    ];
    const r = resolveSourceForUrl(CONCIENCIA, catalog);
    expect(r.kind).toBe('ambiguous');
    const dec = decideDiscoveredUrl(disc({ url: CONCIENCIA, medioId: null, hostname: 'concienciapublica.com.mx' }), {
      nowIso: NOW,
      lakeByCanonical: new Map(),
      catalog,
    });
    expect(dec.record.status).toBe('AMBIGUOUS_SOURCE');
  });

  it('T8 RSS truncated marked non-complete', async () => {
    const catalog = [row('MED-1', 'feed.example')];
    const { report } = await runEngine({
      catalog,
      discover: () =>
        discoveryFor(
          [disc({ url: 'https://feed.example/nota-reciente-solamente/', medioId: 'MED-1', hostname: 'feed.example' })],
          { surfaces: ['rss'], rssSpanCovered: 'NO', sitemapRuntimeCompletenessInvoked: false },
        ),
    });
    expect(report.SOURCES_COMPLETE).toBe(0);
    expect(report.sourceStates[0]?.rss_span_covered).toBe('NO');
    expect(report.sourceStates[0]?.complete).toBe(false);
    expect(rssWindowCompleteness([{ publishedAt: '2026-10-02T16:00:00.000Z' }], W24.start, W24.end).flag).toBe('NO');
  });

  it('T9 source no RSS/sitemap marked incomplete', async () => {
    const catalog = [row('MED-X', 'bare.example', { rss_url: null, sitemap_url: null })];
    const { report } = await runEngine({
      catalog,
      discover: () => ({
        urls: [],
        surfaces: [],
        rssSpanCovered: 'UNKNOWN',
        sitemapSpanCovered: 'UNKNOWN',
        listingSpanCovered: 'UNKNOWN',
        sitemapRuntimeCompletenessInvoked: false,
        capHit: false,
        noDiscoverySurface: true,
      }),
    });
    expect(report.sourceStates[0]?.discovery_surfaces).toContain('NO_DISCOVERY_SURFACE');
    expect(report.sourceStates[0]?.complete).toBe(false);
    expect(report.RECONCILIATION_COMPLETE).toBe(false);
  });

  it('T10 sitemap window actually enforced', () => {
    const r = applySitemapWindow({
      items: [
        { url: 'https://x.com/old-nota-fuera-de-ventana/', fecha: '2026-09-01T00:00:00.000Z' },
        { url: 'https://x.com/new-nota-dentro-de-ventana/', fecha: '2026-10-02T10:00:00.000Z' },
      ],
      windowStart: W24.start,
      windowEnd: W24.end,
      paginationComplete: true,
      indexFollowed: true,
      capHit: false,
    });
    expect(r.items.map((i) => i.url)).toEqual(['https://x.com/new-nota-dentro-de-ventana/']);
    expect(r.datedInWindow).toBe(1);
  });

  it('T11 sitemap completeness runtime invoked', () => {
    const r = applySitemapWindow({
      items: [{ url: 'https://x.com/nota/', fecha: '2026-10-02T10:00:00.000Z' }],
      windowStart: W24.start,
      windowEnd: W24.end,
      paginationComplete: true,
      indexFollowed: true,
      capHit: false,
    });
    expect(r.sitemapRuntimeCompletenessInvoked).toBe(true);
    expect(r.completeness).toBe('YES');
  });

  it('T12 safety cap persists continuation', async () => {
    const catalog = [row('MED-1', 'a.com'), row('MED-2', 'b.com')];
    const store = new MemoryCaptureReliabilityStore();
    const discover = (r: ChannelCatalogRow) =>
      discoveryFor(
        Array.from({ length: 5 }, (_, i) =>
          disc({ url: `https://${r.hostname}/cap-nota-${i}-articulo-largo/`, medioId: r.medio_id, hostname: r.hostname! }),
        ),
      );
    const a = await runEngine({ catalog, store, discover, safetyCap: 3, maxSourcesThisRun: 10 });
    expect(a.report.CAP_HIT).toBe(true);
    expect(a.report.SOURCES_PENDING + a.report.SOURCES_PROCESSED).toBe(2);
    const queued = (await store.snapshot()).filter((r) => r.status === 'QUEUED' || r.status === 'KNOWN_IN_LAKE');
    expect(queued.length).toBeGreaterThan(0);
    const b = await runEngine({ catalog, store, discover, safetyCap: 1000, runId: 'b' });
    expect(b.report.TOTAL_ACTIVE_SOURCES).toBe(2);
  });

  it('T13 time budget persists continuation', async () => {
    const catalog = [row('MED-1', 'a.com'), row('MED-2', 'b.com')];
    const clock = { t: 0 };
    const store = new MemoryCaptureReliabilityStore();
    const discover = async (r: ChannelCatalogRow) => {
      clock.t += 1000;
      return discoveryFor([disc({ url: `https://${r.hostname}/budget-nota-larga/`, medioId: r.medio_id, hostname: r.hostname! })]);
    };
    const optsBase = {
      catalog,
      store,
      discover,
      timeBudgetMs: 500,
      startedMs: 0,
    };
    const a = await runReconcileEngine(
      {
        runId: 'tb',
        mode: '24h',
        windowStart: W24.start,
        windowEnd: W24.end,
        shardIndex: 0,
        shardCount: 1,
        workerId: 'w',
        maxSourcesThisRun: 10,
        safetyCap: 1000,
        timeBudgetMs: 500,
        processRecovery: false,
        dryRun: true,
        nowIso: NOW,
        get nowMs() {
          return clock.t;
        },
        startedMs: 0,
      },
      {
        store,
        catalog,
        discoverSource: discover,
        queryLakeHashes: async () => [],
      },
    );
    expect(a.TIME_BUDGET_HIT || a.SOURCES_PENDING > 0).toBe(true);
    expect(a.TOTAL_ACTIVE_SOURCES).toBe(a.SOURCES_PROCESSED + a.SOURCES_PENDING);
    void optsBase;
  });

  it('T14 429 retry', () => {
    const rec = decideFetchError(baseRecoveryRecord(disc({ url: AFONDO }), NOW), { httpStatus: 429 });
    expect(rec.record.status).toBe('RETRY');
    expect(classifyFetchFailure({ httpStatus: 429 })).toBe('RETRY');
  });

  it('T15 503 retry', () => {
    expect(decideFetchError(baseRecoveryRecord(disc({ url: AFONDO }), NOW), { httpStatus: 503 }).record.status).toBe('RETRY');
  });

  it('T16 timeout retry', () => {
    expect(decideFetchError(baseRecoveryRecord(disc({ url: AFONDO }), NOW), { httpStatus: null, timeout: true }).record.status).toBe(
      'RETRY',
    );
  });

  it('T17 403 blocked', () => {
    expect(decideFetchError(baseRecoveryRecord(disc({ url: AFONDO }), NOW), { httpStatus: 403 }).record.status).toBe('BLOCKED');
  });

  it('T18 max retries terminal', () => {
    const rec = baseRecoveryRecord(disc({ url: AFONDO }), NOW);
    rec.attempt_count = 7;
    const d = decideFetchError(rec, { httpStatus: 503 }, 8);
    expect(d.record.status).toBe('FAILED_RETRY_EXHAUSTED');
    expect(nextBackoffSeconds(8)).toBeNull();
  });

  it('T19 title NULL valid article recoverable', async () => {
    const store = new MemoryCaptureReliabilityStore();
    const rec = { ...baseRecoveryRecord(disc({ url: ENTORNO, medioId: 'MED-0441' }), NOW), status: 'QUEUED' as const };
    await store.upsertDiscovered(rec);
    const claimed = (await store.claimBatch({ workerId: 'w', limit: 1, nowIso: NOW }))[0]!;
    const out = await processRecoveryRecord({
      record: claimed,
      store,
      fetchExtract: async () => okExtract({ titulo: null }),
      writesAllowed: false,
      nowIso: NOW,
    });
    expect(out.status).toBe('WOULD_PERSIST');
    expect(admitDiscoveredArticle({ url: ENTORNO, medioId: 'MED-0441', titulo: null, body: 'x'.repeat(100) }).admit).toBe(true);
  });

  it('T20 resumen NULL valid article recoverable', async () => {
    const store = new MemoryCaptureReliabilityStore();
    const rec = { ...baseRecoveryRecord(disc({ url: ENTORNO, medioId: 'MED-0441' }), NOW), status: 'QUEUED' as const };
    await store.upsertDiscovered(rec);
    const claimed = (await store.claimBatch({ workerId: 'w', limit: 1, nowIso: NOW }))[0]!;
    const out = await processRecoveryRecord({
      record: claimed,
      store,
      fetchExtract: async () => okExtract({ resumen: null }),
      writesAllowed: false,
      nowIso: NOW,
    });
    expect(out.status).toBe('WOULD_PERSIST');
  });

  it('T21 known URL no duplicate', () => {
    const hash = primaryHash(AFONDO);
    const lake = new Map<string, LakeRow | null>([
      [
        captureCanonicalUrl(AFONDO),
        { hash_url: hash, url_original: AFONDO, url_canonica: captureCanonicalUrl(AFONDO), texto_cuerpo_nota: 'b'.repeat(50), texto_nota_limpia: 'b'.repeat(50) },
      ],
    ]);
    const dec = decideDiscoveredUrl(disc({ url: AFONDO }), { nowIso: NOW, lakeByCanonical: lake, catalog: [row('MED-0202', 'afondojalisco.com')] });
    expect(dec.action).toBe('SKIP_KNOWN');
  });

  it('T22 tracked URL no duplicate', () => {
    expect(lakeHasUrl(new Set([primaryHash(AFONDO)]), `${AFONDO}?utm_source=google&fbclid=abc`)).toBe(true);
  });

  it('T23 RSS+sitemap same URL one queue row', async () => {
    const u = unionDiscovery([
      [disc({ url: CONCIENCIA, medioId: 'MED-0201', discoveredVia: 'rss' })],
      [disc({ url: CONCIENCIA, medioId: 'MED-0201', discoveredVia: 'sitemap' })],
    ]);
    expect(u).toHaveLength(1);
    const store = new MemoryCaptureReliabilityStore();
    const catalog = [row('MED-0201', 'concienciapublica.com.mx')];
    await runEngine({
      catalog,
      store,
      discover: () => discoveryFor(u),
    });
    const snap = await store.snapshot();
    expect(snap.filter((r) => r.canonical_url === captureCanonicalUrl(CONCIENCIA))).toHaveLength(1);
  });

  it('T24 cron gap 6h E2E', async () => {
    const news: NoticiaInsert[] = [];
    const catalog = [row('MED-0202', 'afondojalisco.com', { sitemap_url: 'https://afondojalisco.com/sitemap.xml' })];
    const url = 'https://afondojalisco.com/nota-cron-gap-6h-recuperable/';
    const store = new MemoryCaptureReliabilityStore();
    await runEngine({
      catalog,
      store,
      discover: () =>
        discoveryFor([disc({ url, medioId: 'MED-0202', publishedAt: '2026-10-02T12:00:00.000Z' })]),
      processRecovery: false,
    });
    expect((await store.byStatus('QUEUED')).length).toBe(1);
    const r2 = await runEngine({
      catalog,
      store,
      discover: () => discoveryFor([]),
      processRecovery: true,
      dryRun: false,
      allowWritesEnv: 'true',
      fetchExtract: async () => okExtract(),
      persistNews: async (item) => {
        news.push(item);
        return { noticiaId: 'n-6h', inserted: true };
      },
      runId: 'b',
    });
    expect(news).toHaveLength(1);
    expect(r2.report.PRODUCTION_RECOVERY_WRITES).toBe(1);
    expect((await store.snapshot())[0]?.status).toBe('PERSISTED');
  });

  it('T25 cron gap 26h E2E', async () => {
    const news: NoticiaInsert[] = [];
    const catalog = [row('MED-0441', 'entornoinformativo.com.mx')];
    const store = new MemoryCaptureReliabilityStore();
    await runEngine({
      catalog,
      store,
      window: W72,
      discover: () =>
        discoveryFor([
          disc({
            url: ENTORNO,
            medioId: 'MED-0441',
            hostname: 'entornoinformativo.com.mx',
            publishedAt: '2026-10-01T10:00:00.000Z',
          }),
        ]),
      processRecovery: true,
      dryRun: false,
      allowWritesEnv: 'true',
      fetchExtract: async () => okExtract(),
      persistNews: async (item) => {
        news.push(item);
        return { noticiaId: 'n-26h', inserted: true };
      },
    });
    expect(news).toHaveLength(1);
    expect(news[0]?.url_original).toBe(ENTORNO);
  });

  it('T26 process crash between QUEUED/FETCHING', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'caprelcrash-'));
    const path = join(dir, 'store.json');
    const s1 = createJsonCaptureRecoveryRepository(path);
    const rec = { ...baseRecoveryRecord(disc({ url: ENTORNO, medioId: 'MED-0441' }), NOW), status: 'QUEUED' as const };
    await s1.upsertDiscovered(rec);
    await s1.claimBatch({ workerId: 'w', limit: 1, nowIso: NOW });
    const s2 = createJsonCaptureRecoveryRepository(path);
    const loaded = await s2.get(rec.hash_url);
    expect(loaded?.status).toBe('FETCHING');
    rmSync(dir, { recursive: true, force: true });
  });

  it('T27 stale claim recovery', async () => {
    const store = new MemoryCaptureReliabilityStore();
    const rec = { ...baseRecoveryRecord(disc({ url: ENTORNO, medioId: 'MED-0441' }), NOW), status: 'QUEUED' as const };
    await store.upsertDiscovered(rec);
    await store.claimBatch({ workerId: 'w', limit: 1, nowIso: '2026-10-02T17:00:00.000Z' });
    const n = await store.releaseStaleClaims('2026-10-02T17:30:00.000Z');
    expect(n).toBe(1);
    expect((await store.get(rec.hash_url))?.status).toBe('QUEUED');
  });

  it('T28 Entorno exact URL dry-run recovery', async () => {
    const catalog = [row('MED-0441', 'entornoinformativo.com.mx', { sitemap_url: null })];
    const { report, store } = await runEngine({
      catalog,
      discover: () => discoveryFor([], { surfaces: ['rss'], rssSpanCovered: 'NO', sitemapRuntimeCompletenessInvoked: false }),
      gapCandidates: [
        {
          discovered_url: ENTORNO,
          publisher_final_url: ENTORNO,
          hostname: 'entornoinformativo.com.mx',
          discovered_via: 'gap_candidate',
          discovered_at: NOW,
        },
      ],
      processRecovery: true,
      dryRun: true,
      fetchExtract: async (url) => {
        expect(url).toBe(ENTORNO);
        return okExtract({ titulo: null, resumen: null });
      },
    });
    const rec = (await store.snapshot()).find((r) => r.discovered_url === ENTORNO);
    expect(rec?.status).toBe('WOULD_PERSIST');
    expect(rec?.medio_id).toBe('MED-0441');
    expect(report.PRODUCTION_RECOVERY_WRITES).toBe(0);
  });

  it('T29 A Fondo remains deduped', () => {
    const lake = new Map<string, LakeRow | null>([
      [
        captureCanonicalUrl(AFONDO),
        {
          hash_url: primaryHash(AFONDO),
          url_original: AFONDO,
          url_canonica: captureCanonicalUrl(AFONDO),
          texto_cuerpo_nota: 'presente'.repeat(10),
          texto_nota_limpia: 'presente'.repeat(10),
        },
      ],
    ]);
    const dec = decideDiscoveredUrl(disc({ url: AFONDO }), {
      nowIso: NOW,
      lakeByCanonical: lake,
      catalog: [row('MED-0202', 'afondojalisco.com')],
    });
    expect(dec.action).toBe('SKIP_KNOWN');
    expect(dec.record.root_cause).not.toBe('CRON_GAP');
  });

  it('T30 Conciencia remains deduped', () => {
    const lake = new Map<string, LakeRow | null>([
      [
        captureCanonicalUrl(CONCIENCIA),
        {
          hash_url: primaryHash(CONCIENCIA),
          url_original: CONCIENCIA,
          url_canonica: captureCanonicalUrl(CONCIENCIA),
          texto_cuerpo_nota: 'presente'.repeat(10),
          texto_nota_limpia: 'presente'.repeat(10),
        },
      ],
    ]);
    const dec = decideDiscoveredUrl(disc({ url: CONCIENCIA, medioId: 'MED-0201', hostname: 'concienciapublica.com.mx' }), {
      nowIso: NOW,
      lakeByCanonical: lake,
      catalog: [row('MED-0201', 'concienciapublica.com.mx')],
    });
    expect(dec.action).toBe('SKIP_KNOWN');
  });

  it('T31 Agent B untouched', () => {
    const ingest = readFileSync('scripts/capture-reconcile.ts', 'utf8');
    expect(ingest).not.toMatch(/mentions-master-fast-lane/);
    expect(ingest).not.toMatch(/detect-mentions/);
    expect(ingest).not.toMatch(/keywords/);
    const engine = readFileSync('src/captureReliability/engine.ts', 'utf8');
    expect(engine).not.toMatch(/afondojalisco\.com/);
    expect(engine).not.toMatch(/googleItems/);
  });

  it('T32 sends zero', () => {
    const ingest = readFileSync('scripts/capture-reconcile.ts', 'utf8');
    expect(ingest).not.toMatch(/send-internal-alerts|whatsapp|twilio|nodemailer/i);
    expect(recoveryWritesAllowed({ dryRun: true, allowEnv: 'true' })).toBe(false);
    expect(recoveryWritesAllowed({ dryRun: false, allowEnv: null })).toBe(false);
    expect(recoveryWritesAllowed({ dryRun: false, allowEnv: 'true' })).toBe(true);
  });
});
