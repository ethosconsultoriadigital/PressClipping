/**
 * Ingest Astra V2+V3 como DISCOVERED. Dedup vs medios y entre candidatas.
 * No promociona a public.medios.
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { getSupabase } from '../src/supabase/client.js';
import { logger } from '../src/utils/logger.js';
import { loadAstraV3Package } from '../src/sourceRegistry/astraPackage.js';
import {
  classifySourceKind,
  mapAstraContentOrigin,
  pendingAliasCluster,
} from '../src/sourceRegistry/classifyKind.js';
import { decideDedupe } from '../src/sourceRegistry/dedupe.js';
import { hostnameOf, platformFromUrl, registrableDomain, uniquenessKey, foldName } from '../src/sourceRegistry/identity.js';
import { expansionPriority, isNewsKind, isSignalKind } from '../src/sourceRegistry/priority.js';
import type { AstraCandidateRow } from '../src/sourceRegistry/types.js';

function nextFuenteId(n: number): string {
  return `SRC-${String(n).padStart(4, '0')}`;
}

const SANITY = [
  '88.9 Noticias',
  'Iztapalapa Noticias',
  'Noticias Coyoacán',
  'Guardia Nocturna',
  'Quadratín Chiapas',
  'Quadratin Chiapas',
  'Quadratín Chihuahua',
  'Quadratin Chihuahua',
];

async function main() {
  const dry = process.argv.includes('--dry-run');
  const pkg = loadAstraV3Package('data/source-registry');
  for (const f of pkg.missing) logger.warn({ file: f }, `ASTRA_INPUT_MISSING=${f}`);
  const rows = pkg.merged;
  logger.info({ files: pkg.filesFound, missing: pkg.missing, stats: pkg.stats, dry }, 'Astra ingest load');
  if (!rows.length) {
    writeFileSync(
      'artifacts/source-registry-astra-ingest.json',
      JSON.stringify({ ...pkg.stats, files: pkg.filesFound, dry, note: 'No inventar filas. Ingest omitido.' }, null, 2),
    );
    return;
  }

  const sb = getSupabase();
  const { data: medios, error: eM } = await sb.from('medios').select('medio_id,nombre_medio,url_base,estado');
  if (eM) throw eM;
  const existing = (medios ?? []).map((m) => ({
    uniqueness_key: uniquenessKey({
      hostname: hostnameOf(m.url_base),
      platform: 'WEB' as const,
      canonicalName: m.nombre_medio,
      estado: m.estado,
    }),
    name: m.nombre_medio as string,
    hostname: hostnameOf(m.url_base as string | null),
    estado: (m.estado as string | null) ?? null,
  }));

  const imported: AstraCandidateRow[] = [];
  const duplicates: { name: string; reason: string }[] = [];
  const aliasesPending: { name: string; cluster: string }[] = [];
  const regional: string[] = [];
  const seenKeys = new Set(existing.map((e) => e.uniqueness_key));
  const working = [...existing];

  let seq = 1;
  const { data: maxSrc, error: eMax } = await sb
    .from('fuentes')
    .select('fuente_id')
    .like('fuente_id', 'SRC-%')
    .order('fuente_id', { ascending: false })
    .limit(1);
  if (eMax && !dry && !/schema cache|does not exist|Could not find/i.test(eMax.message ?? '')) {
    throw eMax;
  }
  if (maxSrc?.[0]?.fuente_id) {
    const n = Number.parseInt(String(maxSrc[0].fuente_id).replace(/\D/g, ''), 10);
    if (Number.isFinite(n)) seq = n + 1;
  }

  const parentByGroup = new Map<string, string>();
  let news = 0;
  let signal = 0;
  let other = 0;

  for (const row of rows) {
    const url = row.url ?? (row.domain ? `https://${row.domain}` : null);
    const platform = platformFromUrl(url ?? row.facebook_url);
    const cluster = pendingAliasCluster(row.name);
    if (cluster) aliasesPending.push({ name: row.name, cluster });

    const decision = decideDedupe({
      name: row.name,
      url,
      platform: platform === 'PETITION' ? 'WEB' : platform,
      estado: row.estado,
      existing: working,
    });

    const kind = classifySourceKind({ name: row.name, url, hint: row.source_kind_hint });
    const origin = mapAstraContentOrigin(row.content_origin_hint) ?? kind.content_origin;
    if (isNewsKind(kind.source_kind)) news += 1;
    else if (isSignalKind(kind.source_kind)) signal += 1;
    else other += 1;

    if (decision.action === 'ALIAS_OF') {
      duplicates.push({ name: row.name, reason: decision.reason });
      continue;
    }

    if (seenKeys.has(decision.uniqueness_key) && decision.action !== 'REGIONAL_EDITION') {
      duplicates.push({ name: row.name, reason: 'uniqueness_key_collision' });
      continue;
    }

    if (decision.action === 'REGIONAL_EDITION') regional.push(row.name);

    const host = hostnameOf(url);
    const score = expansionPriority({
      evidenceTier: row.evidence_tier,
      sampleWithin30d: row.sample_within_30d,
      estado: row.estado,
      categoria: row.categoria,
      sourceKind: kind.source_kind,
      hasWebCaptureHint: Boolean(url),
      uniquenessVsLegacy: true,
      municipio: row.municipio,
    }).total;

    const fuenteId = nextFuenteId(seq++);
    let parent: string | null = null;
    if (decision.action === 'REGIONAL_EDITION' || decision.action === 'NEW') {
      const gk = 'group_key' in decision ? decision.group_key : null;
      if (gk) {
        parent = parentByGroup.get(gk) ?? null;
        if (!parent) parentByGroup.set(gk, fuenteId);
      }
    }

    const fuente = {
      fuente_id: fuenteId,
      canonical_name: row.name,
      display_name: row.name,
      source_kind: kind.source_kind,
      content_origin: origin,
      pais: 'MX',
      estado: row.estado,
      municipio: row.municipio,
      region: null,
      categoria: row.categoria,
      lifecycle_status: 'DISCOVERED',
      health_status: 'UNKNOWN',
      capture_status: platform === 'WEB' ? 'UNKNOWN' : 'API_REQUIRED',
      technical_class: null,
      priority: String(score),
      group_parent_fuente_id: parent && parent !== fuenteId ? parent : null,
      legacy_medio_id: null,
      first_seen_at: new Date().toISOString(),
      last_seen_at: null,
      notes: [row.notes, row.astra_batch, row.candidate_id, cluster ? `alias_cluster=${cluster}` : null]
        .filter(Boolean)
        .join(' | '),
      expansion_score: score,
      astra_batch: row.astra_batch,
      evidence_tier: row.evidence_tier,
      uniqueness_key: decision.uniqueness_key,
    };

    const canales = [];
    if (url && (platform === 'WEB' || platform === 'PETITION')) {
      canales.push({
        canal_id: `${fuenteId}-WEB`,
        fuente_id: fuenteId,
        platform: platform === 'PETITION' ? 'PETITION' : 'WEB',
        canonical_url: url,
        canonical_domain: registrableDomain(host),
        hostname: host,
        rss_url: null,
        sitemap_url: null,
        capture_method: null,
        capture_feasibility: row.capture_feasibility ?? (platform === 'PETITION' ? 'SEARCH_ONLY' : 'UNKNOWN'),
        activo: false,
        health_status: 'UNKNOWN',
        capture_status: platform === 'PETITION' ? 'SEARCH_ONLY' : 'UNKNOWN',
        technical_class: null,
        consecutive_failures: 0,
      });
    }
    if (row.facebook_url) {
      canales.push({
        canal_id: `${fuenteId}-FACEBOOK`,
        fuente_id: fuenteId,
        platform: 'FACEBOOK',
        canonical_url: row.facebook_url,
        canonical_domain: 'facebook.com',
        hostname: 'facebook.com',
        activo: false,
        health_status: 'UNKNOWN',
        capture_status: 'API_REQUIRED',
        capture_feasibility: 'API_REQUIRED',
        consecutive_failures: 0,
      });
    }

    seenKeys.add(decision.uniqueness_key);
    working.push({
      uniqueness_key: decision.uniqueness_key,
      name: row.name,
      hostname: host,
      estado: row.estado,
    });
    imported.push(row);

    if (!dry) {
      const { error: e1 } = await sb.from('fuentes').upsert(fuente, { onConflict: 'fuente_id' });
      if (e1) throw e1;
      if (canales.length) {
        const { error: e2 } = await sb.from('fuente_canales').upsert(canales, { onConflict: 'canal_id' });
        if (e2) throw e2;
      }
      if (cluster) {
        await sb.from('fuente_aliases').upsert(
          {
            alias_id: `${fuenteId}-pending`,
            fuente_id: fuenteId,
            alias_name: row.name,
            alias_kind: 'NAME',
            pending: true,
            notes: cluster,
          },
          { onConflict: 'alias_id' },
        );
      }
    }
  }

  const sanityHits = SANITY.filter((w) =>
    rows.some((r) => foldName(r.name).includes(foldName(w))),
  );

  const report = {
    ASTRA_FILES_FOUND: pkg.filesFound,
    BASE_ROWS: pkg.stats.base_rows,
    BASE_UNIQUE: pkg.stats.base_unique,
    ENRICH_ROWS_30D: pkg.stats.enrich_rows_30d,
    ENRICH_ROWS_CDMX_EDOMEX: pkg.stats.enrich_rows_cdmx_edomex,
    SUMMARY_ROWS: pkg.stats.summary_rows,
    SUMMARY_PARSED_AS_SOURCES: pkg.stats.summary_parsed_as_sources,
    MERGED_UNIQUE_CANDIDATES: pkg.stats.merged_unique,
    MATCH_EXISTING_LEGACY: duplicates.length,
    DUPLICATES_INTERNAL: pkg.stats.internal_duplicates,
    REGIONAL_EDITIONS: regional.length,
    ALIASES_PENDING: aliasesPending,
    RECENT_30D_COUNT: rows.filter((r) => r.sample_within_30d || r.evidence_tier === 'RECENT_30D').length,
    NEWS_COUNT: news,
    SIGNAL_COUNT: signal,
    OTHER_COUNT: other,
    WOULD_INSERT_DISCOVERED: imported.length,
    PRODUCTION_MEDIA_ADDED: 0,
    PUBLIC_MEDIOS_MODIFIED: 'NO',
    AI_CALLS: 0,
    PRODUCTION_WRITES: dry ? 0 : imported.length,
    dry,
    sanityHits,
    enrich_matched: pkg.stats.enrich_matched,
    enrich_unmatched: pkg.stats.enrich_unmatched,
  };
  writeFileSync('artifacts/source-registry-astra-ingest.json', JSON.stringify(report, null, 2));
  logger.info(report, 'Astra ingest done (DISCOVERED only, no medios)');
}

main().catch((err) => {
  logger.error(err, 'source-registry-ingest-astra fatal');
  process.exit(1);
});
