/**
 * Alta al catálogo de 3 medios — lote "NEWS LAKE 200 FINAL PUSH" (2026-07-22).
 *
 * - PorEsto (MED-0189)   — A_PUBLICO_FACIL: RSS activo `/rss/portada.xml`
 * - LatinUS (MED-0190)   — B_PUBLICO_DIRECT: artículos en HTML estático, sin sitemap
 * - La Silla Rota (MED-0191) — B_PUBLICO_DIRECT: artículos en HTML estático, sin sitemap
 *
 * Uso:
 *   npm run catalog-direct-lote3 -- --dry
 *   npm run catalog-direct-lote3
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { getSupabase } from '../src/supabase/client.js';
import type { Medio } from '../src/types/schemas.js';

export const NUEVOS_MEDIOS_LOTE3: Medio[] = [
  {
    medio_id: 'MED-0189',
    nombre_medio: 'PorEsto',
    grupo_medio: null,
    url_base: 'https://www.poresto.com',
    pais: 'MX',
    estado: 'Yucatán',
    municipio: null,
    region: 'Sureste',
    categoria: 'Noticias / Regional',
    prioridad: 'Media',
    activo: true,
    metodo_extraccion: 'RSS',
    rss_url: 'https://www.poresto.com/rss/portada.xml',
    sitemap_url: null,
    secciones_urls: null,
    buscador_url: null,
    requiere_javascript: false,
    requiere_proxy: false,
    frecuencia_minutos: 240,
    notas_tecnicas:
      'Alta 2026-07-22 (NEWS LAKE 200 FINAL PUSH). A_PUBLICO_FACIL: RSS `/rss/portada.xml` ' +
      'verificado en vivo (artículos del día, patrón /SECCION/YYYY/M/DD/slug.html). ' +
      'dominio correcto: www.poresto.com (redirige desde poresto.net y poresto.com). ' +
      'Cobertura: sureste mexicano (Yucatán, Campeche, Quintana Roo). Sin proxy, sin JS.',
  },
  {
    medio_id: 'MED-0190',
    nombre_medio: 'LatinUS',
    grupo_medio: null,
    url_base: 'https://latinus.us',
    pais: 'MX',
    estado: 'Nacional',
    municipio: null,
    region: 'Nacional',
    categoria: 'Noticias / TV Digital',
    prioridad: 'Media',
    activo: true,
    metodo_extraccion: 'DIRECT',
    rss_url: null,
    sitemap_url: null,
    secciones_urls: 'https://latinus.us/',
    buscador_url: null,
    requiere_javascript: false,
    requiere_proxy: false,
    frecuencia_minutos: 360,
    notas_tecnicas:
      'Alta 2026-07-22 (NEWS LAKE 200 FINAL PUSH). B_PUBLICO_DIRECT: sin sitemap/RSS, ' +
      'pero la homepage devuelve artículos en HTML estático con patrón ' +
      '/SECCION/YYYY/M/DD/slug-NUM.html. Extracción via script dedicado ' +
      'crawl-direct-latinus.ts. Sin proxy, sin Playwright. ' +
      'Nota: IPs de datacenter (AWS/GCP) pueden ser bloqueadas — verificar en prod.',
  },
  {
    medio_id: 'MED-0191',
    nombre_medio: 'La Silla Rota',
    grupo_medio: null,
    url_base: 'https://lasillarota.com',
    pais: 'MX',
    estado: 'Nacional',
    municipio: null,
    region: 'Nacional',
    categoria: 'Noticias / Político-Digital',
    prioridad: 'Alta',
    activo: true,
    metodo_extraccion: 'DIRECT',
    rss_url: null,
    sitemap_url: null,
    secciones_urls: 'https://lasillarota.com/',
    buscador_url: null,
    requiere_javascript: false,
    requiere_proxy: false,
    frecuencia_minutos: 360,
    notas_tecnicas:
      'Alta 2026-07-22 (NEWS LAKE 200 FINAL PUSH). B_PUBLICO_DIRECT (P2 según ' +
      'REPLACEMENT_READINESS_REPORT: 9-11 menciones históricas, alto valor). ' +
      'Homepage devuelve artículos en HTML estático, patrón ' +
      '/SECCION/YYYY/M/DD/slug-ID.html (ID numérico). Extracción via ' +
      'crawl-direct-lasillarota.ts. Sin proxy, sin Playwright. ' +
      'Nota: IPs de datacenter pueden ser bloqueadas — verificar en prod.',
  },
];

async function main() {
  const dry = process.argv.includes('--dry');
  const sb = getSupabase();

  const ids = NUEVOS_MEDIOS_LOTE3.map((m) => m.medio_id);
  const { data: existentes, error: errSel } = await sb.from('medios').select('medio_id, nombre_medio').in('medio_id', ids);
  if (errSel) { console.error('Error leyendo medios existentes:', errSel.message); process.exit(1); }

  console.log(`Medios objetivo: ${ids.length} (${ids.join(', ')})`);
  console.log(`Ya existentes: ${(existentes ?? []).length}`);

  if (dry) {
    console.log('--dry: no se escribió nada.');
    console.log(NUEVOS_MEDIOS_LOTE3.map((m) => `${m.medio_id}: ${m.nombre_medio} — ${m.metodo_extraccion}`).join('\n'));
    return;
  }

  const { error: errUpsert } = await sb.from('medios').upsert(NUEVOS_MEDIOS_LOTE3, { onConflict: 'medio_id' });
  if (errUpsert) { console.error('Upsert medios falló:', errUpsert.message); process.exit(1); }

  const { data: verif, error: errVerif } = await sb
    .from('medios')
    .select('medio_id, nombre_medio, url_base, metodo_extraccion, activo, requiere_proxy, requiere_javascript')
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
