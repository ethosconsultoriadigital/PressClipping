/**
 * Child sintético para BVR-1B-WIRING-001.
 * Emite crawl_media_summary / enrich_media_summary por el logger real.
 * Sin red, sin News Lake. El formato (pretty vs JSON) lo decide LOG_FORMAT.
 */
import { buildCrawlMediaSummaryLogPayload } from '../../src/crawlers/index.js';
import { buildEnrichMediaSummaryLogPayload } from '../../src/enrichers/enrichNews.js';
import { logger } from '../../src/utils/logger.js';

function arg(name: string, fallback?: string): string {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  if (!found) {
    if (fallback !== undefined) return fallback;
    throw new Error(`falta --${name}=`);
  }
  return found.slice(prefix.length);
}

const kind = arg('kind');
const medioId = arg('medio-id');
const inserted = Number(arg('inserted', '2'));
const duplicates = Number(arg('duplicates', '1'));
const processed = Number(arg('processed', String(inserted)));

if (!Number.isFinite(inserted) || !Number.isFinite(duplicates) || !Number.isFinite(processed)) {
  throw new Error('inserted/duplicates/processed deben ser numéricos');
}

if (kind === 'crawl') {
  logger.info(
    buildCrawlMediaSummaryLogPayload({
      medioId,
      status: 'ok',
      sourceMethod: 'rss',
      detected: inserted + duplicates,
      items: inserted + duplicates,
      inserted,
      duplicates,
      promotedDiagnostic: 0,
      terminalErrorMessage: null,
    }),
    `Crawl media summary: ${medioId}`,
  );
} else if (kind === 'enrich') {
  logger.info(
    buildEnrichMediaSummaryLogPayload(
      {
        medio_id: medioId,
        requested: true,
        processed,
        updated: processed,
        unchanged: 0,
        failed: 0,
        clean_text_count: processed,
        body_count: processed,
      },
      { dryRun: false },
    ),
    `Enrich por medio completado: ${medioId}`,
  );
} else {
  throw new Error(`kind desconocido: ${kind}`);
}
