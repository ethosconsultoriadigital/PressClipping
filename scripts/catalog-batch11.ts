/**
 * Alta al catálogo: 25 medios — MEDIA EXPANSION BATCH 3 / P3 (2026-09-30).
 *
 * Prioridad: Sonora, Yucatán, Quintana Roo, Coahuila.
 * Sinaloa (~15) y SLP (~16) ya densos; un solo fill Sinaloa para cerrar 25.
 * IDs: MED-0438..MED-0462 (secuencial tras MAX LIVE MED-0437).
 *
 * Uso:
 *   npm run catalog-batch11 -- --dry
 *   npm run catalog-batch11
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { getSupabase } from '../src/supabase/client.js';
import type { Medio } from '../src/types/schemas.js';

type EstadoP3 = 'Sonora' | 'Sinaloa' | 'Quintana Roo' | 'Yucatán' | 'Coahuila';

function baseMedio(partial: {
  medio_id: string;
  nombre_medio: string;
  url_base: string;
  estado: EstadoP3;
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
  estado: EstadoP3;
  rss_url: string;
  notas_tecnicas: string;
}): Medio {
  return baseMedio({ ...p, metodo_extraccion: 'RSS', sitemap_url: null });
}

function medioSitemap(p: {
  medio_id: string;
  nombre_medio: string;
  url_base: string;
  estado: EstadoP3;
  sitemap_url: string;
  notas_tecnicas: string;
}): Medio {
  return baseMedio({ ...p, metodo_extraccion: 'SITEMAP', rss_url: null });
}

const NOTA = 'Alta 2026-09-30 (MEDIA EXPANSION BATCH 3 P3). Pre-canary público STRICT. Sin cron masivo.';

export const MEDIOS_BATCH11: Medio[] = [
  medioRss({
    medio_id: 'MED-0438',
    nombre_medio: 'Primera Plana Digital',
    url_base: 'https://www.primeraplanadigital.com.mx',
    estado: 'Sonora',
    rss_url: 'https://www.primeraplanadigital.com.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. Digital Hermosillo. No confundir con primeraplana.mx (Michoacán).`,
  }),
  medioRss({
    medio_id: 'MED-0439',
    nombre_medio: 'Vanguardia Sonora',
    url_base: 'https://periodicovanguardia.mx',
    estado: 'Sonora',
    rss_url: 'https://periodicovanguardia.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. Periódico Sonora. No es Vanguardia Coahuila (vanguardia.com.mx).`,
  }),
  medioRss({
    medio_id: 'MED-0440',
    nombre_medio: 'Radar Sonora',
    url_base: 'https://www.radarsonora.com',
    estado: 'Sonora',
    rss_url: 'https://www.radarsonora.com/feed/',
    notas_tecnicas: `${NOTA} RSS. Digital Sonora.`,
  }),
  medioRss({
    medio_id: 'MED-0441',
    nombre_medio: 'Entorno Informativo',
    url_base: 'https://entornoinformativo.com.mx',
    estado: 'Sonora',
    rss_url: 'https://entornoinformativo.com.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. Digital Hermosillo.`,
  }),
  medioRss({
    medio_id: 'MED-0442',
    nombre_medio: 'Hermosillo Hoy',
    url_base: 'https://hermosillohoy.com',
    estado: 'Sonora',
    rss_url: 'https://hermosillohoy.com/feed/',
    notas_tecnicas: `${NOTA} RSS. Digital Hermosillo.`,
  }),
  medioSitemap({
    medio_id: 'MED-0443',
    nombre_medio: 'Diario del Yaqui',
    url_base: 'https://diariodelyaqui.mx',
    estado: 'Sonora',
    sitemap_url: 'https://diariodelyaqui.mx/sitemapnews',
    notas_tecnicas: `${NOTA} NEWS_SITEMAP. Periódico Cajeme. Extractor host-scoped post_content (strip SACS IA).`,
  }),
  medioRss({
    medio_id: 'MED-0444',
    nombre_medio: 'Yucatán a la Mano',
    url_base: 'https://yucatanalamano.com',
    estado: 'Yucatán',
    rss_url: 'https://yucatanalamano.com/feed/',
    notas_tecnicas: `${NOTA} RSS. Digital Yucatán.`,
  }),
  medioRss({
    medio_id: 'MED-0445',
    nombre_medio: 'Yucatán Ahora',
    url_base: 'https://yucatanahora.com.mx',
    estado: 'Yucatán',
    rss_url: 'https://yucatanahora.com.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. Digital Yucatán.`,
  }),
  medioRss({
    medio_id: 'MED-0446',
    nombre_medio: 'The Yucatan Times',
    url_base: 'https://theyucatantimes.com',
    estado: 'Yucatán',
    rss_url: 'https://theyucatantimes.com/feed/',
    notas_tecnicas: `${NOTA} RSS. Digital Yucatán (EN/ES).`,
  }),
  medioRss({
    medio_id: 'MED-0447',
    nombre_medio: 'Yucatán Digital',
    url_base: 'https://meridadigital.mx',
    estado: 'Yucatán',
    rss_url: 'https://meridadigital.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. Digital Mérida.`,
  }),
  medioRss({
    medio_id: 'MED-0448',
    nombre_medio: 'Yucatán al Momento',
    url_base: 'https://yucatanalmomento.com',
    estado: 'Yucatán',
    rss_url: 'https://yucatanalmomento.com/feed/',
    notas_tecnicas: `${NOTA} RSS. Digital Yucatán.`,
  }),
  medioRss({
    medio_id: 'MED-0449',
    nombre_medio: 'El Diario de Mérida',
    url_base: 'https://eldiariodemerida.com',
    estado: 'Yucatán',
    rss_url: 'https://eldiariodemerida.com/feed/',
    notas_tecnicas: `${NOTA} RSS. Digital Mérida.`,
  }),
  medioSitemap({
    medio_id: 'MED-0450',
    nombre_medio: 'Punto Medio',
    url_base: 'https://puntomedio.mx',
    estado: 'Yucatán',
    sitemap_url: 'https://puntomedio.mx/sitemap_index.xml',
    notas_tecnicas: `${NOTA} SITEMAP. Digital Mérida.`,
  }),
  medioRss({
    medio_id: 'MED-0451',
    nombre_medio: 'Sol Quintana Roo',
    url_base: 'https://solquintanaroo.mx',
    estado: 'Quintana Roo',
    rss_url: 'https://solquintanaroo.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. Periódico Chetumal. No es OEM El Sol.`,
  }),
  medioRss({
    medio_id: 'MED-0452',
    nombre_medio: 'Cancún Mío',
    url_base: 'https://www.cancunmio.com',
    estado: 'Quintana Roo',
    rss_url: 'https://www.cancunmio.com/feed/',
    notas_tecnicas: `${NOTA} RSS. Digital Cancún.`,
  }),
  medioRss({
    medio_id: 'MED-0453',
    nombre_medio: 'QR Ahora',
    url_base: 'https://quintanarooahora.com.mx',
    estado: 'Quintana Roo',
    rss_url: 'https://quintanarooahora.com.mx/feed/',
    notas_tecnicas: `${NOTA} RSS. Digital Quintana Roo.`,
  }),
  medioRss({
    medio_id: 'MED-0454',
    nombre_medio: 'Realidades Quintana Roo',
    url_base: 'https://realidadesquintanaroo.org',
    estado: 'Quintana Roo',
    rss_url: 'https://realidadesquintanaroo.org/feed/',
    notas_tecnicas: `${NOTA} RSS. Digital Quintana Roo.`,
  }),
  medioSitemap({
    medio_id: 'MED-0455',
    nombre_medio: 'Noticias Cancún',
    url_base: 'https://noticiascancun.com',
    estado: 'Quintana Roo',
    sitemap_url: 'https://noticiascancun.com/sitemap.xml',
    notas_tecnicas: `${NOTA} SITEMAP. Digital Cancún.`,
  }),
  medioRss({
    medio_id: 'MED-0456',
    nombre_medio: 'Quequi',
    url_base: 'https://periodicoquequi.com',
    estado: 'Quintana Roo',
    rss_url: 'https://periodicoquequi.com/feed/',
    notas_tecnicas: `${NOTA} RSS. Periódico Cancún. Feed principal, no comments/feed.`,
  }),
  medioRss({
    medio_id: 'MED-0457',
    nombre_medio: 'Chetumal Digital',
    url_base: 'https://chetumaldigital.com',
    estado: 'Quintana Roo',
    rss_url: 'https://chetumaldigital.com/feed/',
    notas_tecnicas: `${NOTA} RSS. Digital Chetumal.`,
  }),
  medioRss({
    medio_id: 'MED-0458',
    nombre_medio: 'Coahuila Hoy',
    url_base: 'https://coahuilahoy.com',
    estado: 'Coahuila',
    rss_url: 'https://coahuilahoy.com/feed/',
    notas_tecnicas: `${NOTA} RSS. Digital Coahuila.`,
  }),
  medioRss({
    medio_id: 'MED-0459',
    nombre_medio: 'Coahuila en Línea',
    url_base: 'https://coahuilaenlinea.com',
    estado: 'Coahuila',
    rss_url: 'https://coahuilaenlinea.com/feed/',
    notas_tecnicas: `${NOTA} RSS. Digital Coahuila.`,
  }),
  medioRss({
    medio_id: 'MED-0460',
    nombre_medio: 'Laguna Digital',
    url_base: 'https://lagunadigital.com',
    estado: 'Coahuila',
    rss_url: 'https://lagunadigital.com/feed/',
    notas_tecnicas: `${NOTA} RSS. Digital Laguna.`,
  }),
  medioRss({
    medio_id: 'MED-0461',
    nombre_medio: 'Torreón Digital',
    url_base: 'https://torreondigital.com',
    estado: 'Coahuila',
    rss_url: 'https://torreondigital.com/feed/',
    notas_tecnicas: `${NOTA} RSS. Digital Torreón.`,
  }),
  medioRss({
    medio_id: 'MED-0462',
    nombre_medio: 'Sinaloa en Línea',
    url_base: 'https://sinaloaenlinea.com',
    estado: 'Sinaloa',
    rss_url: 'https://sinaloaenlinea.com/feed/',
    notas_tecnicas: `${NOTA} RSS. Fill único Sinaloa (estado ya denso).`,
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
  const ids = MEDIOS_BATCH11.map((m) => m.medio_id);
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
  const loteHosts = new Set(MEDIOS_BATCH11.map((m) => hostOf(m.url_base)).filter(Boolean));
  if (loteHosts.size !== MEDIOS_BATCH11.length) {
    console.error('ABORT: hosts duplicados dentro del lote');
    process.exit(2);
  }
  const loteFeeds = new Set(MEDIOS_BATCH11.map(sourceUrl).filter(Boolean));
  if (loteFeeds.size !== MEDIOS_BATCH11.length) {
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
    console.log(MEDIOS_BATCH11.map((m) => `${m.medio_id}: ${m.nombre_medio} [${m.estado}] — ${m.rss_url ?? m.sitemap_url}`).join('\n'));
    return;
  }
  const { error: errUpsert } = await sb.from('medios').upsert(MEDIOS_BATCH11, { onConflict: 'medio_id' });
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
