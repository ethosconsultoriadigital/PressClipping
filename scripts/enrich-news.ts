/**
 * Enriquecimiento de noticias: visita la URL de cada noticia y completa los
 * campos faltantes (título, resumen, texto, imagen, autor, sección).
 *
 * Pensado para reparar filas creadas desde sitemap (solo loc/lastmod) que
 * quedaron sin contenido útil. NO exporta a Sheets, NO toca exportado_sheet_raw
 * y NO dispara detección de menciones, IA ni alertas.
 *
 * Uso:
 *   npm run enrich-news -- --dry-run                              # plan, no escribe
 *   npm run enrich-news -- --limit=20 --only-missing-title        # solo sin título
 *   npm run enrich-news -- --limit=20 --only-missing-text         # solo sin texto
 *   npm run enrich-news -- --limit=20 --only-missing-clean-text   # sin texto_nota_limpia
 *   npm run enrich-news -- --limit=20 --only-missing-body-text    # sin texto_cuerpo_nota
 *   npm run enrich-news -- --limit=50 --only-pending-mentions --only-missing-clean-text --dry-run
 *   npm run enrich-news -- --url=https://medio.mx/nota/x          # diagnóstico 1 URL
 *   npm run enrich-news -- --url=https://medio.mx/nota/x --dry-run
 *
 * En modo --url NUNCA escribe en Supabase: solo descarga y muestra lo extraído.
 */
import {
  getNoticiasParaEnriquecer,
  updateNoticiaEnriquecida,
} from '../src/supabase/repositories.js';
import {
  enrichNews,
  type EnrichOpts,
  type EnrichDeps,
} from '../src/enrichers/enrichNews.js';
import { fetchAndExtract } from '../src/extractors/html.js';
import { logger } from '../src/utils/logger.js';
import { parseIntOrNull } from '../src/utils/parse.js';

interface EnrichArgs extends EnrichOpts {
  /** Modo diagnóstico: extrae una sola URL sin tocar Supabase. */
  url?: string;
  timeoutMs?: number;
}

function parseArgs(argv: string[]): EnrichArgs {
  const out: EnrichArgs = { dryRun: false };
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    const key = eq === -1 ? body : body.slice(0, eq);
    const value = eq === -1 ? '' : body.slice(eq + 1);

    switch (key) {
      case 'dry-run':
        out.dryRun = true;
        break;
      case 'only-missing-title':
        out.onlyMissingTitle = true;
        break;
      case 'only-missing-text':
        out.onlyMissingText = true;
        break;
      case 'only-missing-clean-text':
        out.onlyMissingCleanText = true;
        break;
      case 'only-missing-body-text':
        out.onlyMissingBodyText = true;
        break;
      case 'only-pending-mentions':
        out.onlyPendingMentions = true;
        break;
      case 'limit':
        out.limit = parseIntOrNull(value) ?? undefined;
        break;
      case 'max-chars':
        out.maxChars = parseIntOrNull(value) ?? undefined;
        break;
      case 'timeout':
        out.timeoutMs = parseIntOrNull(value) ?? undefined;
        break;
      case 'url':
        out.url = value || undefined;
        break;
      default:
        logger.warn({ flag: arg }, 'Flag desconocido ignorado');
    }
  }
  return out;
}

/** Modo diagnóstico de una sola URL: descarga, extrae y muestra. No escribe. */
async function diagnosticarUrl(url: string, args: EnrichArgs): Promise<void> {
  logger.info({ url }, 'Diagnóstico de URL (no escribe en Supabase)');
  const extracto = await fetchAndExtract(url, {
    maxChars: args.maxChars,
    timeoutMs: args.timeoutMs,
  });
  logger.info(
    {
      ok: extracto.ok,
      error: extracto.error,
      metodo_titulo: extracto.metodo_titulo,
      metodo_texto: extracto.metodo_texto,
      titulo: extracto.titulo,
      resumen: extracto.resumen,
      autor: extracto.autor,
      seccion: extracto.seccion,
      imagen: extracto.imagen,
      texto_chars: extracto.texto_extraido?.length ?? 0,
      texto_preview: extracto.texto_extraido?.slice(0, 300) ?? null,
    },
    'Resultado de extracción (raw)',
  );
  logger.info(
    {
      calidad_extraccion: extracto.calidad_extraccion,
      texto_limpio_chars: extracto.texto_limpio_chars,
      extracto_1300_chars: extracto.extracto_nota_1300?.length ?? 0,
      texto_limpio_preview: extracto.texto_nota_limpia?.slice(0, 500) ?? null,
    },
    'Resultado de texto limpio',
  );
  logger.info(
    {
      tipo_nota: extracto.tipo_nota,
      cuerpo_nota_chars: extracto.cuerpo_nota_chars,
      extracto_cuerpo_chars: extracto.extracto_cuerpo_1300?.length ?? 0,
      cuerpo_preview: extracto.texto_cuerpo_nota?.slice(0, 400) ?? null,
    },
    'Resultado de cuerpo de nota',
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  logger.info(
    {
      dryRun: args.dryRun,
      limit: args.limit,
      onlyMissingTitle: args.onlyMissingTitle,
      onlyMissingText: args.onlyMissingText,
      onlyMissingCleanText: args.onlyMissingCleanText,
      onlyMissingBodyText: args.onlyMissingBodyText,
      onlyPendingMentions: args.onlyPendingMentions,
    },
    'Iniciando enrich-news',
  );

  if (args.url) {
    await diagnosticarUrl(args.url, args);
    return;
  }

  const deps: EnrichDeps = {
    fetchNoticias: getNoticiasParaEnriquecer,
    extract: (url) =>
      fetchAndExtract(url, { maxChars: args.maxChars, timeoutMs: args.timeoutMs }),
    updateNoticia: updateNoticiaEnriquecida,
  };

  const result = await enrichNews(deps, args);

  if (result.dryRun) {
    for (const d of result.detalle) {
      logger.info(
        {
          noticia_id: d.noticia_id,
          url: d.url,
          ok: d.ok,
          campos: d.campos_actualizados,
          marcadores: d.marcadores,
        },
        '[dry-run] Cambios que se aplicarían (no se escribió nada)',
      );
    }
    logger.info(
      {
        leidas: result.leidas,
        actualizarian: result.actualizadas,
        sinCambios: result.sinCambios,
        fallidas: result.fallidas,
        conTextoLimpio: result.conTextoLimpio,
        conCuerpoNota: result.conCuerpoNota,
      },
      '[dry-run] Resumen del enriquecimiento (no se escribió en Supabase)',
    );
    return;
  }

  logger.info(
    {
      leidas: result.leidas,
      actualizadas: result.actualizadas,
      sinCambios: result.sinCambios,
      fallidas: result.fallidas,
      conTextoLimpio: result.conTextoLimpio,
      conCuerpoNota: result.conCuerpoNota,
    },
    'Enriquecimiento de noticias completado.',
  );
}

main().catch((err) => {
  logger.error(err, 'Error fatal en enrich-news.');
  process.exit(1);
});
