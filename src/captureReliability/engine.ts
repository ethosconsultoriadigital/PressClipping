import { configuredSurfaceKinds, hasConfiguredDiscoverySurface, shardCatalog } from './catalog.js';
import { discoveryCoverageVerdict } from './coverage.js';
import { asCheckpoint, emptySourceState, markSourceTerminal, timeBudgetExceeded } from './checkpoint.js';
import type { CaptureReliabilityStore } from './captureRecoveryRepository.js';
import { EXPLAINED_RECOVERY, type ChannelCatalogRow, type CompletenessFlag, type DiscoveredUrl, type GapCandidate, type RecoveryRecord, type RootCause, type SourceReconcileState } from './types.js';
import { lookupExistingNewsByHashes, type HashQueryFn } from './lakeLookup.js';
import { decideDiscoveredUrl, unionDiscovery } from './reconcile.js';
import { googleAuditorClassify } from './recoveryQueue.js';
import { processRecoveryRecord, type RecoveryFetchExtract, type RecoveryPersist } from './recoveryWorker.js';
import { captureCanonicalUrl, hostOf, primaryHash } from './urlIndex.js';
import { recoveryWritesAllowed } from './writesGuard.js';

export interface SourceDiscovery {
  urls: DiscoveredUrl[];
  surfaces: string[];
  rssSpanCovered: CompletenessFlag;
  sitemapSpanCovered: CompletenessFlag;
  listingSpanCovered: CompletenessFlag;
  sitemapRuntimeCompletenessInvoked: boolean;
  capHit: boolean;
  noDiscoverySurface: boolean;
}

export interface EngineDeps {
  store: CaptureReliabilityStore;
  catalog: ChannelCatalogRow[];
  discoverSource: (source: ChannelCatalogRow, window: { start: string; end: string }) => Promise<SourceDiscovery>;
  queryLakeHashes: HashQueryFn;
  fetchExtract?: RecoveryFetchExtract;
  persistNews?: RecoveryPersist;
}

export interface EngineOpts {
  runId: string;
  mode: '24h' | '72h' | 'auditor';
  windowStart: string;
  windowEnd: string;
  shardIndex: number;
  shardCount: number;
  workerId: string;
  maxSourcesThisRun: number;
  safetyCap: number;
  timeBudgetMs: number;
  processRecovery: boolean;
  dryRun: boolean;
  allowWritesEnv?: string | null;
  gapCandidates?: GapCandidate[];
  nowIso: string;
  nowMs?: number;
  startedMs?: number;
  maxAttempts?: number;
  staleClaimMs?: number;
}

export interface EngineReport {
  RUN_ID: string;
  WINDOW_START: string;
  WINDOW_END: string;
  dry: boolean;
  PRODUCTION_RECOVERY_WRITES: number;
  TOTAL_ACTIVE_SOURCES: number;
  SOURCES_QUEUED: number;
  SOURCES_PROCESSED: number;
  SOURCES_PENDING: number;
  SOURCES_COMPLETE: number;
  SOURCES_INCOMPLETE: number;
  DISCOVERED_24H: number;
  KNOWN_IN_LAKE: number;
  QUEUED_MISSING: number;
  REJECTED: number;
  BLOCKED: number;
  FAILED: number;
  WOULD_PERSIST: number;
  FETCH_TO_CLASSIFY: number;
  URL_ACCOUNTING_MISSING: number;
  SOURCES_COVERAGE_CONFIRMED: number;
  SOURCES_COVERAGE_PARTIAL: number;
  SOURCES_COVERAGE_UNKNOWN: number;
  REJECT_REASON_COUNTS: Record<string, number>;
  UNEXPLAINED_MISSING: number;
  RSS_WINDOW_SPAN_COVERED: CompletenessFlag[];
  DISCOVERY_SURFACES_USED: string[];
  CAP_HIT: boolean;
  TIME_BUDGET_HIT: boolean;
  RECONCILIATION_COMPLETE: boolean;
  DISCOVERY_METHOD_COUNTS: Record<string, number>;
  SOURCES_BY_AVAILABLE_SURFACE: Record<string, number>;
  GAP_AUDITOR: Array<{ url: string; host: string; class: string }>;
  checkpoint: ReturnType<typeof asCheckpoint>;
  sourceStates: SourceReconcileState[];
  sample_queued: RecoveryRecord[];
}

function provenCause(item: DiscoveredUrl, discovery: SourceDiscovery): RootCause | null {
  if (item.discoveredVia.includes('gap') || item.discoveredVia.includes('google') || item.discoveredVia.includes('auditor')) {
    return 'LATE_PUBLISHER_DISCOVERY';
  }
  if (discovery.noDiscoverySurface) return 'NO_DISCOVERY_SURFACE';
  return null;
}

export async function scheduleSourceJobs(
  store: CaptureReliabilityStore,
  catalog: ChannelCatalogRow[],
  windowStart: string,
  windowEnd: string,
): Promise<number> {
  let queued = 0;
  for (const row of catalog) {
    const existing = await store.getSourceState(row.medio_id, windowStart, windowEnd);
    if (existing) continue;
    await store.upsertSourceState(emptySourceState({ medioId: row.medio_id, windowStart, windowEnd }));
    queued += 1;
  }
  return queued;
}

function coverage(states: SourceReconcileState[], totalActive: number) {
  const processed = states.filter((s) => s.status === 'COMPLETE' || s.status === 'INCOMPLETE').length;
  const pending = states.filter((s) => s.status === 'PENDING' || s.status === 'IN_PROGRESS').length;
  return {
    TOTAL_ACTIVE_SOURCES: totalActive,
    SOURCES_QUEUED: states.length,
    SOURCES_PROCESSED: processed,
    SOURCES_PENDING: pending,
    SOURCES_COMPLETE: states.filter((s) => s.complete).length,
    SOURCES_INCOMPLETE: states.filter((s) => s.status === 'INCOMPLETE').length,
  };
}

export async function runReconcileEngine(opts: EngineOpts, deps: EngineDeps): Promise<EngineReport> {
  const writesAllowed = recoveryWritesAllowed({ dryRun: opts.dryRun, allowEnv: opts.allowWritesEnv });
  const startedMs = opts.startedMs ?? opts.nowMs ?? Date.now();
  const nowMs = () => opts.nowMs ?? Date.now();

  await scheduleSourceJobs(deps.store, deps.catalog, opts.windowStart, opts.windowEnd);
  await deps.store.upsertRun({
    run_id: opts.runId,
    mode: opts.mode,
    window_start: opts.windowStart,
    window_end: opts.windowEnd,
    shard_index: opts.shardIndex,
    shard_count: opts.shardCount,
    status: 'RUNNING',
    created_at: opts.nowIso,
    updated_at: opts.nowIso,
  });

  const staleBefore = new Date(Date.parse(opts.nowIso) - (opts.staleClaimMs ?? 15 * 60_000)).toISOString();
  await deps.store.releaseStaleClaims(staleBefore);

  const shard = shardCatalog(deps.catalog, opts.shardIndex, opts.shardCount);
  const pendingIds: string[] = [];
  for (const row of shard) {
    const st = await deps.store.getSourceState(row.medio_id, opts.windowStart, opts.windowEnd);
    if (!st || st.status === 'PENDING' || st.status === 'IN_PROGRESS') pendingIds.push(row.medio_id);
  }
  const claimedSources = await deps.store.claimSourceBatch({
    workerId: opts.workerId,
    windowStart: opts.windowStart,
    windowEnd: opts.windowEnd,
    medioIds: pendingIds,
    limit: opts.maxSourcesThisRun,
    nowIso: opts.nowIso,
    staleBeforeIso: staleBefore,
  });
  const claimedIds = new Set(claimedSources.map((s) => s.medio_id));
  const work = shard.filter((row) => claimedIds.has(row.medio_id));

  let capHit = false;
  let timeBudgetHit = false;
  let discoveredThisRun = 0;
  const rssFlags: CompletenessFlag[] = [];
  const surfacesUsed = new Set<string>();
  let sourcesTouched = 0;

  for (const row of work) {
    if (sourcesTouched >= opts.maxSourcesThisRun) break;
    if (timeBudgetExceeded(startedMs, opts.timeBudgetMs, nowMs())) {
      timeBudgetHit = true;
      break;
    }
    sourcesTouched += 1;
    let state = (await deps.store.getSourceState(row.medio_id, opts.windowStart, opts.windowEnd))
      ?? emptySourceState({ medioId: row.medio_id, windowStart: opts.windowStart, windowEnd: opts.windowEnd });

    const discovery = await deps.discoverSource(row, { start: opts.windowStart, end: opts.windowEnd });
    rssFlags.push(discovery.rssSpanCovered);
    for (const s of discovery.surfaces) surfacesUsed.add(s);

    if (discovery.noDiscoverySurface || (!hasConfiguredDiscoverySurface(row) && discovery.surfaces.length === 0)) {
      state = {
        ...state,
        discovery_surfaces: ['NO_DISCOVERY_SURFACE'],
        last_error: 'NO_DISCOVERY_SURFACE',
        cap_hit: discovery.capHit,
        coverage_verdict: 'COVERAGE_UNKNOWN',
      };
      await deps.store.upsertSourceState(markSourceTerminal(state, 'INCOMPLETE', opts.nowIso));
      continue;
    }

    const discovered = unionDiscovery([discovery.urls]);
    const lake = await lookupExistingNewsByHashes(
      discovered.map((d) => d.url),
      deps.queryLakeHashes,
    );

    let known = 0;
    let queued = 0;
    let rejected = 0;
    let blocked = 0;
    let failed = 0;
    let persisted = 0;
    let unexplained = 0;

    for (const item of discovered) {
      const dec = decideDiscoveredUrl(item, {
        nowIso: opts.nowIso,
        lakeByCanonical: lake,
        catalog: deps.catalog,
        provenRootCause: provenCause(item, discovery),
      });
      const rec = await deps.store.upsertDiscovered(dec.record);
      await deps.store.recordObservation({
        run_id: opts.runId,
        hash_url: rec.hash_url,
        medio_id: rec.medio_id,
        window_start: opts.windowStart,
        window_end: opts.windowEnd,
        discovered_via: rec.discovered_via,
        observed_status: rec.status,
        observed_at: opts.nowIso,
        reject_reason: rec.status === 'REJECTED_NON_ARTICLE' ? rec.last_error : null,
      });
      discoveredThisRun += 1;
      if (rec.status === 'KNOWN_IN_LAKE' || rec.status === 'NEEDS_ENRICH') known += 1;
      else if (rec.status === 'QUEUED' || rec.status === 'RETRY' || rec.status === 'FETCH_TO_CLASSIFY') queued += 1;
      else if (rec.status === 'REJECTED_NON_ARTICLE') rejected += 1;
      else if (rec.status === 'BLOCKED') blocked += 1;
      else if (rec.status === 'FAILED_RETRY_EXHAUSTED') failed += 1;
      else if (rec.status === 'PERSISTED' || rec.status === 'WOULD_PERSIST') persisted += 1;
      if (!EXPLAINED_RECOVERY.includes(rec.status)) unexplained += 1;
    }
    if (discoveredThisRun > opts.safetyCap) capHit = true;

    state = {
      ...state,
      discovery_surfaces: discovery.surfaces,
      rss_span_covered: discovery.rssSpanCovered,
      sitemap_span_covered: discovery.sitemapSpanCovered,
      listing_span_covered: discovery.listingSpanCovered,
      sitemap_runtime_completeness_invoked: discovery.sitemapRuntimeCompletenessInvoked,
      urls_discovered: discovered.length,
      urls_known: known,
      urls_queued: queued,
      urls_persisted: persisted,
      urls_rejected: rejected,
      urls_blocked: blocked,
      urls_failed: failed,
      unexplained_missing: unexplained,
      cap_hit: capHit || discovery.capHit,
      time_budget_hit: timeBudgetHit,
    };

    const verdict = discoveryCoverageVerdict({
      rssSpanCovered: discovery.rssSpanCovered,
      sitemapSpanCovered: discovery.sitemapSpanCovered,
      listingSpanCovered: discovery.listingSpanCovered,
      paginationComplete: !discovery.capHit,
      capHit: discovery.capHit || capHit,
      timeBudgetHit,
      noDiscoverySurface: discovery.noDiscoverySurface,
      surfaces: discovery.surfaces,
    });
    state = { ...state, coverage_verdict: verdict };

    if (discovery.capHit && !capHit) {
      await deps.store.upsertSourceState(markSourceTerminal({ ...state, cap_hit: true }, 'INCOMPLETE', opts.nowIso));
      continue;
    }
    if (capHit) {
      await deps.store.upsertSourceState(markSourceTerminal({ ...state, cap_hit: true }, 'INCOMPLETE', opts.nowIso));
      break;
    }

    const status = verdict === 'COVERAGE_CONFIRMED' && unexplained === 0 ? 'COMPLETE' : 'INCOMPLETE';
    await deps.store.upsertSourceState(markSourceTerminal(state, status, opts.nowIso));
  }

  if (opts.gapCandidates?.length) {
    await deps.store.addGapCandidates(opts.gapCandidates);
  }
  await deps.store.releaseStaleGapClaims(staleBefore);
  const gaps = await deps.store.claimGapCandidates({
    workerId: opts.workerId,
    limit: 500,
    nowIso: opts.nowIso,
  });
  const seenGap = new Set<string>();
  const gapUrls: string[] = [];
  for (const g of gaps) {
    const url = g.discovered_url;
    const hash = g.canonical_hash || primaryHash(url);
    if (seenGap.has(hash)) {
      await deps.store.markGapConsumed(g.candidate_id, opts.nowIso);
      continue;
    }
    seenGap.add(hash);
    gapUrls.push(url);
  }
  const gapLake = gapUrls.length
    ? await lookupExistingNewsByHashes(gapUrls, deps.queryLakeHashes)
    : new Map<string, import('./lakeLookup.js').LakeRow | null>();
  for (const g of gaps) {
    const url = g.discovered_url;
    const hash = g.canonical_hash || primaryHash(url);
    if (!seenGap.has(hash)) continue;
    seenGap.delete(hash);
    const item: DiscoveredUrl = {
      url,
      canonicalUrl: captureCanonicalUrl(url),
      hashUrl: hash,
      medioId: g.medio_id,
      fuenteId: g.fuente_id,
      hostname: g.hostname || hostOf(url),
      discoveredVia: g.discovered_via,
      publishedAt: null,
      titulo: null,
      resumen: null,
      body: null,
    };
    const dec = decideDiscoveredUrl(item, {
      nowIso: opts.nowIso,
      lakeByCanonical: gapLake,
      catalog: deps.catalog,
      provenRootCause: 'LATE_PUBLISHER_DISCOVERY',
    });
    const rec = await deps.store.upsertDiscovered(dec.record);
    await deps.store.recordObservation({
      run_id: opts.runId,
      hash_url: rec.hash_url,
      medio_id: rec.medio_id,
      window_start: opts.windowStart,
      window_end: opts.windowEnd,
      discovered_via: rec.discovered_via,
      observed_status: rec.status,
      observed_at: opts.nowIso,
      reject_reason: rec.status === 'REJECTED_NON_ARTICLE' ? rec.last_error : null,
    });
    await deps.store.markGapConsumed(g.candidate_id, opts.nowIso);
  }

  if (opts.processRecovery && deps.fetchExtract) {
    const claimed = await deps.store.claimBatch({
      workerId: opts.workerId,
      limit: 50,
      nowIso: opts.nowIso,
    });
    for (const rec of claimed) {
      await processRecoveryRecord({
        record: rec,
        store: deps.store,
        fetchExtract: deps.fetchExtract,
        persistNews: writesAllowed ? deps.persistNews : undefined,
        writesAllowed,
        nowIso: opts.nowIso,
        maxAttempts: opts.maxAttempts,
      });
    }
  }

  const states = await deps.store.listSourceStates(opts.windowStart, opts.windowEnd);
  const cov = coverage(states, deps.catalog.length);
  const snap = await deps.store.snapshot();
  const obsAll = await deps.store.listObservations(opts.windowStart, opts.windowEnd);
  const byHash = new Map<string, (typeof obsAll)[number]>();
  for (const o of obsAll) byHash.set(o.hash_url, o);
  const obs = [...byHash.values()];
  const unexplained = obs.filter((r) => !EXPLAINED_RECOVERY.includes(r.observed_status)).length;
  const rejectReasons: Record<string, number> = {};
  for (const o of obs) {
    if (o.observed_status === 'REJECTED_NON_ARTICLE') {
      const k = o.reject_reason ?? 'unspecified';
      rejectReasons[k] = (rejectReasons[k] ?? 0) + 1;
    }
  }
  const coverageCounts = {
    SOURCES_COVERAGE_CONFIRMED: states.filter((s) => s.coverage_verdict === 'COVERAGE_CONFIRMED').length,
    SOURCES_COVERAGE_PARTIAL: states.filter((s) => s.coverage_verdict === 'COVERAGE_PARTIAL').length,
    SOURCES_COVERAGE_UNKNOWN: states.filter((s) => !s.coverage_verdict || s.coverage_verdict === 'COVERAGE_UNKNOWN').length,
  };
  const knownHosts = new Set(deps.catalog.map((c) => (c.hostname || '').replace(/^www\./, '')).filter(Boolean));
  const gapAuditor = (opts.gapCandidates ?? []).map((g) => {
    const url = g.publisher_final_url || g.discovered_url;
    const host = (g.hostname || hostOf(url)).replace(/^www\./, '');
    const rec = snap.find((r) => r.canonical_url === captureCanonicalUrl(url));
    const inLake = rec?.status === 'KNOWN_IN_LAKE';
    return {
      url,
      host,
      class: googleAuditorClassify({ publisherHost: host, knownHosts, inLake }),
    };
  });

  const writes = writesAllowed ? snap.filter((r) => r.status === 'PERSISTED').length : 0;
  await deps.store.upsertRun({
    run_id: opts.runId,
    mode: opts.mode,
    window_start: opts.windowStart,
    window_end: opts.windowEnd,
    shard_index: opts.shardIndex,
    shard_count: opts.shardCount,
    status: cov.SOURCES_PENDING > 0 || capHit || timeBudgetHit ? 'PAUSED' : 'DONE',
    created_at: opts.nowIso,
    updated_at: opts.nowIso,
  });

  return {
    RUN_ID: opts.runId,
    WINDOW_START: opts.windowStart,
    WINDOW_END: opts.windowEnd,
    dry: opts.dryRun,
    PRODUCTION_RECOVERY_WRITES: writes,
    ...cov,
    DISCOVERED_24H: obs.length,
    KNOWN_IN_LAKE: obs.filter((r) => r.observed_status === 'KNOWN_IN_LAKE' || r.observed_status === 'NEEDS_ENRICH').length,
    QUEUED_MISSING: obs.filter((r) =>
      r.observed_status === 'QUEUED' ||
      r.observed_status === 'RETRY' ||
      r.observed_status === 'FETCHING' ||
      r.observed_status === 'PERSISTED'
    ).length,
    FETCH_TO_CLASSIFY: obs.filter((r) => r.observed_status === 'FETCH_TO_CLASSIFY').length,
    REJECTED: obs.filter((r) => r.observed_status === 'REJECTED_NON_ARTICLE').length,
    BLOCKED: obs.filter((r) => r.observed_status === 'BLOCKED').length,
    FAILED: obs.filter((r) => r.observed_status === 'FAILED_RETRY_EXHAUSTED' || r.observed_status === 'MANUAL_REVIEW').length,
    WOULD_PERSIST: obs.filter((r) => r.observed_status === 'WOULD_PERSIST').length,
    URL_ACCOUNTING_MISSING: unexplained,
    UNEXPLAINED_MISSING: unexplained,
    REJECT_REASON_COUNTS: rejectReasons,
    ...coverageCounts,
    RSS_WINDOW_SPAN_COVERED: rssFlags,
    DISCOVERY_SURFACES_USED: [...surfacesUsed],
    CAP_HIT: capHit || states.some((s) => s.cap_hit),
    TIME_BUDGET_HIT: timeBudgetHit || states.some((s) => s.time_budget_hit),
    RECONCILIATION_COMPLETE: cov.SOURCES_PENDING === 0 && unexplained === 0 && !capHit && !timeBudgetHit && cov.SOURCES_COMPLETE === cov.TOTAL_ACTIVE_SOURCES,
    DISCOVERY_METHOD_COUNTS: obs.reduce<Record<string, number>>((acc, o) => {
      acc[o.discovered_via] = (acc[o.discovered_via] ?? 0) + 1;
      return acc;
    }, {}),
    SOURCES_BY_AVAILABLE_SURFACE: deps.catalog.reduce<Record<string, number>>((acc, row) => {
      const kinds = configuredSurfaceKinds(row);
      const key = kinds.length ? kinds.join('+') : 'none';
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
    GAP_AUDITOR: gapAuditor,
    checkpoint: asCheckpoint({
      runId: opts.runId,
      mode: opts.mode,
      windowStart: opts.windowStart,
      windowEnd: opts.windowEnd,
      states,
    }),
    sourceStates: states,
    sample_queued: snap.filter((r) => r.status === 'QUEUED' || r.status === 'WOULD_PERSIST').slice(0, 25),
  };
}
export { recoveryWritesAllowed };
