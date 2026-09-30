/**
 * Alta al catálogo: 24 medios — MEDIA EXPANSION BATCH 5 / HISTORICAL PARITY (2026-09-30).
 *
 * Prioridad: MISSING_REAL_PUBLISHER de Concentrado BD (auditoría 2026-09-30).
 * Fill: pool canary STRICT del Batch 5 anterior (verticales PR, sin relleno de estados).
 * Omnia (P1, 86 impactos) sin RSS/sitemap/API pública → no alta.
 * Radio (W Radio, Fórmula, Imagen, Xeva) sin captura editorial web viable → no alta.
 * Diario de Querétaro retirado: RSS OEM idéntico al de Diario de Xalapa (0 notas propias).
 * IDs: MED-0488..MED-0512 salvo MED-0493.
 *
 * Uso:
 *   npm run catalog-batch13 -- --dry
 *   npm run catalog-batch13
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { getSupabase } from '../src/supabase/client.js';
import type { Medio } from '../src/types/schemas.js';

type EstadoB5 =
  | 'Nacional'
  | 'Baja California'
  | 'Puebla'
  | 'San Luis Potosí'
  | 'Veracruz'
  | 'Sonora'
  | 'Tabasco';

function baseMedio(partial: {
  medio_id: string;
  nombre_medio: string;
  url_base: string;
  estado: EstadoB5;
  grupo_medio?: string | null;
  categoria?: string;
  metodo_extraccion: 'RSS' | 'SITEMAP';
  rss_url: string | null;
  sitemap_url: string | null;
  notas_tecnicas: string;
}): Medio {
  return {
    medio_id: partial.medio_id,
    nombre_medio: partial.nombre_medio,
    grupo_medio: partial.grupo_medio ?? null,
    url_base: partial.url_base,
    pais: 'MX',
    estado: partial.estado,
    municipio: null,
    region: null,
    categoria: partial.categoria ?? 'Noticias',
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
  estado: EstadoB5;
  rss_url: string;
  grupo_medio?: string | null;
  categoria?: string;
  notas_tecnicas: string;
}): Medio {
  return baseMedio({ ...p, metodo_extraccion: 'RSS', sitemap_url: null });
}

function medioSitemap(p: {
  medio_id: string;
  nombre_medio: string;
  url_base: string;
  estado: EstadoB5;
  sitemap_url: string;
  grupo_medio?: string | null;
  categoria?: string;
  notas_tecnicas: string;
}): Medio {
  return baseMedio({ ...p, metodo_extraccion: 'SITEMAP', rss_url: null });
}

const NOTA = 'Alta 2026-09-30 (MEDIA EXPANSION BATCH 5 HISTORICAL PARITY). Pre-canary público STRICT. Sin cron masivo.';

export const MEDIOS_BATCH13: Medio[] = [
  medioRss({
    medio_id: 'MED-0488',
    nombre_medio: 'Uniradio Baja California',
    url_base: 'https://www.uniradiobaja.com',
    estado: 'Baja California',
    grupo_medio: 'Uniradio',
    rss_url: 'https://www.uniradiobaja.com/feed/',
    notas_tecnicas: `${NOTA} RSS. Inventario propio en uniradiobaja.com (no es Uniradio Informa MED-0087). Histórico UniMexicali 63 impactos.`,
  }),
  medioRss({
    medio_id: 'MED-0489',
    nombre_medio: 'Municipios Puebla',
    url_base: 'https://municipiospuebla.mx',
    estado: 'Puebla',
    rss_url: 'https://municipiospuebla.mx/rss/',
    notas_tecnicas: `${NOTA} RSS. municipiospuebla.mx. 57 impactos históricos.`,
  }),
  medioRss({
    medio_id: 'MED-0490',
    nombre_medio: 'Acontecer San Luis',
    url_base: 'https://acontecersanluis.wordpress.com',
    estado: 'San Luis Potosí',
    rss_url: 'https://acontecersanluis.wordpress.com/feed/',
    notas_tecnicas: `${NOTA} RSS WordPress.com. Publisher propio SLP. 46 impactos históricos.`,
  }),
  medioRss({
    medio_id: 'MED-0491',
    nombre_medio: 'Diario de Xalapa',
    url_base: 'https://www.diariodexalapa.com.mx',
    estado: 'Veracruz',
    grupo_medio: 'OEM',
    rss_url: 'https://www.diariodexalapa.com.mx/rss.xml',
    notas_tecnicas: `${NOTA} RSS de edición OEM. Inventario propio; artículos pueden vivir en oem.com.mx. 39 impactos históricos.`,
  }),
  medioSitemap({
    medio_id: 'MED-0492',
    nombre_medio: 'El Congresista',
    url_base: 'https://elcongresista.mx',
    estado: 'Nacional',
    sitemap_url: 'https://elcongresista.mx/sitemap.xml',
    notas_tecnicas: `${NOTA} Sitemap. 31 impactos históricos. Filtro homepage, /clima/, /resultados/ y /tag/.`,
  }),
  medioRss({
    medio_id: 'MED-0494',
    nombre_medio: 'El Momento',
    url_base: 'https://elmomento.mx',
    estado: 'Nacional',
    grupo_medio: 'El Momento',
    rss_url: 'https://elmomento.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. Hub elmomento.mx con inventario propio (no es El Momento QROO/BCS/Campeche). 24 impactos históricos.`,
  }),
  medioRss({
    medio_id: 'MED-0495',
    nombre_medio: 'Uniradio Sonora',
    url_base: 'https://www.uniradiosonora.com',
    estado: 'Sonora',
    grupo_medio: 'Uniradio',
    rss_url: 'https://www.uniradiosonora.com/feed/',
    notas_tecnicas: `${NOTA} RSS. Inventario propio en uniradiosonora.com (no es Uniradio Informa MED-0087). 22 impactos históricos UniradioNoticias.`,
  }),
  medioSitemap({
    medio_id: 'MED-0496',
    nombre_medio: 'Diario Presente',
    url_base: 'https://www.diariopresente.mx',
    estado: 'Tabasco',
    sitemap_url: 'https://diariopresente.mx/sitemap.xml',
    notas_tecnicas: `${NOTA} Sitemap. Tabasco. 22 impactos históricos.`,
  }),
  medioRss({
    medio_id: 'MED-0497',
    nombre_medio: 'InformaBTL',
    url_base: 'https://www.informabtl.com',
    estado: 'Nacional',
    categoria: 'Negocios',
    rss_url: 'https://www.informabtl.com/feed/',
    notas_tecnicas: `${NOTA} RSS. Vertical marketing/BTL. 21 impactos históricos Revista InformaBTL.`,
  }),
  medioRss({
    medio_id: 'MED-0498',
    nombre_medio: 'Industrial News BC',
    url_base: 'https://www.industrialnewsbc.com',
    estado: 'Baja California',
    categoria: 'Negocios',
    rss_url: 'https://www.industrialnewsbc.com/feed/',
    notas_tecnicas: `${NOTA} RSS. Maquila/industria BC. 20 impactos históricos.`,
  }),
  medioRss({
    medio_id: 'MED-0499',
    nombre_medio: 'T21',
    url_base: 'https://t21.com.mx',
    estado: 'Nacional',
    categoria: 'Negocios',
    rss_url: 'https://t21.com.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. Vertical logística/transporte. Pool canary Batch 5 anterior.`,
  }),
  medioRss({
    medio_id: 'MED-0500',
    nombre_medio: 'Inmobiliare',
    url_base: 'https://inmobiliare.com',
    estado: 'Nacional',
    categoria: 'Negocios',
    rss_url: 'https://inmobiliare.com/feed/',
    notas_tecnicas: `${NOTA} RSS. Vertical inmobiliario. Pool canary Batch 5 anterior.`,
  }),
  medioRss({
    medio_id: 'MED-0501',
    nombre_medio: 'El Hospital',
    url_base: 'https://www.elhospital.com',
    estado: 'Nacional',
    categoria: 'Salud',
    rss_url: 'https://www.elhospital.com/rss/',
    notas_tecnicas: `${NOTA} RSS. Vertical salud. Pool canary Batch 5 anterior.`,
  }),
  medioRss({
    medio_id: 'MED-0502',
    nombre_medio: 'Consultorsalud',
    url_base: 'https://consultorsalud.com',
    estado: 'Nacional',
    categoria: 'Salud',
    rss_url: 'https://consultorsalud.com/feed/',
    notas_tecnicas: `${NOTA} RSS. Vertical salud. Pool canary Batch 5 anterior.`,
  }),
  medioRss({
    medio_id: 'MED-0503',
    nombre_medio: 'Saludiario',
    url_base: 'https://www.saludiario.com',
    estado: 'Nacional',
    categoria: 'Salud',
    rss_url: 'https://www.saludiario.com/feed/',
    notas_tecnicas: `${NOTA} RSS. Vertical salud. Pool canary Batch 5 anterior.`,
  }),
  medioRss({
    medio_id: 'MED-0504',
    nombre_medio: 'Plenilunia',
    url_base: 'https://plenilunia.com',
    estado: 'Nacional',
    categoria: 'Salud',
    rss_url: 'https://plenilunia.com/feed/',
    notas_tecnicas: `${NOTA} RSS. Vertical salud de la mujer. Pool canary Batch 5 anterior.`,
  }),
  medioRss({
    medio_id: 'MED-0505',
    nombre_medio: 'Energía a Debate',
    url_base: 'https://energiaadebate.com',
    estado: 'Nacional',
    categoria: 'Negocios',
    rss_url: 'https://energiaadebate.com/feed/',
    notas_tecnicas: `${NOTA} RSS. Vertical energía. Pool canary Batch 5 anterior.`,
  }),
  medioRss({
    medio_id: 'MED-0506',
    nombre_medio: 'Energy Magazine',
    url_base: 'https://energymagazine.mx',
    estado: 'Nacional',
    categoria: 'Negocios',
    rss_url: 'https://energymagazine.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. Vertical energía. Pool canary Batch 5 anterior.`,
  }),
  medioRss({
    medio_id: 'MED-0507',
    nombre_medio: 'The Logistics World',
    url_base: 'https://thelogisticsworld.com',
    estado: 'Nacional',
    categoria: 'Negocios',
    rss_url: 'https://thelogisticsworld.com/feed/',
    notas_tecnicas: `${NOTA} RSS. Vertical logística. Pool canary Batch 5 anterior.`,
  }),
  medioRss({
    medio_id: 'MED-0508',
    nombre_medio: 'Siempre',
    url_base: 'https://www.siempre.mx',
    estado: 'Nacional',
    rss_url: 'https://www.siempre.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. Revista política/cultura. Pool canary Batch 5 anterior.`,
  }),
  medioSitemap({
    medio_id: 'MED-0509',
    nombre_medio: 'Gourmet de México',
    url_base: 'https://gourmetdemexico.com.mx',
    estado: 'Nacional',
    categoria: 'Gastronomía',
    sitemap_url: 'https://gourmetdemexico.com.mx/post-sitemap.xml',
    notas_tecnicas: `${NOTA} post-sitemap. Vertical gastronomía. Pool canary Batch 5 anterior. Feed WP 403.`,
  }),
  medioSitemap({
    medio_id: 'MED-0510',
    nombre_medio: 'Mexico Industry',
    url_base: 'https://mexicoindustry.com',
    estado: 'Nacional',
    categoria: 'Negocios',
    sitemap_url: 'https://mexicoindustry.com/sitemap.xml',
    notas_tecnicas: `${NOTA} Sitemap. Vertical industria. Pool canary Batch 5 anterior.`,
  }),
  medioRss({
    medio_id: 'MED-0511',
    nombre_medio: 'Hipertextual',
    url_base: 'https://hipertextual.com',
    estado: 'Nacional',
    categoria: 'Tecnología',
    rss_url: 'https://hipertextual.com/feed/',
    notas_tecnicas: `${NOTA} RSS. Vertical tecnología. Pool canary Batch 5 anterior.`,
  }),
  medioRss({
    medio_id: 'MED-0512',
    nombre_medio: 'Hosteltur',
    url_base: 'https://www.hosteltur.com',
    estado: 'Nacional',
    categoria: 'Turismo',
    rss_url: 'https://www.hosteltur.com/feed',
    notas_tecnicas: `${NOTA} RSS. Vertical turismo (cobertura MX). Pool canary Batch 5 anterior.`,
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
  const ids = MEDIOS_BATCH13.map((m) => m.medio_id);
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
  const loteHosts = new Set(MEDIOS_BATCH13.map((m) => hostOf(m.url_base)).filter(Boolean));
  if (loteHosts.size !== MEDIOS_BATCH13.length) {
    console.error('ABORT: hosts duplicados dentro del lote');
    process.exit(2);
  }
  const loteFeeds = new Set(MEDIOS_BATCH13.map(sourceUrl).filter(Boolean));
  if (loteFeeds.size !== MEDIOS_BATCH13.length) {
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
    console.log(MEDIOS_BATCH13.map((m) => `${m.medio_id}: ${m.nombre_medio} [${m.estado}] — ${m.rss_url ?? m.sitemap_url}`).join('\n'));
    return;
  }
  const { error: errUpsert } = await sb.from('medios').upsert(MEDIOS_BATCH13, { onConflict: 'medio_id' });
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
