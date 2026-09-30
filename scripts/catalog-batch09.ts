/**
 * Alta al catálogo: 25 medios — MEDIA EXPANSION BATCH 1 / P1 (2026-09-29).
 *
 * Prioridad geográfica: CDMX, Jalisco, Nuevo León, Estado de México.
 * NL ya está cubierto en catálogo (El Norte, ABC, Info7, Telediario, etc.);
 * no se rellenó el cupo con redirecciones de identidad ni marcas ajenas.
 * Jalisco también denso: solo 3 altas de fuente pública viable.
 * IDs: MED-0388..MED-0412 (secuencial tras MAX LIVE MED-0387).
 * El CEO (MED-0185) no se reutiliza.
 *
 * Uso:
 *   npm run catalog-batch09 -- --dry
 *   npm run catalog-batch09
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { getSupabase } from '../src/supabase/client.js';
import type { Medio } from '../src/types/schemas.js';

type EstadoP1 = 'CDMX' | 'Jalisco' | 'Estado de México';

function baseMedio(partial: {
  medio_id: string;
  nombre_medio: string;
  url_base: string;
  estado: EstadoP1;
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
    estado: partial.estado,
    municipio: null,
    region: null,
    categoria: 'Noticias',
    prioridad: 'Alta',
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

function medioRss(p: {
  medio_id: string;
  nombre_medio: string;
  url_base: string;
  estado: EstadoP1;
  rss_url: string;
  notas_tecnicas: string;
}): Medio {
  return baseMedio({ ...p, metodo_extraccion: 'RSS', sitemap_url: null });
}

function medioSitemap(p: {
  medio_id: string;
  nombre_medio: string;
  url_base: string;
  estado: EstadoP1;
  sitemap_url: string;
  notas_tecnicas: string;
}): Medio {
  return baseMedio({ ...p, metodo_extraccion: 'SITEMAP', rss_url: null });
}

const NOTA = 'Alta 2026-09-29 (MEDIA EXPANSION BATCH 1 P1). Pre-canary público STRICT. Sin cron masivo.';

export const MEDIOS_BATCH09: Medio[] = [
  medioRss({
    medio_id: 'MED-0388',
    nombre_medio: 'Etcétera',
    url_base: 'https://etcetera.com.mx',
    estado: 'CDMX',
    rss_url: 'https://etcetera.com.mx/feed',
    notas_tecnicas: `${NOTA} RSS. Revista política CDMX.`,
  }),
  medioRss({
    medio_id: 'MED-0389',
    nombre_medio: 'Nexos',
    url_base: 'https://www.nexos.com.mx',
    estado: 'CDMX',
    rss_url: 'https://www.nexos.com.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. Análisis político.`,
  }),
  medioRss({
    medio_id: 'MED-0390',
    nombre_medio: 'Letras Libres',
    url_base: 'https://letraslibres.com',
    estado: 'CDMX',
    rss_url: 'https://letraslibres.com/feed/',
    notas_tecnicas: `${NOTA} RSS. Cultura/política.`,
  }),
  medioRss({
    medio_id: 'MED-0391',
    nombre_medio: 'Regeneración',
    url_base: 'https://regeneracion.mx',
    estado: 'CDMX',
    rss_url: 'https://regeneracion.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. Digital político.`,
  }),
  medioRss({
    medio_id: 'MED-0392',
    nombre_medio: 'Polemón',
    url_base: 'https://polemon.mx',
    estado: 'CDMX',
    rss_url: 'https://polemon.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. CDMX/gobierno.`,
  }),
  medioRss({
    medio_id: 'MED-0393',
    nombre_medio: 'Verificado',
    url_base: 'https://verificado.com.mx',
    estado: 'CDMX',
    rss_url: 'https://verificado.com.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. Fact-check.`,
  }),
  medioRss({
    medio_id: 'MED-0394',
    nombre_medio: 'CIMAC Noticias',
    url_base: 'https://cimacnoticias.com.mx',
    estado: 'CDMX',
    rss_url: 'https://cimacnoticias.com.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. Agencia de género/política.`,
  }),
  medioRss({
    medio_id: 'MED-0395',
    nombre_medio: 'Energía Hoy',
    url_base: 'https://energiahoy.com',
    estado: 'CDMX',
    rss_url: 'https://energiahoy.com/feed/',
    notas_tecnicas: `${NOTA} RSS. Económico/energía.`,
  }),
  medioRss({
    medio_id: 'MED-0396',
    nombre_medio: 'Local.mx',
    url_base: 'https://www.local.mx',
    estado: 'CDMX',
    rss_url: 'https://www.local.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. Digital local CDMX.`,
  }),
  medioRss({
    medio_id: 'MED-0397',
    nombre_medio: 'Revista Común',
    url_base: 'https://revistacomun.com',
    estado: 'CDMX',
    rss_url: 'https://revistacomun.com/feed/',
    notas_tecnicas: `${NOTA} RSS. Política.`,
  }),
  medioRss({
    medio_id: 'MED-0398',
    nombre_medio: 'Rompeviento TV',
    url_base: 'https://www.rompeviento.tv',
    estado: 'CDMX',
    rss_url: 'https://www.rompeviento.tv/feed/',
    notas_tecnicas: `${NOTA} RSS. Digital TV político.`,
  }),
  medioRss({
    medio_id: 'MED-0399',
    nombre_medio: 'Petróleo & Energía',
    url_base: 'https://petroleoenergia.com',
    estado: 'CDMX',
    rss_url: 'https://petroleoenergia.com/sitemap.rss',
    notas_tecnicas: `${NOTA} RSS (sitemap.rss). Económico/energía.`,
  }),
  medioRss({
    medio_id: 'MED-0400',
    nombre_medio: 'Red Financiera',
    url_base: 'https://redfinanciera.mx',
    estado: 'CDMX',
    rss_url: 'https://redfinanciera.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. Finanzas.`,
  }),
  medioSitemap({
    medio_id: 'MED-0401',
    nombre_medio: 'Capital 21',
    url_base: 'https://www.capital21.cdmx.gob.mx',
    estado: 'CDMX',
    sitemap_url: 'https://www.capital21.cdmx.gob.mx/sitemap.xml',
    notas_tecnicas: `${NOTA} SITEMAP. TV pública CDMX.`,
  }),
  medioRss({
    medio_id: 'MED-0402',
    nombre_medio: 'Dossier Político',
    url_base: 'https://dossierpolitico.com',
    estado: 'CDMX',
    rss_url: 'https://dossierpolitico.com/feed/',
    notas_tecnicas: `${NOTA} RSS. Digital político nacional (sede CDMX).`,
  }),
  medioRss({
    medio_id: 'MED-0403',
    nombre_medio: 'IBERO 90.9',
    url_base: 'https://ibero909.fm',
    estado: 'CDMX',
    rss_url: 'https://ibero909.fm/feed/',
    notas_tecnicas: `${NOTA} RSS. Radio universitaria CDMX.`,
  }),
  medioRss({
    medio_id: 'MED-0404',
    nombre_medio: 'Sopitas',
    url_base: 'https://www.sopitas.com',
    estado: 'CDMX',
    rss_url: 'https://www.sopitas.com/feed/',
    notas_tecnicas: `${NOTA} RSS. Digital de actualidad CDMX.`,
  }),
  medioRss({
    medio_id: 'MED-0405',
    nombre_medio: 'ZMG Noticias',
    url_base: 'https://zmgnoticias.com',
    estado: 'Jalisco',
    rss_url: 'https://zmgnoticias.com/feed/',
    notas_tecnicas: `${NOTA} RSS. Digital Zona Metropolitana de Guadalajara.`,
  }),
  medioRss({
    medio_id: 'MED-0406',
    nombre_medio: 'Página 24 Jalisco',
    url_base: 'https://pagina24jalisco.com.mx',
    estado: 'Jalisco',
    rss_url: 'https://pagina24jalisco.com.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. Periódico estatal Jalisco.`,
  }),
  medioRss({
    medio_id: 'MED-0407',
    nombre_medio: 'Me Hace Ruido',
    url_base: 'https://www.mehaceruido.com',
    estado: 'Jalisco',
    rss_url: 'https://www.mehaceruido.com/feed/',
    notas_tecnicas: `${NOTA} RSS. Digital GDL.`,
  }),
  medioRss({
    medio_id: 'MED-0408',
    nombre_medio: 'DigitalMex',
    url_base: 'https://digitalmex.mx',
    estado: 'Estado de México',
    rss_url: 'https://digitalmex.mx/?format=feed',
    notas_tecnicas: `${NOTA} RSS. Digital Edomex.`,
  }),
  medioRss({
    medio_id: 'MED-0409',
    nombre_medio: 'Diario Evolución',
    url_base: 'https://www.diarioevolucion.com.mx',
    estado: 'Estado de México',
    rss_url: 'https://www.diarioevolucion.com.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. Periódico Edomex.`,
  }),
  medioRss({
    medio_id: 'MED-0410',
    nombre_medio: 'El Valle',
    url_base: 'https://elvalle.com.mx',
    estado: 'Estado de México',
    rss_url: 'https://elvalle.com.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. Valle de México.`,
  }),
  medioRss({
    medio_id: 'MED-0411',
    nombre_medio: 'Toluca la Bella',
    url_base: 'https://tolucalabellacd.com',
    estado: 'Estado de México',
    rss_url: 'https://tolucalabellacd.com/feed/',
    notas_tecnicas: `${NOTA} RSS. Digital local Toluca.`,
  }),
  medioRss({
    medio_id: 'MED-0412',
    nombre_medio: 'Portal Político',
    url_base: 'https://www.portalpolitico.tv',
    estado: 'Estado de México',
    rss_url: 'https://www.portalpolitico.tv/rss.xml',
    notas_tecnicas: `${NOTA} RSS. Digital político Edomex/nacional.`,
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
  const ids = MEDIOS_BATCH09.map((m) => m.medio_id);
  if (ids.includes('MED-0204') || ids.includes('MED-0185')) {
    console.error('ABORT: ID reservado (MED-0204 o El CEO MED-0185).');
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
  const loteHosts = new Set(MEDIOS_BATCH09.map((m) => hostOf(m.url_base)).filter(Boolean));
  if (loteHosts.size !== MEDIOS_BATCH09.length) {
    console.error('ABORT: hosts duplicados dentro del lote');
    process.exit(2);
  }
  const loteFeeds = new Set(MEDIOS_BATCH09.map(sourceUrl).filter(Boolean));
  if (loteFeeds.size !== MEDIOS_BATCH09.length) {
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
    console.log(MEDIOS_BATCH09.map((m) => `${m.medio_id}: ${m.nombre_medio} [${m.estado}] — ${m.rss_url ?? m.sitemap_url}`).join('\n'));
    return;
  }
  const { error: errUpsert } = await sb.from('medios').upsert(MEDIOS_BATCH09, { onConflict: 'medio_id' });
  if (errUpsert) { console.error('Upsert falló:', errUpsert.message); process.exit(1); }
  const { data: verif, error: errVerif } = await sb
    .from('medios')
    .select('medio_id,nombre_medio,metodo_extraccion,rss_url,sitemap_url,activo,url_base,estado')
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
