/**
 * Wave07 — sitemaps STALE/EMPTY con RSS oficial fresco del propio medio.
 *
 * Uso:
 *   npx tsx scripts/repair-wave07-rss-sources.ts --dry
 *   npx tsx scripts/repair-wave07-rss-sources.ts
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { getSupabase } from '../src/supabase/client.js';

export interface RssPatch {
  medio_id: string;
  rss_url: string;
  motivo: string;
}

export const WAVE07_RSS_PATCHES: readonly RssPatch[] = [
  { medio_id: 'MED-0043', rss_url: 'https://www.zonadocs.mx/feed/', motivo: 'STALE/EMPTY sitemap; RSS WP 10 items hoy' },
  { medio_id: 'MED-0087', rss_url: 'https://www.uniradioinforma.com/feed/', motivo: 'sitemap index; RSS 57 items hoy' },
  { medio_id: 'MED-0091', rss_url: 'https://puntonorte.info/feed/', motivo: 'sitemap; RSS WP 10 items recientes' },
  { medio_id: 'MED-0136', rss_url: 'https://kioscoinformativo.com/feed/', motivo: 'sitemap; RSS WP 10 items ~2d' },
  { medio_id: 'MED-0138', rss_url: 'https://tv4noticias.com/feed/', motivo: 'sitemap; RSS 11 items hoy' },
];

async function main() {
  const dry = process.argv.includes('--dry');
  const sb = getSupabase();
  const ids = WAVE07_RSS_PATCHES.map((p) => p.medio_id);
  const { data: antes, error } = await sb
    .from('medios')
    .select('medio_id, nombre_medio, metodo_extraccion, rss_url, sitemap_url, activo')
    .in('medio_id', ids);
  if (error) throw new Error(error.message);
  console.log('ANTES', JSON.stringify(antes, null, 2));
  if (dry) {
    console.log(`--dry: ${WAVE07_RSS_PATCHES.length} patches RSS. Sin escritura.`);
    return;
  }
  for (const p of WAVE07_RSS_PATCHES) {
    const { error: up } = await sb
      .from('medios')
      .update({ metodo_extraccion: 'RSS', rss_url: p.rss_url })
      .eq('medio_id', p.medio_id);
    if (up) throw new Error(`${p.medio_id}: ${up.message}`);
    console.log(`OK ${p.medio_id} → ${p.rss_url}`);
  }
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
