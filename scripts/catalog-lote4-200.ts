/**
 * Alta al catálogo: 9 medios — lote "200 MEDIA MILESTONE" (2026-07-22).
 *
 * Todos son A_PUBLICO_FACIL (RSS verificado) salvo Eje Central (SITEMAP mensual).
 * Fuentes verificadas en vivo desde IP local, sin proxy, sin JS.
 *
 * MED-0192  ZonaDocs           A_PUBLICO_FACIL  RSS  investigative/CDMX
 * MED-0193  Pie de Página      A_PUBLICO_FACIL  RSS  investigative/nacional
 * MED-0194  Chiapas Paralelo   A_PUBLICO_FACIL  RSS  regional/Chiapas
 * MED-0195  Quadratín Nacional A_PUBLICO_FACIL  RSS  regional/Michoacán-Nacional
 * MED-0196  Tabasco Hoy        A_PUBLICO_FACIL  RSS  regional/Tabasco
 * MED-0197  El Imparcial Oaxaca A_PUBLICO_FACIL RSS  regional/Oaxaca
 * MED-0198  8 Columnas         A_PUBLICO_FACIL  RSS  político-digital/nacional
 * MED-0199  DesInformémonos    A_PUBLICO_FACIL  RSS  investigative/nacional
 * MED-0200  Eje Central        A_PUBLICO_FACIL  SITEMAP-MENSUAL  político/CDMX+Edomex
 *
 * Uso:
 *   npm run catalog-lote4-200 -- --dry
 *   npm run catalog-lote4-200
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { getSupabase } from '../src/supabase/client.js';
import type { Medio } from '../src/types/schemas.js';

export const MEDIOS_LOTE4: Medio[] = [
  {
    medio_id: 'MED-0192',
    nombre_medio: 'ZonaDocs',
    grupo_medio: null,
    url_base: 'https://www.zonadocs.mx',
    pais: 'MX',
    estado: 'Nacional',
    municipio: null,
    region: 'Nacional',
    categoria: 'Noticias / Investigativo',
    prioridad: 'Media',
    activo: true,
    metodo_extraccion: 'RSS',
    rss_url: 'https://www.zonadocs.mx/feed/',
    sitemap_url: null,
    secciones_urls: null,
    buscador_url: null,
    requiere_javascript: false,
    requiere_proxy: false,
    frecuencia_minutos: 360,
    notas_tecnicas:
      'Alta 2026-07-22 (200 MEDIA MILESTONE). A_PUBLICO_FACIL: RSS WordPress `/feed/` ' +
      '(10 items verificados en vivo). Periodismo investigativo independiente. ' +
      'También tiene wp-sitemap-posts-post-N.xml como alternativa.',
  },
  {
    medio_id: 'MED-0193',
    nombre_medio: 'Pie de Página',
    grupo_medio: null,
    url_base: 'https://piedepagina.mx',
    pais: 'MX',
    estado: 'Nacional',
    municipio: null,
    region: 'Nacional',
    categoria: 'Noticias / Investigativo',
    prioridad: 'Media',
    activo: true,
    metodo_extraccion: 'RSS',
    rss_url: 'https://piedepagina.mx/feed/',
    sitemap_url: null,
    secciones_urls: null,
    buscador_url: null,
    requiere_javascript: false,
    requiere_proxy: false,
    frecuencia_minutos: 360,
    notas_tecnicas:
      'Alta 2026-07-22 (200 MEDIA MILESTONE). A_PUBLICO_FACIL: RSS `/feed/` ' +
      '(10 items verificados en vivo, WordPress). Periodismo de largo aliento ' +
      'y derechos humanos, con cobertura relevante para temas sociales/Jumex.',
  },
  {
    medio_id: 'MED-0194',
    nombre_medio: 'Chiapas Paralelo',
    grupo_medio: null,
    url_base: 'https://www.chiapasparalelo.com',
    pais: 'MX',
    estado: 'Chiapas',
    municipio: null,
    region: 'Sur',
    categoria: 'Noticias / Regional',
    prioridad: 'Media',
    activo: true,
    metodo_extraccion: 'RSS',
    rss_url: 'https://www.chiapasparalelo.com/feed/',
    sitemap_url: null,
    secciones_urls: null,
    buscador_url: null,
    requiere_javascript: false,
    requiere_proxy: false,
    frecuencia_minutos: 360,
    notas_tecnicas:
      'Alta 2026-07-22 (200 MEDIA MILESTONE). A_PUBLICO_FACIL: RSS `/feed/` ' +
      '(10 items verificados en vivo). Cobertura Chiapas, EZLN, comunidades ' +
      'indígenas, derechos sociales.',
  },
  {
    medio_id: 'MED-0195',
    nombre_medio: 'Quadratín Nacional',
    grupo_medio: 'Quadratín',
    url_base: 'https://quadratin.com.mx',
    pais: 'MX',
    estado: 'Michoacán',
    municipio: null,
    region: 'Occidente',
    categoria: 'Noticias / Regional-Nacional',
    prioridad: 'Media',
    activo: true,
    metodo_extraccion: 'RSS',
    rss_url: 'https://quadratin.com.mx/feed/',
    sitemap_url: 'https://quadratin.com.mx/sitemap_index.xml',
    secciones_urls: null,
    buscador_url: null,
    requiere_javascript: false,
    requiere_proxy: false,
    frecuencia_minutos: 240,
    notas_tecnicas:
      'Alta 2026-07-22 (200 MEDIA MILESTONE). A_PUBLICO_FACIL: RSS `/feed/` y ' +
      'sitemap_index.xml (281 locs, artículos con años). Plataforma Quadratín, ' +
      'edición nacional/Michoacán. Distinguir de Quadratín Jalisco (subdominio).',
  },
  {
    medio_id: 'MED-0196',
    nombre_medio: 'Tabasco Hoy',
    grupo_medio: null,
    url_base: 'https://www.tabascohoy.com',
    pais: 'MX',
    estado: 'Tabasco',
    municipio: null,
    region: 'Sur',
    categoria: 'Noticias / Regional',
    prioridad: 'Media',
    activo: true,
    metodo_extraccion: 'RSS',
    rss_url: 'https://www.tabascohoy.com/feed/',
    sitemap_url: null,
    secciones_urls: null,
    buscador_url: null,
    requiere_javascript: false,
    requiere_proxy: false,
    frecuencia_minutos: 240,
    notas_tecnicas:
      'Alta 2026-07-22 (200 MEDIA MILESTONE). A_PUBLICO_FACIL: RSS `/feed/` ' +
      '(40 items verificados en vivo — volumen alto para RSS). Principal ' +
      'diario digital de Tabasco. Usar max_notas limitado en cron.',
  },
  {
    medio_id: 'MED-0197',
    nombre_medio: 'El Imparcial Oaxaca',
    grupo_medio: null,
    url_base: 'https://imparcialoaxaca.mx',
    pais: 'MX',
    estado: 'Oaxaca',
    municipio: null,
    region: 'Sur',
    categoria: 'Noticias / Regional',
    prioridad: 'Media',
    activo: true,
    metodo_extraccion: 'RSS',
    rss_url: 'https://imparcialoaxaca.mx/feed/',
    sitemap_url: null,
    secciones_urls: null,
    buscador_url: null,
    requiere_javascript: false,
    requiere_proxy: false,
    frecuencia_minutos: 240,
    notas_tecnicas:
      'Alta 2026-07-22 (200 MEDIA MILESTONE). A_PUBLICO_FACIL: RSS `/feed/` ' +
      '(10 items verificados en vivo). Principal diario de Oaxaca. ' +
      'No confundir con elimparcial.com (Sonora) que tiene 404 en feeds.',
  },
  {
    medio_id: 'MED-0198',
    nombre_medio: '8 Columnas',
    grupo_medio: null,
    url_base: 'https://8columnas.com.mx',
    pais: 'MX',
    estado: 'Nacional',
    municipio: null,
    region: 'Nacional',
    categoria: 'Noticias / Político-Digital',
    prioridad: 'Media',
    activo: true,
    metodo_extraccion: 'RSS',
    rss_url: 'https://8columnas.com.mx/feed/',
    sitemap_url: null,
    secciones_urls: null,
    buscador_url: null,
    requiere_javascript: false,
    requiere_proxy: false,
    frecuencia_minutos: 240,
    notas_tecnicas:
      'Alta 2026-07-22 (200 MEDIA MILESTONE). A_PUBLICO_FACIL: RSS `/feed/` ' +
      '(10 items verificados en vivo). Cubertura política y Estado de México. ' +
      'Sin www en el dominio (8columnas.com.mx, no www.8columnas.com.mx).',
  },
  {
    medio_id: 'MED-0199',
    nombre_medio: 'DesInformémonos',
    grupo_medio: null,
    url_base: 'https://desinformemonos.org',
    pais: 'MX',
    estado: 'Nacional',
    municipio: null,
    region: 'Nacional',
    categoria: 'Noticias / Investigativo',
    prioridad: 'Media',
    activo: true,
    metodo_extraccion: 'RSS',
    rss_url: 'https://desinformemonos.org/feed/',
    sitemap_url: null,
    secciones_urls: null,
    buscador_url: null,
    requiere_javascript: false,
    requiere_proxy: false,
    frecuencia_minutos: 360,
    notas_tecnicas:
      'Alta 2026-07-22 (200 MEDIA MILESTONE). A_PUBLICO_FACIL: RSS `/feed/` ' +
      '(10 items verificados en vivo). Periodismo independiente con enfoque ' +
      'en movimientos sociales, derechos humanos, comunidades.',
  },
  {
    medio_id: 'MED-0200',
    nombre_medio: 'Eje Central',
    grupo_medio: null,
    url_base: 'https://www.ejecentral.com.mx',
    pais: 'MX',
    estado: 'Ciudad de México',
    municipio: null,
    region: 'Centro',
    categoria: 'Noticias / Político-Digital',
    prioridad: 'Alta',
    activo: true,
    metodo_extraccion: 'SITEMAP',
    rss_url: null,
    sitemap_url: 'https://www.ejecentral.com.mx/sitemap.xml',
    secciones_urls: null,
    buscador_url: null,
    requiere_javascript: false,
    requiere_proxy: false,
    frecuencia_minutos: 1440,
    notas_tecnicas:
      'Alta 2026-07-22 (200 MEDIA MILESTONE). A_PUBLICO_FACIL: sitemap.xml devuelve ' +
      'índice de sitemaps mensuales (sitemap-YYYYMM.xml, 1357+ locs/mes). ' +
      'ALTO VOLUMEN — NO añadir a daily-validated sin validar primero. ' +
      'URLs sin .html: /SECCION/slug. Cobertura CDMX, Edomex, política nacional.',
  },
];

async function main() {
  const dry = process.argv.includes('--dry');
  const sb = getSupabase();
  const ids = MEDIOS_LOTE4.map((m) => m.medio_id);
  const { data: existentes, error: errSel } = await sb.from('medios').select('medio_id, nombre_medio').in('medio_id', ids);
  if (errSel) { console.error('Error leyendo medios existentes:', errSel.message); process.exit(1); }
  console.log(`Medios objetivo: ${ids.length} (${ids.join(', ')})`);
  console.log(`Ya existentes: ${(existentes ?? []).length}`);
  if (dry) {
    console.log('--dry: no se escribió nada.');
    console.log(MEDIOS_LOTE4.map((m) => `${m.medio_id}: ${m.nombre_medio} — ${m.metodo_extraccion}`).join('\n'));
    return;
  }
  const { error: errUpsert } = await sb.from('medios').upsert(MEDIOS_LOTE4, { onConflict: 'medio_id' });
  if (errUpsert) { console.error('Upsert medios falló:', errUpsert.message); process.exit(1); }
  const { data: verif, error: errVerif } = await sb
    .from('medios')
    .select('medio_id, nombre_medio, metodo_extraccion, activo')
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
