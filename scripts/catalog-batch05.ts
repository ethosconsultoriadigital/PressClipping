/**
 * Alta al catálogo: 20 medios — NEW SOURCE BATCH 05 (2026-09-25).
 *
 * Re-probe LIVE de 4 HIGH_CONFIDENCE_PENDING restantes + deep discovery
 * pública de 40 NEEDS_SOURCE_DISCOVERY. 26 STRICT crudos → 20 HIGH_CONFIDENCE_STRICT
 * tras filtros (red Uniradio, índices masivos, magazines). Cap 25, honesto 20.
 * MED-0204 no se reutiliza. IDs: MED-0288..MED-0307 (secuencial tras MAX LIVE MED-0287).
 *
 * Uso:
 *   npm run catalog-batch05 -- --dry
 *   npm run catalog-batch05
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { getSupabase } from '../src/supabase/client.js';
import type { Medio } from '../src/types/schemas.js';

function baseMedio(partial: {
  medio_id: string;
  nombre_medio: string;
  url_base: string;
  metodo_extraccion: 'RSS' | 'SITEMAP';
  rss_url: string | null;
  sitemap_url: string | null;
  notas_tecnicas: string;
}): Medio {
  return {
    medio_id: partial.medio_id,
    nombre_medio: partial.nombre_medio,
    grupo_medio: null,
    url_base: partial.url_base,
    pais: 'MX',
    estado: null,
    municipio: null,
    region: null,
    categoria: 'Noticias',
    prioridad: 'Media',
    activo: true,
    metodo_extraccion: partial.metodo_extraccion,
    rss_url: partial.rss_url,
    sitemap_url: partial.sitemap_url,
    secciones_urls: null,
    buscador_url: null,
    requiere_javascript: false,
    requiere_proxy: false,
    frecuencia_minutos: 360,
    notas_tecnicas: partial.notas_tecnicas,
  };
}

function medioRss(p: { medio_id: string; nombre_medio: string; url_base: string; rss_url: string; notas_tecnicas: string }): Medio {
  return baseMedio({ ...p, metodo_extraccion: 'RSS', sitemap_url: null });
}

function medioSitemap(p: { medio_id: string; nombre_medio: string; url_base: string; sitemap_url: string; notas_tecnicas: string }): Medio {
  return baseMedio({ ...p, metodo_extraccion: 'SITEMAP', rss_url: null });
}

export const MEDIOS_BATCH05: Medio[] = [
  medioRss({
    medio_id: 'MED-0288',
    nombre_medio: 'El Siglo de Torreón',
    url_base: 'https://www.elsiglodetorreon.com.mx',
    rss_url: 'https://www.elsiglodetorreon.com.mx/index.xml',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 05). RSS `/index.xml` HTTP 200, 13 items frescos. Re-probe LIVE: previous TIMEOUT/BLOCKED → STRICT. Lista 1 freq=71.',
  }),
  medioRss({
    medio_id: 'MED-0289',
    nombre_medio: 'Canal 44 El Canal de las Noticias',
    url_base: 'https://canal44.com',
    rss_url: 'https://canal44.com/feed/',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 05). RSS WP `/feed/` HTTP 200, 10 items frescos. Dominio propio canal44.com (no udgtv.com / MED-0040). Lista 1 freq=30.',
  }),
  medioRss({
    medio_id: 'MED-0290',
    nombre_medio: 'La Voz de Michoacán',
    url_base: 'https://www.lavozdemichoacan.com.mx',
    rss_url: 'https://www.lavozdemichoacan.com.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 05). RSS WP `/feed/` HTTP 200, 5 items frescos. Lista 1 freq=30.',
  }),
  medioRss({
    medio_id: 'MED-0291',
    nombre_medio: 'La Jornada San Luis',
    url_base: 'https://lajornadasanluis.com.mx',
    rss_url: 'https://lajornadasanluis.com.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 05). RSS WP `/feed/` HTTP 200, 10 items frescos. Dominio propio lajornadasanluis.com.mx. Lista 1 freq=30.',
  }),
  medioRss({
    medio_id: 'MED-0292',
    nombre_medio: 'Diario de Morelos',
    url_base: 'https://www.diariodemorelos.com',
    rss_url: 'https://www.diariodemorelos.com/uploads/feeds/feed_diario-de-morelos_es.xml',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 05). RSS CMS HTTP 200, 50 items frescos. Lista 1 freq=29.',
  }),
  medioRss({
    medio_id: 'MED-0293',
    nombre_medio: 'Contramuro Noticias de Michoacán',
    url_base: 'https://www.contramuro.com',
    rss_url: 'https://www.contramuro.com/feed/',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 05). RSS WP `/feed/` HTTP 200, 6 items frescos. Lista 1 freq=27.',
  }),
  medioRss({
    medio_id: 'MED-0294',
    nombre_medio: 'NotiMx',
    url_base: 'https://www.notimx.mx',
    rss_url: 'https://www.notimx.mx/rss.xml',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 05). RSS `/rss.xml` HTTP 200, 25 items frescos. Lista 1 freq=25.',
  }),
  medioRss({
    medio_id: 'MED-0295',
    nombre_medio: 'Diario de México',
    url_base: 'https://www.diariodemexico.com',
    rss_url: 'https://www.diariodemexico.com/uploads/feeds/feed_diario-de-mexico_es.xml',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 05). RSS CMS HTTP 200, 50 items frescos. Lista 1 freq=24.',
  }),
  medioRss({
    medio_id: 'MED-0296',
    nombre_medio: 'El Pueblo de Chihuahua',
    url_base: 'https://elpueblo.com',
    rss_url: 'https://elpueblo.com/rss/feed.xml',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 05). RSS `/rss/feed.xml` HTTP 200, 100 items frescos. Lista 1 freq=23.',
  }),
  medioRss({
    medio_id: 'MED-0297',
    nombre_medio: 'Codigo Qro',
    url_base: 'https://codigoqro.mx',
    rss_url: 'https://codigoqro.mx/feeds.php',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 05). RSS `/feeds.php` HTTP 200, 50 items frescos. Lista 1 freq=23.',
  }),
  medioRss({
    medio_id: 'MED-0298',
    nombre_medio: 'Sobre T',
    url_base: 'https://www.sobre-t.com',
    rss_url: 'https://www.sobre-t.com/feed/',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 05). RSS WP `/feed/` HTTP 200, 8 items frescos. Lista 1 freq=22.',
  }),
  medioRss({
    medio_id: 'MED-0299',
    nombre_medio: 'Vértigo Político',
    url_base: 'https://www.vertigopolitico.com',
    rss_url: 'https://www.vertigopolitico.com/index.rss',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 05). RSS `/index.rss` HTTP 200, 10 items, newest ~6d. Lista 1 freq=21.',
  }),
  medioSitemap({
    medio_id: 'MED-0300',
    nombre_medio: 'El Mañana de Nuevo Laredo',
    url_base: 'https://www.elmanana.com',
    sitemap_url: 'https://www.elmanana.com/sitemapnews',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 05). News sitemap HTTP 200, 417 items frescos. HIGH4 re-probe LIVE. Lista 1 freq=122.',
  }),
  medioSitemap({
    medio_id: 'MED-0301',
    nombre_medio: 'Mundo Poder',
    url_base: 'https://www.mundopoder.com',
    sitemap_url: 'https://www.mundopoder.com/sitemap.xml',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 05). Sitemap HTTP 200, 14 items (fechas no expuestas). Lista 1 freq=78.',
  }),
  medioSitemap({
    medio_id: 'MED-0302',
    nombre_medio: 'Noventa Grados',
    url_base: 'https://www.noventagrados.com.mx',
    sitemap_url: 'https://www.noventagrados.com.mx/rss.php',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 05). XML `/rss.php` HTTP 200, 30 items frescos (parse sitemap). Lista 1 freq=43.',
  }),
  medioSitemap({
    medio_id: 'MED-0303',
    nombre_medio: 'Super Channel 12',
    url_base: 'https://superchannel12.com',
    sitemap_url: 'https://superchannel12.com/sitemap.xml',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 05). Sitemap HTTP 200, 14 items frescos. Lista 1 freq=42.',
  }),
  medioSitemap({
    medio_id: 'MED-0304',
    nombre_medio: 'E-consulta',
    url_base: 'https://www.e-consulta.com',
    sitemap_url: 'https://www.e-consulta.com/sitemap.xml',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 05). Sitemap HTTP 200, 100 items frescos. Lista 1 freq=40.',
  }),
  medioSitemap({
    medio_id: 'MED-0305',
    nombre_medio: 'Grupomarmor Informa',
    url_base: 'https://grupomarmor.com.mx',
    sitemap_url: 'http://grupomarmor.com.mx/sitemap.xml',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 05). Sitemap HTTP 200, 12 items frescos. Lista 1 freq=28.',
  }),
  medioSitemap({
    medio_id: 'MED-0306',
    nombre_medio: 'El Gráfico',
    url_base: 'https://www.elgrafico.mx',
    sitemap_url: 'https://www.elgrafico.mx/arc/outboundfeeds/sitemap-index/',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 05). Arc sitemap-index HTTP 200, 20 items frescos. Lista 1 freq=23.',
  }),
  medioSitemap({
    medio_id: 'MED-0307',
    nombre_medio: 'Noticias CDMX',
    url_base: 'https://ntcd.mx',
    sitemap_url: 'https://ntcd.mx/sitemap.xml',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 05). Sitemap HTTP 200, 248 items frescos. Lista 1 freq=23.',
  }),
];

function hostOf(u: string | null | undefined): string {
  if (!u) return '';
  try {
    return new URL(u).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function sourceUrl(m: Medio): string {
  return (m.rss_url ?? m.sitemap_url ?? '').replace(/\/+$/, '').toLowerCase();
}

async function main() {
  const dry = process.argv.includes('--dry');
  const sb = getSupabase();
  const ids = MEDIOS_BATCH05.map((m) => m.medio_id);
  if (ids.includes('MED-0204')) {
    console.error('ABORT: MED-0204 está reservado (PLANNED_NOT_ONBOARDED).');
    process.exit(2);
  }
  const { data: all, error: errAll } = await sb.from('medios').select('medio_id,nombre_medio,url_base,rss_url,sitemap_url');
  if (errAll) { console.error(errAll.message); process.exit(1); }
  const existing = all ?? [];
  const nums = existing.map((r) => Number(String(r.medio_id).replace(/^MED-/, ''))).filter((n) => Number.isFinite(n));
  const max = Math.max(0, ...nums);
  for (const id of ids) {
    const n = Number(id.replace(/^MED-/, ''));
    if (existing.some((e) => e.medio_id === id)) {
      console.error(`ABORT: ID ya existe ${id}`);
      process.exit(2);
    }
    if (n <= max) {
      console.error(`ABORT: ID ${id} no es posterior a MAX LIVE MED-${String(max).padStart(4, '0')}`);
      process.exit(2);
    }
  }
  const loteHosts = new Set(MEDIOS_BATCH05.map((m) => hostOf(m.url_base)).filter(Boolean));
  if (loteHosts.size !== MEDIOS_BATCH05.length) {
    console.error('ABORT: hosts duplicados dentro del lote');
    process.exit(2);
  }
  const loteFeeds = new Set(MEDIOS_BATCH05.map(sourceUrl).filter(Boolean));
  if (loteFeeds.size !== MEDIOS_BATCH05.length) {
    console.error('ABORT: feeds/sitemaps duplicados dentro del lote');
    process.exit(2);
  }
  const collisions = [];
  for (const e of existing) {
    const hs = [hostOf(e.url_base), hostOf(e.rss_url), hostOf(e.sitemap_url)].filter(Boolean);
    for (const h of loteHosts) {
      if (hs.includes(h)) collisions.push({ host: h, existing: e.medio_id, nombre: e.nombre_medio });
    }
  }
  console.log(JSON.stringify({
    dry,
    ids,
    max_existing: `MED-${String(max).padStart(4, '0')}`,
    unique_hosts: [...loteHosts],
    collisions,
  }, null, 2));
  if (collisions.length) {
    console.error('ABORT: duplicate domain vs catálogo LIVE');
    process.exit(2);
  }
  if (dry) {
    console.log('--dry: no se escribió nada.');
    console.log(MEDIOS_BATCH05.map((m) => `${m.medio_id}: ${m.nombre_medio} — ${m.rss_url ?? m.sitemap_url}`).join('\n'));
    return;
  }
  const { error: errUpsert } = await sb.from('medios').upsert(MEDIOS_BATCH05, { onConflict: 'medio_id' });
  if (errUpsert) { console.error('Upsert falló:', errUpsert.message); process.exit(1); }
  const { data: verif, error: errVerif } = await sb
    .from('medios')
    .select('medio_id,nombre_medio,metodo_extraccion,rss_url,sitemap_url,activo,url_base')
    .in('medio_id', ids)
    .order('medio_id');
  if (errVerif) { console.error(errVerif.message); process.exit(1); }
  console.log('=== Read-back post-upsert ===');
  console.log(JSON.stringify(verif, null, 2));
}

function esEntrypointCli(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (esEntrypointCli()) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
