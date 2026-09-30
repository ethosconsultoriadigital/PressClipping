/**
 * Alta al catálogo: 25 medios — MEDIA EXPANSION BATCH 4 / P4 (2026-09-30).
 *
 * Prioridad: Guerrero, Zacatecas, Tlaxcala, Tamaulipas.
 * Fill: Oaxaca, Nayarit, Chiapas, Tabasco, Michoacán, Morelos.
 * BCS denso → quota 0. Colima/Campeche/Durango ya tienen outlets live (estado nulo).
 * IDs: MED-0463..MED-0487 (secuencial tras MAX LIVE MED-0462).
 *
 * Uso:
 *   npm run catalog-batch12 -- --dry
 *   npm run catalog-batch12
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { getSupabase } from '../src/supabase/client.js';
import type { Medio } from '../src/types/schemas.js';

type EstadoP4 =
  | 'Guerrero'
  | 'Zacatecas'
  | 'Tlaxcala'
  | 'Tamaulipas'
  | 'Oaxaca'
  | 'Nayarit'
  | 'Chiapas'
  | 'Tabasco'
  | 'Michoacán'
  | 'Morelos';

function baseMedio(partial: {
  medio_id: string;
  nombre_medio: string;
  url_base: string;
  estado: EstadoP4;
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
  estado: EstadoP4;
  rss_url: string;
  notas_tecnicas: string;
}): Medio {
  return baseMedio({ ...p, metodo_extraccion: 'RSS', sitemap_url: null });
}

function medioSitemap(p: {
  medio_id: string;
  nombre_medio: string;
  url_base: string;
  estado: EstadoP4;
  sitemap_url: string;
  notas_tecnicas: string;
}): Medio {
  return baseMedio({ ...p, metodo_extraccion: 'SITEMAP', rss_url: null });
}

const NOTA = 'Alta 2026-09-30 (MEDIA EXPANSION BATCH 4 P4). Pre-canary público STRICT. Sin cron masivo.';

export const MEDIOS_BATCH12: Medio[] = [
  medioRss({
    medio_id: 'MED-0463',
    nombre_medio: 'El Sur Acapulco',
    url_base: 'https://suracapulco.mx',
    estado: 'Guerrero',
    rss_url: 'https://suracapulco.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. Diario El Sur, Acapulco.`,
  }),
  medioRss({
    medio_id: 'MED-0464',
    nombre_medio: 'Digital Guerrero',
    url_base: 'https://digitalguerrero.com.mx',
    estado: 'Guerrero',
    rss_url: 'https://digitalguerrero.com.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. Digital Chilpancingo/Acapulco.`,
  }),
  medioRss({
    medio_id: 'MED-0465',
    nombre_medio: 'Bajo Palabra',
    url_base: 'https://www.bajopalabra.mx',
    estado: 'Guerrero',
    rss_url: 'https://www.bajopalabra.mx/rss/',
    notas_tecnicas: `${NOTA} RSS. Digital Guerrero.`,
  }),
  medioRss({
    medio_id: 'MED-0466',
    nombre_medio: 'Enfoque Informativo',
    url_base: 'https://www.enfoqueinformativo.mx',
    estado: 'Guerrero',
    rss_url: 'https://www.enfoqueinformativo.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. Acapulco/Guerrero. No es Enfoque Morelos.`,
  }),
  medioRss({
    medio_id: 'MED-0467',
    nombre_medio: 'Zacatecas Online',
    url_base: 'https://zacatecasonline.com.mx',
    estado: 'Zacatecas',
    rss_url: 'https://zacatecasonline.com.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. Digital Zacatecas.`,
  }),
  medioRss({
    medio_id: 'MED-0468',
    nombre_medio: 'Líder Zacatecas',
    url_base: 'https://www.liderzacatecas.com',
    estado: 'Zacatecas',
    rss_url: 'https://www.liderzacatecas.com/feed/',
    notas_tecnicas: `${NOTA} RSS. Digital Zacatecas.`,
  }),
  medioRss({
    medio_id: 'MED-0469',
    nombre_medio: 'Página 24 Zacatecas',
    url_base: 'https://pagina24zacatecas.com.mx',
    estado: 'Zacatecas',
    rss_url: 'https://pagina24zacatecas.com.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. Edición Zacatecas. No es Página 24 Jalisco.`,
  }),
  medioRss({
    medio_id: 'MED-0470',
    nombre_medio: 'Zacatecas Digital',
    url_base: 'https://zacatecasdigital.mx',
    estado: 'Zacatecas',
    rss_url: 'https://zacatecasdigital.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. Digital Zacatecas.`,
  }),
  medioRss({
    medio_id: 'MED-0471',
    nombre_medio: 'Línea de Contraste',
    url_base: 'https://www.lineadecontraste.com',
    estado: 'Tlaxcala',
    rss_url: 'https://www.lineadecontraste.com/feed/',
    notas_tecnicas: `${NOTA} RSS. Digital Tlaxcala.`,
  }),
  medioRss({
    medio_id: 'MED-0472',
    nombre_medio: 'Tlaxcala Digital',
    url_base: 'https://tlaxcaladigital.mx',
    estado: 'Tlaxcala',
    rss_url: 'https://tlaxcaladigital.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. Digital Tlaxcala.`,
  }),
  medioSitemap({
    medio_id: 'MED-0473',
    nombre_medio: 'El Mercurio Victoria',
    url_base: 'https://elmercurio.com.mx',
    estado: 'Tamaulipas',
    sitemap_url: 'https://elmercurio.com.mx/sitemap_index.xml',
    notas_tecnicas: `${NOTA} SITEMAP. Ciudad Victoria.`,
  }),
  medioRss({
    medio_id: 'MED-0474',
    nombre_medio: 'La Verdad de Tamaulipas',
    url_base: 'https://laverdad.com.mx',
    estado: 'Tamaulipas',
    rss_url: 'https://laverdad.com.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. Tamaulipas. No es La Verdad Juárez.`,
  }),
  medioRss({
    medio_id: 'MED-0475',
    nombre_medio: 'Hora Cero Tamaulipas',
    url_base: 'https://horacerotam.com',
    estado: 'Tamaulipas',
    rss_url: 'https://horacerotam.com/feed/',
    notas_tecnicas: `${NOTA} RSS. Digital Tamaulipas.`,
  }),
  medioRss({
    medio_id: 'MED-0476',
    nombre_medio: 'El Bravo Matamoros',
    url_base: 'https://www.elbravo.mx',
    estado: 'Tamaulipas',
    rss_url: 'https://www.elbravo.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. Matamoros. Extractor host-scoped .the-content.`,
  }),
  medioSitemap({
    medio_id: 'MED-0477',
    nombre_medio: 'El Diario de Victoria',
    url_base: 'https://eldiariomx.com',
    estado: 'Tamaulipas',
    sitemap_url: 'https://eldiariomx.com/post-sitemap.xml',
    notas_tecnicas: `${NOTA} SITEMAP post. Ciudad Victoria. Extractor host-scoped .brxe-post-content.`,
  }),
  medioRss({
    medio_id: 'MED-0478',
    nombre_medio: 'Página 3',
    url_base: 'https://pagina3.mx',
    estado: 'Oaxaca',
    rss_url: 'https://pagina3.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. Digital Oaxaca.`,
  }),
  medioRss({
    medio_id: 'MED-0479',
    nombre_medio: 'Tiempo de Oaxaca',
    url_base: 'https://tiempodeoaxaca.com',
    estado: 'Oaxaca',
    rss_url: 'https://tiempodeoaxaca.com/feed/',
    notas_tecnicas: `${NOTA} RSS. Digital Oaxaca.`,
  }),
  medioRss({
    medio_id: 'MED-0480',
    nombre_medio: 'NTV Nayarit',
    url_base: 'https://ntv.com.mx',
    estado: 'Nayarit',
    rss_url: 'https://ntv.com.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. NTV / Nayarit en Línea. No duplicar nayaritenlinea.mx.`,
  }),
  medioRss({
    medio_id: 'MED-0481',
    nombre_medio: 'Chiapas Hoy',
    url_base: 'https://chiapashoy.mx',
    estado: 'Chiapas',
    rss_url: 'https://chiapashoy.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. Digital Chiapas. No confundir con chiapashoy.com (identidad ajena).`,
  }),
  medioRss({
    medio_id: 'MED-0482',
    nombre_medio: 'Ultimátum Chiapas',
    url_base: 'https://ultimatumchiapas.com',
    estado: 'Chiapas',
    rss_url: 'https://ultimatumchiapas.com/feed/',
    notas_tecnicas: `${NOTA} RSS. Digital Chiapas.`,
  }),
  medioRss({
    medio_id: 'MED-0483',
    nombre_medio: 'Novedades de Tabasco',
    url_base: 'https://novedadesdetabasco.com.mx',
    estado: 'Tabasco',
    rss_url: 'https://novedadesdetabasco.com.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. Digital Tabasco.`,
  }),
  medioRss({
    medio_id: 'MED-0484',
    nombre_medio: 'Ahora Tabasco',
    url_base: 'https://ahoratabasco.com',
    estado: 'Tabasco',
    rss_url: 'https://ahoratabasco.com/feed/',
    notas_tecnicas: `${NOTA} RSS. Digital Tabasco.`,
  }),
  medioRss({
    medio_id: 'MED-0485',
    nombre_medio: 'Monitor Expresso',
    url_base: 'https://www.monitorexpresso.com',
    estado: 'Michoacán',
    rss_url: 'https://www.monitorexpresso.com/feed/',
    notas_tecnicas: `${NOTA} RSS. Lázaro Cárdenas / Michoacán.`,
  }),
  medioRss({
    medio_id: 'MED-0486',
    nombre_medio: 'Primera Plana Michoacán',
    url_base: 'https://primeraplana.mx',
    estado: 'Michoacán',
    rss_url: 'https://primeraplana.mx/feed',
    notas_tecnicas: `${NOTA} RSS. Morelia. No confundir con Primera Plana Digital Sonora. Extractor host-scoped .td-post-content.`,
  }),
  medioRss({
    medio_id: 'MED-0487',
    nombre_medio: 'El Regional del Sur',
    url_base: 'https://elregional.com.mx',
    estado: 'Morelos',
    rss_url: 'https://elregional.com.mx/rss/category/morelos',
    notas_tecnicas: `${NOTA} RSS categoría Morelos. No es El Regional de Los Altos (Jalisco).`,
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
  const ids = MEDIOS_BATCH12.map((m) => m.medio_id);
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
  const loteHosts = new Set(MEDIOS_BATCH12.map((m) => hostOf(m.url_base)).filter(Boolean));
  if (loteHosts.size !== MEDIOS_BATCH12.length) {
    console.error('ABORT: hosts duplicados dentro del lote');
    process.exit(2);
  }
  const loteFeeds = new Set(MEDIOS_BATCH12.map(sourceUrl).filter(Boolean));
  if (loteFeeds.size !== MEDIOS_BATCH12.length) {
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
    console.log(MEDIOS_BATCH12.map((m) => `${m.medio_id}: ${m.nombre_medio} [${m.estado}] — ${m.rss_url ?? m.sitemap_url}`).join('\n'));
    return;
  }
  const { error: errUpsert } = await sb.from('medios').upsert(MEDIOS_BATCH12, { onConflict: 'medio_id' });
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
