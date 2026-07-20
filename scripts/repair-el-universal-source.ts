/**
 * Repara la fuente de El Universal (MED-0011) — lote NATIONAL MEDIA COVERAGE
 * RAMP (2026-07-20). El sitemap.xml configurado (`/sitemap.xml`) devuelve 404
 * desde hace semanas (`ultimo_error: "HTTP 404 en sitemap principal"`).
 * Verificado en vivo: `robots.txt` expone el feed real de Arc Publishing
 * (`/arc/outboundfeeds/news/?outputType=xml`) — HTTP 200, artículos reales del
 * mismo día, formato Google News estándar (ya soportado por el parser).
 *
 * SOLO actualiza `sitemap_url` y `activo` de MED-0011 (estaba `activo=false`,
 * desactivado cuando el 404 se volvió persistente). No toca ningún otro medio.
 *
 * Uso:
 *   npm run repair-el-universal-source -- --dry
 *   npm run repair-el-universal-source
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { getSupabase } from '../src/supabase/client.js';

const MEDIO_ID = 'MED-0011';
const NUEVO_SITEMAP = 'https://www.eluniversal.com.mx/arc/outboundfeeds/news/?outputType=xml';

async function main() {
  const dry = process.argv.includes('--dry');
  const sb = getSupabase();

  const { data: antes, error: errAntes } = await sb.from('medios').select('medio_id, nombre_medio, sitemap_url, activo, ultimo_estado, ultimo_error').eq('medio_id', MEDIO_ID).single();
  if (errAntes) { console.error(errAntes.message); process.exit(1); }
  console.log('Antes:', JSON.stringify(antes, null, 2));

  if (dry) {
    console.log(`--dry: se cambiaría sitemap_url a ${NUEVO_SITEMAP} y activo=true. No se escribió nada.`);
    return;
  }

  const { error } = await sb.from('medios').update({ sitemap_url: NUEVO_SITEMAP, activo: true }).eq('medio_id', MEDIO_ID);
  if (error) { console.error(error.message); process.exit(1); }

  const { data: despues } = await sb.from('medios').select('medio_id, nombre_medio, sitemap_url, activo, ultimo_estado, ultimo_error').eq('medio_id', MEDIO_ID).single();
  console.log('Después (read-back):', JSON.stringify(despues, null, 2));
}

function esEntrypointCli(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (esEntrypointCli()) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

export { MEDIO_ID, NUEVO_SITEMAP };
