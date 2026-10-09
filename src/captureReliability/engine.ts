import { configuredSurfaceKinds, hasConfiguredDiscoverySurface, shardCatalog } from './catalog.js';
import { discoveryCoverageVerdict } from './coverage.js';
import { asCheckpoint, emptySourceState, markSourceTerminal, timeBudgetExceeded, withTimeout, SourceTimeoutError } from './checkpoint.js';
import type { CaptureReliabilityStore } from './captureRecoveryRepository.js';
import { EXPLAINED_RECOVERY, type ChannelCatalogRow, type CompletenessFlag, type DiscoverOpts, type DiscoveredUrl, type GapCandidate, type RecoveryRecord, type RootCause, type SourceReconcileState } from './types.js';
import { lookupExistingNewsByHashes, type HashQueryFn } from './lakeLookup.js';
import { decideDiscoveredUrl, unionDiscovery } from './reconcile.js';
import { googleAuditorClassify } from './recoveryQueue.js';
import { drainRecoveryQueue, type RecoveryDrainReport } from './recoveryDrain.js';
import { recoveryTargetUrl } from './gapCandidates.js';
import { cycleIsDrained } from './cycle.js';
import { captureCanonicalUrl, hostOf, primaryHash } from './urlIndex.js';
import { recoveryWritesAllowed } from './writesGuard.js';
import {
  getCoverageDebt,
  isResumableDebt,
  listCoverageDebt,
  registerCoverageDebt,
  reportCoverageDebtBacklog,
} from './coverageDebt.js';
import { executeCoverageDebtFollowUp } from './coverageDebtExecutor.js';
import { gapRecoveryEligible } from '../matching/bGapCandidateToCaptureGapRow.js';
import type { RecoveryFetchExtract, RecoveryPersist } from './recoveryWorker.js';

export interface SourceDiscovery {
  urls: DiscoveredUrl[];
  surfaces: string[];
  rssSpanCovered: CompletenessFlag;
  sitemapSpanCovered: CompletenessFlag;
  listingSpanCovered: CompletenessFlag;
  sitemapRuntimeCompletenessInvoked: boolean;
  capHit: boolean;
  noDiscoverySurface: boolean;
  cursor?: string | null;
  pageExhausted?: boolean;
  probedSurface?: string | null;
  probeEvaluated?: boolean;
  resumedFromCursor?: string | null;
  surfaceResult?: import('./surfaceResult.js').SurfaceAttemptResult;
  cursorNotFound?: boolean;
  pendingSubs?: number;
  subsFallidos?: number;
  truncated?: boolean;
  nextFollowUp?: import('./coverageDebt.js').CoverageFollowUp | null;
}

export interface EngineDeps {
  store: CaptureReliabilityStore;
  catalog: ChannelCatalogRow[];
  discoverSource: (
    source: ChannelCatalogRow,
    window: { start: string; end: string },
    opts?: DiscoverOpts,
  ) => Promise<SourceDiscovery>;
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
  perSourceTimeoutMs?: number;
  cycleId?: string;
  recoveryBatchSize?: number;
  recoveryConcurrency?: number;
  maxRecoveryBatches?: number;
  recoveryTimeBudgetMs?: number;
  globalConcurrency?: number;
  perHostConcurrency?: number;
  recoveryOnlyHashes?: Set<string>;
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
  CYCLE_ID: string;
  CYCLE_STATUS: 'OPEN' | 'DRAINED' | 'PAUSED';
  RECOVERY_QUEUE_TOTAL: number;
  RECOVERY_QUEUE_CLAIMABLE: number;
  RECOVERY_PROCESSED_THIS_RUN: number;
  RECOVERY_PERSISTED: number;
  RECOVERY_PERSISTED_GLOBAL: number;
  NEW_WRITES_THIS_RUN: number;
  KNOWN_THIS_RUN: number;
  REJECTED_THIS_RUN: number;
  RETRY_THIS_RUN: number;
  BLOCKED_THIS_RUN: number;
  RECOVERY_KNOWN: number;
  RECOVERY_REJECTED: number;
  RECOVERY_RETRY: number;
  RECOVERY_BLOCKED: number;
  RECOVERY_FAILED: number;
  RECOVERY_REMAINING: number;
  RECOVERY_WOULD_PERSIST: number;
  DEBT_BACKLOG: ReturnType<typeof reportCoverageDebtBacklog>;
}

async function persistIncompleteSource(
  store: CaptureReliabilityStore,
  state: SourceReconcileState,
  nowIso: string,
  catalogRow?: ChannelCatalogRow,
): Promise<SourceReconcileState> {
  const terminal = markSourceTerminal(state, 'INCOMPLETE', nowIso);
  await store.upsertSourceState(terminal);
  await registerCoverageDebt(store, terminal, nowIso, catalogRow);
  return terminal;
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
    cycle_id: opts.cycleId ?? opts.runId,
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
  const windowDebt = await listCoverageDebt(deps.store, opts.windowStart, opts.windowEnd);
  const debtByMedio = new Map(windowDebt.map((d) => [d.medio_id, d]));
  const pendingIds: string[] = [];
  for (const row of shard) {
    const st = await deps.store.getSourceState(row.medio_id, opts.windowStart, opts.windowEnd);
    if (!st || st.status === 'PENDING' || st.status === 'IN_PROGRESS') pendingIds.push(row.medio_id);
    else if (st.status === 'INCOMPLETE' && isResumableDebt(debtByMedio.get(st.medio_id))) pendingIds.push(row.medio_id);
  }
  const claimedSources = await deps.store.claimSourceBatch({
    workerId: opts.workerId,
    windowStart: opts.windowStart,
    windowEnd: opts.windowEnd,
    medioIds: pendingIds,
    limit: opts.maxSourcesThisRun,
    nowIso: opts.nowIso,
    staleBeforeIso: staleBefore,
    resumeIncomplete: true,
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

    const liveDebt = await getCoverageDebt(deps.store, row.medio_id, opts.windowStart, opts.windowEnd);
    if (liveDebt && isResumableDebt(liveDebt)) {
      await executeCoverageDebtFollowUp({
        store: deps.store,
        catalog: row,
        state,
        debt: liveDebt,
        nowIso: opts.nowIso,
        runId: opts.runId,
        discover: deps.discoverSource,
        queryLakeHashes: deps.queryLakeHashes,
        workerId: opts.workerId,
      });
      continue;
    }

    let discovery: SourceDiscovery;
    try {
      discovery = await withTimeout(
        deps.discoverSource(row, { start: opts.windowStart, end: opts.windowEnd }),
        opts.perSourceTimeoutMs ?? 40_000,
        row.medio_id,
      );
    } catch (err) {
      const timeout = err instanceof SourceTimeoutError || /SOURCE_TIMEOUT/i.test(err instanceof Error ? err.message : String(err));
      state = {
        ...state,
        last_error: timeout ? 'SOURCE_TIMEOUT' : (err instanceof Error ? err.message : String(err)),
        coverage_verdict: 'COVERAGE_PARTIAL',
        time_budget_hit: false,
      };
      await persistIncompleteSource(deps.store, state, opts.nowIso, row);
      continue;
    }
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
      await persistIncompleteSource(deps.store, state, opts.nowIso, row);
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
      cap_hit: discovery.capHit,
      time_budget_hit: timeBudgetHit,
    };

    const verdict = discoveryCoverageVerdict({
      rssSpanCovered: discovery.rssSpanCovered,
      sitemapSpanCovered: discovery.sitemapSpanCovered,
      listingSpanCovered: discovery.listingSpanCovered,
      paginationComplete: !discovery.capHit,
      capHit: discovery.capHit,
      timeBudgetHit,
      noDiscoverySurface: discovery.noDiscoverySurface,
      surfaces: discovery.surfaces,
    });
    state = { ...state, coverage_verdict: verdict };

    if (discovery.capHit) {
      const next = { ...state, cap_hit: true };
      if (verdict === 'COVERAGE_CONFIRMED') {
        await deps.store.upsertSourceState(markSourceTerminal(next, 'COMPLETE', opts.nowIso));
      } else {
        await persistIncompleteSource(deps.store, next, opts.nowIso, row);
      }
      continue;
    }
    if (capHit) {
      await persistIncompleteSource(deps.store, { ...state, cap_hit: true }, opts.nowIso, row);
      break;
    }

    if (verdict === 'COVERAGE_CONFIRMED' && unexplained === 0) {
      await deps.store.upsertSourceState(markSourceTerminal(state, 'COMPLETE', opts.nowIso));
    } else {
      await persistIncompleteSource(deps.store, state, opts.nowIso, row);
    }
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
    const url = recoveryTargetUrl(g);
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
    if (!gapRecoveryEligible(g.discovery_status)) continue;
    const url = recoveryTargetUrl(g);
    const fetchUrl = g.discovered_url && hostOf(g.discovered_url) === hostOf(url) ? g.discovered_url : url;
    const hash = g.canonical_hash || primaryHash(url);
    if (!seenGap.has(hash)) continue;
    seenGap.delete(hash);
    const item: DiscoveredUrl = {
      url: fetchUrl,
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

  let recovery: RecoveryDrainReport = {
    RECOVERY_QUEUE_TOTAL: 0,
    RECOVERY_QUEUE_CLAIMABLE: 0,
    RECOVERY_PROCESSED_THIS_RUN: 0,
    RECOVERY_PERSISTED: 0,
    RECOVERY_PERSISTED_GLOBAL: 0,
    NEW_WRITES_THIS_RUN: 0,
    KNOWN_THIS_RUN: 0,
    REJECTED_THIS_RUN: 0,
    RETRY_THIS_RUN: 0,
    BLOCKED_THIS_RUN: 0,
    RECOVERY_KNOWN: 0,
    RECOVERY_REJECTED: 0,
    RECOVERY_RETRY: 0,
    RECOVERY_BLOCKED: 0,
    RECOVERY_FAILED: 0,
    RECOVERY_REMAINING: 0,
    RECOVERY_WOULD_PERSIST: 0,
    TIME_BUDGET_HIT: false,
  };
  if (opts.processRecovery && deps.fetchExtract) {
    recovery = await drainRecoveryQueue({
      store: deps.store,
      workerId: opts.workerId,
      nowIso: opts.nowIso,
      nowMs: opts.nowMs,
      startedMs,
      batchSize: opts.recoveryBatchSize ?? 50,
      maxBatches: opts.maxRecoveryBatches ?? 1,
      concurrency: opts.recoveryConcurrency ?? 4,
      globalConcurrency: opts.globalConcurrency ?? 8,
      perHostConcurrency: opts.perHostConcurrency ?? 2,
      timeBudgetMs: opts.recoveryTimeBudgetMs ?? Math.max(1, opts.timeBudgetMs),
      writesAllowed,
      fetchExtract: deps.fetchExtract,
      persistNews: deps.persistNews,
      maxAttempts: opts.maxAttempts,
      onlyHashes: opts.recoveryOnlyHashes,
      windowStart: opts.windowStart,
      windowEnd: opts.windowEnd,
    });
    if (recovery.TIME_BUDGET_HIT) timeBudgetHit = true;
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

  const writes = recovery.NEW_WRITES_THIS_RUN;
  const debts = await listCoverageDebt(deps.store, opts.windowStart, opts.windowEnd);
  const cycleStatus = cycleIsDrained(cov.SOURCES_PENDING) ? 'DRAINED' : capHit || timeBudgetHit ? 'PAUSED' : 'OPEN';
  await deps.store.upsertRun({
    run_id: opts.runId,
    cycle_id: opts.cycleId ?? opts.runId,
    mode: opts.mode,
    window_start: opts.windowStart,
    window_end: opts.windowEnd,
    shard_index: opts.shardIndex,
    shard_count: opts.shardCount,
    status: cycleStatus === 'DRAINED' ? 'DRAINED' : cov.SOURCES_PENDING > 0 || capHit || timeBudgetHit ? 'PAUSED' : 'DONE',
    created_at: opts.nowIso,
    updated_at: opts.nowIso,
  });

  return {
    RUN_ID: opts.runId,
    CYCLE_ID: opts.cycleId ?? opts.runId,
    CYCLE_STATUS: cycleStatus,
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
    sample_queued: snap.filter((r) => r.status === 'QUEUED' || r.status === 'WOULD_PERSIST' || r.status === 'FETCH_TO_CLASSIFY').slice(0, 25),
    RECOVERY_QUEUE_TOTAL: recovery.RECOVERY_QUEUE_TOTAL,
    RECOVERY_QUEUE_CLAIMABLE: recovery.RECOVERY_QUEUE_CLAIMABLE,
    RECOVERY_PROCESSED_THIS_RUN: recovery.RECOVERY_PROCESSED_THIS_RUN,
    RECOVERY_PERSISTED: recovery.RECOVERY_PERSISTED_GLOBAL,
    RECOVERY_PERSISTED_GLOBAL: recovery.RECOVERY_PERSISTED_GLOBAL,
    NEW_WRITES_THIS_RUN: recovery.NEW_WRITES_THIS_RUN,
    KNOWN_THIS_RUN: recovery.KNOWN_THIS_RUN,
    REJECTED_THIS_RUN: recovery.REJECTED_THIS_RUN,
    RETRY_THIS_RUN: recovery.RETRY_THIS_RUN,
    BLOCKED_THIS_RUN: recovery.BLOCKED_THIS_RUN,
    RECOVERY_KNOWN: recovery.RECOVERY_KNOWN,
    RECOVERY_REJECTED: recovery.RECOVERY_REJECTED,
    RECOVERY_RETRY: recovery.RECOVERY_RETRY,
    RECOVERY_BLOCKED: recovery.RECOVERY_BLOCKED,
    RECOVERY_FAILED: recovery.RECOVERY_FAILED,
    RECOVERY_REMAINING: recovery.RECOVERY_REMAINING,
    RECOVERY_WOULD_PERSIST: recovery.RECOVERY_WOULD_PERSIST,
    DEBT_BACKLOG: reportCoverageDebtBacklog(debts, Date.parse(opts.nowIso)),
  };
}
export { recoveryWritesAllowed };
