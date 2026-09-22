/**
 * Repara la fuente de Punto MX (MED-0063) — Media Scale Sprint 06.
 *
 * El sitemap index configurado (`https://punto.mx/sitemap.xml`) resuelve a
 * artículos de 2024-04-04 sin título ni cuerpo. Verificado en vivo:
 * `https://punto.mx/feed/` responde HTTP 200, RSS WordPress con 10 notas
 * actuales y títulos reales. Formato ya soportado por el parser RSS.
 *
 * SOLO actualiza `metodo_extraccion` y `rss_url` de MED-0063. Conserva
 * `sitemap_url`. No toca ningún otro medio.
 *
 * Uso:
 *   npx tsx scripts/repair-punto-mx-source.ts --dry
 *   npx tsx scripts/repair-punto-mx-source.ts
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { getSupabase } from '../src/supabase/client.js';

const MEDIO_ID = 'MED-0063';
const RSS = 'https://punto.mx/feed/';

async function main() {
  const dry = process.argv.includes('--dry');
  const sb = getSupabase();

  const { data: antes, error: errAntes } = await sb
    .from('medios')
    .select('medio_id, nombre_medio, metodo_extraccion, rss_url, sitemap_url, activo, ultimo_estado, ultimo_error')
    .eq('medio_id', MEDIO_ID)
    .single();
  if (errAntes) {
    console.error(errAntes.message);
    process.exit(1);
  }
  console.log('Antes:', JSON.stringify(antes, null, 2));

  if (dry) {
    console.log(`--dry: se cambiaría metodo_extraccion=RSS rss_url=${RSS}. No se escribió nada.`);
    return;
  }

  const { error } = await sb
    .from('medios')
    .update({ metodo_extraccion: 'RSS', rss_url: RSS })
    .eq('medio_id', MEDIO_ID);
  if (error) {
    console.error(error.message);
    process.exit(1);
  }

  const { data: despues } = await sb
    .from('medios')
    .select('medio_id, nombre_medio, metodo_extraccion, rss_url, sitemap_url, activo, ultimo_estado, ultimo_error')
    .eq('medio_id', MEDIO_ID)
    .single();
  console.log('Después (read-back):', JSON.stringify(despues, null, 2));
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

export { MEDIO_ID, RSS };
