/**
 * Capture reliability V5 — cycle scheduler + source/recovery workers.
 * GitHub is one caller. Same CLI works from any scheduler.
 * Production writes require --no-dry-run AND ALLOW_CAPTURE_RECOVERY_WRITES=true.
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { getSupabase } from '../src/supabase/client.js';
import { captureReliabilitySchemaReady } from '../src/captureReliability/schemaReady.js';
import { ingestNoticias, updateNoticiaEnriquecida } from '../src/supabase/repositories.js';
import type { RecoveredNewsPayload } from '../src/captureReliability/recoveryPayload.js';
import { logger } from '../src/utils/logger.js';
import { hostnameOf } from '../src/sourceRegistry/identity.js';
import { fetchAndExtract } from '../src/extractors/html.js';
import {
  createJsonCaptureRecoveryRepository,
  type CaptureReliabilityStore,
} from '../src/captureReliability/captureRecoveryRepository.js';
import { SupabaseCaptureReliabilityStore } from '../src/captureReliability/supabaseStore.js';
import { runReconcileEngine, scheduleSourceJobs } from '../src/captureReliability/engine.js';
import { discoverLiveSource } from '../src/captureReliability/discoverLive.js';
import { loadGapCandidatesFromFile } from '../src/captureReliability/gapCandidates.js';
import { recoveryWritesAllowed } from '../src/captureReliability/writesGuard.js';
import { computeFixedCycle, DEFAULT_SHARD_COUNT } from '../src/captureReliability/cycle.js';
import { drainRecoveryQueue } from '../src/captureReliability/recoveryDrain.js';
import { buildCoverageRemediation } from '../src/captureReliability/coverageRemediation.js';
import { auditQueuedSample } from '../src/captureReliability/queueAudit.js';
import type { ChannelCatalogRow } from '../src/captureReliability/types.js';
import type { LakeRow } from '../src/captureReliability/lakeLookup.js';
import { primaryHash } from '../src/captureReliability/urlIndex.js';

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

function numArg(name: string, fallback: number): number {
  const raw = arg(name);
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

async function loadActiveCatalog(medioIds: string[]): Promise<ChannelCatalogRow[]> {
  const sb = getSupabase();
  const page = 500;
  let from = 0;
  const rows: ChannelCatalogRow[] = [];
  while (true) {
    let q = sb
      .from('medios')
      .select('medio_id,url_base,activo,rss_url,sitemap_url,metodo_extraccion,secciones_urls')
      .eq('activo', true)
      .order('medio_id')
      .range(from, from + page - 1);
    if (medioIds.length) q = q.in('medio_id', medioIds);
    const { data, error } = await q;
    if (error) throw error;
    const batch = data ?? [];
    for (const m of batch) {
      rows.push({
        medio_id: m.medio_id as string,
        url_base: (m.url_base as string | null) ?? null,
        rss_url: (m.rss_url as string | null) ?? null,
        sitemap_url: (m.sitemap_url as string | null) ?? null,
        hostname: hostnameOf(m.url_base as string | null) ?? hostnameOf(m.rss_url as string | null),
        metodo_extraccion: (m.metodo_extraccion as string | null) ?? null,
        secciones_urls: (m.secciones_urls as string | null) ?? null,
      });
    }
    if (batch.length < page) break;
    from += page;
  }
  return rows;
}

async function queryLakeHashes(hashes: string[]): Promise<LakeRow[]> {
  if (!hashes.length) return [];
  const sb = getSupabase();
  const { data, error } = await sb
    .from('noticias')
    .select('noticia_id,hash_url,url_original,url_canonica,texto_cuerpo_nota,texto_nota_limpia')
    .in('hash_url', hashes);
  if (error) throw error;
  return (data ?? []) as LakeRow[];
}

async function persistViaNewsLake(payload: RecoveredNewsPayload): Promise<{ noticiaId: string | null; outcome: 'inserted' | 'known' }> {
  const item = payload.insert;
  const before = await queryLakeHashes([item.hash_url]);
  if (before.length) return { noticiaId: before[0]?.noticia_id ?? null, outcome: 'known' };
  await ingestNoticias([item]);
  const sb = getSupabase();
  const { data, error } = await sb
    .from('noticias')
    .select('noticia_id,medio_id,url_canonica,hash_url')
    .eq('hash_url', item.hash_url)
    .maybeSingle();
  if (error) throw error;
  if (!data?.noticia_id) {
    throw new Error(`persist verification failed for ${item.hash_url}`);
  }
  await updateNoticiaEnriquecida(data.noticia_id as string, payload.enrichment);
  return { noticiaId: data.noticia_id as string, outcome: 'inserted' };
}

async function openStore(jsonPath: string): Promise<{ store: CaptureReliabilityStore; backend: 'supabase' | 'json' }> {
  const sb = getSupabase();
  const ready = await captureReliabilitySchemaReady(sb);
  if (ready === 'PARTIAL_SCHEMA') {
    throw new Error('PARTIAL_SCHEMA: capture reliability tables/RPCs are incomplete. Fail closed. No JSON fallback.');
  }
  if (ready === 'FULLY_READY') {
    return { store: new SupabaseCaptureReliabilityStore(sb), backend: 'supabase' };
  }
  return { store: createJsonCaptureRecoveryRepository(jsonPath), backend: 'json' };
}

function resolveDryRun(): boolean {
  if (process.argv.includes('--no-dry-run')) {
    return process.env.ALLOW_CAPTURE_RECOVERY_WRITES === 'true' ? false : true;
  }
  return true;
}

async function main() {
  const dry = resolveDryRun();
  const allowEnv = process.env.ALLOW_CAPTURE_RECOVERY_WRITES ?? null;
  const writes = recoveryWritesAllowed({ dryRun: dry, allowEnv });
  const mode = (arg('mode') ?? '24h') as '24h' | '72h' | 'auditor';
  const shardCount = numArg('shard-count', DEFAULT_SHARD_COUNT);
  const cycle = computeFixedCycle({
    mode,
    windowStart: arg('window-start'),
    windowEnd: arg('window-end'),
    cycleId: arg('cycle-id'),
    shardCount,
  });
  const medioIds = (arg('medio-ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const maxSourcesThisRun = numArg('max-sources-this-run', 80);
  const shardIndex = numArg('shard-index', 0);
  const safetyCap = numArg('safety-cap', 20000);
  const budgetMs = numArg('time-budget-ms', 1_200_000);
  const recoveryBatchSize = numArg('recovery-batch-size', 50);
  const recoveryConcurrency = numArg('recovery-concurrency', 4);
  const maxRecoveryBatches = numArg('max-recovery-batches', 20);
  const recoveryTimeBudgetMs = numArg('recovery-time-budget-ms', budgetMs);
  const globalConcurrency = numArg('global-concurrency', 8);
  const perHostConcurrency = numArg('per-host-concurrency', 2);
  const processRecovery = !process.argv.includes('--no-recovery');
  const role = arg('role') ?? 'all';
  const runId = arg('run-id') ?? `${cycle.cycle_id}-s${shardIndex}`;
  const storePath = arg('store') ?? 'artifacts/capture-reliability-store.json';
  const gapPath = arg('gap-candidates') ?? 'config/capture-gap-candidates.json';
  const workerId = process.env.RUN_BY ?? 'capture-reliability-worker';
  const recoveryHashes = new Set(
    [
      ...(arg('recovery-hashes') ?? '').split(','),
      ...(arg('recovery-urls') ?? '')
        .split(',')
        .map((u) => u.trim())
        .filter(Boolean)
        .map((u) => primaryHash(u)),
    ]
      .map((s) => s.trim())
      .filter(Boolean),
  );

  const catalog = await loadActiveCatalog(medioIds);
  const { store, backend } = await openStore(storePath);
  const gapCandidates = loadGapCandidatesFromFile(gapPath, catalog);

  mkdirSync('artifacts', { recursive: true });

  if (role === 'scheduler' || role === 'capture-reliability-scheduler') {
    const queued = await scheduleSourceJobs(store, catalog, cycle.window_start, cycle.window_end);
    const report = {
      role: 'scheduler',
      CYCLE_ID: cycle.cycle_id,
      WINDOW_START: cycle.window_start,
      WINDOW_END: cycle.window_end,
      SHARD_COUNT: cycle.shard_count,
      TOTAL_ACTIVE_SOURCES: catalog.length,
      SOURCES_QUEUED: queued,
      STORE_BACKEND: backend,
      PRODUCTION_RECOVERY_WRITES: 0,
      DRY_RUN: dry,
    };
    writeFileSync('artifacts/capture-reliability-24h-dry.json', JSON.stringify(report, null, 2));
    logger.info(report, 'capture-reliability scheduler');
    return;
  }

  if (role === 'recovery' || role === 'capture-reliability-recovery-worker') {
    const drain = await drainRecoveryQueue({
      store,
      workerId,
      nowIso: new Date().toISOString(),
      batchSize: recoveryBatchSize,
      maxBatches: maxRecoveryBatches,
      concurrency: recoveryConcurrency,
      globalConcurrency,
      perHostConcurrency,
      timeBudgetMs: recoveryTimeBudgetMs,
      writesAllowed: writes,
      fetchExtract: (url) => fetchAndExtract(url, { timeoutMs: 12000, maxAttempts: 1 }),
      persistNews: writes ? persistViaNewsLake : undefined,
      onlyHashes: recoveryHashes.size ? recoveryHashes : undefined,
      windowStart: cycle.window_start,
      windowEnd: cycle.window_end,
    });
    const report = {
      role: 'recovery',
      CYCLE_ID: cycle.cycle_id,
      WINDOW_START: cycle.window_start,
      WINDOW_END: cycle.window_end,
      DRY_RUN: dry,
      PRODUCTION_RECOVERY_WRITES: writes ? drain.RECOVERY_PERSISTED : 0,
      ...drain,
    };
    writeFileSync('artifacts/capture-reliability-24h-dry.json', JSON.stringify(report, null, 2));
    logger.info(report, 'capture-reliability recovery');
    return;
  }

  const report = await runReconcileEngine(
    {
      runId,
      cycleId: cycle.cycle_id,
      mode,
      windowStart: cycle.window_start,
      windowEnd: cycle.window_end,
      shardIndex,
      shardCount: cycle.shard_count,
      workerId,
      maxSourcesThisRun,
      safetyCap,
      timeBudgetMs: budgetMs,
      processRecovery: role === 'source' || role === 'capture-reliability-source-worker' ? false : processRecovery,
      dryRun: dry,
      allowWritesEnv: allowEnv,
      gapCandidates,
      nowIso: new Date().toISOString(),
      recoveryBatchSize,
      recoveryConcurrency,
      maxRecoveryBatches,
      recoveryTimeBudgetMs,
      globalConcurrency,
      perHostConcurrency,
      recoveryOnlyHashes: recoveryHashes.size ? recoveryHashes : undefined,
    },
    {
      store,
      catalog,
      discoverSource: discoverLiveSource,
      queryLakeHashes,
      fetchExtract: (url) => fetchAndExtract(url, { timeoutMs: 12000, maxAttempts: 1 }),
      persistNews: writes ? persistViaNewsLake : undefined,
    },
  );

  const remediation = buildCoverageRemediation({ states: report.sourceStates, catalog });
  writeFileSync('artifacts/coverage-remediation-v5.json', JSON.stringify({ generated_at: new Date().toISOString(), rows: remediation }, null, 2));
  const queued = report.sample_queued.filter((r) => r.status === 'QUEUED' || r.status === 'FETCH_TO_CLASSIFY');
  const snap = await store.snapshot();
  const audit = auditQueuedSample(
    snap.filter((r) => r.status === 'QUEUED' || r.status === 'FETCH_TO_CLASSIFY'),
    { start: cycle.window_start, end: cycle.window_end },
    40,
  );
  writeFileSync('artifacts/queued-sample-audit-v5.json', JSON.stringify(audit, null, 2));

  const out = {
    ...report,
    STORE_BACKEND: backend,
    FULL_CATALOG_STRATEGY: 'fixed_cycle + deterministic shards',
    PRODUCTION_RECOVERY_WRITES: writes ? report.PRODUCTION_RECOVERY_WRITES : 0,
    WRITES_ALLOWED: writes,
    DRY_RUN: dry,
    SECRET_ENABLED: allowEnv === 'true',
    QUEUED_SAMPLE_TOTAL: audit.total,
    VALID_RECENT_RATE: audit.rates.VALID_ARTICLE_RECENT,
    WRONG_WINDOW_RATE: audit.rates.WRONG_WINDOW + audit.rates.VALID_ARTICLE_OLD,
    NON_ARTICLE_RATE: audit.rates.NON_ARTICLE,
    WINDOW_MEMBERSHIP_UNKNOWN_RATE: audit.rates.WINDOW_MEMBERSHIP_UNKNOWN,
  };
  writeFileSync('artifacts/capture-reliability-24h-dry.json', JSON.stringify(out, null, 2));
  logger.info(out, 'capture-reliability');
}

main().catch((e) => {
  logger.error(e, 'capture-reconcile fatal');
  process.exit(1);
});
