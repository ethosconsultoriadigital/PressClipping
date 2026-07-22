/**
 * Alta al catálogo de CNIT (Cámara Nacional de la Industria Tequilera,
 * cnit.org.mx) — lote "OFFICIAL SOURCES + DIRECT EXTRACTORS" (2026-07-20).
 *
 * CNIT es B_PUBLICO_DIRECT: tiene blog público real con comunicados relevantes
 * para Patrón/tequila/agave, pero sin sitemap/RSS descubrible. Se extrae via
 * el script dedicado `crawl-direct-cnit.ts` — NO va por el cron estándar.
 *
 * Uso:
 *   npm run catalog-cnit -- --dry
 *   npm run catalog-cnit
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { getSupabase } from '../src/supabase/client.js';
import type { Medio } from '../src/types/schemas.js';

export const CNIT_MEDIO: Medio = {
  medio_id: 'MED-0188',
  nombre_medio: 'CNIT — Cámara Nacional de la Industria Tequilera',
  grupo_medio: null,
  url_base: 'https://cnit.org.mx',
  pais: 'MX',
  estado: 'Jalisco',
  municipio: null,
  region: 'Occidente',
  categoria: 'Gobierno / Industria',
  prioridad: 'Alta',
  activo: true,
  metodo_extraccion: 'DIRECT',
  rss_url: null,
  sitemap_url: null,
  secciones_urls: 'https://cnit.org.mx/blog',
  buscador_url: null,
  requiere_javascript: false,
  requiere_proxy: false,
  frecuencia_minutos: 1440,
  notas_tecnicas:
    'Alta 2026-07-20 (OFFICIAL SOURCES + DIRECT EXTRACTORS). B_PUBLICO_DIRECT: ' +
    'blog público real con comunicados de denominación de origen, sustentabilidad ' +
    'y normativa tequilera — muy relevante para Patrón. Sin sitemap/RSS descubrible. ' +
    'Extracción via script dedicado crawl-direct-cnit.ts (no cron estándar). ' +
    'Sin proxy, sin Playwright, sin bypass. Dedup por URL.',
};

async function main() {
  const dry = process.argv.includes('--dry');
  const sb = getSupabase();

  const { data: existentes, error: errSel } = await sb
    .from('medios')
    .select('medio_id, nombre_medio')
    .eq('medio_id', CNIT_MEDIO.medio_id);
  if (errSel) { console.error('Error leyendo medio existente:', errSel.message); process.exit(1); }

  console.log(`Medio objetivo: ${CNIT_MEDIO.medio_id} (${CNIT_MEDIO.nombre_medio})`);
  console.log(`Ya existe: ${(existentes ?? []).length > 0}`);

  if (dry) {
    console.log('--dry: no se escribió nada.');
    console.log(JSON.stringify(CNIT_MEDIO, null, 2));
    return;
  }

  const { error: errUpsert } = await sb.from('medios').upsert([CNIT_MEDIO], { onConflict: 'medio_id' });
  if (errUpsert) { console.error('Upsert falló:', errUpsert.message); process.exit(1); }

  const { data: verif, error: errVerif } = await sb
    .from('medios')
    .select('medio_id, nombre_medio, url_base, metodo_extraccion, activo, requiere_proxy, requiere_javascript')
    .eq('medio_id', CNIT_MEDIO.medio_id);
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
