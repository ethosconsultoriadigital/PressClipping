/**
 * Alta al catálogo: 28 medios — NEW SOURCE BATCH 04 (2026-09-24).
 *
 * Re-probe LIVE: 8 leftover strict de Batch03 (El Siglo de Durango sitemap + 7 RSS)
 * y easy-pool adicional. 45 probes → 28 HIGH_CONFIDENCE_STRICT (cap 30, honesto).
 * MED-0204 no se reutiliza. IDs: MED-0260..MED-0287 (secuencial tras MAX LIVE MED-0259).
 *
 * Uso:
 *   npm run catalog-batch04 -- --dry
 *   npm run catalog-batch04
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

export const MEDIOS_BATCH04: Medio[] = [
  medioSitemap({
    medio_id: 'MED-0260',
    nombre_medio: 'El Siglo de Durango',
    url_base: 'https://www.elsiglodedurango.com.mx',
    sitemap_url: 'https://www.elsiglodedurango.com.mx/sitemapNews.xml',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 04). News sitemap HTTP 200, 698 items frescos. Leftover Batch03 re-probe LIVE. Lista 1 freq=56.',
  }),
  medioRss({
    medio_id: 'MED-0261',
    nombre_medio: 'Dereporteros',
    url_base: 'https://dereporteros.com',
    rss_url: 'https://dereporteros.com/feed/',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 04). RSS WP `/feed/` HTTP 200, 10 items frescos. Leftover Batch03 re-probe LIVE. Lista 1 freq=20.',
  }),
  medioRss({
    medio_id: 'MED-0262',
    nombre_medio: 'La Jiribilla',
    url_base: 'https://lajiribilla.com.mx',
    rss_url: 'https://lajiribilla.com.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 04). RSS WP `/feed/` HTTP 200, 10 items frescos. Leftover Batch03 re-probe LIVE. Lista 1 freq=20.',
  }),
  medioRss({
    medio_id: 'MED-0263',
    nombre_medio: 'Sociedad Noticias',
    url_base: 'https://sociedad-noticias.com',
    rss_url: 'https://sociedad-noticias.com/feed/',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 04). RSS WP `/feed/` HTTP 200, 10 items frescos. Leftover Batch03 re-probe LIVE. Lista 1 freq=20.',
  }),
  medioRss({
    medio_id: 'MED-0264',
    nombre_medio: 'A Tiempo',
    url_base: 'https://atiempo.mx',
    rss_url: 'https://atiempo.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 04). RSS WP `/feed/` HTTP 200, 10 items frescos. Leftover Batch03 re-probe LIVE. Lista 1 freq=20.',
  }),
  medioRss({
    medio_id: 'MED-0265',
    nombre_medio: 'Quintana Roo Hoy',
    url_base: 'https://quintanaroohoy.com',
    rss_url: 'https://quintanaroohoy.com/feed/',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 04). RSS WP `/feed/` HTTP 200, 30 items frescos. Leftover Batch03 re-probe LIVE. Lista 1 freq=19.',
  }),
  medioRss({
    medio_id: 'MED-0266',
    nombre_medio: 'Al Chile Poblano',
    url_base: 'https://www.alchilepoblano.com',
    rss_url: 'https://www.alchilepoblano.com/feed/',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 04). RSS WP `/feed/` HTTP 200, 20 items frescos. Leftover Batch03 re-probe LIVE. Lista 1 freq=19.',
  }),
  medioRss({
    medio_id: 'MED-0267',
    nombre_medio: 'EstamosAquí MX',
    url_base: 'https://estamosaqui.mx',
    rss_url: 'https://estamosaqui.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 04). RSS WP `/feed/` HTTP 200, 10 items frescos. Leftover Batch03 re-probe LIVE. Lista 1 freq=19.',
  }),
  medioRss({
    medio_id: 'MED-0268',
    nombre_medio: 'El Diario de Delicias',
    url_base: 'https://eldiariodedelicias.mx',
    rss_url: 'https://eldiariodedelicias.mx/rss/feed.xml',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 04). RSS `/rss/feed.xml` HTTP 200, 150 items frescos. Lista 1 freq=80.',
  }),
  medioRss({
    medio_id: 'MED-0269',
    nombre_medio: 'El Diariodel Noroeste',
    url_base: 'https://eldiariodelnoroeste.mx',
    rss_url: 'https://eldiariodelnoroeste.mx/rss/feed.xml',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 04). RSS `/rss/feed.xml` HTTP 200, 150 items frescos. Lista 1 freq=77.',
  }),
  medioRss({
    medio_id: 'MED-0270',
    nombre_medio: 'El Diario de Parral',
    url_base: 'https://eldiariodeparral.mx',
    rss_url: 'https://eldiariodeparral.mx/rss/feed.xml',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 04). RSS `/rss/feed.xml` HTTP 200, 150 items frescos. Lista 1 freq=75.',
  }),
  medioRss({
    medio_id: 'MED-0271',
    nombre_medio: 'El Diario de Juárez',
    url_base: 'https://diario.mx',
    rss_url: 'https://diario.mx/rss/feed.xml',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 04). RSS `/rss/feed.xml` HTTP 200, 150 items frescos. Dominio propio diario.mx. Lista 1 freq=69.',
  }),
  medioRss({
    medio_id: 'MED-0272',
    nombre_medio: 'El Porvenir',
    url_base: 'https://elporvenir.mx',
    rss_url: 'https://elporvenir.mx/feedgooglenews/local',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 04). RSS same-domain `/feedgooglenews/local` HTTP 200, 30 items frescos. Lista 1 freq=57.',
  }),
  medioRss({
    medio_id: 'MED-0273',
    nombre_medio: 'Vox Populi Noticias',
    url_base: 'https://voxpopulinoticias.com.mx',
    rss_url: 'https://voxpopulinoticias.com.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 04). RSS WP `/feed/` HTTP 200, 5 items frescos. Lista 1 freq=52.',
  }),
  medioRss({
    medio_id: 'MED-0274',
    nombre_medio: 'Xeu',
    url_base: 'https://xeu.mx',
    rss_url: 'https://xeu.mx/feeds/noticias/feed-noticias.xml',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 04). RSS `/feeds/noticias/feed-noticias.xml` HTTP 200, 50 items frescos. Lista 1 freq=52.',
  }),
  medioRss({
    medio_id: 'MED-0275',
    nombre_medio: 'Luces del Siglo Diario',
    url_base: 'https://lucesdelsiglo.com',
    rss_url: 'https://lucesdelsiglo.com/feed/',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 04). RSS WP `/feed/` HTTP 200, 10 items frescos. Lista 1 freq=41.',
  }),
  medioRss({
    medio_id: 'MED-0276',
    nombre_medio: 'Periodico La Voz',
    url_base: 'https://periodicolavoz.com.mx',
    rss_url: 'https://periodicolavoz.com.mx/feed/loultimo',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 04). RSS `/feed/loultimo` HTTP 200, 25 items frescos. Lista 1 freq=38.',
  }),
  medioRss({
    medio_id: 'MED-0277',
    nombre_medio: 'Hoy Tamaulipas',
    url_base: 'https://www.hoytamaulipas.net',
    rss_url: 'https://www.hoytamaulipas.net/rss.php',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 04). RSS `/rss.php` HTTP 200, 10 items frescos. Lista 1 freq=37.',
  }),
  medioRss({
    medio_id: 'MED-0278',
    nombre_medio: 'Cuarto Poder',
    url_base: 'https://www.cuartopoder.mx',
    rss_url: 'https://www.cuartopoder.mx/feedgooglenews/nacional',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 04). RSS same-domain `/feedgooglenews/nacional` HTTP 200, 30 items frescos. Lista 1 freq=36.',
  }),
  medioRss({
    medio_id: 'MED-0279',
    nombre_medio: 'Tutucuman',
    url_base: 'https://tutucuman.com',
    rss_url: 'https://tutucuman.com/feed/',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 04). RSS WP `/feed/` HTTP 200, 10 items frescos. Lista 1 freq=36.',
  }),
  medioSitemap({
    medio_id: 'MED-0280',
    nombre_medio: 'TV Azteca Jalisco',
    url_base: 'https://www.aztecajalisco.com',
    sitemap_url: 'https://www.aztecajalisco.com/arc/outboundfeeds/sitemap-news/latest/',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 04). News sitemap Arc HTTP 200, 100 items frescos. Dominio propio aztecajalisco.com (no tvazteca.com). Lista 1 freq=141.',
  }),
  medioSitemap({
    medio_id: 'MED-0281',
    nombre_medio: 'Notigram',
    url_base: 'https://notigram.com',
    sitemap_url: 'https://notigram.com/sitemap-news.xml',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 04). News sitemap HTTP 200, 276 items frescos. Lista 1 freq=107.',
  }),
  medioSitemap({
    medio_id: 'MED-0282',
    nombre_medio: 'El Autómata',
    url_base: 'https://www.elautomata.mx',
    sitemap_url: 'https://www.elautomata.mx/sitemap_news.xml',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 04). News sitemap HTTP 200, 352 items frescos. Lista 1 freq=52.',
  }),
  medioSitemap({
    medio_id: 'MED-0283',
    nombre_medio: 'Mimorelia',
    url_base: 'https://mimorelia.com',
    sitemap_url: 'https://mimorelia.com/sitemap-news.xml',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 04). News sitemap HTTP 200, 199 items frescos. Lista 1 freq=40.',
  }),
  medioSitemap({
    medio_id: 'MED-0284',
    nombre_medio: 'Novedades Quintana Roo',
    url_base: 'https://sipse.com',
    sitemap_url: 'https://sipse.com/sitemaps/google_news.xml',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 04). News sitemap same-domain sipse.com HTTP 200, 100 items frescos. Lista 1 freq=36.',
  }),
  medioSitemap({
    medio_id: 'MED-0285',
    nombre_medio: 'Canal 13',
    url_base: 'https://canal13mexico.com',
    sitemap_url: 'https://canal13mexico.com/wp-sitemap-posts-post-1.xml',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 04). Post sitemap HTTP 200, 2000 items, actividad reciente. Lista 1 freq=32.',
  }),
  medioSitemap({
    medio_id: 'MED-0286',
    nombre_medio: 'Netnoticias',
    url_base: 'https://netnoticias.mx',
    sitemap_url: 'https://netnoticias.mx/sitemap-news.xml',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 04). News sitemap HTTP 200, 371 items frescos. Lista 1 freq=32.',
  }),
  medioSitemap({
    medio_id: 'MED-0287',
    nombre_medio: 'Antena Noticias',
    url_base: 'https://www.antenanoticias.com.mx',
    sitemap_url: 'https://www.antenanoticias.com.mx/post-sitemap.xml',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 04). Post sitemap HTTP 200, 201 items frescos. Lista 1 freq=31.',
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
  const ids = MEDIOS_BATCH04.map((m) => m.medio_id);
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
    if (n <= max && existing.some((e) => e.medio_id === id)) {
      console.error(`ABORT: ID ya existe ${id}`);
      process.exit(2);
    }
    if (n <= 259) {
      console.error(`ABORT: ID ${id} no es posterior a MAX LIVE MED-0259`);
      process.exit(2);
    }
  }
  const loteHosts = new Set(MEDIOS_BATCH04.map((m) => hostOf(m.url_base)).filter(Boolean));
  if (loteHosts.size !== MEDIOS_BATCH04.length) {
    console.error('ABORT: hosts duplicados dentro del lote');
    process.exit(2);
  }
  const loteFeeds = new Set(MEDIOS_BATCH04.map(sourceUrl).filter(Boolean));
  if (loteFeeds.size !== MEDIOS_BATCH04.length) {
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
    console.log(MEDIOS_BATCH04.map((m) => `${m.medio_id}: ${m.nombre_medio} — ${m.rss_url ?? m.sitemap_url}`).join('\n'));
    return;
  }
  const { error: errUpsert } = await sb.from('medios').upsert(MEDIOS_BATCH04, { onConflict: 'medio_id' });
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
