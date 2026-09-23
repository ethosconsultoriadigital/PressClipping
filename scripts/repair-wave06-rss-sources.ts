/**
 * Wave06 Rescue — sitemaps que capturan URLs viejas; RSS oficial del propio
 * medio con HTTP 200, artículos reales y fechas recientes.
 *
 * Conserva sitemap_url. Solo metodo_extraccion + rss_url.
 *
 * MED-0035 (24 Horas) no se incluye: sitemap 403 y RSS /feed/ también 403
 * desde este entorno (ENVIRONMENT/SOURCE_BLOCKED). No es bypass.
 *
 * Uso:
 *   npx tsx scripts/repair-wave06-rss-sources.ts --dry
 *   npx tsx scripts/repair-wave06-rss-sources.ts
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { getSupabase } from '../src/supabase/client.js';

export interface RssPatch {
  medio_id: string;
  rss_url: string;
  motivo: string;
}

export const WAVE06_RSS_PATCHES: readonly RssPatch[] = [
  { medio_id: 'MED-0124', rss_url: 'https://vallartaindependiente.com/feed/', motivo: 'STALE_SITEMAP; RSS WP 20 items hoy' },
  { medio_id: 'MED-0052', rss_url: 'https://www.horacero.com.mx/feed/', motivo: 'STALE_SITEMAP; RSS WP 10 items hoy' },
  { medio_id: 'MED-0062', rss_url: 'https://cafenegroportal.com/feed/', motivo: 'STALE_SITEMAP; RSS WP 10 items hoy' },
  { medio_id: 'MED-0072', rss_url: 'https://sanluishoy.com.mx/feed/', motivo: 'STALE_SITEMAP; RSS WP 10 items hoy' },
  { medio_id: 'MED-0080', rss_url: 'https://www.astrolabio.com.mx/feed/', motivo: 'STALE_SITEMAP; RSS WP 10 items hoy' },
  { medio_id: 'MED-0093', rss_url: 'https://www.periodismonegro.mx/feed/', motivo: 'STALE_SITEMAP; RSS WP 10 items hoy' },
  { medio_id: 'MED-0122', rss_url: 'https://tribunadelabahia.com.mx/feed/', motivo: 'STALE_SITEMAP; RSS WP 10 items hoy' },
  { medio_id: 'MED-0036', rss_url: 'https://www.chilango.com/feed/', motivo: 'STALE_SITEMAP; RSS WP 10 items hoy' },
  { medio_id: 'MED-0018', rss_url: 'https://reporte18.com/feed/', motivo: 'STALE_SITEMAP; RSS WP 10 items hoy' },
  { medio_id: 'MED-0022', rss_url: 'https://potosinoticias.com/feed/', motivo: 'STALE_SITEMAP; RSS WP 10 items hoy' },
  { medio_id: 'MED-0108', rss_url: 'https://noticiaslapaz.news/feed/', motivo: 'sin_fuente sitemap; RSS WP 12 items ~2d' },
  { medio_id: 'MED-0101', rss_url: 'https://www.diarioelindependiente.mx/feed/', motivo: 'LOW_VOLUME falso; RSS 828 items hoy' },
  { medio_id: 'MED-0116', rss_url: 'https://traficozmg.com/feed/', motivo: 'LOW_VOLUME falso; RSS 29 items hoy' },
  { medio_id: 'MED-0009', rss_url: 'https://www.alcancediario.mx/feed/', motivo: 'LOW_VOLUME falso; RSS 10 items hoy' },
];

async function main() {
  const dry = process.argv.includes('--dry');
  const sb = getSupabase();
  const ids = WAVE06_RSS_PATCHES.map((p) => p.medio_id);
  const { data: antes, error } = await sb
    .from('medios')
    .select('medio_id, nombre_medio, metodo_extraccion, rss_url, sitemap_url, activo')
    .in('medio_id', ids);
  if (error) throw new Error(error.message);
  console.log('ANTES', JSON.stringify(antes, null, 2));
  if (dry) {
    console.log(`--dry: ${WAVE06_RSS_PATCHES.length} patches RSS. Sin escritura.`);
    return;
  }
  for (const p of WAVE06_RSS_PATCHES) {
    const { error: up } = await sb
      .from('medios')
      .update({ metodo_extraccion: 'RSS', rss_url: p.rss_url })
      .eq('medio_id', p.medio_id);
    if (up) throw new Error(`${p.medio_id}: ${up.message}`);
    console.log(`OK ${p.medio_id} → ${p.rss_url}`);
  }
  const { data: despues } = await sb
    .from('medios')
    .select('medio_id, nombre_medio, metodo_extraccion, rss_url, sitemap_url, activo')
    .in('medio_id', ids)
    .order('medio_id');
  console.log('DESPUES', JSON.stringify(despues, null, 2));
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
