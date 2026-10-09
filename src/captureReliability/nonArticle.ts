/**
 * Recovery / News Lake non-article classifier.
 * URL shape first; title/body only as combined signals. Never title==site-name alone.
 */
export const NON_ARTICLE_REASONS = [
  'NON_ARTICLE_CATEGORY',
  'NON_ARTICLE_AUTHOR_HUB',
  'NON_ARTICLE_TEMPLATE',
  'NON_ARTICLE_DIRECTORY',
  'NON_ARTICLE_PRINT_COVER',
  'NON_ARTICLE_GENERIC_LISTING',
  'NON_ARTICLE_LOGIN_PAGE',
  'NON_ARTICLE_INVENTORY',
] as const;

export type NonArticleReason = (typeof NON_ARTICLE_REASONS)[number];

export interface NonArticleInput {
  url: string;
  titulo?: string | null;
  body?: string | null;
  siteName?: string | null;
  section?: string | null;
}

export interface NonArticleVerdict {
  nonArticle: boolean;
  reason: NonArticleReason | null;
}

const TAXONOMY_SEG = /^(categoria|categorias|category|categories|tag|tags|etiqueta|etiquetas)$/i;
const AUTHOR_SEG = /^(author|authors|autor|autores|columnista|columnistas|colaborador|colaboradores)$/i;
const DIRECTORY_SEG =
  /^(people-companies|people|companies|directorio|directorio-de|staff|equipo|contributors|authors)$/i;
const TEMPLATE_SEG = /^(tdb_templates|wp-templates|templates|template)$/i;
const PRINT_COVER_SEG = /^(portadas?-impresas?|edicion-impresa|version-impresa|impreso)$/i;
const NAME_STOP = new Set([
  'sobre',
  'para',
  'desde',
  'entre',
  'como',
  'cuando',
  'despues',
  'ante',
  'tras',
  'contra',
  'hacia',
  'segun',
  'porque',
  'aunque',
  'esta',
  'este',
  'esto',
  'una',
  'uno',
  'los',
  'las',
  'del',
  'por',
  'con',
  'sin',
  'que',
  'the',
  'and',
  'editoriales',
  'editorial',
  'columnas',
  'columna',
]);

function segsOf(url: string): string[] | null {
  try {
    return new URL(url).pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  } catch {
    return null;
  }
}

function looksLikePersonNameSlug(slug: string): boolean {
  const parts = slug.toLowerCase().split('-').filter(Boolean);
  if (parts.length < 2 || parts.length > 4) return false;
  if (parts.some((p) => /\d/.test(p) || p.length < 2 || p.length > 14)) return false;
  if (parts.some((p) => NAME_STOP.has(p))) return false;
  return parts.every((p) => /^[a-záéíóúüñ]+$/i.test(p));
}

function looksLikeArticleSlug(slug: string): boolean {
  if (/20\d{2}/.test(slug)) return true;
  const parts = slug.split('-').filter(Boolean);
  if (parts.length >= 5) return true;
  if (slug.length >= 48) return true;
  return false;
}

function titleLooksTemplate(titulo: string | null | undefined): boolean {
  const t = (titulo ?? '').trim();
  if (!t) return false;
  return /header\s*template/i.test(t) || /default\s*pro/i.test(t) || /^template\b/i.test(t);
}

const WEEKDAY_TOKEN = 'lunes|martes|miercoles|jueves|viernes|sabado|domingo';
const MONTH_TOKEN =
  'enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre';

function foldPrintCoverText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

const COMPACT_COVER_DATE = /\d{1,2}[-./]\d{1,2}[-./](?:\d{2}|\d{4})\b/;
const PRINT_COVER_SLUG_PREFIX =
  /^(?:la-|las-)?portadas?(?:-impresas?)?(?:-|$)|^(?:las?-)?primeras?-planas?(?:-|$)|^tapa-(?:del-)?dia(?:-|$)/;

function hasDailyCoverDate(value: string): boolean {
  const s = foldPrintCoverText(value);
  if (new RegExp(`(?:${WEEKDAY_TOKEN}).*(?:${MONTH_TOKEN})`).test(s)) return true;
  if (new RegExp(`(?:${WEEKDAY_TOKEN})-\\d{1,2}`).test(s)) return true;
  if (/20\d{2}-\d{2}-\d{2}/.test(s)) return true;
  if (new RegExp(`\\d{1,2}-de-(?:${MONTH_TOKEN})(?:-20\\d{2})?`).test(s)) return true;
  if (COMPACT_COVER_DATE.test(s)) return true;
  return false;
}

function titleLooksPrintCover(titulo: string | null | undefined): boolean {
  const t = foldPrintCoverText((titulo ?? '').trim());
  if (!t) return false;
  if (!/^(la\s+|las\s+)?(portadas?|primeras?\s+planas?|tapa(\s+del\s+dia)?)\b/.test(t)) return false;
  return (
    new RegExp(`(?:impresa|${WEEKDAY_TOKEN}|${MONTH_TOKEN}|20\\d{2})`).test(t) || COMPACT_COVER_DATE.test(t)
  );
}

function sectionLooksPrintCover(section: string | null | undefined): boolean {
  const s = foldPrintCoverText((section ?? '').trim());
  return /^(primeras?\s+planas?|portadas?(\s+impresas?)?|edicion\s+impresa|tapa)$/.test(s);
}

function textLooksPrintCoverEdition(...parts: Array<string | null | undefined>): boolean {
  const t = foldPrintCoverText(parts.filter(Boolean).join(' '));
  if (!t) return false;
  const coverWord = /portadas?|primeras?\s+planas?|tapa/.test(t);
  const edition = /edicion\s+impresa|version\s+impresa|primeras?\s+planas?|descarga/.test(t);
  return coverWord && edition && hasDailyCoverDate(t.replace(/\s+/g, '-'));
}

/** Daily print/digital cover slug. Does not treat /portada/<article-slug> as a cover. */
export function lastSlugIsDailyPrintCover(slug: string): boolean {
  const s = foldPrintCoverText(slug).replace(/\/+$/, '');
  if (!PRINT_COVER_SLUG_PREFIX.test(s)) return false;
  if (hasDailyCoverDate(s)) return true;
  const rest = s.replace(/^(?:la-|las-)?/, '');
  return /^(portadas?-impresas?|primeras?-planas?)$/.test(rest);
}

function titleMatchesSiteName(titulo: string | null | undefined, url: string, siteName?: string | null): boolean {
  const t = (titulo ?? '').trim().toLowerCase();
  if (t.length < 4) return false;
  if (siteName && t === siteName.trim().toLowerCase()) return true;
  try {
    const host = new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
    const brand = host.replace(/\.(com|mx|net|org|me|info)(\.[a-z]{2})?$/i, '').replace(/[-.]/g, '');
    const compact = t.replace(/[^a-záéíóúüñ0-9]/gi, '').toLowerCase();
    return compact.length >= 8 && compact === brand;
  } catch {
    return false;
  }
}

export function classifyNonArticle(input: NonArticleInput): NonArticleVerdict {
  const segs = segsOf(input.url);
  if (!segs) return { nonArticle: false, reason: null };
  const lower = segs.map((s) => s.toLowerCase());
  const joined = `/${lower.join('/')}/`;
  const last = lower.at(-1) ?? '';
  const titulo = input.titulo ?? null;

  if (lower.some((s) => /^(login|signin|sign-in|iniciar-sesion|acceso|suscripcion|subscribe)$/i.test(s))) {
    return { nonArticle: true, reason: 'NON_ARTICLE_LOGIN_PAGE' };
  }
  if (/inventario-de-seminuevos|vehiculo-no-encontrado|vehicle-not-found/i.test(joined)) {
    return { nonArticle: true, reason: 'NON_ARTICLE_INVENTORY' };
  }
  if (/veh[ií]culo no encontrado/i.test(titulo ?? '')) {
    return { nonArticle: true, reason: 'NON_ARTICLE_INVENTORY' };
  }
  if (/seminuevos autoexplora/i.test(titulo ?? '') && /inventario|seminuevos/i.test(joined)) {
    return { nonArticle: true, reason: 'NON_ARTICLE_INVENTORY' };
  }

  if (lower.some((s) => TEMPLATE_SEG.test(s)) || /tdb_templates|wp-template/i.test(joined)) {
    return { nonArticle: true, reason: 'NON_ARTICLE_TEMPLATE' };
  }
  if (titleLooksTemplate(titulo) && (lower.some((s) => TEMPLATE_SEG.test(s)) || /template/i.test(joined))) {
    return { nonArticle: true, reason: 'NON_ARTICLE_TEMPLATE' };
  }

  if (lower.some((s) => PRINT_COVER_SEG.test(s)) || /portada-impresa|edicion-impresa|version-impresa/i.test(joined)) {
    return { nonArticle: true, reason: 'NON_ARTICLE_PRINT_COVER' };
  }
  if (lastSlugIsDailyPrintCover(last)) {
    return { nonArticle: true, reason: 'NON_ARTICLE_PRINT_COVER' };
  }
  const coverPath = /portadas?|primeras?-planas?|impresa|tapa/i.test(joined);
  if (titleLooksPrintCover(titulo) && coverPath && !looksLikeArticleSlug(last)) {
    return { nonArticle: true, reason: 'NON_ARTICLE_PRINT_COVER' };
  }
  if (
    !looksLikeArticleSlug(last) &&
    coverPath &&
    (sectionLooksPrintCover(input.section) || textLooksPrintCoverEdition(titulo, input.body, input.section)) &&
    (titleLooksPrintCover(titulo) || PRINT_COVER_SLUG_PREFIX.test(foldPrintCoverText(last)) || sectionLooksPrintCover(input.section))
  ) {
    return { nonArticle: true, reason: 'NON_ARTICLE_PRINT_COVER' };
  }

  if (lower.some((s) => DIRECTORY_SEG.test(s))) {
    const dirIdx = lower.findIndex((s) => DIRECTORY_SEG.test(s));
    const after = lower.slice(dirIdx + 1);
    if (after.length <= 2 && !after.some(looksLikeArticleSlug)) {
      return { nonArticle: true, reason: 'NON_ARTICLE_DIRECTORY' };
    }
  }

  const taxIdx = lower.findIndex((s) => TAXONOMY_SEG.test(s));
  if (taxIdx >= 0) {
    const after = lower.slice(taxIdx + 1);
    if (after.length === 0 || (after.length <= 2 && !after.some(looksLikeArticleSlug))) {
      return { nonArticle: true, reason: 'NON_ARTICLE_CATEGORY' };
    }
  }

  const authIdx = lower.findIndex((s) => AUTHOR_SEG.test(s));
  if (authIdx >= 0) {
    const after = lower.slice(authIdx + 1);
    if (after.length <= 1 && !after.some(looksLikeArticleSlug)) {
      return { nonArticle: true, reason: 'NON_ARTICLE_AUTHOR_HUB' };
    }
  }

  // /seccion/opinion/{person-name} — columnist archive, not /opinion/editoriales/article
  if (lower[0] === 'seccion' && (lower[1] === 'opinion' || lower[1] === 'columna' || lower[1] === 'columnas')) {
    if (lower.length === 2) {
      return { nonArticle: true, reason: 'NON_ARTICLE_GENERIC_LISTING' };
    }
    if (lower.length === 3 && looksLikePersonNameSlug(last) && !looksLikeArticleSlug(last)) {
      return { nonArticle: true, reason: 'NON_ARTICLE_AUTHOR_HUB' };
    }
  }

  if (
    titleMatchesSiteName(titulo, input.url, input.siteName) &&
    (taxIdx >= 0 || authIdx >= 0 || lower[0] === 'seccion' || titleLooksTemplate(titulo))
  ) {
    if (!looksLikeArticleSlug(last)) {
      return { nonArticle: true, reason: 'NON_ARTICLE_AUTHOR_HUB' };
    }
  }

  return { nonArticle: false, reason: null };
}

export function isNonArticleReason(reason: string | null | undefined): reason is NonArticleReason {
  return NON_ARTICLE_REASONS.includes(reason as NonArticleReason);
}
