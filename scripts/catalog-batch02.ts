/**
 * Alta al catálogo: 20 medios — NEW SOURCE BATCH 02 (2026-09-24).
 *
 * Re-probe estricto del pool IMPORTER_HIGH_PENDING (Lista 1 / Pressclipping_medios.csv).
 * RSS oficial HIGH_CONFIDENCE_STRICT. Canal 44 se excluyó (sin fuente 200;
 * colisión operativa con MED-0040). MED-0204 no se reutiliza.
 * IDs: MED-0215..MED-0234 (secuencial tras MAX LIVE MED-0214).
 *
 * Uso:
 *   npm run catalog-batch02 -- --dry
 *   npm run catalog-batch02
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

export const MEDIOS_BATCH02: Medio[] = [
  medioRss({
    medio_id: 'MED-0215',
    nombre_medio: 'El Tiempo de Monclova',
    url_base: 'https://eltiempomx.com',
    rss_url: 'https://eltiempomx.com/index.xml',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 02). RSS `/index.xml` HTTP 200, 25 items frescos. Lista 1 freq=110.',
  }),
  medioRss({
    medio_id: 'MED-0216',
    nombre_medio: 'AlMomento.mx',
    url_base: 'https://almomento.mx',
    rss_url: 'https://almomento.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 02). RSS WP `/feed/` HTTP 200, 10 items frescos. Lista 1 freq=45.',
  }),
  medioRss({
    medio_id: 'MED-0217',
    nombre_medio: 'La Jornada Aguascalientes',
    url_base: 'https://www.lja.mx',
    rss_url: 'https://www.lja.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 02). RSS WP `/feed/` HTTP 200, 18 items frescos. Dominio propio lja.mx (no jornada.com.mx). Lista 1 freq=44.',
  }),
  medioRss({
    medio_id: 'MED-0218',
    nombre_medio: 'Nuevolaredo.tv',
    url_base: 'https://nuevolaredo.tv',
    rss_url: 'https://nuevolaredo.tv/feed/',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 02). RSS WP `/feed/` HTTP 200, 10 items frescos. Lista 1 freq=42.',
  }),
  medioRss({
    medio_id: 'MED-0219',
    nombre_medio: 'Marcrix Noticias',
    url_base: 'https://www.marcrixnoticias.com.mx',
    rss_url: 'https://www.marcrixnoticias.com.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 02). RSS WP `/feed/` HTTP 200, 10 items frescos. Lista 1 freq=42.',
  }),
  medioRss({
    medio_id: 'MED-0220',
    nombre_medio: 'Ovaciones',
    url_base: 'https://ovaciones.com',
    rss_url: 'https://ovaciones.com/rss.xml',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 02). RSS `/rss.xml` HTTP 200, 50 items frescos. Lista 1 freq=37.',
  }),
  medioRss({
    medio_id: 'MED-0221',
    nombre_medio: 'El Liberal Metropolitano',
    url_base: 'https://liberalmetropolitano.com.mx',
    rss_url: 'https://liberalmetropolitano.com.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 02). RSS WP `/feed/` HTTP 200, 15 items frescos. Lista 1 freq=36.',
  }),
  medioRss({
    medio_id: 'MED-0222',
    nombre_medio: 'La Prensa De Monclova',
    url_base: 'https://laprensadecoahuila.com.mx',
    rss_url: 'https://laprensadecoahuila.com.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 02). RSS WP `/feed/` HTTP 200, 13 items frescos. Lista 1 freq=36.',
  }),
  medioRss({
    medio_id: 'MED-0223',
    nombre_medio: 'Talajalisco noticias',
    url_base: 'https://talajalisconoticias.com',
    rss_url: 'https://talajalisconoticias.com/feed/',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 02). RSS WP `/feed/` HTTP 200, 10 items frescos. Lista 1 freq=35.',
  }),
  medioRss({
    medio_id: 'MED-0224',
    nombre_medio: 'Cúspide México',
    url_base: 'https://cuspidemexico.com',
    rss_url: 'https://cuspidemexico.com/feed/',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 02). RSS WP `/feed/` HTTP 200, 10 items frescos. Lista 1 freq=34.',
  }),
  medioRss({
    medio_id: 'MED-0225',
    nombre_medio: 'Entrelíneas. Las Noticias de Chihuahua',
    url_base: 'https://entrelineas.com.mx',
    rss_url: 'https://entrelineas.com.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 02). RSS WP `/feed/` HTTP 200, 10 items frescos. Lista 1 freq=34.',
  }),
  medioRss({
    medio_id: 'MED-0226',
    nombre_medio: 'Mass Informacion',
    url_base: 'https://massinformacion.com.mx',
    rss_url: 'https://massinformacion.com.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 02). RSS WP `/feed/` HTTP 200, 10 items frescos. Lista 1 freq=32.',
  }),
  medioRss({
    medio_id: 'MED-0227',
    nombre_medio: 'Tigmx',
    url_base: 'https://tigmx.com',
    rss_url: 'https://tigmx.com/feed/',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 02). RSS WP `/feed/` HTTP 200, 10 items frescos. Lista 1 freq=30.',
  }),
  medioRss({
    medio_id: 'MED-0228',
    nombre_medio: 'La Jornada Estado de México',
    url_base: 'https://lajornadaestadodemexico.com',
    rss_url: 'https://lajornadaestadodemexico.com/feed/',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 02). RSS WP `/feed/` HTTP 200, 100 items frescos. Dominio propio (no jornada.com.mx). Lista 1 freq=30.',
  }),
  medioRss({
    medio_id: 'MED-0229',
    nombre_medio: 'La Jornada de Oriente',
    url_base: 'https://www.lajornadadeoriente.com.mx',
    rss_url: 'https://www.lajornadadeoriente.com.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 02). RSS WP `/feed/` HTTP 200, 20 items frescos. Dominio propio (no jornada.com.mx). Lista 1 freq=29.',
  }),
  medioRss({
    medio_id: 'MED-0230',
    nombre_medio: 'Libertador',
    url_base: 'https://libertador.mx',
    rss_url: 'https://libertador.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 02). RSS WP `/feed/` HTTP 200, 10 items frescos. Lista 1 freq=29.',
  }),
  medioRss({
    medio_id: 'MED-0231',
    nombre_medio: 'Es Noticia Veracruz',
    url_base: 'https://esnoticiamexico.com',
    rss_url: 'https://esnoticiamexico.com/feed/',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 02). RSS WP `/feed/` HTTP 200, 10 items frescos. Lista 1 freq=29.',
  }),
  medioRss({
    medio_id: 'MED-0232',
    nombre_medio: 'Diario de Tabasco',
    url_base: 'https://www.diariodetabasco.mx',
    rss_url: 'https://www.diariodetabasco.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 02). RSS WP `/feed/` HTTP 200, 13 items frescos. Lista 1 freq=28.',
  }),
  medioRss({
    medio_id: 'MED-0233',
    nombre_medio: 'Periodismo Y Ambiente',
    url_base: 'https://www.periodismoyambiente.com.mx',
    rss_url: 'https://www.periodismoyambiente.com.mx/feed/',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 02). RSS WP `/feed/` HTTP 200, 10 items frescos. Lista 1 freq=27.',
  }),
  medioRss({
    medio_id: 'MED-0234',
    nombre_medio: 'Expreso.press',
    url_base: 'https://expreso.press',
    rss_url: 'https://expreso.press/feed/',
    notas_tecnicas: 'Alta 2026-09-24 (NEW SOURCE BATCH 02). RSS WP `/feed/` HTTP 200, 10 items frescos. Lista 1 freq=27.',
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
  const ids = MEDIOS_BATCH02.map((m) => m.medio_id);
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
    if (n <= 214) {
      console.error(`ABORT: ID ${id} no es posterior a MAX LIVE MED-0214`);
      process.exit(2);
    }
  }
  const loteHosts = new Set(MEDIOS_BATCH02.flatMap((m) => [hostOf(m.url_base), hostOf(m.rss_url)].filter(Boolean)));
  if (loteHosts.size !== MEDIOS_BATCH02.length) {
    console.error('ABORT: hosts duplicados dentro del lote');
    process.exit(2);
  }
  const loteFeeds = new Set(MEDIOS_BATCH02.map((m) => (m.rss_url ?? '').replace(/\/+$/, '').toLowerCase()));
  if (loteFeeds.size !== MEDIOS_BATCH02.length) {
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
    console.log(MEDIOS_BATCH02.map((m) => `${m.medio_id}: ${m.nombre_medio} — ${m.rss_url}`).join('\n'));
    return;
  }
  const { error: errUpsert } = await sb.from('medios').upsert(MEDIOS_BATCH02, { onConflict: 'medio_id' });
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
