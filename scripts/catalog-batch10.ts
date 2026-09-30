/**
 * Alta al catálogo: 25 medios — MEDIA EXPANSION BATCH 2 / P2 (2026-09-30).
 *
 * Prioridad geográfica: Veracruz, Querétaro, Puebla, Guanajuato, Chihuahua.
 * BC ya denso (Zeta/AFN/Uniradio); no se rellenó. GTO: solo 1 STRICT viable
 * (Heraldo León); Correo/AM ya cubiertos. AM Querétaro redirige a Al Diálogo.
 * IDs: MED-0413..MED-0437 (secuencial tras MAX LIVE MED-0412).
 *
 * Uso:
 *   npm run catalog-batch10 -- --dry
 *   npm run catalog-batch10
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { getSupabase } from '../src/supabase/client.js';
import type { Medio } from '../src/types/schemas.js';

type EstadoP2 = 'Puebla' | 'Guanajuato' | 'Querétaro' | 'Veracruz' | 'Chihuahua' | 'Baja California';

function baseMedio(partial: {
  medio_id: string;
  nombre_medio: string;
  url_base: string;
  estado: EstadoP2;
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
  estado: EstadoP2;
  rss_url: string;
  notas_tecnicas: string;
}): Medio {
  return baseMedio({ ...p, metodo_extraccion: 'RSS', sitemap_url: null });
}

function medioSitemap(p: {
  medio_id: string;
  nombre_medio: string;
  url_base: string;
  estado: EstadoP2;
  sitemap_url: string;
  notas_tecnicas: string;
}): Medio {
  return baseMedio({ ...p, metodo_extraccion: 'SITEMAP', rss_url: null });
}

const NOTA = 'Alta 2026-09-30 (MEDIA EXPANSION BATCH 2 P2). Pre-canary público STRICT. Sin cron masivo.';

export const MEDIOS_BATCH10: Medio[] = [
  medioRss({
    medio_id: 'MED-0413',
    nombre_medio: 'La Opinión de Poza Rica',
    url_base: 'https://laopinion.net',
    estado: 'Veracruz',
    rss_url: 'https://laopinion.net/feed/',
    notas_tecnicas: `${NOTA} RSS. Poza Rica / norte de Veracruz.`,
  }),
  medioRss({
    medio_id: 'MED-0414',
    nombre_medio: 'Formato Siete',
    url_base: 'https://formato7.com',
    estado: 'Veracruz',
    rss_url: 'https://formato7.com/feed/',
    notas_tecnicas: `${NOTA} RSS. Digital Xalapa.`,
  }),
  medioRss({
    medio_id: 'MED-0415',
    nombre_medio: 'La Jornada Veracruz',
    url_base: 'https://jornadaveracruz.com.mx',
    estado: 'Veracruz',
    rss_url: 'https://jornadaveracruz.com.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. Edición Veracruz (dominio propio).`,
  }),
  medioRss({
    medio_id: 'MED-0416',
    nombre_medio: 'Crónica del Poder',
    url_base: 'https://cronicadelpoder.com',
    estado: 'Veracruz',
    rss_url: 'https://cronicadelpoder.com/feed/',
    notas_tecnicas: `${NOTA} RSS. Política veracruzana.`,
  }),
  medioRss({
    medio_id: 'MED-0417',
    nombre_medio: 'Liberal del Sur',
    url_base: 'https://liberal.com.mx',
    estado: 'Veracruz',
    rss_url: 'https://liberal.com.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. Coatzacoalcos / sur de Veracruz.`,
  }),
  medioSitemap({
    medio_id: 'MED-0418',
    nombre_medio: 'El Dictamen',
    url_base: 'https://www.eldictamen.mx',
    estado: 'Veracruz',
    sitemap_url: 'https://www.eldictamen.mx/gn_sitemap.xml/',
    notas_tecnicas: `${NOTA} NEWS_SITEMAP. Periódico Veracruz.`,
  }),
  medioSitemap({
    medio_id: 'MED-0419',
    nombre_medio: 'El Piñero de la Cuenca',
    url_base: 'https://elpinerodelacuenca.com.mx',
    estado: 'Veracruz',
    sitemap_url: 'https://elpinerodelacuenca.com.mx/sitemap_index.xml',
    notas_tecnicas: `${NOTA} SITEMAP_INDEX. Cuenca del Papaloapan.`,
  }),
  medioSitemap({
    medio_id: 'MED-0420',
    nombre_medio: 'e-Veracruz',
    url_base: 'https://e-veracruz.mx',
    estado: 'Veracruz',
    sitemap_url: 'https://e-veracruz.mx/sitemap.xml',
    notas_tecnicas: `${NOTA} SITEMAP. Digital estatal Veracruz (dominio propio, no e-consulta.com).`,
  }),
  medioRss({
    medio_id: 'MED-0421',
    nombre_medio: 'ADN Informativo Qro',
    url_base: 'https://adninformativo.mx',
    estado: 'Querétaro',
    rss_url: 'https://adninformativo.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. Digital Querétaro.`,
  }),
  medioRss({
    medio_id: 'MED-0422',
    nombre_medio: 'Rotativo',
    url_base: 'https://rotativo.com.mx',
    estado: 'Querétaro',
    rss_url: 'https://rotativo.com.mx/feeds/feed.rss',
    notas_tecnicas: `${NOTA} RSS. Digital Querétaro.`,
  }),
  medioRss({
    medio_id: 'MED-0423',
    nombre_medio: 'Conexión 360',
    url_base: 'https://conexion360.mx',
    estado: 'Querétaro',
    rss_url: 'https://conexion360.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. Digital Querétaro.`,
  }),
  medioRss({
    medio_id: 'MED-0424',
    nombre_medio: 'Pulso Querétaro',
    url_base: 'https://pulsoqro.com',
    estado: 'Querétaro',
    rss_url: 'https://pulsoqro.com/feed/',
    notas_tecnicas: `${NOTA} RSS. Digital Querétaro.`,
  }),
  medioSitemap({
    medio_id: 'MED-0425',
    nombre_medio: 'Al Diálogo',
    url_base: 'https://aldialogo.mx',
    estado: 'Querétaro',
    sitemap_url: 'https://aldialogo.mx/sitemap',
    notas_tecnicas: `${NOTA} SITEMAP. Identidad actual de lo que redirige amqueretaro.com; no se duplica AM León.`,
  }),
  medioRss({
    medio_id: 'MED-0426',
    nombre_medio: 'Diario Cambio',
    url_base: 'https://www.diariocambio.com.mx',
    estado: 'Puebla',
    rss_url: 'https://www.diariocambio.com.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. Periódico Puebla.`,
  }),
  medioRss({
    medio_id: 'MED-0427',
    nombre_medio: 'Síntesis Puebla',
    url_base: 'https://sintesis.mx',
    estado: 'Puebla',
    rss_url: 'https://sintesis.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. Periódico Puebla (no Síntesis TV).`,
  }),
  medioSitemap({
    medio_id: 'MED-0428',
    nombre_medio: 'Ensenada.net',
    url_base: 'https://ensenada.net',
    estado: 'Baja California',
    sitemap_url: 'https://ensenada.net/sitemap.xml',
    notas_tecnicas: `${NOTA} SITEMAP. Digital Ensenada. Reemplazo de Puebla Online (HTTP 403 persistente sin content:encoded).`,
  }),
  medioRss({
    medio_id: 'MED-0429',
    nombre_medio: 'Quinto Poder Puebla',
    url_base: 'https://quintopoder.com.mx',
    estado: 'Puebla',
    rss_url: 'https://quintopoder.com.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. Digital político Puebla.`,
  }),
  medioRss({
    medio_id: 'MED-0430',
    nombre_medio: 'Poblanerías',
    url_base: 'https://www.poblanerias.com',
    estado: 'Puebla',
    rss_url: 'https://www.poblanerias.com/feed/',
    notas_tecnicas: `${NOTA} RSS. Digital Puebla.`,
  }),
  medioSitemap({
    medio_id: 'MED-0431',
    nombre_medio: 'Intolerancia Diario',
    url_base: 'https://intoleranciadiario.com',
    estado: 'Puebla',
    sitemap_url: 'https://intoleranciadiario.com/sitemap/news.xml',
    notas_tecnicas: `${NOTA} NEWS_SITEMAP. Periódico Puebla.`,
  }),
  medioRss({
    medio_id: 'MED-0432',
    nombre_medio: 'Crónica Puebla',
    url_base: 'https://cronicapuebla.com',
    estado: 'Puebla',
    rss_url: 'https://cronicapuebla.com/feed/',
    notas_tecnicas: `${NOTA} RSS. Digital Puebla.`,
  }),
  medioRss({
    medio_id: 'MED-0433',
    nombre_medio: 'El Heraldo de León',
    url_base: 'https://www.heraldoleon.mx',
    estado: 'Guanajuato',
    rss_url: 'https://www.heraldoleon.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. León (no heraldo.mx Aguascalientes).`,
  }),
  medioRss({
    medio_id: 'MED-0434',
    nombre_medio: 'Norte Digital',
    url_base: 'https://nortedigital.mx',
    estado: 'Chihuahua',
    rss_url: 'https://nortedigital.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. Digital Juárez.`,
  }),
  medioRss({
    medio_id: 'MED-0435',
    nombre_medio: 'Referente',
    url_base: 'https://www.referente.mx',
    estado: 'Chihuahua',
    rss_url: 'https://www.referente.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. Digital Chihuahua.`,
  }),
  medioRss({
    medio_id: 'MED-0436',
    nombre_medio: 'La Verdad Juárez',
    url_base: 'https://laverdadjuarez.com',
    estado: 'Chihuahua',
    rss_url: 'https://laverdadjuarez.com/feed/',
    notas_tecnicas: `${NOTA} RSS. Digital Juárez (no La Verdad Noticias).`,
  }),
  medioRss({
    medio_id: 'MED-0437',
    nombre_medio: 'Chihuahua Noticias',
    url_base: 'https://chihuahuanoticias.mx',
    estado: 'Chihuahua',
    rss_url: 'https://chihuahuanoticias.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. Digital Chihuahua.`,
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
  const ids = MEDIOS_BATCH10.map((m) => m.medio_id);
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
  const loteHosts = new Set(MEDIOS_BATCH10.map((m) => hostOf(m.url_base)).filter(Boolean));
  if (loteHosts.size !== MEDIOS_BATCH10.length) {
    console.error('ABORT: hosts duplicados dentro del lote');
    process.exit(2);
  }
  const loteFeeds = new Set(MEDIOS_BATCH10.map(sourceUrl).filter(Boolean));
  if (loteFeeds.size !== MEDIOS_BATCH10.length) {
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
    console.log(MEDIOS_BATCH10.map((m) => `${m.medio_id}: ${m.nombre_medio} [${m.estado}] — ${m.rss_url ?? m.sitemap_url}`).join('\n'));
    return;
  }
  const { error: errUpsert } = await sb.from('medios').upsert(MEDIOS_BATCH10, { onConflict: 'medio_id' });
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
