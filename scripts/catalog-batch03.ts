/**
 * Alta al catálogo: 25 medios — NEW SOURCE BATCH 03 (2026-09-24).
 *
 * Re-probe LIVE del pool IMPORTER_HIGH_PENDING + 4 leftover strict de Batch02.
 * RSS-first HIGH_CONFIDENCE_STRICT. Canal 44 y Nación321 se excluyeron
 * (no_200_source / no_strict_gate). El Siglo de Durango (sitemap strict)
 * quedó fuera del cap RSS-first de 25. MED-0204 no se reutiliza.
 * IDs: MED-0235..MED-0259 (secuencial tras MAX LIVE MED-0234).
 *
 * Uso:
 *   npm run catalog-batch03 -- --dry
 *   npm run catalog-batch03
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { getSupabase } from '../src/supabase/client.js';
import type { Medio } from '../src/types/schemas.js';

function medioRss(partial: {
  medio_id: string;
  nombre_medio: string;
  url_base: string;
  rss_url: string;
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
    metodo_extraccion: 'RSS',
    rss_url: partial.rss_url,
    sitemap_url: null,
    secciones_urls: null,
    buscador_url: null,
    requiere_javascript: false,
    requiere_proxy: false,
    frecuencia_minutos: 360,
    notas_tecnicas: partial.notas_tecnicas,
  };
}

export const MEDIOS_BATCH03: Medio[] = [
  medioRss({
    medio_id: 'MED-0235',
    nombre_medio: 'Diario de Chiapas',
    url_base: 'https://diariodechiapas.com',
    rss_url: 'https://diariodechiapas.com/feed/',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 03). RSS WP `/feed/` HTTP 200, 12 items frescos. Leftover Batch02 re-probe LIVE. Lista 1 freq=26.',
  }),
  medioRss({
    medio_id: 'MED-0236',
    nombre_medio: 'LA JORNADA BAJA CALIFORNIA',
    url_base: 'https://jornadabc.com.mx',
    rss_url: 'https://jornadabc.com.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 03). RSS WP `/feed/` HTTP 200, 10 items frescos. Dominio propio jornadabc.com.mx (no jornada.com.mx). Leftover Batch02 re-probe LIVE. Lista 1 freq=26.',
  }),
  medioRss({
    medio_id: 'MED-0237',
    nombre_medio: 'Juárez Noticias',
    url_base: 'https://juareznoticias.com',
    rss_url: 'https://juareznoticias.com/feed/',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 03). RSS WP `/feed/` HTTP 200, 10 items frescos. Leftover Batch02 re-probe LIVE. Lista 1 freq=26.',
  }),
  medioRss({
    medio_id: 'MED-0238',
    nombre_medio: 'Récord',
    url_base: 'https://www.record.com.mx',
    rss_url: 'https://www.record.com.mx/rss',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 03). RSS `/rss` HTTP 200, 200 items frescos. Lista 1 freq=26.',
  }),
  medioRss({
    medio_id: 'MED-0239',
    nombre_medio: 'Enfoque',
    url_base: 'https://enfoquenoticias.com.mx',
    rss_url: 'https://enfoquenoticias.com.mx/rss.xml',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 03). RSS `/rss.xml` HTTP 200, 50 items frescos. Lista 1 freq=25.',
  }),
  medioRss({
    medio_id: 'MED-0240',
    nombre_medio: 'Reto Diario',
    url_base: 'https://retodiario.com',
    rss_url: 'https://retodiario.com/feed/',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 03). RSS WP `/feed/` HTTP 200, 15 items frescos. Lista 1 freq=24.',
  }),
  medioRss({
    medio_id: 'MED-0241',
    nombre_medio: 'Notiver',
    url_base: 'https://www.notiver.com',
    rss_url: 'https://www.notiver.com/rss/',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 03). RSS `/rss/` HTTP 200, 15 items frescos. Lista 1 freq=24.',
  }),
  medioRss({
    medio_id: 'MED-0242',
    nombre_medio: 'Colima Noticias',
    url_base: 'https://www.colimanoticias.com',
    rss_url: 'https://www.colimanoticias.com/feed/',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 03). RSS WP `/feed/` HTTP 200, 50 items frescos. Lista 1 freq=24.',
  }),
  medioRss({
    medio_id: 'MED-0243',
    nombre_medio: 'NVI Noticias',
    url_base: 'https://www.nvinoticias.com',
    rss_url: 'https://www.nvinoticias.com/rss.xml',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 03). RSS `/rss.xml` HTTP 200, 10 items frescos. Lista 1 freq=24.',
  }),
  medioRss({
    medio_id: 'MED-0244',
    nombre_medio: 'Tus Buenas Noticias',
    url_base: 'https://www.tusbuenasnoticias.com',
    rss_url: 'https://www.tusbuenasnoticias.com/feed-google-news/actualidad',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 03). RSS same-domain `/feed-google-news/actualidad` HTTP 200, 15 items frescos. No agregador externo. Lista 1 freq=24.',
  }),
  medioRss({
    medio_id: 'MED-0245',
    nombre_medio: 'Eldespertadorqr.com',
    url_base: 'https://eldespertador.com.mx',
    rss_url: 'https://eldespertador.com.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 03). RSS WP `/feed/` HTTP 200, 10 items frescos. Lista 1 freq=23.',
  }),
  medioRss({
    medio_id: 'MED-0246',
    nombre_medio: 'El Momento Quintana Roo',
    url_base: 'https://elmomentoqroo.mx',
    rss_url: 'https://elmomentoqroo.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 03). RSS WP `/feed/` HTTP 200, 10 items frescos. Lista 1 freq=23.',
  }),
  medioRss({
    medio_id: 'MED-0247',
    nombre_medio: 'Mayacomunicacion.com.mx',
    url_base: 'https://mayacomunicacion.com.mx',
    rss_url: 'https://mayacomunicacion.com.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 03). RSS WP `/feed/` HTTP 200, 81 items frescos. Lista 1 freq=23.',
  }),
  medioRss({
    medio_id: 'MED-0248',
    nombre_medio: 'Noticiero Altavoz',
    url_base: 'https://noticieroaltavoz.com',
    rss_url: 'https://noticieroaltavoz.com/feed/',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 03). RSS WP `/feed/` HTTP 200, 10 items frescos. Lista 1 freq=23.',
  }),
  medioRss({
    medio_id: 'MED-0249',
    nombre_medio: 'Golpe Político',
    url_base: 'https://golpepolitico.com',
    rss_url: 'https://golpepolitico.com/feed/',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 03). RSS WP `/feed/` HTTP 200, 10 items frescos. Lista 1 freq=23.',
  }),
  medioRss({
    medio_id: 'MED-0250',
    nombre_medio: 'Candelero',
    url_base: 'https://candelero.com.mx',
    rss_url: 'https://candelero.com.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 03). RSS WP `/feed/` HTTP 200, 10 items frescos. Lista 1 freq=23.',
  }),
  medioRss({
    medio_id: 'MED-0251',
    nombre_medio: 'Cco Noticias Corporación Comunicativa Ojeda',
    url_base: 'https://cconoticias.com',
    rss_url: 'https://cconoticias.com/feed/',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 03). RSS WP `/feed/` HTTP 200, 50 items frescos. Lista 1 freq=23.',
  }),
  medioRss({
    medio_id: 'MED-0252',
    nombre_medio: 'La Gazzetta DF',
    url_base: 'https://lagazzettadf.com',
    rss_url: 'https://lagazzettadf.com/feed/',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 03). RSS WP `/feed/` HTTP 200, 14 items frescos. Lista 1 freq=22.',
  }),
  medioRss({
    medio_id: 'MED-0253',
    nombre_medio: 'Tribuna del Yaqui',
    url_base: 'https://tribuna.com.mx',
    rss_url: 'https://tribuna.com.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 03). RSS WP `/feed/` HTTP 200, 10 items frescos. Lista 1 freq=22.',
  }),
  medioRss({
    medio_id: 'MED-0254',
    nombre_medio: 'El Sureste',
    url_base: 'https://elsureste.mx',
    rss_url: 'https://elsureste.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 03). RSS WP `/feed/` HTTP 200, 10 items frescos. Lista 1 freq=21.',
  }),
  medioRss({
    medio_id: 'MED-0255',
    nombre_medio: 'Plaza de Armas',
    url_base: 'https://plazadearmas.com.mx',
    rss_url: 'https://plazadearmas.com.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 03). RSS WP `/feed/` HTTP 200, 10 items frescos. Lista 1 freq=21.',
  }),
  medioRss({
    medio_id: 'MED-0256',
    nombre_medio: 'Segundo a Segundo',
    url_base: 'https://segundoasegundo.com',
    rss_url: 'https://segundoasegundo.com/feed/',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 03). RSS WP `/feed/` HTTP 200, 120 items frescos. Lista 1 freq=21.',
  }),
  medioRss({
    medio_id: 'MED-0257',
    nombre_medio: 'Dominiopublico',
    url_base: 'https://www.dominiopublico.com.mx',
    rss_url: 'https://www.dominiopublico.com.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 03). RSS WP `/feed/` HTTP 200, 10 items frescos. Lista 1 freq=21.',
  }),
  medioRss({
    medio_id: 'MED-0258',
    nombre_medio: 'La Región Tula',
    url_base: 'https://laregiontula.com.mx',
    rss_url: 'https://laregiontula.com.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 03). RSS WP `/feed/` HTTP 200, 10 items frescos. Lista 1 freq=21.',
  }),
  medioRss({
    medio_id: 'MED-0259',
    nombre_medio: 'Arsenal Diario Digital',
    url_base: 'https://www.elarsenal.net',
    rss_url: 'https://www.elarsenal.net/feed/',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 03). RSS WP `/feed/` HTTP 200, 10 items frescos. Lista 1 freq=21.',
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

async function main() {
  const dry = process.argv.includes('--dry');
  const sb = getSupabase();
  const ids = MEDIOS_BATCH03.map((m) => m.medio_id);
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
    if (n <= 234) {
      console.error(`ABORT: ID ${id} no es posterior a MAX LIVE MED-0234`);
      process.exit(2);
    }
  }
  const loteHosts = new Set(MEDIOS_BATCH03.flatMap((m) => [hostOf(m.url_base), hostOf(m.rss_url)].filter(Boolean)));
  if (loteHosts.size !== MEDIOS_BATCH03.length) {
    console.error('ABORT: hosts duplicados dentro del lote');
    process.exit(2);
  }
  const loteFeeds = new Set(MEDIOS_BATCH03.map((m) => (m.rss_url ?? '').replace(/\/+$/, '').toLowerCase()));
  if (loteFeeds.size !== MEDIOS_BATCH03.length) {
    console.error('ABORT: feeds duplicados dentro del lote');
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
    console.log(MEDIOS_BATCH03.map((m) => `${m.medio_id}: ${m.nombre_medio} — ${m.rss_url}`).join('\n'));
    return;
  }
  const { error: errUpsert } = await sb.from('medios').upsert(MEDIOS_BATCH03, { onConflict: 'medio_id' });
  if (errUpsert) { console.error('Upsert falló:', errUpsert.message); process.exit(1); }
  const { data: verif, error: errVerif } = await sb
    .from('medios')
    .select('medio_id,nombre_medio,metodo_extraccion,rss_url,activo,url_base')
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
