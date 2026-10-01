/**
 * Alta al catálogo: 25 medios — OVERNIGHT FACTORY V2 BATCH 6 (2026-09-30).
 *
 * Prioridad: MISSING_REAL_PUBLISHER / MANUAL_REVIEW de alto valor + verticales PR.
 * STRICT pre-canary. Rechazados: molinos/agregadores (Cultura Colectiva, The Happening,
 * Los Tubos, Report News, Ecos de la Costa SEO, El Popular sitemap 2011, Expresión Sonora tweets).
 * IDs: MAX LIVE + 1 (esperado MED-0513..MED-0537 si max=0512).
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { getSupabase } from '../src/supabase/client.js';
import type { Medio } from '../src/types/schemas.js';

type EstadoB6 =
  | 'Nacional'
  | 'Querétaro'
  | 'Puebla'
  | 'Chihuahua'
  | 'Tamaulipas'
  | 'Tlaxcala'
  | 'Estado de México'
  | 'Sonora';

function baseMedio(partial: {
  medio_id: string;
  nombre_medio: string;
  url_base: string;
  estado: EstadoB6;
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
  estado: EstadoB6;
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
  estado: EstadoB6;
  sitemap_url: string;
  grupo_medio?: string | null;
  categoria?: string;
  notas_tecnicas: string;
}): Medio {
  return baseMedio({ ...p, metodo_extraccion: 'SITEMAP', rss_url: null });
}

const NOTA = 'Alta 2026-09-30 (OVERNIGHT FACTORY V2 BATCH 6). Pre-canary público STRICT. Sin cron masivo.';

export const MEDIOS_BATCH14: Medio[] = [
  medioSitemap({
    medio_id: 'MED-0513',
    nombre_medio: 'Quinta Fuerza',
    url_base: 'https://quintafuerza.mx',
    estado: 'Nacional',
    sitemap_url: 'https://quintafuerza.mx/sitemap.xml',
    notas_tecnicas: `${NOTA} Sitemap. 25 impactos históricos.`,
  }),
  medioRss({
    medio_id: 'MED-0514',
    nombre_medio: 'Al Tiempo',
    url_base: 'https://altiempo.mx',
    estado: 'Nacional',
    categoria: 'Negocios',
    rss_url: 'https://altiempo.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. 23 impactos históricos. Publisher propio negocios/marcas.`,
  }),
  medioRss({
    medio_id: 'MED-0515',
    nombre_medio: 'PLAYERS of life',
    url_base: 'https://playersoflife.com',
    estado: 'Nacional',
    categoria: 'Negocios',
    rss_url: 'https://playersoflife.com/blog/feed/',
    notas_tecnicas: `${NOTA} RSS /blog/feed. 22 impactos históricos. Lifestyle/negocios PR.`,
  }),
  medioSitemap({
    medio_id: 'MED-0516',
    nombre_medio: 'Mexico Informa',
    url_base: 'https://mexicoinforma.mx',
    estado: 'Nacional',
    sitemap_url: 'https://mexicoinforma.mx/sitemap_index.xml',
    notas_tecnicas: `${NOTA} sitemap_index. 21 impactos históricos.`,
  }),
  medioRss({
    medio_id: 'MED-0517',
    nombre_medio: 'Dónde Ir',
    url_base: 'https://dondeir.com',
    estado: 'Nacional',
    categoria: 'Turismo',
    rss_url: 'https://dondeir.com/noticias/feed/',
    notas_tecnicas: `${NOTA} RSS sección noticias. 18 impactos históricos.`,
  }),
  medioSitemap({
    medio_id: 'MED-0518',
    nombre_medio: 'Cocina Vital',
    url_base: 'https://www.cocinavital.mx',
    estado: 'Nacional',
    categoria: 'Gastronomía',
    sitemap_url: 'https://www.cocinavital.mx/sitemap_index.xml',
    notas_tecnicas: `${NOTA} sitemap_index. 17 impactos históricos. Vertical alimentos. Filtro /academia-cocina-vital/ y hubs de video.`,
  }),
  medioRss({
    medio_id: 'MED-0519',
    nombre_medio: 'Plaza Pública',
    url_base: 'https://plazapublica.com.mx',
    estado: 'Nacional',
    rss_url: 'https://plazapublica.com.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. 17 impactos históricos.`,
  }),
  medioRss({
    medio_id: 'MED-0520',
    nombre_medio: 'Diario Amanecer',
    url_base: 'https://diarioamanecer.com.mx',
    estado: 'Estado de México',
    rss_url: 'https://diarioamanecer.com.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. 16 impactos históricos. Cobertura Edomex (Naucalpan).`,
  }),
  medioRss({
    medio_id: 'MED-0521',
    nombre_medio: 'La de Hoy Querétaro',
    url_base: 'https://ladehoy.com.mx',
    estado: 'Querétaro',
    rss_url: 'https://ladehoy.com.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. 16 impactos históricos. Edición Querétaro.`,
  }),
  medioRss({
    medio_id: 'MED-0522',
    nombre_medio: 'Índice Político',
    url_base: 'https://indicepolitico.com',
    estado: 'Nacional',
    rss_url: 'https://indicepolitico.com/feed/',
    notas_tecnicas: `${NOTA} RSS. 15 impactos históricos.`,
  }),
  medioRss({
    medio_id: 'MED-0523',
    nombre_medio: 'Presencia en Puebla',
    url_base: 'https://presenciaenpuebla.com.mx',
    estado: 'Puebla',
    rss_url: 'https://presenciaenpuebla.com.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. 14 impactos históricos.`,
  }),
  medioSitemap({
    medio_id: 'MED-0524',
    nombre_medio: 'Periódico Victoria',
    url_base: 'https://periodicovictoria.com',
    estado: 'Tamaulipas',
    sitemap_url: 'https://periodicovictoria.com/sitemap_index.xml',
    notas_tecnicas: `${NOTA} sitemap_index. 14 impactos históricos. Ciudad Victoria.`,
  }),
  medioRss({
    medio_id: 'MED-0525',
    nombre_medio: 'Food and Wine México',
    url_base: 'https://foodandwineespanol.com',
    estado: 'Nacional',
    categoria: 'Gastronomía',
    rss_url: 'https://foodandwineespanol.com/feed/',
    notas_tecnicas: `${NOTA} RSS. 14 impactos históricos. Vertical gastronomía/hospitality.`,
  }),
  medioSitemap({
    medio_id: 'MED-0526',
    nombre_medio: 'Cambio Digital',
    url_base: 'https://cambiodigitalnoticias.com',
    estado: 'Nacional',
    sitemap_url: 'https://cambiodigitalnoticias.com/wp-sitemap.xml',
    notas_tecnicas: `${NOTA} wp-sitemap. 14 impactos históricos.`,
  }),
  medioRss({
    medio_id: 'MED-0527',
    nombre_medio: 'Reporte Chihuahua',
    url_base: 'https://reportechihuahua.com',
    estado: 'Chihuahua',
    rss_url: 'https://reportechihuahua.com/feed/',
    notas_tecnicas: `${NOTA} RSS. 14 impactos históricos.`,
  }),
  medioRss({
    medio_id: 'MED-0528',
    nombre_medio: 'Por La Libre',
    url_base: 'https://porlalibre.com.mx',
    estado: 'Nacional',
    rss_url: 'https://porlalibre.com.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. 14 impactos históricos.`,
  }),
  medioRss({
    medio_id: 'MED-0529',
    nombre_medio: 'Curul Puebla',
    url_base: 'https://curul.com.mx',
    estado: 'Puebla',
    rss_url: 'https://curul.com.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. MANUAL_REVIEW 9 impactos. Publisher propio Puebla.`,
  }),
  medioSitemap({
    medio_id: 'MED-0530',
    nombre_medio: 'e-Tlaxcala',
    url_base: 'https://e-tlaxcala.mx',
    estado: 'Tlaxcala',
    sitemap_url: 'https://e-tlaxcala.mx/sitemap.xml',
    notas_tecnicas: `${NOTA} Sitemap. MANUAL_REVIEW 9 impactos. Gap Tlaxcala.`,
  }),
  medioSitemap({
    medio_id: 'MED-0531',
    nombre_medio: 'Mundo Ejecutivo',
    url_base: 'https://mundoejecutivo.com.mx',
    estado: 'Nacional',
    categoria: 'Negocios',
    sitemap_url: 'https://mundoejecutivo.com.mx/sitemap_index.xml',
    notas_tecnicas: `${NOTA} sitemap_index. MANUAL_REVIEW 9 impactos. Vertical negocios.`,
  }),
  medioSitemap({
    medio_id: 'MED-0532',
    nombre_medio: 'Cluster Industrial',
    url_base: 'https://clusterindustrial.com.mx',
    estado: 'Nacional',
    categoria: 'Negocios',
    sitemap_url: 'https://clusterindustrial.com.mx/sitemap.xml',
    notas_tecnicas: `${NOTA} Sitemap. Vertical industria/automotriz PR.`,
  }),
  medioRss({
    medio_id: 'MED-0533',
    nombre_medio: 'El Contribuyente',
    url_base: 'https://www.elcontribuyente.mx',
    estado: 'Nacional',
    categoria: 'Negocios',
    rss_url: 'https://www.elcontribuyente.mx/rss.xml',
    notas_tecnicas: `${NOTA} RSS. Vertical fiscal/regulación empresarial.`,
  }),
  medioRss({
    medio_id: 'MED-0534',
    nombre_medio: 'Imagen Agropecuaria',
    url_base: 'https://imagenagropecuaria.com',
    estado: 'Nacional',
    categoria: 'Agroindustria',
    rss_url: 'https://imagenagropecuaria.com/feed/',
    notas_tecnicas: `${NOTA} RSS. Vertical agroindustria.`,
  }),
  medioRss({
    medio_id: 'MED-0535',
    nombre_medio: 'Unocero',
    url_base: 'https://www.unocero.com',
    estado: 'Nacional',
    categoria: 'Tecnología',
    rss_url: 'https://www.unocero.com/feed/',
    notas_tecnicas: `${NOTA} RSS. Vertical tecnología MX.`,
  }),
  medioSitemap({
    medio_id: 'MED-0536',
    nombre_medio: 'Manufactura',
    url_base: 'https://manufactura.mx',
    estado: 'Nacional',
    categoria: 'Negocios',
    sitemap_url: 'https://manufactura.mx/sitemap.xml',
    notas_tecnicas: `${NOTA} Sitemap. Vertical manufactura/industria.`,
  }),
  medioRss({
    medio_id: 'MED-0537',
    nombre_medio: 'Mexico Now',
    url_base: 'https://mexico-now.com',
    estado: 'Nacional',
    categoria: 'Negocios',
    rss_url: 'https://mexico-now.com/feed/',
    notas_tecnicas: `${NOTA} RSS. Vertical nearshore/industria.`,
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
  const ids = MEDIOS_BATCH14.map((m) => m.medio_id);
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
  const loteHosts = new Set(MEDIOS_BATCH14.map((m) => hostOf(m.url_base)).filter(Boolean));
  if (loteHosts.size !== MEDIOS_BATCH14.length) {
    console.error('ABORT: hosts duplicados dentro del lote');
    process.exit(2);
  }
  const loteFeeds = new Set(MEDIOS_BATCH14.map(sourceUrl).filter(Boolean));
  if (loteFeeds.size !== MEDIOS_BATCH14.length) {
    console.error('ABORT: feeds/sitemaps duplicados dentro del lote');
    process.exit(2);
  }
  const collisions: { host: string; existing: string; nombre: string }[] = [];
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
    console.log(MEDIOS_BATCH14.map((m) => `${m.medio_id}: ${m.nombre_medio} [${m.estado}] — ${m.rss_url ?? m.sitemap_url}`).join('\n'));
    return;
  }
  const { error: errUpsert } = await sb.from('medios').upsert(MEDIOS_BATCH14, { onConflict: 'medio_id' });
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
