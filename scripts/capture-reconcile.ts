/**
 * 24h / 72h URL-first reconciliation. Default --dry-run (no inserts).
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { getSupabase } from '../src/supabase/client.js';
import { logger } from '../src/utils/logger.js';
import { fetchRss } from '../src/parsers/rss.js';
import { fetchSitemap } from '../src/parsers/sitemap.js';
import { hostnameOf } from '../src/sourceRegistry/identity.js';
import { emptyCheckpoint, persistProgress, timeBudgetExceeded, resumeFrom } from '../src/captureReliability/checkpoint.js';
import { decideDiscoveredUrl, unionDiscovery, type LakeRow } from '../src/captureReliability/reconcile.js';
import { rssWindowCompleteness } from '../src/captureReliability/rssWindow.js';
import { RecoveryQueue, googleAuditorClassify } from '../src/captureReliability/recoveryQueue.js';
import { captureCanonicalUrl, captureUrlHashes, primaryHash, hostOf } from '../src/captureReliability/urlIndex.js';
import type { DiscoveredUrl, CompletenessFlag } from '../src/captureReliability/types.js';

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

function hoursWindow(hours: number): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end.getTime() - hours * 3600_000);
  return { start: start.toISOString(), end: end.toISOString() };
}

async function main() {
  const dry = !process.argv.includes('--no-dry-run');
  const mode = (arg('mode') ?? '24h') as '24h' | '72h';
  const hours = mode === '72h' ? 72 : 24;
  const window = hoursWindow(hours);
  const medioIds = (arg('medio-ids') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const limit = Number.parseInt(arg('limit') ?? '8', 10);
  const safetyCap = Number.parseInt(arg('safety-cap') ?? '5000', 10);
  const budgetMs = Number.parseInt(arg('time-budget-ms') ?? '180000', 10);
  const runId = `caprel-${mode}-${Date.now()}`;
  const started = Date.now();

  const sb = getSupabase();
  let mq = sb
    .from('medios')
    .select('medio_id,nombre_medio,url_base,activo,rss_url,sitemap_url,metodo_extraccion')
    .eq('activo', true)
    .order('medio_id');
  if (medioIds.length) mq = mq.in('medio_id', medioIds);
  const { data: medios, error } = await mq.limit(limit);
  if (error) throw error;
  const catalog = medios ?? [];

  const knownHosts = new Map<string, { medioId: string }>();
  for (const m of catalog) {
    const h = hostnameOf(m.url_base);
    if (h) knownHosts.set(h, { medioId: m.medio_id });
  }

  const incidentHosts = ['afondojalisco.com', 'concienciapublica.com.mx', 'entornoinformativo.com.mx'];
  const lakeHashes = new Set<string>();
  const lakeByHash = new Map<string, LakeRow>();
  for (const h of incidentHosts) {
    const { data } = await sb
      .from('noticias')
      .select('hash_url,url_original,url_canonica,texto_cuerpo_nota,texto_nota_limpia,created_at')
      .or(`url_original.ilike.%${h}%,url_canonica.ilike.%${h}%`)
      .limit(500);
    for (const r of data ?? []) {
      const row = r as LakeRow;
      lakeHashes.add(row.hash_url);
      lakeByHash.set(row.hash_url, row);
      const extras = [row.url_original, row.url_canonica].filter(Boolean) as string[];
      for (const u of extras) {
        for (const hh of captureUrlHashes(u)) {
          lakeHashes.add(hh);
          lakeByHash.set(hh, row);
        }
      }
    }
  }

  let cp = emptyCheckpoint({
    run_id: runId,
    mode,
    window_start: window.start,
    window_end: window.end,
  });
  const queue = new RecoveryQueue();
  const counts = {
    URLS_DISCOVERED: 0,
    URLS_ALREADY_KNOWN: 0,
    URLS_NEW: 0,
    WOULD_INSERT_MISSING: 0,
    WOULD_ENRICH_EXISTING: 0,
    WOULD_RETRY: 0,
    WOULD_REJECT_NON_ARTICLE: 0,
    SOURCE_DISCOVERY_PENDING: 0,
  };
  const missingBySource: Record<string, number> = {};
  const rssFlags: CompletenessFlag[] = [];
  let capHit = false;
  let timeBudgetHit = false;
  const sourcesIncomplete: string[] = [];

  const remaining = resumeFrom(cp, catalog.map((m) => m.medio_id));
  const byId = new Map(catalog.map((m) => [m.medio_id, m]));

  for (const id of remaining) {
    if (timeBudgetExceeded(started, budgetMs, Date.now())) {
      timeBudgetHit = true;
      cp = { ...cp, time_budget_hit: true };
      break;
    }
    const m = byId.get(id);
    if (!m) continue;
    const layers: DiscoveredUrl[][] = [];
    let rssComplete: CompletenessFlag = 'UNKNOWN';
    if (m.rss_url) {
      try {
        const items = await fetchRss(m.rss_url);
        const mapped: DiscoveredUrl[] = items.map((it) => ({
          url: it.url,
          canonicalUrl: captureCanonicalUrl(it.url),
          hashUrl: primaryHash(it.url),
          medioId: m.medio_id,
          fuenteId: null,
          hostname: hostOf(it.url),
          discoveredVia: 'rss',
          publishedAt: it.fecha ?? null,
          titulo: it.titulo ?? null,
          resumen: it.resumen ?? null,
          body: null,
        }));
        const win = rssWindowCompleteness(
          mapped.map((x) => ({ publishedAt: x.publishedAt })),
          window.start,
          window.end,
        );
        rssComplete = win.flag;
        rssFlags.push(win.flag);
        if (win.flag === 'NO') sourcesIncomplete.push(m.medio_id);
        layers.push(mapped.filter((x) => !x.publishedAt || Date.parse(x.publishedAt) >= Date.parse(window.start)));
      } catch (e) {
        sourcesIncomplete.push(m.medio_id);
        logger.warn({ medio_id: m.medio_id, err: e instanceof Error ? e.message : String(e) }, 'rss discovery fail');
      }
    } else {
      rssFlags.push('UNKNOWN');
    }
    if (m.sitemap_url) {
      try {
        const items = await fetchSitemap(m.sitemap_url, { limit: 400, maxSubSitemaps: 15, maxDepth: 2 });
        layers.push(
          items.map((it) => ({
            url: it.url,
            canonicalUrl: captureCanonicalUrl(it.url),
            hashUrl: primaryHash(it.url),
            medioId: m.medio_id,
            fuenteId: null,
            hostname: hostOf(it.url),
            discoveredVia: 'sitemap',
            publishedAt: it.fecha ?? null,
            titulo: it.titulo ?? null,
            resumen: it.resumen ?? null,
            body: null,
          })),
        );
      } catch (e) {
        sourcesIncomplete.push(m.medio_id);
        logger.warn({ medio_id: m.medio_id, err: e instanceof Error ? e.message : String(e) }, 'sitemap discovery fail');
      }
    } else if (rssComplete === 'NO') {
      sourcesIncomplete.push(`${m.medio_id}:RSS_TRUNCATION+SITEMAP_NOT_SCANNED`);
    }

    const discovered = unionDiscovery(layers);
    counts.URLS_DISCOVERED += discovered.length;
    if (counts.URLS_DISCOVERED > safetyCap) {
      capHit = true;
      cp = { ...cp, cap_hit: true };
      break;
    }
    for (const d of discovered) {
      const dec = decideDiscoveredUrl(d, {
        nowIso: new Date().toISOString(),
        lakeHashes,
        lakeByHash,
        knownHosts,
      });
      queue.upsert(dec.record);
      if (dec.action === 'SKIP_KNOWN') counts.URLS_ALREADY_KNOWN += 1;
      if (dec.action === 'WOULD_INSERT') {
        counts.WOULD_INSERT_MISSING += 1;
        counts.URLS_NEW += 1;
        missingBySource[m.medio_id] = (missingBySource[m.medio_id] ?? 0) + 1;
      }
      if (dec.action === 'WOULD_ENRICH') counts.WOULD_ENRICH_EXISTING += 1;
      if (dec.action === 'WOULD_RETRY') counts.WOULD_RETRY += 1;
      if (dec.action === 'WOULD_REJECT') counts.WOULD_REJECT_NON_ARTICLE += 1;
      if (dec.action === 'SOURCE_DISCOVERY_PENDING') counts.SOURCE_DISCOVERY_PENDING += 1;
    }
    cp = persistProgress(cp, m.medio_id, new Date().toISOString());
  }

  const googleItems = [
    'https://afondojalisco.com/monreal-arropa-a-mery-pozos-durante-su-informe-fortalece-su-presencia-rumbo-a-guadalajara/',
    'https://concienciapublica.com.mx/2026/10/02/monreal-mery-pozos/',
    'https://entornoinformativo.com.mx/plantea-fortalecer-presupuesto-a-universidades-publicas-la-rectora-de-unison-dena-maria-camarena/',
  ];
  const google = googleItems.map((url) => {
    const host = hostnameOf(url) ?? '';
    const inLake = [...lakeByHash.values()].some(
      (r) => (r.url_original && captureCanonicalUrl(r.url_original) === captureCanonicalUrl(url)) ||
        (r.url_canonica && captureCanonicalUrl(r.url_canonica) === captureCanonicalUrl(url)),
    );
    return {
      url,
      host,
      class: googleAuditorClassify({
        publisherHost: host,
        knownHosts: new Set(knownHosts.keys()),
        inLake,
      }),
    };
  });

  const report = {
    RUN_ID: runId,
    WINDOW_START: window.start,
    WINDOW_END: window.end,
    dry,
    PRODUCTION_RECOVERY_WRITES: 0,
    SOURCES_ATTEMPTED: cp.processed_medio_ids.length,
    SOURCES_INCOMPLETE: [...new Set(sourcesIncomplete)],
    CAP_HIT: capHit,
    TIME_BUDGET_HIT: timeBudgetHit,
    RECONCILIATION_24H_COMPLETE: mode === '24h' && !capHit && !timeBudgetHit && sourcesIncomplete.length === 0,
    DEEP_72H_COMPLETE: mode === '72h' && !capHit && !timeBudgetHit,
    RSS_WINDOW_FLAGS: rssFlags,
    KNOWN_SOURCES_SCANNED: catalog.map((m) => m.medio_id),
    DISCOVERED_ARTICLES_24H: counts.URLS_DISCOVERED,
    ALREADY_IN_NEWS_LAKE: counts.URLS_ALREADY_KNOWN,
    MISSING_FROM_NEWS_LAKE: counts.WOULD_INSERT_MISSING,
    MISSING_RATE:
      counts.URLS_DISCOVERED === 0 ? 0 : counts.WOULD_INSERT_MISSING / counts.URLS_DISCOVERED,
    MISSING_BY_SOURCE: missingBySource,
    WOULD_RECOVER: counts.WOULD_INSERT_MISSING,
    WOULD_INSERT_MISSING: counts.WOULD_INSERT_MISSING,
    WOULD_ENRICH_EXISTING: counts.WOULD_ENRICH_EXISTING,
    WOULD_RETRY: counts.WOULD_RETRY,
    WOULD_REJECT_NON_ARTICLE: counts.WOULD_REJECT_NON_ARTICLE,
    GOOGLE_AUDITOR: google,
    GOOGLE_MISSING_KNOWN_SOURCE: google.filter((g) => g.class === 'RECOVERY_CANDIDATE').length,
    checkpoint: cp,
    sample_queued: queue.byStatus('QUEUED').slice(0, 25),
  };
  writeFileSync('artifacts/capture-reliability-24h-dry.json', JSON.stringify(report, null, 2));
  logger.info(report, 'capture-reliability dry-run');
}

main().catch((e) => {
  logger.error(e, 'capture-reconcile fatal');
  process.exit(1);
});
