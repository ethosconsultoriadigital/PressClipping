/**
 * Alta al catálogo: 25 medios — NEW SOURCE BATCH 06 (2026-09-25).
 *
 * Deep discovery pública de 50 NEEDS_SOURCE_DISCOVERY. 33 STRICT crudos → 25
 * HIGH_CONFIDENCE_STRICT tras filtros (red Uniradio, feed Google News de sección,
 * magazine). Cap 25, honesto 25. MED-0204 no se reutiliza.
 * IDs: MED-0308..MED-0332 (secuencial tras MAX LIVE MED-0307).
 *
 * Uso:
 *   npm run catalog-batch06 -- --dry
 *   npm run catalog-batch06
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

export const MEDIOS_BATCH06: Medio[] = [
  medioRss({
    medio_id: 'MED-0308',
    nombre_medio: 'Elchapucero',
    url_base: 'https://www.elchapucero.com',
    rss_url: 'https://www.elchapucero.com/feed/',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 06). RSS WP `/feed/` HTTP 200, 10 items frescos. Lista 1 freq=21.',
  }),
  medioRss({
    medio_id: 'MED-0309',
    nombre_medio: 'Expreso Sonora',
    url_base: 'https://expreso.com.mx',
    rss_url: 'https://expreso.com.mx/feed/noticias.xml',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 06). RSS `/feed/noticias.xml` HTTP 200, 30 items frescos. Dominio propio expreso.com.mx (no Expreso.press). Lista 1 freq=20.',
  }),
  medioRss({
    medio_id: 'MED-0310',
    nombre_medio: 'AlertaQro - Noticias Querétaro',
    url_base: 'https://www.alertaqronoticias.com',
    rss_url: 'https://www.alertaqronoticias.com/feed/',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 06). RSS WP `/feed/` HTTP 200, 15 items frescos. Lista 1 freq=19.',
  }),
  medioRss({
    medio_id: 'MED-0311',
    nombre_medio: 'Miradas',
    url_base: 'https://miradas.mx',
    rss_url: 'https://miradas.mx/rss/',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 06). RSS `/rss/` HTTP 200, 15 items frescos. Lista 1 freq=19.',
  }),
  medioRss({
    medio_id: 'MED-0312',
    nombre_medio: 'Noti',
    url_base: 'https://noti.mx',
    rss_url: 'https://noti.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 06). RSS WP `/feed/` HTTP 200, 40 items. Dominio propio noti.mx (no NotiMx MED-0294). Lista 1 freq=19.',
  }),
  medioRss({
    medio_id: 'MED-0313',
    nombre_medio: 'Quien',
    url_base: 'https://www.quien.com',
    rss_url: 'https://www.quien.com/rss',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 06). RSS `/rss` HTTP 200, 48 items frescos. Lista 1 freq=19.',
  }),
  medioRss({
    medio_id: 'MED-0314',
    nombre_medio: 'Impacto',
    url_base: 'https://impactonoticias.com.mx',
    rss_url: 'https://impactonoticias.com.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 06). RSS WP `/feed/` HTTP 200, 10 items frescos. Lista 1 freq=18.',
  }),
  medioRss({
    medio_id: 'MED-0315',
    nombre_medio: 'Platino News',
    url_base: 'https://platino.news',
    rss_url: 'https://platino.news/feed/',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 06). RSS WP `/feed/` HTTP 200, 20 items. Lista 1 freq=18.',
  }),
  medioRss({
    medio_id: 'MED-0316',
    nombre_medio: 'Meridiano de Nayarit',
    url_base: 'https://meridiano.mx',
    rss_url: 'https://meridiano.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 06). RSS WP `/feed/` HTTP 200, 10 items. Lista 1 freq=18.',
  }),
  medioRss({
    medio_id: 'MED-0317',
    nombre_medio: 'DRV Noticias',
    url_base: 'https://drvnoticias.com',
    rss_url: 'https://drvnoticias.com/feed/',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 06). RSS WP `/feed/` HTTP 200, 20 items frescos. Lista 1 freq=18.',
  }),
  medioRss({
    medio_id: 'MED-0318',
    nombre_medio: 'Respuesta',
    url_base: 'https://www.respuesta.com.mx',
    rss_url: 'https://www.respuesta.com.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 06). RSS WP `/feed/` HTTP 200, 10 items frescos. Lista 1 freq=18.',
  }),
  medioRss({
    medio_id: 'MED-0319',
    nombre_medio: 'Diario Plaza Juárez',
    url_base: 'https://plazajuarez.mx',
    rss_url: 'https://plazajuarez.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 06). RSS WP `/feed/` HTTP 200, 10 items. Lista 1 freq=18.',
  }),
  medioRss({
    medio_id: 'MED-0320',
    nombre_medio: 'Periodico Palacio',
    url_base: 'https://periodicopalacio.com',
    rss_url: 'https://periodicopalacio.com/feed/',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 06). RSS WP `/feed/` HTTP 200, 10 items frescos. Lista 1 freq=18.',
  }),
  medioRss({
    medio_id: 'MED-0321',
    nombre_medio: 'El Heraldo De Saltillo',
    url_base: 'https://elheraldodesaltillo.mx',
    rss_url: 'https://elheraldodesaltillo.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 06). RSS WP `/feed/` HTTP 200, 200 items frescos. Dominio propio elheraldodesaltillo.mx. Lista 1 freq=18.',
  }),
  medioRss({
    medio_id: 'MED-0322',
    nombre_medio: 'Noticaribe',
    url_base: 'https://noticaribe.com.mx',
    rss_url: 'https://noticaribe.com.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 06). RSS WP `/feed/` HTTP 200, 10 items frescos. Lista 1 freq=17.',
  }),
  medioRss({
    medio_id: 'MED-0323',
    nombre_medio: 'EL REGIO',
    url_base: 'https://elregio.com',
    rss_url: 'https://elregio.com/blog/feed/',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 06). RSS `/blog/feed/` HTTP 200, 10 items (newest ~4d). Lista 1 freq=17.',
  }),
  medioRss({
    medio_id: 'MED-0324',
    nombre_medio: 'Diario Tijuana',
    url_base: 'https://diariotijuana.info',
    rss_url: 'https://diariotijuana.info/feed',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 06). RSS `/feed` HTTP 200, 10 items frescos. Lista 1 freq=17.',
  }),
  medioRss({
    medio_id: 'MED-0325',
    nombre_medio: 'Juárez a Diario',
    url_base: 'https://www.adiario.mx',
    rss_url: 'https://www.adiario.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 06). RSS WP `/feed/` HTTP 200, 15 items frescos. Lista 1 freq=17.',
  }),
  medioRss({
    medio_id: 'MED-0326',
    nombre_medio: 'Políticos Al Desnudo',
    url_base: 'https://politicosaldesnudo.com.mx',
    rss_url: 'https://politicosaldesnudo.com.mx/index.php/feed/',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 06). RSS WP `/index.php/feed/` HTTP 200, 10 items. Lista 1 freq=17.',
  }),
  medioRss({
    medio_id: 'MED-0327',
    nombre_medio: 'Información En Directo',
    url_base: 'https://endirecto.mx',
    rss_url: 'https://endirecto.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 06). RSS WP `/feed/` HTTP 200, 10 items frescos. Lista 1 freq=17.',
  }),
  medioRss({
    medio_id: 'MED-0328',
    nombre_medio: 'La Prensa.Mx',
    url_base: 'https://www.laprensa.mx',
    rss_url: 'https://www.laprensa.mx/rss/',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 06). RSS `/rss/` HTTP 200, 10 items frescos. Dominio propio laprensa.mx (no OEM). Lista 1 freq=17.',
  }),
  medioRss({
    medio_id: 'MED-0329',
    nombre_medio: 'Macronews Noticias',
    url_base: 'https://macronews.mx',
    rss_url: 'https://macronews.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 06). RSS WP `/feed/` HTTP 200, 10 items. Lista 1 freq=17.',
  }),
  medioSitemap({
    medio_id: 'MED-0330',
    nombre_medio: 'Periódico Enfoque',
    url_base: 'https://www.periodicoenfoque.com.mx',
    sitemap_url: 'https://www.periodicoenfoque.com.mx/sitemaps/sitemap-index.xml',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 06). Sitemap-index HTTP 200, 50 items frescos. Lista 1 freq=20.',
  }),
  medioSitemap({
    medio_id: 'MED-0331',
    nombre_medio: 'Diario Puntual',
    url_base: 'https://diariopuntual.com',
    sitemap_url: 'https://diariopuntual.com/news-sitemap.xml',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 06). News sitemap HTTP 200, 97 items frescos. Lista 1 freq=19.',
  }),
  medioSitemap({
    medio_id: 'MED-0332',
    nombre_medio: 'La Jornada Maya',
    url_base: 'https://www.lajornadamaya.mx',
    sitemap_url: 'https://www.lajornadamaya.mx/sitemap.xml',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 06). Sitemap HTTP 200, 250 items frescos. Dominio propio lajornadamaya.mx. Lista 1 freq=17.',
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
  const ids = MEDIOS_BATCH06.map((m) => m.medio_id);
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
  const loteHosts = new Set(MEDIOS_BATCH06.map((m) => hostOf(m.url_base)).filter(Boolean));
  if (loteHosts.size !== MEDIOS_BATCH06.length) {
    console.error('ABORT: hosts duplicados dentro del lote');
    process.exit(2);
  }
  const loteFeeds = new Set(MEDIOS_BATCH06.map(sourceUrl).filter(Boolean));
  if (loteFeeds.size !== MEDIOS_BATCH06.length) {
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
    console.log(MEDIOS_BATCH06.map((m) => `${m.medio_id}: ${m.nombre_medio} — ${m.rss_url ?? m.sitemap_url}`).join('\n'));
    return;
  }
  const { error: errUpsert } = await sb.from('medios').upsert(MEDIOS_BATCH06, { onConflict: 'medio_id' });
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
