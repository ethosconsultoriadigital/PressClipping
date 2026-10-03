import { describe, expect, it } from 'vitest';
import { buildRecoveredNewsPayload } from '../src/captureReliability/recoveryPayload.js';
import { processRecoveryRecord } from '../src/captureReliability/recoveryWorker.js';
import { MemoryCaptureReliabilityStore } from '../src/captureReliability/captureRecoveryRepository.js';
import { baseRecoveryRecord } from '../src/captureReliability/reconcile.js';
import { primaryHash, captureCanonicalUrl } from '../src/captureReliability/urlIndex.js';
import { discoveryCoverageVerdict } from '../src/captureReliability/coverage.js';
import { classifyPreFetch } from '../src/captureReliability/articleAdmission.js';
import { classifySchemaPresence } from '../src/captureReliability/schemaReady.js';
import { gapCandidateFromUrl } from '../src/captureReliability/gapCandidates.js';
import { decideDiscoveredUrl } from '../src/captureReliability/reconcile.js';
import { configuredSurfaceKinds } from '../src/captureReliability/catalog.js';
import { runReconcileEngine } from '../src/captureReliability/engine.js';
import { selectTrustedBody } from '../src/matching/trustedBody.js';
import type { FetchExtractResult } from '../src/extractors/html.js';
import type { DiscoveredUrl } from '../src/captureReliability/types.js';

const ENTORNO =
  'https://entornoinformativo.com.mx/plantea-fortalecer-presupuesto-a-universidades-publicas-la-rectora-de-unison-dena-maria-camarena/';
const NOW = '2026-10-02T18:00:00.000Z';
const MERY = 'Merilyn Gómez Pozos presentó la propuesta presupuestal de la universidad pública en Sonora. '.repeat(4);

function extract(over: Partial<FetchExtractResult> = {}): FetchExtractResult {
  const raw = 'RAW MENU teaser no usar para matching ' + MERY;
  const clean = MERY;
  return {
    ok: true,
    error: null,
    titulo: 'Plantea fortalecer presupuesto a universidades públicas',
    resumen: 'La rectora habló del presupuesto.',
    texto_extraido: raw,
    texto_nota_limpia: clean,
    extracto_nota_1300: clean.slice(0, 200),
    calidad_extraccion: 'alta',
    texto_limpio_chars: clean.length,
    texto_cuerpo_nota: clean,
    extracto_cuerpo_1300: clean.slice(0, 200),
    cuerpo_nota_chars: clean.length,
    tipo_nota: 'Política',
    imagen: null,
    autor: null,
    seccion: 'Educación',
    metodo_titulo: 'html_og',
    metodo_texto: 'html_article',
    ...over,
  };
}

function disc(url: string): DiscoveredUrl {
  return {
    url,
    canonicalUrl: captureCanonicalUrl(url),
    hashUrl: primaryHash(url),
    medioId: 'MED-0441',
    fuenteId: null,
    hostname: 'entornoinformativo.com.mx',
    discoveredVia: 'gap_candidate',
    publishedAt: '2026-10-02T12:00:00.000Z',
    titulo: 'titulo discovery',
    resumen: 'resumen discovery',
    body: null,
  };
}

describe('Capture reliability V4', () => {
  it('T33 recovered article persists trusted clean/body fields', () => {
    const payload = buildRecoveredNewsPayload({
      url: ENTORNO,
      medioId: 'MED-0441',
      extract: extract(),
      publishedAt: '2026-10-02T12:00:00.000Z',
    });
    expect(payload.insert.texto_extraido).toContain('RAW MENU');
    expect(payload.insert.texto_extraido).not.toBe(payload.enrichment.texto_cuerpo_nota);
    expect(payload.enrichment.texto_cuerpo_nota).toContain('Merilyn Gómez Pozos');
    expect(payload.enrichment.texto_nota_limpia).toContain('Merilyn Gómez Pozos');
    expect(payload.enrichment.calidad_extraccion).toBe('alta');
    expect(payload.enrichment.tipo_nota).toBe('Política');
  });

  it('T34 Entorno recovered BODY contains Merilyn outside RAW contract', () => {
    const payload = buildRecoveredNewsPayload({ url: ENTORNO, medioId: 'MED-0441', extract: extract() });
    const trusted = selectTrustedBody(
      {
        texto_cuerpo_nota: payload.enrichment.texto_cuerpo_nota,
        texto_nota_limpia: payload.enrichment.texto_nota_limpia,
        texto_extraido: payload.insert.texto_extraido,
        calidad_extraccion: payload.enrichment.calidad_extraccion,
      },
      'body_high',
    );
    expect(trusted.status).toBe('BODY_TRUSTED');
    expect(trusted.campo).toBe('texto_cuerpo_nota');
    expect(trusted.text).toContain('Merilyn Gómez Pozos');
    expect(trusted.text).not.toContain('RAW MENU');
  });

  it('T35 post-persist returns actual noticia_id', async () => {
    const store = new MemoryCaptureReliabilityStore();
    const rec = { ...baseRecoveryRecord(disc(ENTORNO), NOW), status: 'QUEUED' as const };
    await store.upsertDiscovered(rec);
    const claimed = (await store.claimBatch({ workerId: 'w', limit: 1, nowIso: NOW }))[0]!;
    const out = await processRecoveryRecord({
      record: claimed,
      store,
      fetchExtract: async () => extract(),
      writesAllowed: true,
      persistNews: async () => ({ noticiaId: 'not-real-1', outcome: 'inserted' }),
      nowIso: NOW,
    });
    expect(out.status).toBe('PERSISTED');
    expect(out.noticia_id).toBe('not-real-1');
  });

  it('T36 duplicate/race marks KNOWN not fake inserted', async () => {
    const store = new MemoryCaptureReliabilityStore();
    const rec = { ...baseRecoveryRecord(disc(ENTORNO), NOW), status: 'QUEUED' as const };
    await store.upsertDiscovered(rec);
    const claimed = (await store.claimBatch({ workerId: 'w', limit: 1, nowIso: NOW }))[0]!;
    const out = await processRecoveryRecord({
      record: claimed,
      store,
      fetchExtract: async () => extract(),
      writesAllowed: true,
      persistNews: async () => ({ noticiaId: 'existing-9', outcome: 'known' }),
      nowIso: NOW,
    });
    expect(out.status).toBe('KNOWN_IN_LAKE');
    expect(out.noticia_id).toBe('existing-9');
  });

  it('T37 discovered published_at survives recovery', () => {
    const payload = buildRecoveredNewsPayload({
      url: ENTORNO,
      medioId: 'MED-0441',
      extract: extract({ titulo: null, resumen: null }),
      publishedAt: '2026-10-02T12:00:00.000Z',
      discoveredTitle: 'titulo discovery',
      discoveredSummary: 'resumen discovery',
    });
    expect(payload.insert.fecha_publicacion).toContain('2026-10-02');
    expect(payload.insert.titulo).toBe('titulo discovery');
    expect(payload.insert.resumen).toBe('resumen discovery');
  });

  it('T38 dry-run does not make URL unclaimable', async () => {
    const store = new MemoryCaptureReliabilityStore();
    const rec = { ...baseRecoveryRecord(disc(ENTORNO), NOW), status: 'QUEUED' as const };
    await store.upsertDiscovered(rec);
    const claimed = (await store.claimBatch({ workerId: 'dry', limit: 1, nowIso: NOW }))[0]!;
    await processRecoveryRecord({
      record: claimed,
      store,
      fetchExtract: async () => extract(),
      writesAllowed: false,
      nowIso: NOW,
    });
    const again = await store.claimBatch({ workerId: 'prod', limit: 1, nowIso: NOW });
    expect(again).toHaveLength(1);
    expect(again[0]?.hash_url).toBe(rec.hash_url);
  });

  it('T39 dry-run then production can persist same URL', async () => {
    const store = new MemoryCaptureReliabilityStore();
    const rec = { ...baseRecoveryRecord(disc(ENTORNO), NOW), status: 'QUEUED' as const };
    await store.upsertDiscovered(rec);
    const dry = (await store.claimBatch({ workerId: 'dry', limit: 1, nowIso: NOW }))[0]!;
    await processRecoveryRecord({ record: dry, store, fetchExtract: async () => extract(), writesAllowed: false, nowIso: NOW });
    const prod = (await store.claimBatch({ workerId: 'prod', limit: 1, nowIso: NOW }))[0]!;
    const out = await processRecoveryRecord({
      record: prod,
      store,
      fetchExtract: async () => extract(),
      writesAllowed: true,
      persistNews: async () => ({ noticiaId: 'n-39', outcome: 'inserted' }),
      nowIso: NOW,
    });
    expect(out.status).toBe('PERSISTED');
    expect(out.noticia_id).toBe('n-39');
  });

  it('T40 partial schema fails closed', () => {
    expect(classifySchemaPresence([true, false, false, false, false], false)).toBe('PARTIAL_SCHEMA');
    expect(classifySchemaPresence([false, false, false, false, false], false)).toBe('NONE_PRESENT');
    expect(classifySchemaPresence([true, true, true, true, true], true, true)).toBe('FULLY_READY');
  });

  it('T41 atomic queue claim two workers no overlap', async () => {
    const store = new MemoryCaptureReliabilityStore();
    for (let i = 0; i < 4; i++) {
      const url = `https://medio.example/nota-claim-${i}-articulo-largo/`;
      await store.upsertDiscovered({ ...baseRecoveryRecord(disc(url), NOW), status: 'QUEUED' });
    }
    const [a, b] = await Promise.all([
      store.claimBatch({ workerId: 'A', limit: 2, nowIso: NOW }),
      store.claimBatch({ workerId: 'B', limit: 2, nowIso: NOW }),
    ]);
    const hashes = [...a, ...b].map((r) => r.hash_url);
    expect(new Set(hashes).size).toBe(hashes.length);
    expect(hashes).toHaveLength(4);
  });

  it('T42 atomic source claim no duplicate worker', async () => {
    const store = new MemoryCaptureReliabilityStore();
    const opts = {
      windowStart: NOW,
      windowEnd: NOW,
      medioIds: ['MED-1', 'MED-2'],
      limit: 2,
      nowIso: NOW,
      staleBeforeIso: '2026-10-02T17:00:00.000Z',
    };
    const [a, b] = await Promise.all([
      store.claimSourceBatch({ ...opts, workerId: 'A' }),
      store.claimSourceBatch({ ...opts, workerId: 'B' }),
    ]);
    const ids = [...a, ...b].map((s) => s.medio_id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(['MED-1', 'MED-2']);
  });

  it('T43 DB gap candidate consumed durably', async () => {
    const store = new MemoryCaptureReliabilityStore();
    const gap = gapCandidateFromUrl({ discovered_url: ENTORNO, publisher_final_url: ENTORNO, medio_id: 'MED-0441' });
    await store.addGapCandidates([gap]);
    const claimed = await store.claimGapCandidates({ workerId: 'w', limit: 1, nowIso: NOW });
    expect(claimed).toHaveLength(1);
    await store.markGapConsumed(claimed[0]!.candidate_id, NOW);
    const again = await store.claimGapCandidates({ workerId: 'w2', limit: 1, nowIso: NOW });
    expect(again).toHaveLength(0);
  });

  it('T44 crash before consumed_at does not lose candidate', async () => {
    const store = new MemoryCaptureReliabilityStore();
    const gap = gapCandidateFromUrl({ discovered_url: ENTORNO });
    await store.addGapCandidates([gap]);
    await store.claimGapCandidates({ workerId: 'w', limit: 1, nowIso: '2026-10-02T17:00:00.000Z' });
    const n = await store.releaseStaleGapClaims('2026-10-02T17:30:00.000Z');
    expect(n).toBe(1);
    const again = await store.claimGapCandidates({ workerId: 'w2', limit: 1, nowIso: NOW });
    expect(again).toHaveLength(1);
  });

  it('T45 canonical gap dedupe', () => {
    const a = gapCandidateFromUrl({ discovered_url: ENTORNO + '?utm_source=google' });
    const b = gapCandidateFromUrl({ discovered_url: ENTORNO });
    expect(a.candidate_id).toBe(b.candidate_id);
  });

  it('T47 coverage sitemap UNKNOWN != COMPLETE', () => {
    expect(
      discoveryCoverageVerdict({
        rssSpanCovered: 'NO',
        sitemapSpanCovered: 'UNKNOWN',
        listingSpanCovered: 'UNKNOWN',
        paginationComplete: true,
        capHit: false,
        timeBudgetHit: false,
        noDiscoverySurface: false,
        surfaces: ['rss', 'sitemap'],
      }),
    ).not.toBe('COVERAGE_CONFIRMED');
  });

  it('T48 coverage sitemap NO != COMPLETE', () => {
    expect(
      discoveryCoverageVerdict({
        rssSpanCovered: 'YES',
        sitemapSpanCovered: 'NO',
        listingSpanCovered: 'UNKNOWN',
        paginationComplete: true,
        capHit: false,
        timeBudgetHit: false,
        noDiscoverySurface: false,
        surfaces: ['rss', 'sitemap'],
      }),
    ).toBe('COVERAGE_PARTIAL');
  });

  it('T49 RSS-only != COMPLETE', () => {
    expect(
      discoveryCoverageVerdict({
        rssSpanCovered: 'YES',
        sitemapSpanCovered: 'UNKNOWN',
        listingSpanCovered: 'UNKNOWN',
        paginationComplete: true,
        capHit: false,
        timeBudgetHit: false,
        noDiscoverySurface: false,
        surfaces: ['rss'],
      }),
    ).toBe('COVERAGE_PARTIAL');
  });

  it('T50 RSS NO + sitemap YES expected verdict', () => {
    expect(
      discoveryCoverageVerdict({
        rssSpanCovered: 'NO',
        sitemapSpanCovered: 'YES',
        listingSpanCovered: 'UNKNOWN',
        paginationComplete: true,
        capHit: false,
        timeBudgetHit: false,
        noDiscoverySurface: false,
        surfaces: ['rss', 'sitemap'],
      }),
    ).toBe('COVERAGE_CONFIRMED');
  });

  it('T51 uncertain legitimate URL → FETCH_TO_CLASSIFY', () => {
    const r = classifyPreFetch(
      { url: 'https://medio.example/x', medioId: 'MED-1', titulo: 'Nota' },
      'rss',
    );
    expect(r.disposition).toBe('FETCH_TO_CLASSIFY');
  });

  it('T52 obvious hub still rejected', () => {
    expect(classifyPreFetch({ url: 'https://medio.example/tag/jalisco/', medioId: 'MED-1' }, 'rss').disposition).toBe('REJECT');
    expect(classifyPreFetch({ url: 'https://medio.example/', medioId: 'MED-1' }, 'sitemap').disposition).toBe('REJECT');
  });

  it('T51b dated and section slugs are admitted', () => {
    expect(
      classifyPreFetch(
        { url: 'https://medio.example/politica/nota-importante-de-presupuesto/', medioId: 'MED-1' },
        'sitemap',
      ).disposition,
    ).toBe('ADMIT');
    expect(classifyPreFetch({ url: 'https://medio.example/noticia/123456', medioId: 'MED-1' }, 'rss').disposition).toBe('ADMIT');
    expect(classifyPreFetch({ url: 'https://medio.example/2026/10/02/slug-largo/', medioId: 'MED-1' }, 'rss').disposition).toBe('ADMIT');
  });

  it('T46 duplicate host keeps ambiguity', () => {
    const catalog = [
      { medio_id: 'MED-A', url_base: 'https://dup.example/', rss_url: null, sitemap_url: null, hostname: 'dup.example' },
      { medio_id: 'MED-B', url_base: 'https://dup.example/', rss_url: null, sitemap_url: null, hostname: 'dup.example' },
    ];
    const url = 'https://dup.example/politica/nota-importante-de-presupuesto/';
    const ambiguous = decideDiscoveredUrl(
      {
        url,
        canonicalUrl: url,
        hashUrl: 'h',
        medioId: null,
        fuenteId: null,
        hostname: 'dup.example',
        discoveredVia: 'gap_candidate',
        publishedAt: null,
        titulo: 'Nota',
        resumen: null,
        body: null,
      },
      { nowIso: NOW, lakeByCanonical: new Map(), catalog, provenRootCause: null },
    );
    expect(ambiguous.record.status).toBe('AMBIGUOUS_SOURCE');
    const kept = decideDiscoveredUrl(
      {
        url,
        canonicalUrl: url,
        hashUrl: 'h',
        medioId: 'MED-B',
        fuenteId: null,
        hostname: 'dup.example',
        discoveredVia: 'gap_candidate',
        publishedAt: null,
        titulo: 'Nota',
        resumen: null,
        body: null,
      },
      { nowIso: NOW, lakeByCanonical: new Map(), catalog, provenRootCause: null },
    );
    expect(kept.record.status).not.toBe('AMBIGUOUS_SOURCE');
    expect(kept.record.medio_id).toBe('MED-B');
  });

  it('T53 section/listing configured surface used', () => {
    expect(configuredSurfaceKinds({
      medio_id: 'MED-1',
      url_base: 'https://medio.example/',
      rss_url: null,
      sitemap_url: null,
      hostname: 'medio.example',
      secciones_urls: 'https://medio.example/politica/',
    })).toContain('listing');
  });

  it('T54 T55 run metrics ignore historical queue rows', async () => {
    const store = new MemoryCaptureReliabilityStore();
    const old = baseRecoveryRecord(
      {
        url: 'https://old.example/nota-historica-fallida-123456/',
        canonicalUrl: 'https://old.example/nota-historica-fallida-123456/',
        hashUrl: 'old-hash',
        medioId: 'MED-1',
        fuenteId: null,
        hostname: 'old.example',
        discoveredVia: 'rss',
        publishedAt: null,
        titulo: 'Vieja',
        resumen: null,
        body: null,
      },
      '2026-09-01T00:00:00.000Z',
    );
    await store.upsertDiscovered({ ...old, status: 'FAILED_RETRY_EXHAUSTED', last_error: 'old' });
    const catalog = [{
      medio_id: 'MED-1',
      url_base: 'https://medio.example/',
      rss_url: 'https://medio.example/feed',
      sitemap_url: 'https://medio.example/sitemap.xml',
      hostname: 'medio.example',
    }];
    const currentUrl = 'https://medio.example/politica/nota-de-la-ventana-actual/';
    const report = await runReconcileEngine(
      {
        runId: 'win-24',
        mode: '24h',
        windowStart: '2026-10-01T18:00:00.000Z',
        windowEnd: '2026-10-02T18:00:00.000Z',
        shardIndex: 0,
        shardCount: 1,
        workerId: 'w',
        maxSourcesThisRun: 5,
        safetyCap: 100,
        timeBudgetMs: 60_000,
        processRecovery: false,
        dryRun: true,
        allowWritesEnv: null,
        nowIso: NOW,
      },
      {
        store,
        catalog,
        discoverSource: async () => ({
          urls: [{
            url: currentUrl,
            canonicalUrl: currentUrl,
            hashUrl: 'cur',
            medioId: 'MED-1',
            fuenteId: null,
            hostname: 'medio.example',
            discoveredVia: 'rss',
            publishedAt: NOW,
            titulo: 'Actual',
            resumen: null,
            body: null,
          }],
          surfaces: ['rss', 'sitemap'],
          rssSpanCovered: 'NO',
          sitemapSpanCovered: 'YES',
          listingSpanCovered: 'UNKNOWN',
          sitemapRuntimeCompletenessInvoked: true,
          capHit: false,
          noDiscoverySurface: false,
        }),
        queryLakeHashes: async () => [],
      },
    );
    expect(report.DISCOVERED_24H).toBe(1);
    expect(report.URL_ACCOUNTING_MISSING).toBe(0);
    expect(report.FAILED).toBe(0);
    const older = await runReconcileEngine(
      {
        runId: 'win-old',
        mode: '72h',
        windowStart: '2026-09-29T18:00:00.000Z',
        windowEnd: '2026-10-02T18:00:00.000Z',
        shardIndex: 0,
        shardCount: 1,
        workerId: 'w',
        maxSourcesThisRun: 5,
        safetyCap: 100,
        timeBudgetMs: 60_000,
        processRecovery: false,
        dryRun: true,
        allowWritesEnv: null,
        nowIso: NOW,
      },
      {
        store,
        catalog,
        discoverSource: async () => ({
          urls: [],
          surfaces: ['rss', 'sitemap'],
          rssSpanCovered: 'NO',
          sitemapSpanCovered: 'YES',
          listingSpanCovered: 'UNKNOWN',
          sitemapRuntimeCompletenessInvoked: true,
          capHit: false,
          noDiscoverySurface: false,
        }),
        queryLakeHashes: async () => [],
      },
    );
    expect(older.DISCOVERED_24H).toBe(0);
    expect(older.FAILED).toBe(0);
  });
});
