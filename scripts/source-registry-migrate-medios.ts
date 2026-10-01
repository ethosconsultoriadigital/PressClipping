/**
 * Importa public.medios → public.fuentes + fuente_canales (WEB).
 * No duplica noticias. No cambia medio_id. lifecycle PROMOTED.
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { getSupabase } from '../src/supabase/client.js';
import { logger } from '../src/utils/logger.js';
import { classifySourceKind, editorialGroupKey } from '../src/sourceRegistry/classifyKind.js';
import { hostnameOf, registrableDomain, uniquenessKey } from '../src/sourceRegistry/identity.js';

async function tableExists(name: 'fuentes' | 'fuente_canales'): Promise<boolean> {
  const sb = getSupabase();
  const { error } = await sb.from(name).select('*').limit(1);
  if (!error) return true;
  if (/schema cache|does not exist|Could not find/i.test(error.message ?? '')) return false;
  logger.warn({ name, msg: error.message }, 'table probe inconclusive');
  return false;
}

async function main() {
  const dry = process.argv.includes('--dry-run');
  const sb = getSupabase();
  const { data: medios, error } = await sb
    .from('medios')
    .select(
      'medio_id,nombre_medio,grupo_medio,url_base,pais,estado,municipio,region,categoria,prioridad,activo,metodo_extraccion,rss_url,sitemap_url,notas_tecnicas,created_at,ultimo_scrapeo',
    )
    .order('medio_id');
  if (error) throw error;
  const rows = medios ?? [];
  logger.info({ n: rows.length, dry }, 'Migrando medios → fuentes');

  const keyCount = new Map<string, string[]>();
  const hostCount = new Map<string, string[]>();
  for (const m of rows) {
    const host = hostnameOf(m.url_base);
    const uk = uniquenessKey({
      hostname: host,
      platform: 'WEB',
      canonicalName: m.nombre_medio,
      estado: m.estado,
    });
    keyCount.set(uk, [...(keyCount.get(uk) ?? []), m.medio_id]);
    if (host) hostCount.set(host, [...(hostCount.get(host) ?? []), m.medio_id]);
  }
  const duplicateKeys = [...keyCount.entries()].filter(([, ids]) => ids.length > 1);
  const duplicateHosts = [...hostCount.entries()].filter(([, ids]) => ids.length > 1);
  const webApplicable = rows.filter((m) => Boolean(m.url_base)).length;

  const schemaOk = (await tableExists('fuentes')) && (await tableExists('fuente_canales'));
  const report = {
    LEGACY_MEDIOS_CURRENT: rows.length,
    LEGACY_WITH_WEB_CHANNEL: webApplicable,
    DUPLICATE_LEGACY_IDENTITIES: duplicateKeys.length,
    duplicate_uniqueness_keys: duplicateKeys.slice(0, 40),
    duplicate_hostnames: duplicateHosts.slice(0, 40),
    SCHEMA_READY: schemaOk,
    upserted: 0,
    skippedHealth: 0,
    MIGRATION_ERRORS: [] as string[],
  };

  if (!schemaOk) {
    report.MIGRATION_ERRORS.push('public.fuentes / fuente_canales no existen en LIVE. DDL pendiente SQL Editor.');
    writeFileSync('artifacts/source-registry-migrate-report.json', JSON.stringify(report, null, 2));
    logger.warn(report, 'Migración omitida: schema LIVE ausente');
    return;
  }

  const { data: existingFuentes, error: eEx } = await sb
    .from('fuentes')
    .select('fuente_id,health_status,technical_class,lifecycle_status');
  if (eEx) throw eEx;
  const existing = new Map((existingFuentes ?? []).map((f) => [f.fuente_id, f]));

  const { data: existingCanales, error: eC } = await sb
    .from('fuente_canales')
    .select('canal_id,last_light_probe_at,last_deep_probe_at,health_status,consecutive_failures,technical_class,last_http_status,last_success_at,latest_content_at,redirect_final_url');
  if (eC) throw eC;
  const existingCanal = new Map((existingCanales ?? []).map((c) => [c.canal_id, c]));

  let upserted = 0;
  let skippedHealth = 0;
  for (const m of rows) {
    const kind = classifySourceKind({ name: m.nombre_medio, url: m.url_base });
    const host = hostnameOf(m.url_base);
    const prev = existing.get(m.medio_id);
    const fuente = {
      fuente_id: m.medio_id,
      canonical_name: m.nombre_medio,
      display_name: m.nombre_medio,
      source_kind: kind.source_kind,
      content_origin: kind.content_origin,
      pais: m.pais ?? 'MX',
      estado: m.estado,
      municipio: m.municipio,
      region: m.region,
      categoria: m.categoria,
      lifecycle_status: prev?.lifecycle_status === 'PROMOTED' ? 'PROMOTED' : 'PROMOTED',
      health_status: prev?.health_status ?? 'UNKNOWN',
      capture_status: m.rss_url || m.sitemap_url ? 'READY' : 'PARTIAL',
      technical_class: prev?.technical_class ?? null,
      priority: m.prioridad,
      group_parent_fuente_id: null,
      legacy_medio_id: m.medio_id,
      first_seen_at: m.created_at,
      last_seen_at: m.ultimo_scrapeo,
      notes: m.notas_tecnicas,
      expansion_score: null,
      astra_batch: null,
      evidence_tier: null,
      uniqueness_key: uniquenessKey({
        hostname: host,
        platform: 'WEB',
        canonicalName: m.nombre_medio,
        estado: m.estado,
      }),
    };
    const prevC = existingCanal.get(`${m.medio_id}-WEB`);
    if (prevC?.last_light_probe_at) skippedHealth += 1;
    const canal = {
      canal_id: `${m.medio_id}-WEB`,
      fuente_id: m.medio_id,
      platform: 'WEB',
      canonical_url: m.url_base,
      canonical_domain: registrableDomain(host),
      hostname: host,
      rss_url: m.rss_url,
      sitemap_url: m.sitemap_url,
      capture_method: m.metodo_extraccion,
      capture_feasibility: m.activo ? 'READY' : 'UNKNOWN',
      activo: m.activo,
      health_status: prevC?.health_status ?? 'UNKNOWN',
      capture_status: m.rss_url || m.sitemap_url ? 'READY' : 'PARTIAL',
      technical_class: prevC?.technical_class ?? null,
      last_http_status: prevC?.last_http_status ?? null,
      last_light_probe_at: prevC?.last_light_probe_at ?? null,
      last_deep_probe_at: prevC?.last_deep_probe_at ?? null,
      last_success_at: prevC?.last_success_at ?? null,
      latest_content_at: prevC?.latest_content_at ?? null,
      consecutive_failures: prevC?.consecutive_failures ?? 0,
      redirect_final_url: prevC?.redirect_final_url ?? null,
    };
    if (dry) {
      upserted += 1;
      continue;
    }
    const { error: e1 } = await sb.from('fuentes').upsert(fuente, { onConflict: 'fuente_id' });
    if (e1) throw e1;
    const { error: e2 } = await sb.from('fuente_canales').upsert(canal, { onConflict: 'canal_id' });
    if (e2) throw e2;
    upserted += 1;
  }

  if (!dry) {
    const parentByGroup = new Map<string, string>();
    for (const m of rows) {
      const gk = editorialGroupKey(m.nombre_medio, hostnameOf(m.url_base));
      if (!gk) continue;
      if (!parentByGroup.has(gk)) parentByGroup.set(gk, m.medio_id);
    }
    for (const m of rows) {
      const gk = editorialGroupKey(m.nombre_medio, hostnameOf(m.url_base));
      if (!gk) continue;
      const parent = parentByGroup.get(gk);
      if (!parent || parent === m.medio_id) continue;
      const { error: eP } = await sb
        .from('fuentes')
        .update({ group_parent_fuente_id: parent })
        .eq('fuente_id', m.medio_id);
      if (eP) report.MIGRATION_ERRORS.push(`${m.medio_id}: ${eP.message}`);
    }
  }

  report.upserted = upserted;
  report.skippedHealth = skippedHealth;
  writeFileSync('artifacts/source-registry-migrate-report.json', JSON.stringify(report, null, 2));
  logger.info(report, 'Migración medios completada');
}

main().catch((err) => {
  logger.error(err, 'source-registry-migrate-medios fatal');
  process.exit(1);
});
