/**
 * Canal 8 BCS (MED-0109) — B24 stabilization.
 * RSS oficial /feed/ HTTP 200 en curl, pero Node/undici aborta el cuerpo
 * gzip+chunked (TypeError: terminated). sitemap Yoast post-sitemap8.xml
 * es oficial, HTTP 200, artículos del día, y Node lo lee.
 *
 * Uso:
 *   npx tsx scripts/repair-canal-8-bcs-source.ts --dry
 *   npx tsx scripts/repair-canal-8-bcs-source.ts
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { getSupabase } from '../src/supabase/client.js';

export const MEDIO_ID = 'MED-0109';
export const RSS = 'https://iert.bcs.gob.mx/feed/';
export const SITEMAP = 'https://iert.bcs.gob.mx/post-sitemap8.xml';

async function main() {
  const dry = process.argv.includes('--dry');
  const sb = getSupabase();
  const { data: antes, error: errAntes } = await sb
    .from('medios')
    .select('medio_id, nombre_medio, metodo_extraccion, rss_url, sitemap_url, activo, ultimo_estado')
    .eq('medio_id', MEDIO_ID)
    .single();
  if (errAntes) {
    console.error(errAntes.message);
    process.exit(1);
  }
  console.log('Antes:', JSON.stringify(antes, null, 2));
  if (dry) {
    console.log(`--dry: metodo=SITEMAP sitemap_url=${SITEMAP} rss_url=${RSS}. Sin escritura.`);
    return;
  }
  const { error } = await sb
    .from('medios')
    .update({ metodo_extraccion: 'SITEMAP', sitemap_url: SITEMAP, rss_url: RSS })
    .eq('medio_id', MEDIO_ID);
  if (error) {
    console.error(error.message);
    process.exit(1);
  }
  const { data: despues } = await sb
    .from('medios')
    .select('medio_id, nombre_medio, metodo_extraccion, rss_url, sitemap_url, activo, ultimo_estado')
    .eq('medio_id', MEDIO_ID)
    .single();
  console.log('Después:', JSON.stringify(despues, null, 2));
}

function esEntrypointCli(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (esEntrypointCli()) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
