/**
 * Elegibilidad de artículo para certificación operativa.
 *
 * Reutiliza el filtro oficial de captura (`shouldRejectCrawlUrl`). Una URL que
 * el crawler ya no ingestaría (hub, tag, print, cartoon, autor) no puede
 * degradar usable/listing/clone del medio.
 */
import { shouldRejectCrawlUrl } from '../crawlers/urlFilters.js';

export function isNonArticleUrl(medioId: string, url: string | null | undefined): boolean {
  if (!url) return false;
  return shouldRejectCrawlUrl(medioId, url);
}

export function eligibleArticleNotes<T extends { url_original: string | null }>(
  medioId: string,
  notes: readonly T[],
): { eligible: T[]; rejected: T[] } {
  const eligible: T[] = [];
  const rejected: T[] = [];
  for (const n of notes) {
    if (isNonArticleUrl(medioId, n.url_original)) rejected.push(n);
    else eligible.push(n);
  }
  return { eligible, rejected };
}
