import { shouldRejectCrawlUrl } from '../crawlers/urlFilters.js';
import { isGenericListing, isHomepage } from '../mediaValidation/certScore.js';
import { classifyNonArticle, isNonArticleReason, type NonArticleReason } from './nonArticle.js';

export interface AdmissionInput {
  url: string;
  medioId: string | null;
  titulo?: string | null;
  resumen?: string | null;
  body?: string | null;
  publishedAt?: string | null;
  hasStructuredData?: boolean;
  siteName?: string | null;
}

export interface AdmissionResult {
  admit: boolean;
  reason: string;
}

export { isNonArticleReason };
export type { NonArticleReason };

export function isNonArticleAdmission(reason: string | null | undefined): boolean {
  return isNonArticleReason(reason) || reason === 'homepage' || reason === 'listing_hub' || reason === 'taxonomy_or_search';
}

export const AUTH_WALL_EXTRACT = 'AUTH_WALL_EXTRACT';
export const SOFT_404_EXTRACT = 'SOFT_404_EXTRACT';

export function extractLooksLikeAuthWall(titulo?: string | null, body?: string | null): boolean {
  const t = (titulo ?? '').trim();
  if (!t) return false;
  if (/^login(\s+grupo\s+reforma)?$/i.test(t)) return true;
  if (/^(iniciar\s+sesi[oó]n|sign\s*in|acceso\s+suscriptores)$/i.test(t)) return true;
  const b = (body ?? '').trim();
  return /login grupo reforma/i.test(t) && b.length < 400;
}

export function extractLooksLikeSoft404(titulo?: string | null, url?: string | null): boolean {
  const t = (titulo ?? '').trim();
  if (/veh[ií]culo no encontrado/i.test(t)) return true;
  if (/seminuevos autoexplora/i.test(t) && /inventario-de-seminuevos/i.test(url ?? '')) return true;
  return false;
}

function pathLooksLikeArticle(url: string): boolean {
  try {
    const p = new URL(url).pathname.replace(/\/+$/, '');
    if (/\/20\d{2}\/\d{2}\/\d{2}\//.test(p)) return true;
    if (/\/noticia\/\d+/i.test(p)) return true;
    if (/\/p\/[a-z0-9]{3,}/i.test(p)) return true;
    const segs = p.split('/').filter(Boolean);
    if (segs.length >= 2 && (segs.at(-1)?.length ?? 0) >= 8) return true;
    if (segs.length === 1 && segs[0] && segs[0].length > 12 && !/^(tag|category|author|seccion|tema|search|archivo)$/i.test(segs[0])) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

const TRUSTED_DISCOVERY = /rss|sitemap|gap|google|auditor|listing|section/i;

const OBVIOUS_REJECT = new Set([
  'homepage',
  'listing_hub',
  'taxonomy_or_search',
  'host_filter_non_article',
  'malformed_url',
  'NON_ARTICLE_CATEGORY',
  'NON_ARTICLE_AUTHOR_HUB',
  'NON_ARTICLE_TEMPLATE',
  'NON_ARTICLE_DIRECTORY',
  'NON_ARTICLE_PRINT_COVER',
  'NON_ARTICLE_GENERIC_LISTING',
  'NON_ARTICLE_LOGIN_PAGE',
  'NON_ARTICLE_INVENTORY',
]);

export function classifyPreFetch(input: AdmissionInput, discoveredVia: string): {
  disposition: 'ADMIT' | 'REJECT' | 'FETCH_TO_CLASSIFY';
  reason: string;
} {
  const admission = admitDiscoveredArticle(input);
  if (admission.admit) return { disposition: 'ADMIT', reason: admission.reason };
  if (OBVIOUS_REJECT.has(admission.reason)) return { disposition: 'REJECT', reason: admission.reason };
  if (TRUSTED_DISCOVERY.test(discoveredVia)) {
    return { disposition: 'FETCH_TO_CLASSIFY', reason: admission.reason };
  }
  return { disposition: 'FETCH_TO_CLASSIFY', reason: admission.reason };
}

export function admitDiscoveredArticle(input: AdmissionInput): AdmissionResult {
  const url = input.url;
  try {
    new URL(url);
  } catch {
    return { admit: false, reason: 'malformed_url' };
  }
  if (input.medioId && shouldRejectCrawlUrl(input.medioId, url)) {
    return { admit: false, reason: 'host_filter_non_article' };
  }
  if (isHomepage(url)) return { admit: false, reason: 'homepage' };

  const nonArticle = classifyNonArticle({
    url,
    titulo: input.titulo,
    body: input.body,
    siteName: input.siteName,
  });
  if (nonArticle.nonArticle && nonArticle.reason) {
    return { admit: false, reason: nonArticle.reason };
  }

  if (isGenericListing(url)) return { admit: false, reason: 'NON_ARTICLE_GENERIC_LISTING' };
  try {
    const path = new URL(url).pathname;
    if (/\/(tag|tags|category|categoria|author|autor|etiqueta|archivo|search|busca)(\/|$)/i.test(path)) {
      return { admit: false, reason: 'NON_ARTICLE_CATEGORY' };
    }
  } catch {
    return { admit: false, reason: 'malformed_url' };
  }

  if (extractLooksLikeSoft404(input.titulo, url)) {
    return { admit: false, reason: 'NON_ARTICLE_INVENTORY' };
  }
  if (extractLooksLikeAuthWall(input.titulo, input.body)) {
    return { admit: false, reason: AUTH_WALL_EXTRACT };
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
