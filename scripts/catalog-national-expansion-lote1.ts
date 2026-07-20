/**
 * Alta al catálogo de 12 medios nacionales nuevos — lote "ETHOS 200 MEDIA
 * NEWS LAKE" (2026-07-20), FASE 7. Todos verificados en vivo (sitemap real,
 * artículos recientes, sin proxy/JS/paywall) antes de catalogar.
 *
 * Candidatos evaluados y NO catalogados (documentados en
 * docs/NATIONAL_MEDIA_ACCESS_MATRIX.md, no en este script):
 *   - La Silla Rota, LatinUS, W Radio, PorEsto: B_PUBLICO_DIRECT (sin
 *     sitemap descubrible, requerirían extractor DIRECT dedicado).
 *   - El Siglo de Torreón, SinEmbargo, Radio Fórmula: bloqueados (403).
 *   - Business Insider México, Fortune en Español: dominio no resuelve.
 *   - Imagen Radio: robots.txt apunta (mal configurado) al sitemap de
 *     Excelsior — no confiable.
 *
 * SOLO agrega filas nuevas a `medios`. NO activa cron por sí solo (ver
 * `src/config/shadowMedia.ts` para el sub-lote de 10 que sí entra a cron).
 *
 * Uso:
 *   npm run catalog-national-expansion-lote1 -- --dry
 *   npm run catalog-national-expansion-lote1
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { getSupabase } from '../src/supabase/client.js';
import type { Medio } from '../src/types/schemas.js';

const NUEVOS_MEDIOS: Medio[] = [
  {
    medio_id: 'MED-0174', nombre_medio: 'Alto Nivel', grupo_medio: null,
    url_base: 'https://altonivel.com.mx', pais: 'MX', estado: 'Nacional', municipio: null,
    region: 'Nacional', categoria: 'Negocios', prioridad: 'Media', activo: true,
    metodo_extraccion: 'SITEMAP', rss_url: null,
    sitemap_url: 'https://altonivel.com.mx/sitemap_index.xml',
    secciones_urls: null, buscador_url: null, requiere_javascript: false, requiere_proxy: false,
    frecuencia_minutos: 240,
    notas_tecnicas: 'Alta 2026-07-20 (ETHOS 200 MEDIA NEWS LAKE). Yoast sitemap_index.xml verificado en vivo.',
  },
  {
    medio_id: 'MED-0175', nombre_medio: 'SDP Noticias', grupo_medio: null,
    url_base: 'https://www.sdpnoticias.com', pais: 'MX', estado: 'Nacional', municipio: null,
    region: 'Nacional', categoria: 'Noticias / General', prioridad: 'Alta', activo: true,
    metodo_extraccion: 'SITEMAP', rss_url: null,
    sitemap_url: 'https://www.sdpnoticias.com/arc/outboundfeeds/news-sitemap/?outputType=xml',
    secciones_urls: null, buscador_url: null, requiere_javascript: false, requiere_proxy: false,
    frecuencia_minutos: 120,
    notas_tecnicas: 'Alta 2026-07-20. Feed Arc Publishing verificado en vivo (mismo patrón que El Universal).',
  },
  {
    medio_id: 'MED-0176', nombre_medio: 'Bloomberg Línea México', grupo_medio: 'Bloomberg Línea',
    url_base: 'https://www.bloomberglinea.com', pais: 'MX', estado: 'Nacional', municipio: null,
    region: 'Nacional', categoria: 'Negocios', prioridad: 'Alta', activo: true,
    metodo_extraccion: 'SITEMAP', rss_url: null,
    sitemap_url: 'https://www.bloomberglinea.com/arc/outboundfeeds/google-news-feed-latam/?outputType=xml',
    secciones_urls: null, buscador_url: null, requiere_javascript: false, requiere_proxy: false,
    frecuencia_minutos: 120,
    notas_tecnicas: 'Alta 2026-07-20. Feed Arc Publishing (Google News LatAm) verificado en vivo.',
  },
  {
    medio_id: 'MED-0177', nombre_medio: 'DPL News', grupo_medio: null,
    url_base: 'https://dplnews.com', pais: 'MX', estado: 'Nacional', municipio: null,
    region: 'Nacional', categoria: 'Negocios', prioridad: 'Media', activo: true,
    metodo_extraccion: 'SITEMAP', rss_url: null,
    sitemap_url: 'https://dplnews.com/sitemap_index.xml',
    secciones_urls: null, buscador_url: null, requiere_javascript: false, requiere_proxy: false,
    frecuencia_minutos: 240,
    notas_tecnicas: 'Alta 2026-07-20. sitemap_index.xml verificado en vivo.',
  },
  {
    medio_id: 'MED-0178', nombre_medio: 'N+', grupo_medio: 'Grupo Multimedios',
    url_base: 'https://www.nmas.com.mx', pais: 'MX', estado: 'Nacional', municipio: null,
    region: 'Nacional', categoria: 'Noticias / General', prioridad: 'Alta', activo: true,
    metodo_extraccion: 'SITEMAP', rss_url: null,
    sitemap_url: 'https://www.nmas.com.mx/sitemaps/sitemap_news.xml',
    secciones_urls: null, buscador_url: null, requiere_javascript: false, requiere_proxy: false,
    frecuencia_minutos: 120,
    notas_tecnicas: 'Alta 2026-07-20. sitemap_news.xml verificado en vivo (TV nacional, Grupo Multimedios).',
  },
  {
    medio_id: 'MED-0179', nombre_medio: 'ADN40', grupo_medio: null,
    url_base: 'https://www.adn40.mx', pais: 'MX', estado: 'Nacional', municipio: null,
    region: 'Nacional', categoria: 'Noticias / General', prioridad: 'Alta', activo: true,
    metodo_extraccion: 'SITEMAP', rss_url: null,
    sitemap_url: 'https://www.adn40.mx/arc/outboundfeeds/sitemap-news/latest/',
    secciones_urls: null, buscador_url: null, requiere_javascript: false, requiere_proxy: false,
    frecuencia_minutos: 120,
    notas_tecnicas: 'Alta 2026-07-20. Feed Arc Publishing verificado en vivo.',
  },
  {
    medio_id: 'MED-0180', nombre_medio: 'TV Azteca Noticias', grupo_medio: 'TV Azteca',
    url_base: 'https://www.tvazteca.com/aztecanoticias', pais: 'MX', estado: 'Nacional', municipio: null,
    region: 'Nacional', categoria: 'Noticias / General', prioridad: 'Alta', activo: true,
    metodo_extraccion: 'SITEMAP', rss_url: null,
    sitemap_url: 'https://www.tvazteca.com/aztecanoticias/sitemap-latest.xml',
    secciones_urls: null, buscador_url: null, requiere_javascript: false, requiere_proxy: false,
    frecuencia_minutos: 120,
    notas_tecnicas: 'Alta 2026-07-20. Sitemap de sección aztecanoticias verificado en vivo (robots.txt lista muchos, este es el de noticias).',
  },
  {
    medio_id: 'MED-0181', nombre_medio: 'MVS Noticias', grupo_medio: 'MVS Comunicaciones',
    url_base: 'https://mvsnoticias.com', pais: 'MX', estado: 'Nacional', municipio: null,
    region: 'Nacional', categoria: 'Noticias / General', prioridad: 'Media', activo: true,
    metodo_extraccion: 'SITEMAP', rss_url: null,
    sitemap_url: 'https://mvsnoticias.com/sitemaps/index.xml',
    secciones_urls: null, buscador_url: null, requiere_javascript: false, requiere_proxy: false,
    frecuencia_minutos: 180,
    notas_tecnicas: 'Alta 2026-07-20. sitemaps/index.xml verificado en vivo.',
  },
  {
    medio_id: 'MED-0182', nombre_medio: 'Diario de Yucatán', grupo_medio: null,
    url_base: 'https://www.yucatan.com.mx', pais: 'MX', estado: 'Yucatán', municipio: 'Mérida',
    region: 'Sureste', categoria: 'Noticias / Local', prioridad: 'Media', activo: true,
    metodo_extraccion: 'SITEMAP', rss_url: null,
    sitemap_url: 'https://www.yucatan.com.mx/news-sitemap.xml',
    secciones_urls: null, buscador_url: null, requiere_javascript: false, requiere_proxy: false,
    frecuencia_minutos: 240,
    notas_tecnicas: 'Alta 2026-07-20. news-sitemap.xml verificado en vivo.',
  },
  {
    medio_id: 'MED-0183', nombre_medio: 'Contralínea', grupo_medio: null,
    url_base: 'https://contralinea.com.mx', pais: 'MX', estado: 'Nacional', municipio: null,
    region: 'Nacional', categoria: 'Noticias / Investigación', prioridad: 'Media', activo: true,
    metodo_extraccion: 'SITEMAP', rss_url: null,
    sitemap_url: 'https://contralinea.com.mx/sitemap_index.xml',
    secciones_urls: null, buscador_url: null, requiere_javascript: false, requiere_proxy: false,
    frecuencia_minutos: 240,
    notas_tecnicas: 'Alta 2026-07-20. sitemap_index.xml verificado en vivo.',
  },
  {
    medio_id: 'MED-0184', nombre_medio: 'Merca2.0', grupo_medio: null,
    url_base: 'https://www.merca20.com', pais: 'MX', estado: 'Nacional', municipio: null,
    region: 'Nacional', categoria: 'Negocios / Mercadotecnia', prioridad: 'Baja', activo: true,
    metodo_extraccion: 'SITEMAP', rss_url: null,
    sitemap_url: 'https://www.merca20.com/sitemap_index.xml',
    secciones_urls: null, buscador_url: null, requiere_javascript: false, requiere_proxy: false,
    frecuencia_minutos: 360,
    notas_tecnicas: 'Alta 2026-07-20. sitemap_index.xml verificado en vivo. Catalogado, sin cron inmediato (prioridad baja para Jumex/Patrón).',
  },
  {
    medio_id: 'MED-0185', nombre_medio: 'El CEO', grupo_medio: null,
    url_base: 'https://elceo.com', pais: 'MX', estado: 'Nacional', municipio: null,
    region: 'Nacional', categoria: 'Negocios', prioridad: 'Baja', activo: true,
    metodo_extraccion: 'SITEMAP', rss_url: null,
    sitemap_url: 'https://elceo.com/sitemap_index.xml',
    secciones_urls: null, buscador_url: null, requiere_javascript: false, requiere_proxy: false,
    frecuencia_minutos: 360,
    notas_tecnicas: 'Alta 2026-07-20. sitemap_index.xml verificado en vivo. Catalogado, sin cron inmediato (prioridad baja para Jumex/Patrón).',
  },
];

async function main() {
  const dry = process.argv.includes('--dry');
  const sb = getSupabase();

  const ids = NUEVOS_MEDIOS.map((m) => m.medio_id);
  const { data: existentes, error: errSel } = await sb.from('medios').select('medio_id, nombre_medio').in('medio_id', ids);
  if (errSel) { console.error('Error leyendo medios existentes:', errSel.message); process.exit(1); }

  console.log(`Medios objetivo: ${ids.length} (${ids[0]}..${ids[ids.length - 1]})`);
  console.log(`Ya existentes en catálogo: ${(existentes ?? []).length} (esperado 0, alta nueva)`);

  if (dry) {
    console.log('--dry: no se escribió nada.');
    console.log(NUEVOS_MEDIOS.map((m) => `${m.medio_id}: ${m.nombre_medio} (${m.url_base})`).join('\n'));
    return;
  }

  const { error: errUpsert } = await sb.from('medios').upsert(NUEVOS_MEDIOS, { onConflict: 'medio_id' });
  if (errUpsert) { console.error('Upsert medios falló:', errUpsert.message); process.exit(1); }

  const { data: verif, error: errVerif } = await sb
    .from('medios')
    .select('medio_id, nombre_medio, url_base, metodo_extraccion, sitemap_url, activo, requiere_proxy, requiere_javascript')
    .in('medio_id', ids)
    .order('medio_id');
  if (errVerif) { console.error('Error en read-back:', errVerif.message); process.exit(1); }
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

export { NUEVOS_MEDIOS };
