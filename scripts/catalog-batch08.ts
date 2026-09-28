/**
 * Alta al catálogo: 30 medios — NEW SOURCE BATCH 08 (2026-09-28).
 *
 * Deep discovery pública de 60 NEEDS_SOURCE_DISCOVERY nuevos (no reprobe Batch02–07).
 * 49 STRICT crudos → 47 tras massive_index → 30 HIGH_CONFIDENCE_STRICT (cap 30).
 * CNN en Español excluido (red CNN). MED-0204 no se reutiliza.
 * IDs: MED-0358..MED-0387 (secuencial tras MAX LIVE MED-0357).
 *
 * Uso:
 *   npm run catalog-batch08 -- --dry
 *   npm run catalog-batch08
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

export const MEDIOS_BATCH08: Medio[] = [
  medioRss({
    medio_id: 'MED-0358',
    nombre_medio: "Rev101",
    url_base: 'https://rev101.com',
    rss_url: 'https://rev101.com/feed/',
    notas_tecnicas: 'Alta 2026-09-28 (NEW SOURCE BATCH 08). RSS HTTP 200, 10 items. Dominio propio rev101.com. Lista 1 freq=13.',
  }),
  medioRss({
    medio_id: 'MED-0359',
    nombre_medio: "Robb Report Mexico",
    url_base: 'https://robbreportenespanol.com',
    rss_url: 'https://robbreportenespanol.com/feed/',
    notas_tecnicas: 'Alta 2026-09-28 (NEW SOURCE BATCH 08). RSS HTTP 200, 10 items. Dominio propio robbreportenespanol.com. Lista 1 freq=13.',
  }),
  medioRss({
    medio_id: 'MED-0360',
    nombre_medio: "Oronoticias",
    url_base: 'https://oronoticiaspuebla.com',
    rss_url: 'https://oronoticiaspuebla.com/feed/',
    notas_tecnicas: 'Alta 2026-09-28 (NEW SOURCE BATCH 08). RSS HTTP 200, 10 items. Dominio propio oronoticiaspuebla.com. Lista 1 freq=12.',
  }),
  medioRss({
    medio_id: 'MED-0361',
    nombre_medio: "El Heraldo de Aguascalientes",
    url_base: 'https://www.heraldo.mx',
    rss_url: 'https://www.heraldo.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-28 (NEW SOURCE BATCH 08). RSS HTTP 200, 10 items. Dominio propio heraldo.mx. Lista 1 freq=12.',
  }),
  medioRss({
    medio_id: 'MED-0362',
    nombre_medio: "Desde Puebla",
    url_base: 'https://desdepuebla.com',
    rss_url: 'https://desdepuebla.com/feed/',
    notas_tecnicas: 'Alta 2026-09-28 (NEW SOURCE BATCH 08). RSS HTTP 200, 10 items. Dominio propio desdepuebla.com. Lista 1 freq=12.',
  }),
  medioRss({
    medio_id: 'MED-0363',
    nombre_medio: "Alminuto",
    url_base: 'https://www.alminuto.mx',
    rss_url: 'https://www.alminuto.mx/rss.xml',
    notas_tecnicas: 'Alta 2026-09-28 (NEW SOURCE BATCH 08). RSS HTTP 200, 25 items. Dominio propio alminuto.mx. Lista 1 freq=12.',
  }),
  medioRss({
    medio_id: 'MED-0364',
    nombre_medio: "El punto crítico",
    url_base: 'https://elpuntocritico.com',
    rss_url: 'https://elpuntocritico.com/?format=feed&type=rss',
    notas_tecnicas: 'Alta 2026-09-28 (NEW SOURCE BATCH 08). RSS HTTP 200, 23 items. Dominio propio elpuntocritico.com. Lista 1 freq=12.',
  }),
  medioRss({
    medio_id: 'MED-0365',
    nombre_medio: "Momento San Luis Potosí",
    url_base: 'https://periodicoelmomento.com',
    rss_url: 'https://periodicoelmomento.com/feed/',
    notas_tecnicas: 'Alta 2026-09-28 (NEW SOURCE BATCH 08). RSS HTTP 200, 10 items. Dominio propio periodicoelmomento.com. Lista 1 freq=12.',
  }),
  medioRss({
    medio_id: 'MED-0366',
    nombre_medio: "El Eden Mx",
    url_base: 'https://www.eledenmx.com.mx',
    rss_url: 'https://www.eledenmx.com.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-28 (NEW SOURCE BATCH 08). RSS HTTP 200, 12 items. Dominio propio eledenmx.com.mx. Lista 1 freq=12.',
  }),
  medioRss({
    medio_id: 'MED-0367',
    nombre_medio: "Ultra Noticias",
    url_base: 'https://ultranoticias.com.mx',
    rss_url: 'https://ultranoticias.com.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-28 (NEW SOURCE BATCH 08). RSS HTTP 200, 10 items. Dominio propio ultranoticias.com.mx. Lista 1 freq=12.',
  }),
  medioRss({
    medio_id: 'MED-0368',
    nombre_medio: "Portalhidalgo",
    url_base: 'https://www.portalhidalgo.com',
    rss_url: 'https://www.portalhidalgo.com/feed/',
    notas_tecnicas: 'Alta 2026-09-28 (NEW SOURCE BATCH 08). RSS HTTP 200, 10 items. Dominio propio portalhidalgo.com. Lista 1 freq=12.',
  }),
  medioRss({
    medio_id: 'MED-0369',
    nombre_medio: "Estos días",
    url_base: 'https://estosdias.com.mx',
    rss_url: 'https://estosdias.com.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-28 (NEW SOURCE BATCH 08). RSS HTTP 200, 10 items. Dominio propio estosdias.com.mx. Lista 1 freq=12.',
  }),
  medioRss({
    medio_id: 'MED-0370',
    nombre_medio: "Frontenet",
    url_base: 'https://frontenet.com',
    rss_url: 'https://frontenet.com/rss/feed.xml',
    notas_tecnicas: 'Alta 2026-09-28 (NEW SOURCE BATCH 08). RSS HTTP 200, 100 items. Dominio propio frontenet.com. Lista 1 freq=12.',
  }),
  medioRss({
    medio_id: 'MED-0371',
    nombre_medio: "Periodico El Orbe",
    url_base: 'https://elorbe.com',
    rss_url: 'https://elorbe.com/feed',
    notas_tecnicas: 'Alta 2026-09-28 (NEW SOURCE BATCH 08). RSS HTTP 200, 10 items. Dominio propio elorbe.com. Lista 1 freq=12.',
  }),
  medioRss({
    medio_id: 'MED-0372',
    nombre_medio: "Frontera News",
    url_base: 'https://frontera.news',
    rss_url: 'https://frontera.news/feed/',
    notas_tecnicas: 'Alta 2026-09-28 (NEW SOURCE BATCH 08). RSS HTTP 200, 10 items. Dominio propio frontera.news. Lista 1 freq=12.',
  }),
  medioRss({
    medio_id: 'MED-0373',
    nombre_medio: "Diario Marca.mx",
    url_base: 'https://www.diariomarca.com.mx',
    rss_url: 'https://www.diariomarca.com.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-28 (NEW SOURCE BATCH 08). RSS HTTP 200, 15 items. Dominio propio diariomarca.com.mx. Lista 1 freq=12.',
  }),
  medioRss({
    medio_id: 'MED-0374',
    nombre_medio: "Anews",
    url_base: 'https://anews.mx',
    rss_url: 'https://anews.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-28 (NEW SOURCE BATCH 08). RSS HTTP 200, 10 items. Dominio propio anews.mx. Lista 1 freq=12.',
  }),
  medioRss({
    medio_id: 'MED-0375',
    nombre_medio: "Línea Política",
    url_base: 'https://lineapolitica.com',
    rss_url: 'https://lineapolitica.com/feed/',
    notas_tecnicas: 'Alta 2026-09-28 (NEW SOURCE BATCH 08). RSS HTTP 200, 10 items. Dominio propio lineapolitica.com. Lista 1 freq=12.',
  }),
  medioRss({
    medio_id: 'MED-0376',
    nombre_medio: "La Crónica de Morelos",
    url_base: 'https://lacronicademorelos.com',
    rss_url: 'https://lacronicademorelos.com/feed/',
    notas_tecnicas: 'Alta 2026-09-28 (NEW SOURCE BATCH 08). RSS HTTP 200, 10 items. Dominio propio lacronicademorelos.com. Lista 1 freq=12.',
  }),
  medioRss({
    medio_id: 'MED-0377',
    nombre_medio: "Así Sucede",
    url_base: 'https://asisucede.com.mx',
    rss_url: 'https://asisucede.com.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-28 (NEW SOURCE BATCH 08). RSS HTTP 200, 10 items. Dominio propio asisucede.com.mx. Lista 1 freq=12.',
  }),
  medioRss({
    medio_id: 'MED-0378',
    nombre_medio: "Acierta",
    url_base: 'https://www.acierta.mx',
    rss_url: 'https://www.acierta.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-28 (NEW SOURCE BATCH 08). RSS HTTP 200, 10 items. Dominio propio acierta.mx. Lista 1 freq=12.',
  }),
  medioRss({
    medio_id: 'MED-0379',
    nombre_medio: "Ego Chihuahua",
    url_base: 'https://egochihuahua.com.mx',
    rss_url: 'https://egochihuahua.com.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-28 (NEW SOURCE BATCH 08). RSS HTTP 200, 10 items. Dominio propio egochihuahua.com.mx. Lista 1 freq=12.',
  }),
  medioRss({
    medio_id: 'MED-0380',
    nombre_medio: "Medios Obson",
    url_base: 'https://mediosobson.com',
    rss_url: 'https://mediosobson.com/feed/',
    notas_tecnicas: 'Alta 2026-09-28 (NEW SOURCE BATCH 08). RSS HTTP 200, 10 items. Dominio propio mediosobson.com. Lista 1 freq=12.',
  }),
  medioRss({
    medio_id: 'MED-0381',
    nombre_medio: "24 Horas Puebla",
    url_base: 'https://24horaspuebla.com',
    rss_url: 'https://24horaspuebla.com/feed/',
    notas_tecnicas: 'Alta 2026-09-28 (NEW SOURCE BATCH 08). RSS HTTP 200, 10 items. Dominio propio 24horaspuebla.com. Lista 1 freq=12.',
  }),
  medioRss({
    medio_id: 'MED-0382',
    nombre_medio: "El Heraldo de Puebla",
    url_base: 'https://heraldodepuebla.com',
    rss_url: 'https://heraldodepuebla.com/feed/',
    notas_tecnicas: 'Alta 2026-09-28 (NEW SOURCE BATCH 08). RSS HTTP 200, 10 items. Dominio propio heraldodepuebla.com. Lista 1 freq=12.',
  }),
  medioRss({
    medio_id: 'MED-0383',
    nombre_medio: "Agua Quemada",
    url_base: 'https://aguaquemada.mx',
    rss_url: 'https://aguaquemada.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-28 (NEW SOURCE BATCH 08). RSS HTTP 200, 12 items. Dominio propio aguaquemada.mx. Lista 1 freq=12.',
  }),
  medioRss({
    medio_id: 'MED-0384',
    nombre_medio: "Nv Noticias",
    url_base: 'https://nvnoticias.mx',
    rss_url: 'https://nvnoticias.mx/index.php/feed/',
    notas_tecnicas: 'Alta 2026-09-28 (NEW SOURCE BATCH 08). RSS HTTP 200, 10 items. Dominio propio nvnoticias.mx. Lista 1 freq=12.',
  }),
  medioRss({
    medio_id: 'MED-0385',
    nombre_medio: "Carlos Martin Huerta",
    url_base: 'https://carlosmartinhuerta.com.mx',
    rss_url: 'https://carlosmartinhuerta.com.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-28 (NEW SOURCE BATCH 08). RSS HTTP 200, 10 items. Dominio propio carlosmartinhuerta.com.mx. Lista 1 freq=11.',
  }),
  medioRss({
    medio_id: 'MED-0386',
    nombre_medio: "Así Lo Dice Puebla",
    url_base: 'https://asilodicepuebla.com',
    rss_url: 'https://asilodicepuebla.com/feed/',
    notas_tecnicas: 'Alta 2026-09-28 (NEW SOURCE BATCH 08). RSS HTTP 200, 10 items. Dominio propio asilodicepuebla.com. Lista 1 freq=11.',
  }),
  medioRss({
    medio_id: 'MED-0387',
    nombre_medio: "Clase Turista",
    url_base: 'https://claseturista.com.mx',
    rss_url: 'https://claseturista.com.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-28 (NEW SOURCE BATCH 08). RSS HTTP 200, 10 items. Dominio propio claseturista.com.mx. Lista 1 freq=11.',
  }),
];

function hostOf(u: string | null | undefined): string {
  if (!u) return '';
  try {
    return new URL(u.startsWith('http') ? u : `https://${u}`).hostname.replace(/^www\./, '').toLowerCase();
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
  const ids = MEDIOS_BATCH08.map((m) => m.medio_id);
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
  const loteHosts = new Set(MEDIOS_BATCH08.map((m) => hostOf(m.url_base)).filter(Boolean));
  if (loteHosts.size !== MEDIOS_BATCH08.length) {
    console.error('ABORT: hosts duplicados dentro del lote');
    process.exit(2);
  }
  const loteFeeds = new Set(MEDIOS_BATCH08.map(sourceUrl).filter(Boolean));
  if (loteFeeds.size !== MEDIOS_BATCH08.length) {
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
    console.log(MEDIOS_BATCH08.map((m) => `${m.medio_id}: ${m.nombre_medio} — ${m.rss_url ?? m.sitemap_url}`).join('\n'));
    return;
  }
  const { error: errUpsert } = await sb.from('medios').upsert(MEDIOS_BATCH08, { onConflict: 'medio_id' });
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
