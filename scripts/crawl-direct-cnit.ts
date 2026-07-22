/**
 * Extractor DIRECT para CNIT (Cámara Nacional de la Industria Tequilera,
 * cnit.org.mx) — lote "OFFICIAL SOURCES + DIRECT EXTRACTORS" (2026-07-20).
 *
 * CNIT tiene un blog público real (comunicados, sustentabilidad, denominación
 * de origen — muy relevante para Patrón) pero SIN sitemap/RSS descubrible
 * (ver docs/NATIONAL_MEDIA_ACCESS_MATRIX.md §2). Este script implementa el
 * caso "B_PUBLICO_DIRECT": lee la página pública de listado del blog, extrae
 * los links a notas, y para cada URL NUEVA (dedup contra `noticias` antes de
 * fetch) descarga y extrae con el mismo extractor HTML que usa el resto del
 * pipeline (`fetchAndExtract`) — NO reinventa el extractor, solo la fuente de
 * descubrimiento.
 *
 * Reglas respetadas (no scraping agresivo):
 *   - Solo la página pública principal del blog (`/blog`), sin paginar más.
 *   - Máximo `--limit` (default 10) notas NUEVAS por corrida.
 *   - Dedup por URL ANTES de descargar el artículo (nunca re-fetch de una
 *     nota ya conocida).
 *   - Sin proxy, sin Playwright, sin bypass — un único fetch de texto plano.
 *   - Nunca lanza: un artículo roto se cuenta como fallido y se sigue.
 *
 * Uso:
 *   npm run crawl-direct-cnit -- --dry-run
 *   npm run crawl-direct-cnit -- --limit=10
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

const MEDIO_ID = 'MED-0188';
const BLOG_URL = 'https://cnit.org.mx/blog';
const URL_PATTERN = /href="(https:\/\/cnit\.org\.mx\/blog\/[a-z0-9-]+)"/g;

function parseArgs(argv: string[]): { dryRun: boolean; limit: number } {
  let limit = 10;
  let dryRun = false;
  for (const arg of argv) {
    if (arg === '--dry-run') dryRun = true;
    if (arg.startsWith('--limit=')) limit = Number(arg.split('=')[1]) || limit;
  }
  return { dryRun, limit };
}

/** Extrae URLs de nota únicas del listado del blog (sin paginar, sin duplicados). */
function extraerUrlsDelListado(html: string): string[] {
  const urls = new Set<string>();
  for (const m of html.matchAll(URL_PATTERN)) {
    if (m[1]) urls.add(m[1]);
  }
  return [...urls];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sb = getSupabase();
  logger.info({ medio_id: MEDIO_ID, dryRun: args.dryRun, limit: args.limit }, 'Iniciando crawl-direct-cnit (SOLO fuente pública, sin proxy/JS)');

  const html = await fetchText(BLOG_URL);
  const urlsListado = extraerUrlsDelListado(html);
  logger.info({ detectadas: urlsListado.length }, 'URLs detectadas en el listado del blog');

  // Dedup ANTES de descargar: nunca re-fetch de una URL ya conocida.
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
    if (!extracto.ok) { fallidas += 1; logger.warn({ url, error: extracto.error }, 'Extracción fallida, se omite'); continue; }
    const item = normalizeNoticia(
      { url, titulo: extracto.titulo, resumen: extracto.resumen, autor: extracto.autor, seccion: extracto.seccion, imagen: extracto.imagen },
      { medio_id: MEDIO_ID, fuente: 'direct', pais: 'MX', estado: 'Jalisco', municipio: null },
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
  logger.info(resultado, 'Ingesta completada (metadata)');

  // Segundo paso: aplicar texto limpio/cuerpo con el mismo extracto ya descargado
  // (evita un segundo fetch — el "enrich" de este DIRECT es parte del mismo ciclo).
  const { data: insertadas } = await sb
    .from('noticias')
    .select('noticia_id, url_original, titulo, resumen, texto_extraido, autor, seccion, imagen_principal, texto_nota_limpia, extracto_nota_1300, calidad_extraccion, texto_limpio_chars, texto_cuerpo_nota, extracto_cuerpo_1300, cuerpo_nota_chars, tipo_nota')
    .eq('medio_id', MEDIO_ID)
    .in('url_original', nuevas);

  let enriquecidas = 0;
  for (const row of (insertadas ?? []) as NoticiaEnriquecibleRow[]) {
    const extracto = extractos.get(row.url_original ?? '');
    if (!extracto || !extracto.ok) continue;
    const { fields, campos } = construirActualizacion(row, extracto, {});
    if (campos.length === 0) continue;
    try {
      await updateNoticiaEnriquecida(row.noticia_id, fields);
      enriquecidas += 1;
    } catch (err) {
      logger.warn({ noticia_id: row.noticia_id, error: err instanceof Error ? err.message : String(err) }, 'No se pudo aplicar texto limpio (aislado, no detiene el resto)');
    }
  }

  logger.info({ enriquecidas }, '=== crawl-direct-cnit completado ===');
}

function esEntrypointCli(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (esEntrypointCli()) {
  main().catch((e) => { logger.error(e, 'Error fatal en crawl-direct-cnit'); process.exit(1); });
}

export { parseArgs, extraerUrlsDelListado, MEDIO_ID, BLOG_URL };
