/**
 * Alta al catálogo: 10 medios — NEW SOURCE BATCH 01 (2026-09-24).
 *
 * Master list Pressclipping_medios.csv, SIN_MATCH, RSS oficial FRESH
 * (HTTP 200, ≥5 items, fechas ≤7d, dominio propio). UniMexicali/uniradiobaja
 * se excluyó (red Uniradio vs MED-0087). MED-0204 no se reutiliza
 * (PLANNED_NOT_ONBOARDED). IDs: MED-0205..MED-0214.
 *
 * Uso:
 *   npm run catalog-batch01 -- --dry
 *   npm run catalog-batch01
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { getSupabase } from '../src/supabase/client.js';
import type { Medio } from '../src/types/schemas.js';

export const MEDIOS_BATCH01: Medio[] = [
  {
    medio_id: 'MED-0205',
    nombre_medio: 'Hoy En Perspectiva',
    grupo_medio: null,
    url_base: 'https://hoyenperspectiva.com',
    pais: 'MX',
    estado: null,
    municipio: null,
    region: null,
    categoria: 'Noticias',
    prioridad: 'Media',
    activo: true,
    metodo_extraccion: 'RSS',
    rss_url: 'https://hoyenperspectiva.com/feed/',
    sitemap_url: null,
    secciones_urls: null,
    buscador_url: null,
    requiere_javascript: false,
    requiere_proxy: false,
    frecuencia_minutos: 360,
    notas_tecnicas:
      'Alta 2026-09-24 (NEW SOURCE BATCH 01). RSS WP `/feed/` HTTP 200, 10 items frescos. Lista 1 freq=115.',
  },
  {
    medio_id: 'MED-0206',
    nombre_medio: 'Jalisco Hoy',
    grupo_medio: null,
    url_base: 'https://jaliscohoy.com',
    pais: 'MX',
    estado: null,
    municipio: null,
    region: null,
    categoria: 'Noticias',
    prioridad: 'Media',
    activo: true,
    metodo_extraccion: 'RSS',
    rss_url: 'https://jaliscohoy.com/feed/',
    sitemap_url: null,
    secciones_urls: null,
    buscador_url: null,
    requiere_javascript: false,
    requiere_proxy: false,
    frecuencia_minutos: 360,
    notas_tecnicas:
      'Alta 2026-09-24 (NEW SOURCE BATCH 01). RSS WP `/feed/` HTTP 200, 10 items frescos. Lista 1 freq=80.',
  },
  {
    medio_id: 'MED-0207',
    nombre_medio: 'Diario CAMBIO22',
    grupo_medio: null,
    url_base: 'https://diariocambio22.mx',
    pais: 'MX',
    estado: null,
    municipio: null,
    region: null,
    categoria: 'Noticias',
    prioridad: 'Media',
    activo: true,
    metodo_extraccion: 'RSS',
    rss_url: 'https://diariocambio22.mx/feed/',
    sitemap_url: null,
    secciones_urls: null,
    buscador_url: null,
    requiere_javascript: false,
    requiere_proxy: false,
    frecuencia_minutos: 360,
    notas_tecnicas:
      'Alta 2026-09-24 (NEW SOURCE BATCH 01). RSS WP `/feed/` HTTP 200, 20 items frescos. Lista 1 freq=68.',
  },
  {
    medio_id: 'MED-0208',
    nombre_medio: 'Diario El Buen Tono',
    grupo_medio: null,
    url_base: 'https://www.elbuentono.com.mx',
    pais: 'MX',
    estado: null,
    municipio: null,
    region: null,
    categoria: 'Noticias',
    prioridad: 'Media',
    activo: true,
    metodo_extraccion: 'RSS',
    rss_url: 'https://www.elbuentono.com.mx/feed/',
    sitemap_url: null,
    secciones_urls: null,
    buscador_url: null,
    requiere_javascript: false,
    requiere_proxy: false,
    frecuencia_minutos: 360,
    notas_tecnicas:
      'Alta 2026-09-24 (NEW SOURCE BATCH 01). RSS WP `/feed/` HTTP 200, 10 items frescos. Lista 1 freq=59.',
  },
  {
    medio_id: 'MED-0209',
    nombre_medio: 'Laparadoja',
    grupo_medio: null,
    url_base: 'https://laparadoja.com.mx',
    pais: 'MX',
    estado: null,
    municipio: null,
    region: null,
    categoria: 'Noticias',
    prioridad: 'Media',
    activo: true,
    metodo_extraccion: 'RSS',
    rss_url: 'https://laparadoja.com.mx/feed',
    sitemap_url: null,
    secciones_urls: null,
    buscador_url: null,
    requiere_javascript: false,
    requiere_proxy: false,
    frecuencia_minutos: 360,
    notas_tecnicas:
      'Alta 2026-09-24 (NEW SOURCE BATCH 01). RSS WP `/feed` HTTP 200, 10 items frescos. Lista 1 freq=58.',
  },
  {
    medio_id: 'MED-0210',
    nombre_medio: 'Hoja De Ruta Digital',
    grupo_medio: null,
    url_base: 'https://hojaderutadigital.mx',
    pais: 'MX',
    estado: null,
    municipio: null,
    region: null,
    categoria: 'Noticias',
    prioridad: 'Media',
    activo: true,
    metodo_extraccion: 'RSS',
    rss_url: 'https://hojaderutadigital.mx/feed/',
    sitemap_url: null,
    secciones_urls: null,
    buscador_url: null,
    requiere_javascript: false,
    requiere_proxy: false,
    frecuencia_minutos: 360,
    notas_tecnicas:
      'Alta 2026-09-24 (NEW SOURCE BATCH 01). RSS WP `/feed/` HTTP 200, 10 items frescos. Lista 1 freq=51.',
  },
  {
    medio_id: 'MED-0211',
    nombre_medio: 'Cadena Política',
    grupo_medio: null,
    url_base: 'https://cadenapolitica.com',
    pais: 'MX',
    estado: null,
    municipio: null,
    region: null,
    categoria: 'Noticias',
    prioridad: 'Media',
    activo: true,
    metodo_extraccion: 'RSS',
    rss_url: 'https://cadenapolitica.com/feed/',
    sitemap_url: null,
    secciones_urls: null,
    buscador_url: null,
    requiere_javascript: false,
    requiere_proxy: false,
    frecuencia_minutos: 360,
    notas_tecnicas:
      'Alta 2026-09-24 (NEW SOURCE BATCH 01). RSS WP `/feed/` HTTP 200, 42 items frescos. Lista 1 freq=48.',
  },
  {
    medio_id: 'MED-0212',
    nombre_medio: 'Punto por Punto',
    grupo_medio: null,
    url_base: 'https://www.puntoporpunto.com',
    pais: 'MX',
    estado: null,
    municipio: null,
    region: null,
    categoria: 'Noticias',
    prioridad: 'Media',
    activo: true,
    metodo_extraccion: 'RSS',
    rss_url: 'https://www.puntoporpunto.com/feed/',
    sitemap_url: null,
    secciones_urls: null,
    buscador_url: null,
    requiere_javascript: false,
    requiere_proxy: false,
    frecuencia_minutos: 360,
    notas_tecnicas:
      'Alta 2026-09-24 (NEW SOURCE BATCH 01). RSS WP `/feed/` HTTP 200, 10 items frescos. Lista 1 freq=48.',
  },
  {
    medio_id: 'MED-0213',
    nombre_medio: 'Talla Política',
    grupo_medio: null,
    url_base: 'https://www.tallapolitica.com.mx',
    pais: 'MX',
    estado: null,
    municipio: null,
    region: null,
    categoria: 'Noticias',
    prioridad: 'Media',
    activo: true,
    metodo_extraccion: 'RSS',
    rss_url: 'https://www.tallapolitica.com.mx/feed/',
    sitemap_url: null,
    secciones_urls: null,
    buscador_url: null,
    requiere_javascript: false,
    requiere_proxy: false,
    frecuencia_minutos: 360,
    notas_tecnicas:
      'Alta 2026-09-24 (NEW SOURCE BATCH 01). RSS WP `/feed/` HTTP 200, 88 items frescos. Lista 1 freq=47.',
  },
  {
    medio_id: 'MED-0214',
    nombre_medio: 'Jlanoticias',
    grupo_medio: null,
    url_base: 'https://jlanoticias.com',
    pais: 'MX',
    estado: null,
    municipio: null,
    region: null,
    categoria: 'Noticias',
    prioridad: 'Media',
    activo: true,
    metodo_extraccion: 'RSS',
    rss_url: 'https://jlanoticias.com/feed/',
    sitemap_url: null,
    secciones_urls: null,
    buscador_url: null,
    requiere_javascript: false,
    requiere_proxy: false,
    frecuencia_minutos: 360,
    notas_tecnicas:
      'Alta 2026-09-24 (NEW SOURCE BATCH 01). RSS WP `/feed/` HTTP 200, 10 items frescos. Lista 1 freq=46. Reemplaza a UniMexicali (uniradiobaja) por red Uniradio.',
  },
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
  const ids = MEDIOS_BATCH01.map((m) => m.medio_id);
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
    if (n <= 204) {
      console.error(`ABORT: ID ${id} no es posterior a MED-0204`);
      process.exit(2);
    }
  }
  const loteHosts = new Set(MEDIOS_BATCH01.flatMap((m) => [hostOf(m.url_base), hostOf(m.rss_url)].filter(Boolean)));
  if (loteHosts.size !== MEDIOS_BATCH01.length) {
    console.error('ABORT: hosts duplicados dentro del lote');
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
    console.log(MEDIOS_BATCH01.map((m) => `${m.medio_id}: ${m.nombre_medio} — ${m.rss_url}`).join('\n'));
    return;
  }
  const { error: errUpsert } = await sb.from('medios').upsert(MEDIOS_BATCH01, { onConflict: 'medio_id' });
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
