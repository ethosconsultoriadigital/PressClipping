/**
 * Extractor DIRECT para La Silla Rota (lasillarota.com) — lote "NEWS LAKE 200 FINAL PUSH"
 * (2026-07-22).
 *
 * La Silla Rota es B_PUBLICO_DIRECT (P2 según readiness report: 9-11 menciones históricas,
 * alto valor). La homepage devuelve artículos en HTML estático con patrón de URL:
 *   https://lasillarota.com/SECCION/YYYY/M/DD/slug-ID.html  (absolutas)
 *
 * Reglas respetadas (no scraping agresivo):
 *   - Solo la homepage pública como fuente de descubrimiento.
 *   - Máximo `--limit` (default 10) notas NUEVAS por corrida.
 *   - Dedup por URL ANTES de descargar el artículo.
 *   - Sin proxy, sin Playwright, sin bypass.
 *   - Un artículo roto se cuenta como fallido y se sigue.
 *
 * ⚠ Nota de infraestructura: IPs de datacenter pueden recibir 403 de Cloudflare.
 * Verificado OK desde entorno local 2026-07-22.
 *
 * Uso:
 *   npm run crawl-direct-lasillarota -- --dry-run
 *   npm run crawl-direct-lasillarota -- --limit=10
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { getSupabase } from '../src/supabase/client.js';
import { ingestNoticias, updateNoticiaEnriquecida } from '../src/supabase/repositories.js';
import { normalizeNoticia, type NoticiaInsert } from '../src/normalizers/noticia.js';
import { fetchAndExtract } from '../src/extractors/html.js';
import { construirActualizacion, type NoticiaEnriquecibleRow } from '../src/enrichers/enrichNews.js';
import { fetchText } from '../src/utils/http.js';
import { logger } from '../src/utils/logger.js';

export const MEDIO_ID = 'MED-0191';
export const BASE_URL = 'https://lasillarota.com';
export const HOME_URL = 'https://lasillarota.com/';

// Artículos con fecha en ruta, ID numérico al final:
//   https://lasillarota.com/SECCION/YYYY/M/DD/slug-NUMERO.html
export const URL_PATTERN = /href="(https:\/\/lasillarota\.com\/[a-z][a-z0-9-]*\/20\d{2}\/\d{1,2}\/\d{1,2}\/[a-z0-9-]+-\d+\.html)"/g;

export function parseArgs(argv: string[]): { dryRun: boolean; limit: number } {
  let limit = 10;
  let dryRun = false;
  for (const arg of argv) {
    if (arg === '--dry-run') dryRun = true;
    if (arg.startsWith('--limit=')) limit = Number(arg.split('=')[1]) || limit;
  }
  return { dryRun, limit };
}

export function extraerUrlsDeHomepage(html: string): string[] {
  const urls = new Set<string>();
  for (const m of html.matchAll(URL_PATTERN)) {
    if (m[1]) urls.add(m[1]);
  }
  return [...urls];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sb = getSupabase();
  logger.info({ medio_id: MEDIO_ID, dryRun: args.dryRun, limit: args.limit }, 'Iniciando crawl-direct-lasillarota');

  const html = await fetchText(HOME_URL);
  const urlsListado = extraerUrlsDeHomepage(html);
  logger.info({ detectadas: urlsListado.length }, 'URLs detectadas en homepage');

  const { data: existentes } = await sb.from('noticias').select('url_original').eq('medio_id', MEDIO_ID);
  const yaConocidas = new Set((existentes ?? []).map((n: any) => n.url_original));
  const nuevas = urlsListado.filter((u) => !yaConocidas.has(u)).slice(0, args.limit);
  logger.info({ ya_conocidas: yaConocidas.size, nuevas: nuevas.length }, 'Dedup por URL completado');

  if (nuevas.length === 0) {
    logger.info({}, 'Sin URLs nuevas — nada que hacer.');
    return;
  }

  const items: NoticiaInsert[] = [];
  const extractos = new Map<string, Awaited<ReturnType<typeof fetchAndExtract>>>();
  let fallidas = 0;

  for (const url of nuevas) {
    const extracto = await fetchAndExtract(url);
    extractos.set(url, extracto);
    if (!extracto.ok) { fallidas += 1; logger.warn({ url, error: extracto.error }, 'Extracción fallida'); continue; }
    const item = normalizeNoticia(
      { url, titulo: extracto.titulo, resumen: extracto.resumen, autor: extracto.autor, seccion: extracto.seccion, imagen: extracto.imagen },
      { medio_id: MEDIO_ID, fuente: 'direct', pais: 'MX', estado: 'Nacional', municipio: null },
    );
    if (item) items.push(item);
  }

  logger.info({ items: items.length, fallidas }, 'Extracción completada');

  if (args.dryRun) {
    logger.info({}, '[dry-run] No se escribió nada en Supabase.');
    for (const item of items) logger.info({ url: item.url_original, titulo: item.titulo }, '[dry-run] Nota que se insertaría');
    return;
  }

  const resultado = await ingestNoticias(items);
  logger.info(resultado, 'Ingesta completada');

  const { data: insertadas } = await sb
    .from('noticias')
    .select('noticia_id, url_original, titulo, resumen, texto_extraido, autor, seccion, imagen_principal, texto_nota_limpia, extracto_nota_1300, calidad_extraccion, texto_limpio_chars, texto_cuerpo_nota, extracto_cuerpo_1300, cuerpo_nota_chars, tipo_nota')
    .eq('medio_id', MEDIO_ID)
    .in('url_original', nuevas);

  let enriquecidas = 0;
  for (const row of (insertadas ?? []) as NoticiaEnriquecibleRow[]) {
    const extracto = extractos.get(row.url_original ?? '');
    if (!extracto || !extracto.ok) continue;
    const { campos, fields } = construirActualizacion(row, extracto, {});
    if (campos.length === 0) continue;
    try {
      await updateNoticiaEnriquecida(row.noticia_id, fields);
      enriquecidas += 1;
    } catch (err) {
      logger.warn({ noticia_id: row.noticia_id, error: err instanceof Error ? err.message : String(err) }, 'No se pudo aplicar texto limpio');
    }
  }

  logger.info({ enriquecidas }, '=== crawl-direct-lasillarota completado ===');
}

function esEntrypointCli(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (esEntrypointCli()) {
  main().catch((e) => { logger.error(e, 'Error fatal en crawl-direct-lasillarota'); process.exit(1); });
}
