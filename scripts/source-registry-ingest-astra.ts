/**
 * Ingest Astra V2+V3 como DISCOVERED. Dedup vs medios y entre candidatas.
 * No promociona a public.medios.
 */
import 'dotenv/config';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getSupabase } from '../src/supabase/client.js';
import { logger } from '../src/utils/logger.js';
import { loadAstraCsvFile } from '../src/sourceRegistry/csv.js';
import { classifySourceKind, pendingAliasCluster } from '../src/sourceRegistry/classifyKind.js';
import { decideDedupe } from '../src/sourceRegistry/dedupe.js';
import { hostnameOf, platformFromUrl, registrableDomain, uniquenessKey } from '../src/sourceRegistry/identity.js';
import { expansionPriority } from '../src/sourceRegistry/priority.js';
import type { AstraCandidateRow } from '../src/sourceRegistry/types.js';

const REQUIRED = [
  'CANDIDATAS_ACUMULADAS_V2_V3.csv',
  'CON_MUESTRA_30D_V3.csv',
  'CDMX_EDOMEX_ADICIONALES_V3.csv',
  'COBERTURA_32_ENTIDADES_V3.csv',
];
const SEARCH = [
  ...REQUIRED.map((f) => `data/source-registry/${f}`),
  ...REQUIRED.map((f) => `artifacts/${f}`),
];

function nextFuenteId(n: number): string {
  return `SRC-${String(n).padStart(4, '0')}`;
}

async function main() {
  const dry = process.argv.includes('--dry-run');
  const extra = process.argv.find((a) => a.startsWith('--csv='))?.slice(6);
  const paths = [...SEARCH, extra].filter((p): p is string => Boolean(p)).map((p) => resolve(p));
  const found = paths.filter((p) => existsSync(p));
  const missing = REQUIRED.filter(
    (f) => !found.some((p) => p.replace(/\\/g, '/').endsWith(`/${f}`) || p.replace(/\\/g, '/').endsWith(f)),
  );
  for (const f of missing) logger.warn({ file: f }, `ASTRA_INPUT_MISSING=${f}`);
  const rows: AstraCandidateRow[] = [];
  for (const p of found) rows.push(...loadAstraCsvFile(p));

  logger.info({ files: found, missing, rows: rows.length, dry }, 'Astra ingest load');
  if (!rows.length) {
    writeFileSync(
      'artifacts/source-registry-astra-ingest.json',
      JSON.stringify(
        {
          files: found,
          astra_input_missing: missing,
          astra_rows_input: 0,
          unique_candidates_imported: 0,
          duplicates_found: 0,
          aliases_pending: [],
          dry,
          note: 'No inventar filas. Ingest omitido.',
        },
        null,
        2,
      ),
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
  const seenKeys = new Set(existing.map((e) => e.uniqueness_key));
  const working = [...existing];

  let seq = 1;
  const { data: maxSrc } = await sb
    .from('fuentes')
    .select('fuente_id')
    .like('fuente_id', 'SRC-%')
    .order('fuente_id', { ascending: false })
    .limit(1);
  if (maxSrc?.[0]?.fuente_id) {
    const n = Number.parseInt(String(maxSrc[0].fuente_id).replace(/\D/g, ''), 10);
    if (Number.isFinite(n)) seq = n + 1;
  }

  const parentByGroup = new Map<string, string>();

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

    if (decision.action === 'ALIAS_OF') {
      duplicates.push({ name: row.name, reason: decision.reason });
      continue;
    }

    if (seenKeys.has(decision.uniqueness_key) && decision.action !== 'REGIONAL_EDITION') {
      duplicates.push({ name: row.name, reason: 'uniqueness_key_collision' });
      continue;
    }

    const kind = classifySourceKind({ name: row.name, url, hint: row.source_kind_hint });
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
      content_origin: kind.content_origin,
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
      notes: [row.notes, row.astra_batch, cluster ? `alias_cluster=${cluster}` : null].filter(Boolean).join(' | '),
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
        capture_feasibility: platform === 'PETITION' ? 'SEARCH_ONLY' : 'UNKNOWN',
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

  const report = {
    files: found,
    astra_rows_input: rows.length,
    unique_candidates_imported: imported.length,
    duplicates_found: duplicates.length,
    aliases_pending: aliasesPending,
    dry,
  };
  writeFileSync('artifacts/source-registry-astra-ingest.json', JSON.stringify(report, null, 2));
  logger.info(report, 'Astra ingest done (DISCOVERED only, no medios)');
}

main().catch((err) => {
  logger.error(err, 'source-registry-ingest-astra fatal');
  process.exit(1);
});
