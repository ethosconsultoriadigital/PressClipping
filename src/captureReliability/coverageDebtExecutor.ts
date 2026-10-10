import { configuredSurfaceKinds } from './catalog.js';
import {
  finalizeCoverageDebt,
  incrementCoverageDebtAttempt,
  markCoverageDebtInProgress,
  type CoverageDebtRecord,
  type CoverageFollowUp,
} from './coverageDebt.js';
import { nextUnusedSurface } from './sitemapCursor.js';
import { canResolveFromSurface, followUpForProbedSurface } from './surfaceResult.js';
import type { SurfaceAttemptResult } from './surfaceResult.js';
import type { CaptureReliabilityStore } from './captureRecoveryRepository.js';
import type { ChannelCatalogRow, DiscoverOpts, DiscoveredUrl, SourceReconcileState } from './types.js';
import type { SourceDiscovery } from './engine.js';
import { decideDiscoveredUrl, unionDiscovery } from './reconcile.js';
import { lookupExistingNewsByHashes, type HashQueryFn } from './lakeLookup.js';
import { markSourceTerminal } from './checkpoint.js';

export interface CoverageDebtDiscover {
  (row: ChannelCatalogRow, window: { start: string; end: string }, opts?: DiscoverOpts): Promise<SourceDiscovery>;
}

export interface CoverageDebtExecution {
  medio_id: string;
  window_start: string;
  window_end: string;
  cursor: string | null;
  reason: CoverageDebtRecord['reason'];
  follow_up: CoverageDebtRecord['follow_up'];
  attempt_count: number;
  lifecycle: CoverageDebtRecord['lifecycle'];
  result: string;
  new_urls: number;
  duplicate_urls: number;
  surface_used: string[];
  surface_found: string | null;
  surface_result: SurfaceAttemptResult | null;
  progressed: boolean;
  resolved: boolean;
  noop_rediscovery: boolean;
  next_follow_up: CoverageFollowUp;
}

function sameSurfaces(prev: string[], next: string[]): boolean {
  const a = [...prev].filter((s) => s !== 'NO_DISCOVERY_SURFACE').sort().join('|');
  const b = [...next].filter((s) => s !== 'NO_DISCOVERY_SURFACE').sort().join('|');
  return a === b && a.length > 0;
}

export function buildFollowUpDiscoverOpts(
  debt: CoverageDebtRecord,
  catalog: ChannelCatalogRow,
  usedSurfaces: string[] = [],
): DiscoverOpts {
  const used = usedSurfaces.length
    ? usedSurfaces
    : debt.reason === 'RSS_ONLY'
      ? ['rss']
      : [];
  if (debt.follow_up === 'PAGINATE_FROM_CURSOR') {
    return { resumeCursor: debt.cursor, onlySurfaces: ['sitemap'] };
  }
  if (debt.follow_up === 'SECOND_SURFACE') {
    if (debt.cursor?.startsWith('lst2|')) {
      return {
        skipSurfaces: used.filter((s) => s !== 'listing'),
        onlySurfaces: ['listing'],
        resumeCursor: debt.cursor,
      };
    }
    const next = nextUnusedSurface(used, configuredSurfaceKinds(catalog));
    return { skipSurfaces: used, onlySurfaces: next ? [next] : [] };
  }
  if (debt.follow_up === 'SURFACE_PROBE') {
    return { probeListing: true, skipSurfaces: ['rss', 'sitemap'] };
  }
  return { resumeCursor: debt.cursor };
}

export async function executeCoverageDebtFollowUp(opts: {
  store: CaptureReliabilityStore;
  catalog: ChannelCatalogRow;
  state: SourceReconcileState;
  debt: CoverageDebtRecord;
  nowIso: string;
  runId: string;
  discover: CoverageDebtDiscover;
  queryLakeHashes: HashQueryFn;
  workerId?: string;
}): Promise<CoverageDebtExecution> {
  const window = { start: opts.debt.window_start, end: opts.debt.window_end };
  let state: SourceReconcileState = {
    ...opts.state,
    medio_id: opts.debt.medio_id,
    window_start: opts.debt.window_start,
    window_end: opts.debt.window_end,
    cursor: opts.debt.cursor ?? opts.state.cursor,
    status: 'IN_PROGRESS',
    worker_id: opts.workerId ?? opts.state.worker_id,
  };
  await opts.store.upsertSourceState(state);
  await markCoverageDebtInProgress(opts.store, state, opts.nowIso, opts.workerId ?? null);

  const discoverOpts = buildFollowUpDiscoverOpts(
    opts.debt,
    opts.catalog,
    opts.state.discovery_surfaces ?? [],
  );
  const prevCursor = opts.debt.cursor;
  const prevSurfaces = opts.state.discovery_surfaces ?? [];

  const discovery = await opts.discover(opts.catalog, window, discoverOpts);
  const discovered = unionDiscovery([discovery.urls]);
  const lake = await lookupExistingNewsByHashes(
    discovered.map((d) => d.url),
    opts.queryLakeHashes,
  );

  let newUrls = 0;
  let duplicateUrls = 0;
  const visibleDebt = new Set<string>();
  for (const item of discovered) {
    const dec = decideDiscoveredUrl(item, {
      nowIso: opts.nowIso,
      lakeByCanonical: lake,
      catalog: [opts.catalog],
      provenRootCause: discovery.noDiscoverySurface ? 'NO_DISCOVERY_SURFACE' : null,
    });
    const before = await opts.store.get(dec.record.hash_url);
    const rec = await opts.store.upsertDiscovered(dec.record);
    if (before && before.hash_url === rec.hash_url) duplicateUrls += 1;
    else newUrls += 1;
    if (rec.status === 'BLOCKED' || rec.status === 'RETRY' || rec.status === 'MANUAL_REVIEW') {
      visibleDebt.add(rec.status);
    }
    await opts.store.recordObservation({
      run_id: opts.runId,
      hash_url: rec.hash_url,
      medio_id: rec.medio_id,
      window_start: window.start,
      window_end: window.end,
      discovered_via: rec.discovered_via,
      observed_status: rec.status,
      observed_at: opts.nowIso,
      reject_reason: rec.status === 'REJECTED_NON_ARTICLE' ? rec.last_error : null,
    });
  }

  const surfaceResult = discovery.surfaceResult ?? null;
  const pendingWork = Boolean(
    discovery.pendingSubs ||
      discovery.truncated ||
      (discovery.subsFallidos ?? 0) > 0 ||
      (discovery.pendingListingTargets?.length ?? 0) > 0,
  );
  const nextCursor = discovery.cursorRootMismatch
    ? prevCursor
    : discovery.pageExhausted && surfaceResult === 'EXHAUSTED'
      ? null
      : surfaceResult === 'SUCCESS' && !pendingWork
        ? (discovery.cursor ?? null)
        : (discovery.cursor ?? state.cursor);
  const surfaceFound = discovery.probedSurface ?? (discovery.surfaces.find((s) => s !== 'NO_DISCOVERY_SURFACE') ?? null);
  const cursorMoved = Boolean(nextCursor && nextCursor !== prevCursor);
  const pageExhausted = discovery.pageExhausted === true && surfaceResult === 'EXHAUSTED';
  const coverageEvaluated =
    discovery.rssSpanCovered === 'YES' ||
    discovery.sitemapSpanCovered === 'YES' ||
    (pageExhausted && !pendingWork);
  const noop =
    !cursorMoved &&
    newUrls === 0 &&
    sameSurfaces(prevSurfaces, discovery.surfaces) &&
    opts.debt.follow_up !== 'SURFACE_PROBE' &&
    opts.debt.follow_up !== 'SECOND_SURFACE';

  let progressed = false;
  let evaluated = false;
  let result = 'NO_PROGRESS';
  let nextFollowUp: CoverageFollowUp = opts.debt.follow_up;
  if (opts.debt.follow_up === 'PAGINATE_FROM_CURSOR') {
    progressed = cursorMoved || pageExhausted || newUrls > 0;
    evaluated = pageExhausted && !pendingWork && !discovery.cursorNotFound && surfaceResult === 'EXHAUSTED';
    result = discovery.cursorRootMismatch
      ? 'CURSOR_ROOT_MISMATCH'
      : discovery.cursorNotFound
        ? 'CURSOR_NOT_FOUND'
        : surfaceResult === 'FAILED'
          ? 'SITEMAP_FETCH_FAILED'
          : evaluated
            ? 'PAGINATION_EXHAUSTED'
            : surfaceResult === 'PARTIAL'
              ? 'PAGINATION_PARTIAL'
              : 'PAGINATION_NO_PROGRESS';
  } else if (opts.debt.follow_up === 'SECOND_SURFACE') {
    const fetched = canResolveFromSurface(surfaceResult);
    progressed = fetched;
    evaluated =
      fetched &&
      !pendingWork &&
      !discovery.cursorNotFound &&
      !discovery.cursorRootMismatch &&
      (surfaceResult === 'SUCCESS' || (surfaceResult === 'EXHAUSTED' && coverageEvaluated));
    result = surfaceResult === 'FAILED'
      ? 'SECOND_SURFACE_FAILED'
      : surfaceResult === 'UNAVAILABLE' || discoverOpts.onlySurfaces?.length === 0
        ? 'SECOND_SURFACE_UNAVAILABLE'
        : surfaceResult === 'PARTIAL'
          ? 'SECOND_SURFACE_PARTIAL'
          : evaluated
            ? 'SECOND_SURFACE_EVALUATED'
            : 'SECOND_SURFACE_PARTIAL';
  } else if (opts.debt.follow_up === 'SURFACE_PROBE') {
    progressed = Boolean(discovery.probeEvaluated && surfaceFound);
    evaluated = false;
    if (!discovery.probeEvaluated || surfaceResult === 'FAILED') {
      result = 'SURFACE_PROBE_FAILED';
    } else {
      nextFollowUp = discovery.nextFollowUp ?? followUpForProbedSurface(surfaceFound);
      result = `SURFACE_FOUND:${surfaceFound}:CHAIN:${nextFollowUp}`;
    }
  } else {
    progressed = newUrls > 0;
    evaluated =
      !noop &&
      canResolveFromSurface(surfaceResult) &&
      !discovery.capHit &&
      !pendingWork &&
      coverageEvaluated &&
      !discovery.noDiscoverySurface;
    result = evaluated ? 'WINDOW_RESUMED' : 'RESUME_NO_PROGRESS';
  }
  if (noop && opts.debt.follow_up === 'RESUME_SAME_WINDOW') {
    evaluated = false;
    result = 'NOOP_REDISCOVERY';
  }

  state = {
    ...state,
    discovery_surfaces: discovery.surfaces,
    rss_span_covered: discovery.rssSpanCovered,
    sitemap_span_covered: discovery.sitemapSpanCovered,
    listing_span_covered: discovery.listingSpanCovered,
    sitemap_runtime_completeness_invoked: discovery.sitemapRuntimeCompletenessInvoked,
    urls_discovered: discovered.length,
    cap_hit: discovery.capHit,
    cursor: nextCursor,
    last_error: evaluated ? null : result,
  };

  const incremented = await incrementCoverageDebtAttempt(opts.store, state, opts.nowIso);
  const lifecycle = evaluated
    ? 'RESOLVED'
    : incremented && incremented.attempt_count >= 3
      ? 'ESCALATED_MANUAL'
      : 'OPEN_AUTOMATIC';
  await finalizeCoverageDebt(
    opts.store,
    { ...state, status: evaluated ? 'COMPLETE' : 'INCOMPLETE' },
    opts.nowIso,
    lifecycle,
    result,
    { follow_up: nextFollowUp },
  );

  if (evaluated && !noop) {
    await opts.store.upsertSourceState(markSourceTerminal({ ...state, last_error: null }, 'COMPLETE', opts.nowIso));
  } else {
    await opts.store.upsertSourceState(markSourceTerminal(state, 'INCOMPLETE', opts.nowIso));
  }

  const finalDebt = incremented;
  return {
    medio_id: opts.debt.medio_id,
    window_start: opts.debt.window_start,
    window_end: opts.debt.window_end,
    cursor: state.cursor,
    reason: opts.debt.reason,
    follow_up: opts.debt.follow_up,
    attempt_count: finalDebt?.attempt_count ?? opts.debt.attempt_count + 1,
    lifecycle,
    result,
    new_urls: newUrls,
    duplicate_urls: duplicateUrls,
    surface_used: discovery.surfaces,
    surface_found: surfaceFound,
    surface_result: surfaceResult,
    progressed,
    resolved: lifecycle === 'RESOLVED',
    noop_rediscovery: noop,
    next_follow_up: nextFollowUp,
  };
}

export function discoveredUrlIdentity(item: Pick<DiscoveredUrl, 'hashUrl' | 'canonicalUrl'>): string {
  return item.hashUrl || item.canonicalUrl;
}
