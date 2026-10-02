/**
 * Capture reliability V3 — scheduler + worker.
 * Default dry-run. Production writes require --no-dry-run AND ALLOW_CAPTURE_RECOVERY_WRITES=true.
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { getSupabase } from '../src/supabase/client.js';
import { ingestNoticias } from '../src/supabase/repositories.js';
import { logger } from '../src/utils/logger.js';
import { hostnameOf } from '../src/sourceRegistry/identity.js';
import { fetchAndExtract } from '../src/extractors/html.js';
import {
  createJsonCaptureRecoveryRepository,
  type CaptureReliabilityStore,
} from '../src/captureReliability/captureRecoveryRepository.js';
import { captureRecoveryQueueTableExists, SupabaseCaptureReliabilityStore } from '../src/captureReliability/supabaseStore.js';
import { runReconcileEngine } from '../src/captureReliability/engine.js';
import { discoverLiveSource } from '../src/captureReliability/discoverLive.js';
import { loadGapCandidatesFromFile } from '../src/captureReliability/gapCandidates.js';
import { recoveryWritesAllowed } from '../src/captureReliability/writesGuard.js';
import type { ChannelCatalogRow } from '../src/captureReliability/types.js';
import type { LakeRow } from '../src/captureReliability/lakeLookup.js';
import type { NoticiaInsert } from '../src/normalizers/noticia.js';

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

function hoursWindow(hours: number): { start: string; end: string } {
  const end = new Date();
  end.setUTCMinutes(0, 0, 0);
  const start = new Date(end.getTime() - hours * 3600_000);
  return { start: start.toISOString(), end: end.toISOString() };
}

async function loadActiveCatalog(medioIds: string[]): Promise<ChannelCatalogRow[]> {
  const sb = getSupabase();
  const page = 500;
  let from = 0;
  const rows: ChannelCatalogRow[] = [];
  while (true) {
    let q = sb
      .from('medios')
      .select('medio_id,url_base,activo,rss_url,sitemap_url')
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
    .select('hash_url,url_original,url_canonica,texto_cuerpo_nota,texto_nota_limpia')
    .in('hash_url', hashes);
  if (error) throw error;
  return (data ?? []) as LakeRow[];
}

async function persistViaNewsLake(item: NoticiaInsert): Promise<{ noticiaId: string | null; inserted: boolean }> {
  await ingestNoticias([item]);
  return { noticiaId: null, inserted: true };
}

async function openStore(jsonPath: string): Promise<{ store: CaptureReliabilityStore; backend: 'supabase' | 'json' }> {
  try {
    const sb = getSupabase();
    if (await captureRecoveryQueueTableExists(sb)) {
      return { store: new SupabaseCaptureReliabilityStore(sb), backend: 'supabase' };
    }
  } catch {
    /* tables not LIVE — JSON durable fallback */
  }
  return { store: createJsonCaptureRecoveryRepository(jsonPath), backend: 'json' };
}

async function main() {
  const dry = !process.argv.includes('--no-dry-run');
  const allowEnv = process.env.ALLOW_CAPTURE_RECOVERY_WRITES ?? null;
  const writes = recoveryWritesAllowed({ dryRun: dry, allowEnv });
  const mode = (arg('mode') ?? '24h') as '24h' | '72h' | 'auditor';
  const hours = mode === '72h' ? 72 : 24;
  const computed = hoursWindow(hours);
  const window = {
    start: arg('window-start') ?? computed.start,
    end: arg('window-end') ?? computed.end,
  };
  const medioIds = (arg('medio-ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const maxSourcesThisRun = Number.parseInt(arg('max-sources-this-run') ?? arg('limit') ?? '80', 10);
  const shardIndex = Number.parseInt(arg('shard-index') ?? '0', 10);
  const shardCount = Number.parseInt(arg('shard-count') ?? '1', 10);
  const safetyCap = Number.parseInt(arg('safety-cap') ?? '20000', 10);
  const budgetMs = Number.parseInt(arg('time-budget-ms') ?? '1200000', 10);
  const processRecovery = !process.argv.includes('--no-recovery');
  const role = arg('role') ?? 'all';
  const runId = arg('run-id') ?? `caprel-${mode}-${Date.now()}`;
  const storePath = arg('store') ?? 'artifacts/capture-reliability-store.json';
  const gapPath = arg('gap-candidates') ?? 'config/capture-gap-candidates.json';
  const workerId = process.env.RUN_BY ?? 'capture-reliability-worker';

  const catalog = await loadActiveCatalog(medioIds);
  const { store, backend } = await openStore(storePath);
  const gapCandidates = loadGapCandidatesFromFile(gapPath);

  if (role === 'scheduler') {
    const { scheduleSourceJobs } = await import('../src/captureReliability/engine.js');
    const queued = await scheduleSourceJobs(store, catalog, window.start, window.end);
    const report = {
      role: 'scheduler',
      RUN_ID: runId,
      TOTAL_ACTIVE_SOURCES: catalog.length,
      SOURCES_QUEUED: queued,
      STORE_BACKEND: backend,
      PRODUCTION_RECOVERY_WRITES: 0,
    };
    mkdirSync('artifacts', { recursive: true });
    writeFileSync('artifacts/capture-reliability-24h-dry.json', JSON.stringify(report, null, 2));
    logger.info(report, 'capture-reliability scheduler');
    return;
  }

  const report = await runReconcileEngine(
    {
      runId,
      mode,
      windowStart: window.start,
      windowEnd: window.end,
      shardIndex,
      shardCount,
      workerId,
      maxSourcesThisRun,
      safetyCap,
      timeBudgetMs: budgetMs,
      processRecovery,
      dryRun: dry,
      allowWritesEnv: allowEnv,
      gapCandidates,
      nowIso: new Date().toISOString(),
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

  const out = {
    ...report,
    STORE_BACKEND: backend,
    LIMIT_12_REMOVED: true,
    FULL_CATALOG_STRATEGY: 'paginate_medios + durable source jobs + shards',
    PRODUCTION_RECOVERY_WRITES: writes ? report.PRODUCTION_RECOVERY_WRITES : 0,
    WRITES_ALLOWED: writes,
    DRY_RUN: dry,
  };
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/capture-reliability-24h-dry.json', JSON.stringify(out, null, 2));
  logger.info(out, 'capture-reliability');
}

main().catch((e) => {
  logger.error(e, 'capture-reconcile fatal');
  process.exit(1);
});
