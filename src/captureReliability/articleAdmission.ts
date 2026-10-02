import { shouldRejectCrawlUrl } from '../crawlers/urlFilters.js';
import { isGenericListing, isHomepage } from '../mediaValidation/certScore.js';

export interface AdmissionInput {
  url: string;
  medioId: string | null;
  titulo?: string | null;
  resumen?: string | null;
  body?: string | null;
  publishedAt?: string | null;
  hasStructuredData?: boolean;
}

export interface AdmissionResult {
  admit: boolean;
  reason: string;
}

function pathLooksLikeArticle(url: string): boolean {
  try {
    const p = new URL(url).pathname.replace(/\/+$/, '');
    if (/\/20\d{2}\/\d{2}\/\d{2}\//.test(p)) return true;
    const segs = p.split('/').filter(Boolean);
    if (segs.length >= 1 && segs[0] && segs[0].length > 12 && !/^(tag|category|author|seccion|tema)$/i.test(segs[0])) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function admitDiscoveredArticle(input: AdmissionInput): AdmissionResult {
  const url = input.url;
  if (input.medioId && shouldRejectCrawlUrl(input.medioId, url)) {
    return { admit: false, reason: 'host_filter_non_article' };
  }
  if (isHomepage(url)) return { admit: false, reason: 'homepage' };
  if (isGenericListing(url)) return { admit: false, reason: 'listing_hub' };
  try {
    const path = new URL(url).pathname;
    if (/\/(tag|category|author|etiqueta|archivo|search|busca)(\/|$)/i.test(path)) {
      return { admit: false, reason: 'taxonomy_or_search' };
    }
  } catch {
    return { admit: false, reason: 'malformed_url' };
  }

  const body = (input.body ?? '').trim();
  if (body.length >= 80) return { admit: true, reason: 'valid_body' };
  if (input.hasStructuredData && pathLooksLikeArticle(url)) return { admit: true, reason: 'structured_data_permalink' };
  if (input.publishedAt && pathLooksLikeArticle(url)) return { admit: true, reason: 'dated_permalink' };
  if (pathLooksLikeArticle(url)) return { admit: true, reason: 'permalink_pattern' };
  const titulo = (input.titulo ?? '').trim();
  if (titulo.length >= 8 && pathLooksLikeArticle(url)) return { admit: true, reason: 'title_and_permalink' };
  return { admit: false, reason: 'insufficient_article_signal' };
}
