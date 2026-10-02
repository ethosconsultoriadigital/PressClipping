/**
 * Dry-run Zero-Loss Reliability V4.
 * NO escribe MASTER. NO inserta News Lake. NO alertas.
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getSupabase } from '../src/supabase/client.js';
import { getAllClientes, getKeywordsActivas } from '../src/supabase/repositories.js';
import { hasTrustedSearchableText } from '../src/matching/trustedBody.js';
import { RECOVERY_WINDOW_HOURS, windowSinceHours } from '../src/matching/matchWindows.js';
import {
  classifyPublisher,
  fetchGoogleNewsItems,
  recoveryQueriesFromKeywords,
  resolvePublisherUrl,
} from '../src/matching/googleNewsRecoveryRadar.js';
import { canonicalizeUrl } from '../src/normalizers/url.js';
import { fetchAndExtract } from '../src/extractors/html.js';
import {
  buildRows,
  fetchEligibleNewsPaged,
  groupKeywordsByActiveClient,
  RECOVERY_FETCH_CAP,
  type MasterNewsRow,
} from './mentions-master-fast-lane.js';
import { logger } from '../src/utils/logger.js';

const INFORMADOR_IDS = [
  '7a790fdf-49bb-47c9-8153-d341614c14a7',
  'c00957ec-4bb7-4f66-85ba-e4965e02678b',
  'cde2e64c-767d-41a0-ac31-793ea9cff836',
];
const RSS_URLS = [
  'https://afondojalisco.com/monreal-arropa-a-mery-pozos-durante-su-informe-fortalece-su-presencia-rumbo-a-guadalajara/',
  'https://entornoinformativo.com.mx/plantea-fortalecer-presupuesto-a-universidades-publicas-la-rectora-de-unison-dena-maria-camarena/',
  'https://concienciapublica.com.mx/2026/10/02/monreal-mery-pozos/',
];

function pick(row: Record<string, string | number | boolean | null>) {
  return {
    cliente_id: row['cliente_id'],
    noticia_id: row['NOTICIA'],
    medio: row['medio'],
    titulo: row['titulo / titular'],
    url: row['url'],
    campo_match: row['campo_match'],
    keyword_ids_matched: row['keyword_ids_matched'],
    dedupe_key: row['dedupe_key'],
  };
}

async function lookupUrl(url: string) {
  const canon = canonicalizeUrl(url);
  const sb = getSupabase();
  const cols = 'noticia_id, titulo, resumen, url_original, texto_cuerpo_nota, calidad_extraccion, medio_id';
  const { data, error } = await sb.from('noticias').select(cols).eq('url_original', url).limit(5);
  const { data: data2 } = await sb.from('noticias').select(cols).eq('url_original', canon).limit(5);
  let path = '';
  try {
    path = new URL(url).pathname.replace(/\/$/, '').slice(-48);
  } catch {
    path = '';
  }
  const { data: like } = path
    ? await sb.from('noticias').select(cols).ilike('url_original', `%${path}%`).limit(5)
    : { data: [] };
  const rows = [...(data ?? []), ...(data2 ?? [])];
  if (error) return { url, canon, error: error.message, rows, like: like ?? [] };
  return { url, canon, rows, like: like ?? [] };
}

async function fetchByIds(ids: string[]): Promise<MasterNewsRow[]> {
  const { data, error } = await getSupabase()
    .from('noticias')
    .select(
      'noticia_id, medio_id, titulo, subtitulo, resumen, url_original, fecha_publicacion, fecha_captura, autor, seccion, texto_extraido, texto_nota_limpia, texto_cuerpo_nota, tipo_nota, calidad_extraccion, medios(nombre_medio)',
    )
    .in('noticia_id', ids);
  if (error) throw new Error(error.message);
  return (data ?? []).map((n: any) => ({
    noticia_id: n.noticia_id,
    medio_id: n.medio_id ?? null,
    medio_nombre: n.medios?.nombre_medio ?? null,
    titulo: n.titulo ?? null,
    subtitulo: n.subtitulo ?? null,
    resumen: n.resumen ?? null,
    url_original: n.url_original ?? null,
    fecha_publicacion: n.fecha_publicacion ?? null,
    fecha_captura: n.fecha_captura ?? null,
    autor: n.autor ?? null,
    seccion: n.seccion ?? null,
    texto_extraido: n.texto_extraido ?? null,
    texto_nota_limpia: n.texto_nota_limpia ?? null,
    texto_cuerpo_nota: n.texto_cuerpo_nota ?? null,
    tipo_nota: n.tipo_nota ?? null,
    calidad_extraccion: n.calidad_extraccion ?? null,
  }));
}

async function main(): Promise<void> {
  const sinceIso = windowSinceHours(RECOVERY_WINDOW_HOURS);
  const [clients, keywords] = await Promise.all([getAllClientes(), getKeywordsActivas()]);
  const { keywordsByClient, clientNames } = groupKeywordsByActiveClient(clients, keywords);
  const paged = await fetchEligibleNewsPaged(sinceIso, undefined, RECOVERY_FETCH_CAP);
  const news = paged.rows;
  const titleNull = news.filter((n) => !n.titulo?.trim()).length;
  const summaryNull = news.filter((n) => !n.resumen?.trim()).length;
  const urlNull = news.filter((n) => !n.url_original?.trim()).length;
  const trustedBody = news.filter((n) => (n.texto_cuerpo_nota ?? '').trim().length > 0).length;

  const currentLike = news.filter((n) => n.titulo?.trim() && n.resumen?.trim() && n.url_original?.trim());
  const v4Rows = buildRows(news, keywordsByClient, clientNames, {
    masterBodyV2: true,
    bodyPolicy: 'general',
    mode: 'body_v4',
  });
  const oldRows = buildRows(currentLike, keywordsByClient, clientNames, {
    masterBodyV2: true,
    bodyPolicy: 'general',
    mode: 'body_v4',
  });
  const oldKeys = new Set(oldRows.map((r) => String(r['dedupe_key'])));
  const wouldRecoverMaster = v4Rows.filter((r) => !oldKeys.has(String(r['dedupe_key']))).map(pick);

  const informador = await fetchByIds(INFORMADOR_IDS);
  const informadorMatches = buildRows(informador, keywordsByClient, clientNames, {
    masterBodyV2: true,
    bodyPolicy: 'general',
    mode: 'body_v4',
  });

  const { data: medios } = await getSupabase().from('medios').select('medio_id,nombre_medio,url_base');
  const medioRows = (medios ?? []) as Array<{ medio_id: string; nombre_medio: string; url_base: string | null }>;

  const lakeLookups = [];
  for (const url of RSS_URLS) lakeLookups.push(await lookupUrl(url));

  const sampleCases = [];
  for (const url of RSS_URLS) {
    const hit = lakeLookups.find((h) => h.url === url)!;
    const cls = classifyPublisher(url, medioRows);
    const extract = await fetchAndExtract(url, { timeoutMs: 12_000, maxAttempts: 1 });
    const synthetic: MasterNewsRow = {
      noticia_id: `synthetic-${cls.hostname ?? 'host'}`,
      medio_id: cls.medio_id,
      medio_nombre: null,
      titulo: extract.titulo,
      subtitulo: null,
      resumen: extract.resumen,
      url_original: extract.finalUrl ?? url,
      fecha_publicacion: null,
      fecha_captura: new Date().toISOString(),
      autor: extract.autor,
      seccion: extract.seccion,
      texto_extraido: null,
      texto_nota_limpia: extract.texto_nota_limpia,
      texto_cuerpo_nota: extract.texto_cuerpo_nota,
      tipo_nota: extract.tipo_nota,
      calidad_extraccion: extract.calidad_extraccion,
    };
    const matches = buildRows([synthetic], keywordsByClient, clientNames, {
      masterBodyV2: true,
      bodyPolicy: 'general',
      mode: 'body_v4',
    });
    const inLake = (hit.rows as unknown[]).length > 0 || (hit.like as unknown[]).length > 0;
    sampleCases.push({
      url,
      in_news_lake: inLake,
      hostname: cls.hostname,
      source_kind: cls.kind,
      medio_id: cls.medio_id,
      extract_ok: extract.ok,
      extract_error: extract.error,
      titulo: extract.titulo,
      resumen: extract.resumen,
      trusted_body_chars: (extract.texto_cuerpo_nota ?? '').length,
      merilyn_in_trusted_body: /merilyn/i.test(extract.texto_cuerpo_nota ?? ''),
      mery_in_title: /mery/i.test(extract.titulo ?? ''),
      would_match: matches.map(pick),
      would_recover_news_lake: !inLake && cls.kind === 'known',
    });
  }

  const queries = recoveryQueriesFromKeywords(keywords, 12);
  const rssItems = [];
  for (const q of queries.slice(0, 6)) {
    try {
      const items = await fetchGoogleNewsItems(q.query, q.keyword_id, q.cliente_id);
      rssItems.push(...items.slice(0, 8));
    } catch (err) {
      logger.warn({ query: q.query, err: err instanceof Error ? err.message : String(err) }, 'google rss query failed');
    }
  }

  const resolved = [];
  const seenHostUrl = new Set<string>();
  for (const it of rssItems) {
    const pub = await resolvePublisherUrl(it.google_item_url);
    const cls = classifyPublisher(pub, medioRows);
    const key = pub.toLowerCase();
    if (seenHostUrl.has(key)) continue;
    seenHostUrl.add(key);
    resolved.push({ ...it, publisher_final_url: pub, hostname: cls.hostname, source_kind: cls.kind, medio_id: cls.medio_id });
  }

  const missing = [];
  for (const r of resolved) {
    if (!r.publisher_final_url) continue;
    const hit = await lookupUrl(r.publisher_final_url);
    if ((hit.rows as unknown[]).length === 0 && (hit.like as unknown[]).length === 0) {
      missing.push({ ...r, would_recover_news_lake: r.source_kind === 'known', unknown_source: r.source_kind === 'unknown' });
    }
  }

  const payload = {
    generated_at: new Date().toISOString(),
    production_writes: 0,
    alerts_sent: 0,
    LIVE_WINDOW_HOURS: 2,
    RECOVERY_WINDOW_HOURS,
    sinceIso,
    live_news_scanned: news.filter((n) => (n.fecha_captura ?? '') >= windowSinceHours(2)).length,
    recovery_news_scanned: news.length,
    title_null_count: titleNull,
    summary_null_count: summaryNull,
    url_null_count: urlNull,
    trusted_body_available: trustedBody,
    pages_scanned: paged.pagesScanned,
    cap_hit: paged.capHit,
    old_eligibility_matches: oldRows.length,
    v4_matches: v4Rows.length,
    WOULD_RECOVER_MASTER: wouldRecoverMaster.length,
    would_recover_master_rows: wouldRecoverMaster.slice(0, 80),
    informador_cases: informador.map((n) => ({
      noticia_id: n.noticia_id,
      titulo: n.titulo,
      resumen: n.resumen,
      matchable: hasTrustedSearchableText(n),
    })),
    informador_matches: informadorMatches.map(pick),
    google_rss_items: resolved.length,
    google_rss_known: resolved.filter((r) => r.source_kind === 'known').length,
    google_rss_unknown: resolved.filter((r) => r.source_kind === 'unknown').length,
    MISSING_FROM_NEWS_LAKE: missing.length + sampleCases.filter((s) => !s.in_news_lake).length,
    WOULD_RECOVER_NEWS_LAKE:
      missing.filter((m) => m.would_recover_news_lake).length +
      sampleCases.filter((s) => s.would_recover_news_lake).length,
    missing_examples: missing.slice(0, 40),
    rss_url_lookups: lakeLookups,
    rss_sample_cases: sampleCases,
  };

  const dir = join(process.cwd(), 'artifacts');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `zero-loss-reliability-v4-dry-run-${new Date().toISOString().slice(0, 10)}.json`);
  writeFileSync(out, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify({
    out,
    recovery_news_scanned: news.length,
    cap_hit: paged.capHit,
    WOULD_RECOVER_MASTER: wouldRecoverMaster.length,
    informador_matches: informadorMatches.length,
    google_rss_items: resolved.length,
    MISSING_FROM_NEWS_LAKE: missing.length,
    WOULD_RECOVER_NEWS_LAKE:
      missing.filter((m) => m.would_recover_news_lake).length +
      sampleCases.filter((s) => s.would_recover_news_lake).length,
    sample_in_lake: sampleCases.filter((s) => s.in_news_lake).length,
    sample_would_match: sampleCases.map((s) => ({ url: s.url, matches: s.would_match.length })),
  }, null, 2));
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
