/**
 * Alta al catálogo: 25 medios — NEW SOURCE BATCH 07 (2026-09-25).
 *
 * Deep discovery pública de 50 NEEDS_SOURCE_DISCOVERY nuevos (no reprobe Batch02–06).
 * 45 STRICT crudos → 25 HIGH_CONFIDENCE_STRICT tras filtros (Google News Marca,
 * Feedburner/Blogspot Entre Veredas). Cap 25, honesto 25. MED-0204 no se reutiliza.
 * IDs: MED-0333..MED-0357 (secuencial tras MAX LIVE MED-0332).
 *
 * Uso:
 *   npm run catalog-batch07 -- --dry
 *   npm run catalog-batch07
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

export const MEDIOS_BATCH07: Medio[] = [
  medioRss({
    medio_id: 'MED-0333',
    nombre_medio: 'Changoonga',
    url_base: 'https://changoonga.com',
    rss_url: 'https://changoonga.com/feed/',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 07). RSS WP `/feed/` HTTP 200, 25 items frescos. Lista 1 freq=16.',
  }),
  medioRss({
    medio_id: 'MED-0334',
    nombre_medio: 'Diario Imagen',
    url_base: 'https://www.diarioimagen.net',
    rss_url: 'https://www.diarioimagen.net/?feed=rss2',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 07). RSS `/?feed=rss2` HTTP 200, 33 items. Lista 1 freq=16.',
  }),
  medioRss({
    medio_id: 'MED-0335',
    nombre_medio: 'Sigue tu Ruta',
    url_base: 'https://sigueturuta.com',
    rss_url: 'https://sigueturuta.com/feed/',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 07). RSS WP `/feed/` HTTP 200, 10 items frescos. Lista 1 freq=16.',
  }),
  medioRss({
    medio_id: 'MED-0336',
    nombre_medio: 'vocero.com.mx',
    url_base: 'https://www.vocero.com.mx',
    rss_url: 'https://www.vocero.com.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 07). RSS WP `/feed/` HTTP 200, 10 items. Lista 1 freq=16.',
  }),
  medioRss({
    medio_id: 'MED-0337',
    nombre_medio: 'Once Noticias',
    url_base: 'https://oncenoticias.digital',
    rss_url: 'https://oncenoticias.digital/feed/',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 07). RSS WP `/feed/` HTTP 200, 10 items frescos. Lista 1 freq=16.',
  }),
  medioRss({
    medio_id: 'MED-0338',
    nombre_medio: 'Apro',
    url_base: 'https://apro.com.mx',
    rss_url: 'https://apro.com.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 07). RSS WP `/feed/` HTTP 200, 10 items frescos. Lista 1 freq=16.',
  }),
  medioRss({
    medio_id: 'MED-0339',
    nombre_medio: 'Proyecto Puente',
    url_base: 'https://proyectopuente.com.mx',
    rss_url: 'https://proyectopuente.com.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 07). RSS WP `/feed/` HTTP 200, 10 items frescos. Lista 1 freq=15.',
  }),
  medioRss({
    medio_id: 'MED-0340',
    nombre_medio: 'El Pionero - Delicias Digital',
    url_base: 'https://noticiasdelicias.mx',
    rss_url: 'https://noticiasdelicias.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 07). RSS WP `/feed/` HTTP 200, 10 items. Dominio propio noticiasdelicias.mx. Lista 1 freq=15.',
  }),
  medioRss({
    medio_id: 'MED-0341',
    nombre_medio: 'Elpuntero',
    url_base: 'https://elpuntero.com.mx',
    rss_url: 'https://elpuntero.com.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 07). RSS WP `/feed/` HTTP 200, 10 items. Lista 1 freq=15.',
  }),
  medioRss({
    medio_id: 'MED-0342',
    nombre_medio: 'Plumas Libres',
    url_base: 'https://plumaslibres.com.mx',
    rss_url: 'https://plumaslibres.com.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 07). RSS WP `/feed/` HTTP 200, 10 items. Lista 1 freq=15.',
  }),
  medioRss({
    medio_id: 'MED-0343',
    nombre_medio: 'Cursor en la Noticia',
    url_base: 'https://www.cursorenlanoticia.com.mx',
    rss_url: 'https://www.cursorenlanoticia.com.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 07). RSS WP `/feed/` HTTP 200, 10 items. Lista 1 freq=15.',
  }),
  medioRss({
    medio_id: 'MED-0344',
    nombre_medio: 'Cyber Mexico',
    url_base: 'https://cybermexico.mx',
    rss_url: 'https://cybermexico.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 07). RSS WP `/feed/` HTTP 200, 10 items frescos. Lista 1 freq=15.',
  }),
  medioRss({
    medio_id: 'MED-0345',
    nombre_medio: 'José Cárdenas',
    url_base: 'https://josecardenas.com',
    rss_url: 'https://josecardenas.com/feed/',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 07). RSS WP `/feed/` HTTP 200, 6 items frescos. Lista 1 freq=15.',
  }),
  medioRss({
    medio_id: 'MED-0346',
    nombre_medio: 'Es Diario Popular',
    url_base: 'https://esdiario.com.mx',
    rss_url: 'https://esdiario.com.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 07). RSS WP `/feed/` HTTP 200, 10 items. Lista 1 freq=15.',
  }),
  medioRss({
    medio_id: 'MED-0347',
    nombre_medio: 'La Chispa',
    url_base: 'https://lachispa.mx',
    rss_url: 'https://lachispa.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 07). RSS WP `/feed/` HTTP 200, 10 items frescos. Lista 1 freq=14.',
  }),
  medioRss({
    medio_id: 'MED-0348',
    nombre_medio: 'Diario 21',
    url_base: 'https://diario21.com.mx',
    rss_url: 'https://diario21.com.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 07). RSS WP `/feed/` HTTP 200, 10 items. Lista 1 freq=14.',
  }),
  medioRss({
    medio_id: 'MED-0349',
    nombre_medio: 'Turquesa NEWS',
    url_base: 'https://turquesanews.mx',
    rss_url: 'https://turquesanews.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 07). RSS WP `/feed/` HTTP 200, 10 items frescos. Lista 1 freq=14.',
  }),
  medioRss({
    medio_id: 'MED-0350',
    nombre_medio: 'Gaceta.mx',
    url_base: 'https://gaceta.mx',
    rss_url: 'https://gaceta.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 07). RSS WP `/feed/` HTTP 200, 10 items. Lista 1 freq=14.',
  }),
  medioRss({
    medio_id: 'MED-0351',
    nombre_medio: 'Reporte 32 Mx',
    url_base: 'https://reporte32mx.com',
    rss_url: 'https://reporte32mx.com/feed/',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 07). RSS WP `/feed/` HTTP 200, 10 items frescos. Lista 1 freq=14.',
  }),
  medioRss({
    medio_id: 'MED-0352',
    nombre_medio: 'El Momento Baja California Sur',
    url_base: 'https://elmomentobcs.mx',
    rss_url: 'https://elmomentobcs.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 07). RSS WP `/feed/` HTTP 200, 10 items frescos. Dominio propio elmomentobcs.mx (no El Momento QRoo MED-0246). Lista 1 freq=14.',
  }),
  medioRss({
    medio_id: 'MED-0353',
    nombre_medio: 'El Momento Campeche',
    url_base: 'https://elmomentocampeche.mx',
    rss_url: 'https://elmomentocampeche.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 07). RSS WP `/feed/` HTTP 200, 10 items frescos. Dominio propio elmomentocampeche.mx. Lista 1 freq=14.',
  }),
  medioRss({
    medio_id: 'MED-0354',
    nombre_medio: 'Elmomento Veracruz',
    url_base: 'https://elmomentoveracruz.mx',
    rss_url: 'https://elmomentoveracruz.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 07). RSS WP `/feed/` HTTP 200, 10 items frescos. Dominio propio elmomentoveracruz.mx. Lista 1 freq=14.',
  }),
  medioRss({
    medio_id: 'MED-0355',
    nombre_medio: 'Pausa Mx',
    url_base: 'https://pausa.mx',
    rss_url: 'https://pausa.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 07). RSS WP `/feed/` HTTP 200, 15 items frescos. Lista 1 freq=14.',
  }),
  medioRss({
    medio_id: 'MED-0356',
    nombre_medio: 'Tribuna noticias',
    url_base: 'https://tribunanoticias.mx',
    rss_url: 'https://tribunanoticias.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 07). RSS WP `/feed/` HTTP 200, 10 items frescos. Dominio propio tribunanoticias.mx (no Tribuna del Yaqui / Bahía). Lista 1 freq=14.',
  }),
  medioRss({
    medio_id: 'MED-0357',
    nombre_medio: 'eitmedia',
    url_base: 'https://eitmedia.tech',
    rss_url: 'https://eitmedia.tech/feed/',
    notas_tecnicas: 'Alta 2026-09-25 (NEW SOURCE BATCH 07). RSS WP `/feed/` HTTP 200, 10 items. Lista 1 freq=14.',
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
  const ids = MEDIOS_BATCH07.map((m) => m.medio_id);
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
  const loteHosts = new Set(MEDIOS_BATCH07.map((m) => hostOf(m.url_base)).filter(Boolean));
  if (loteHosts.size !== MEDIOS_BATCH07.length) {
    console.error('ABORT: hosts duplicados dentro del lote');
    process.exit(2);
  }
  const loteFeeds = new Set(MEDIOS_BATCH07.map(sourceUrl).filter(Boolean));
  if (loteFeeds.size !== MEDIOS_BATCH07.length) {
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
    console.log(MEDIOS_BATCH07.map((m) => `${m.medio_id}: ${m.nombre_medio} — ${m.rss_url ?? m.sitemap_url}`).join('\n'));
    return;
  }
  const { error: errUpsert } = await sb.from('medios').upsert(MEDIOS_BATCH07, { onConflict: 'medio_id' });
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
