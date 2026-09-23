/**
 * El Peninsular Digital (MED-0103) — B24 stabilization.
 * post-sitemap100.xml ya no es fuente usable en cron (B24: sin_fuente).
 * news-sitemap.xml oficial HTTP 200, 21 artículos de hoy.
 *
 * Uso:
 *   npx tsx scripts/repair-el-peninsular-source.ts --dry
 *   npx tsx scripts/repair-el-peninsular-source.ts
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { getSupabase } from '../src/supabase/client.js';

export const MEDIO_ID = 'MED-0103';
export const SITEMAP = 'https://peninsulardigital.com/news-sitemap.xml';

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
    console.log(`--dry: metodo=SITEMAP sitemap_url=${SITEMAP}. Sin escritura.`);
    return;
  }
  const { error } = await sb
    .from('medios')
    .update({ metodo_extraccion: 'SITEMAP', sitemap_url: SITEMAP, rss_url: null })
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
