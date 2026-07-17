/**
 * Alta al catálogo de 2 fuentes P1 faltantes para Patrón (CLI-0002), del lote
 * "PATRON P1 MEDIA GAP CLOSURE" (2026-07-17): AM León (am.com.mx) y CRT /
 * Consejo Regulador del Tequila (crt.org.mx). Idempotente (upsert por medio_id).
 *
 * Viabilidad verificada en vivo (single-request, sin proxy/Playwright/bypass):
 * - AM León: news-sitemap.xml (Yoast/Jetpack, formato Google News) con
 *   artículos recientes confirmados (2026-07-16/17).
 * - CRT: wp-sitemap-posts-post-1.xml (WordPress, posts reales — boletines/
 *   comunicados del Consejo Regulador del Tequila, NO confundir con "CRT tech").
 *
 * SOLO agrega filas nuevas a `medios`. NO activa cron por sí solo — el alta a
 * `SHADOW_MEDIOS_DAILY_VALIDATED` (src/config/shadowMedia.ts) es un cambio
 * separado y ya aplicado; este script únicamente cataloga los medios para que
 * ese tier (fuente='auto') pueda resolver metodo_extraccion/sitemap_url.
 *
 * NO hace crawl. NO toca noticias/menciones. NO toca clientes/keywords.
 *
 * Uso:
 *   npm run catalog-patron-p1-gap-media -- --dry   # solo imprime el plan
 *   npm run catalog-patron-p1-gap-media            # aplica (upsert)
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { getSupabase } from '../src/supabase/client.js';
import type { Medio } from '../src/types/schemas.js';

const NUEVOS_MEDIOS: Medio[] = [
  {
    medio_id: 'MED-0172',
    nombre_medio: 'AM León',
    grupo_medio: 'OEM (Organización Editorial Mexicana)',
    url_base: 'https://www.am.com.mx',
    pais: 'MX',
    estado: 'Guanajuato',
    municipio: 'León',
    region: 'Bajío',
    categoria: 'Medio regional',
    prioridad: 'Media',
    activo: true,
    metodo_extraccion: 'SITEMAP',
    rss_url: null,
    sitemap_url: 'https://www.am.com.mx/news-sitemap.xml',
    secciones_urls: null,
    buscador_url: null,
    requiere_javascript: false,
    requiere_proxy: false,
    frecuencia_minutos: 240,
    notas_tecnicas:
      'Alta 2026-07-17 (lote PATRON P1 MEDIA GAP CLOSURE): P2 Guanajuato, zona de ' +
      'crisis tequilera. news-sitemap.xml (Yoast/Jetpack, formato Google News) ' +
      'verificado en vivo con artículos recientes. Sin proxy/JS.',
  },
  {
    medio_id: 'MED-0173',
    nombre_medio: 'Consejo Regulador del Tequila (CRT)',
    grupo_medio: null,
    url_base: 'https://www.crt.org.mx',
    pais: 'MX',
    estado: 'Jalisco',
    municipio: null,
    region: 'Sectorial',
    categoria: 'Institucional / Boletines sector tequilero',
    prioridad: 'Alta',
    activo: true,
    metodo_extraccion: 'SITEMAP',
    rss_url: null,
    sitemap_url: 'https://www.crt.org.mx/wp-sitemap-posts-post-1.xml',
    secciones_urls: null,
    buscador_url: null,
    requiere_javascript: false,
    requiere_proxy: false,
    frecuencia_minutos: 1440,
    notas_tecnicas:
      'Alta 2026-07-17 (lote PATRON P1 MEDIA GAP CLOSURE): fuente primaria sectorial ' +
      '(denominación de origen, certificaciones, comunicados oficiales). Sitemap de ' +
      'posts (no el índice) para evitar páginas/taxonomías/usuarios. Volumen bajo ' +
      '(institucional): max_notas_shadow=20 en el tier daily-validated. Sin proxy/JS. ' +
      'NO confundir con "CRT tech" (guard editorial en src/editorial/consolidation.ts).',
  },
];

async function main() {
  const dry = process.argv.includes('--dry');
  const sb = getSupabase();

  const ids = NUEVOS_MEDIOS.map((m) => m.medio_id);
  const { data: existentes, error: errSel } = await sb
    .from('medios')
    .select('medio_id, nombre_medio')
    .in('medio_id', ids);
  if (errSel) {
    console.error('Error leyendo medios existentes:', errSel.message);
    process.exit(1);
  }

  console.log(`Medios objetivo: ${ids.join(', ')}`);
  console.log(`Ya existentes en catálogo: ${(existentes ?? []).length} (esperado 0, alta nueva)`);
  for (const e of existentes ?? []) {
    console.log(`  - ${e.medio_id}: ${e.nombre_medio} (¡ya existe! upsert lo dejará igual salvo cambios de campos)`);
  }

  if (dry) {
    console.log('--dry: no se escribió nada.');
    console.log(JSON.stringify(NUEVOS_MEDIOS, null, 2));
    return;
  }

  const { error: errUpsert } = await sb.from('medios').upsert(NUEVOS_MEDIOS, { onConflict: 'medio_id' });
  if (errUpsert) {
    console.error('Upsert medios falló:', errUpsert.message);
    process.exit(1);
  }

  const { data: verif, error: errVerif } = await sb
    .from('medios')
    .select('medio_id, nombre_medio, url_base, metodo_extraccion, sitemap_url, activo, requiere_proxy, requiere_javascript')
    .in('medio_id', ids);
  if (errVerif) {
    console.error('Error en read-back:', errVerif.message);
    process.exit(1);
  }
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
