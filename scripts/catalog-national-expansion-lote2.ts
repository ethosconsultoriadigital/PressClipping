/**
 * Alta al catálogo de 2 medios nacionales más — lote "ETHOS 200 MEDIA NEWS
 * LAKE — SECOND EXPANSION" (2026-07-20). Ambos verificados en vivo antes de
 * catalogar.
 *
 * Nota honesta: la mayoría de los ~30 candidatos listados en esta fase ya
 * estaban catalogados con otro nombre (Reporte Índigo, Eje Central,
 * Notisistema, Partidero, ZonaDocs, Canal 44, Línea Directa, Noroeste, El
 * Debate) o ya fueron investigados y descartados en la fase anterior (La
 * Silla Rota, LatinUS, W Radio, PorEsto, El Siglo de Torreón, SinEmbargo,
 * Radio Fórmula, 24 Horas, Business Insider MX, Fortune ES, Imagen Radio,
 * CNIT, COFEPRIS, El CEO/Merca2.0 ya catalogados). SAT y DOF se investigaron
 * en esta fase: portales gubernamentales complejos sin feed público
 * fácilmente identificable (mismo patrón que COFEPRIS) — NO catalogados, no
 * se fuerza. Solo 2 candidatos NUEVOS pasaron viabilidad limpia esta vez;
 * no se inventan 17-20 solo para llegar a un número.
 *
 * Uso:
 *   npm run catalog-national-expansion-lote2 -- --dry
 *   npm run catalog-national-expansion-lote2
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { getSupabase } from '../src/supabase/client.js';
import type { Medio } from '../src/types/schemas.js';

const NUEVOS_MEDIOS: Medio[] = [
  {
    medio_id: 'MED-0186', nombre_medio: 'Político MX', grupo_medio: null,
    url_base: 'https://politico.mx', pais: 'MX', estado: 'Nacional', municipio: null,
    region: 'Nacional', categoria: 'Noticias / Política', prioridad: 'Media', activo: true,
    metodo_extraccion: 'SITEMAP', rss_url: null,
    sitemap_url: 'https://politico.mx/arc/outboundfeeds/sitemap-news-index/',
    secciones_urls: null, buscador_url: null, requiere_javascript: false, requiere_proxy: false,
    frecuencia_minutos: 180,
    notas_tecnicas: 'Alta 2026-07-20 (ETHOS 200 MEDIA NEWS LAKE, 2da expansión). Índice de sitemaps Arc Publishing verificado en vivo (artículos de los últimos 4 días).',
  },
  {
    medio_id: 'MED-0187', nombre_medio: 'AF Medios', grupo_medio: null,
    url_base: 'https://www.afmedios.com', pais: 'MX', estado: 'Jalisco', municipio: null,
    region: 'Occidente', categoria: 'Noticias / Local', prioridad: 'Media', activo: true,
    metodo_extraccion: 'SITEMAP', rss_url: null,
    sitemap_url: 'https://www.afmedios.com/sitemap_index.xml',
    secciones_urls: null, buscador_url: null, requiere_javascript: false, requiere_proxy: false,
    frecuencia_minutos: 240,
    notas_tecnicas: 'Alta 2026-07-20 (ETHOS 200 MEDIA NEWS LAKE, 2da expansión). Yoast sitemap_index.xml verificado en vivo. Ya estaba en la lista curada de medios importantes de Jalisco (antes NO_CATALOGADO).',
  },
];

async function main() {
  const dry = process.argv.includes('--dry');
  const sb = getSupabase();

  const ids = NUEVOS_MEDIOS.map((m) => m.medio_id);
  const { data: existentes, error: errSel } = await sb.from('medios').select('medio_id, nombre_medio').in('medio_id', ids);
  if (errSel) { console.error('Error leyendo medios existentes:', errSel.message); process.exit(1); }

  console.log(`Medios objetivo: ${ids.length} (${ids.join(', ')})`);
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
