/**
 * Unified Matching V2 — campos de señal + cuerpo editorial confiable.
 *
 * texto_extraido RAW nunca dispara menciones productivas.
 * Fast Lane canary: MENTIONS_MASTER_BODY_V2 + allowlist por keyword.
 * Detector: DETECT_MENTIONS_BODY_V2 (independiente). BODY_MATCHING_V2 está deprecado.
 *
 * Matching productivo usa únicamente EDITORIAL_CONTENT. Bloques de
 * related / featured / navigation / share / listing se cortan antes de buscar.
 */
import { PESOS_CAMPO, type CampoBuscable } from '../matchers/keyword.js';
import { foldText } from '../matchers/text.js';

export type BodyTrustStatus =
  | 'BODY_TRUSTED'
  | 'BODY_FALLBACK_CLEAN'
  | 'BODY_REJECTED'
  | 'NO_BODY';

export type MatchingMode =
  | 'current'
  | 'body_high'
  | 'body_high_plus_clean'
  | 'body_with_proximity'
  | 'body_v4';

export type TemplateContentClass =
  | 'EDITORIAL_CONTENT'
  | 'RELATED_CONTENT'
  | 'FEATURED_CONTENT'
  | 'NAVIGATION_CONTENT'
  | 'PREVIOUS_NEXT_ARTICLE'
  | 'LISTING_CONTENT'
  | 'SHARE_WIDGET_CONTENT'
  | 'TEMPLATE_RELATED_CONTENT'
  | 'TEMPLATE_FEATURED_CONTENT'
  | 'LISTING_OR_TEMPLATE_CONTENT';

export const MIN_BODY_CHARS = 80;

/** Encabezados de recirculación. No cortan un uso casual en oración. */
const HEADING_MARKERS: Array<{ folded: string; classification: TemplateContentClass }> = [
  { folded: 'notas relacionadas', classification: 'TEMPLATE_RELATED_CONTENT' },
  { folded: 'noticias relacionadas', classification: 'TEMPLATE_RELATED_CONTENT' },
  { folded: 'tambien te puede interesar', classification: 'TEMPLATE_RELATED_CONTENT' },
  { folded: 'te puede interesar', classification: 'TEMPLATE_RELATED_CONTENT' },
  { folded: 'te recomendamos', classification: 'TEMPLATE_RELATED_CONTENT' },
  { folded: 'contenido relacionado', classification: 'TEMPLATE_RELATED_CONTENT' },
  { folded: 'mas noticias', classification: 'RELATED_CONTENT' },
  { folded: 'mas leidas', classification: 'RELATED_CONTENT' },
  { folded: 'lo mas visto', classification: 'RELATED_CONTENT' },
  { folded: 'sigue leyendo', classification: 'RELATED_CONTENT' },
  { folded: 'lee tambien', classification: 'TEMPLATE_RELATED_CONTENT' },
  { folded: 'ver mas notas', classification: 'RELATED_CONTENT' },
  { folded: 'articulo anterior', classification: 'PREVIOUS_NEXT_ARTICLE' },
  { folded: 'articulo siguiente', classification: 'PREVIOUS_NEXT_ARTICLE' },
  { folded: 'destacadas', classification: 'TEMPLATE_FEATURED_CONTENT' },
  { folded: 'compartir', classification: 'SHARE_WIDGET_CONTENT' },
];

const SOCIAL = '(?:facebook|twitter|instagram|pinterest|whatsapp|telegram|tiktok|\\bx\\b)';

export interface ContentLayers {
  titulo?: string | null;
  subtitulo?: string | null;
  resumen?: string | null;
  seccion?: string | null;
  texto_cuerpo_nota?: string | null;
  texto_nota_limpia?: string | null;
  texto_extraido?: string | null;
  calidad_extraccion?: string | null;
  url_original?: string | null;
  medio_id?: string | null;
}

export interface TrustedBody {
  status: BodyTrustStatus;
  text: string;
  campo: 'texto_cuerpo_nota' | 'texto_nota_limpia' | null;
  calidad: string | null;
  chars: number;
  contaminated: boolean;
}

export interface EditorialSegment {
  text: string;
  classification: TemplateContentClass;
  cutAt: number | null;
  cutReason: string | null;
}

/** @deprecated No usar para producción. Fast Lane usa MENTIONS_MASTER_BODY_V2. */
export function isBodyMatchingV2Enabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.BODY_MATCHING_V2 ?? '').trim().toLowerCase() === 'true';
}

function isLineStart(folded: string, index: number): boolean {
  if (index <= 0) return true;
  const prev = folded[index - 1];
  return prev === '\n' || prev === '\r' || prev === '|' || prev === ';';
}

function isHeadingBoundary(folded: string, index: number): boolean {
  if (isLineStart(folded, index)) return true;
  const prev = folded[index - 1] ?? '';
  return /[.!?:]/.test(prev);
}

function afterLooksLikeHeading(folded: string, end: number): boolean {
  const tail = folded.slice(end, end + 24);
  return /^(?:\s*$|\s*[:.\-–—]\s*|\s+[a-z0-9])/.test(tail);
}

function findHeadingCut(folded: string): { at: number; classification: TemplateContentClass; marker: string } | null {
  let best: { at: number; classification: TemplateContentClass; marker: string } | null = null;
  for (const marker of HEADING_MARKERS) {
    let from = 0;
    while (from < folded.length) {
      const at = folded.indexOf(marker.folded, from);
      if (at < 0) break;
      const end = at + marker.folded.length;
      const before = folded[at - 1] ?? '';
      const after = folded[end] ?? '';
      const wordBound = (at === 0 || /[\s\n|:.]/.test(before)) && (end >= folded.length || /[\s\n|:.]/.test(after));
      if (wordBound && isHeadingBoundary(folded, at) && afterLooksLikeHeading(folded, end)) {
        if (marker.folded === 'te puede interesar') {
          const window = folded.slice(Math.max(0, at - 12), at);
          if (/\b(que|le|si|no|esto|eso)\s+$/.test(window)) {
            from = end;
            continue;
          }
        }
        if (marker.folded === 'destacadas') {
          const windowBefore = folded.slice(Math.max(0, at - 24), at);
          if (/\b(noticias|notas|las|lo)\s+$/.test(windowBefore) && !isLineStart(folded, at)) {
            from = end;
            continue;
          }
        }
        if (marker.folded === 'compartir' && !isLineStart(folded, at)) {
          from = end;
          continue;
        }
        if (!best || at < best.at) best = { at, classification: marker.classification, marker: marker.folded };
        break;
      }
      from = end;
    }
  }
  return best;
}

function findClusterCut(folded: string): { at: number; classification: TemplateContentClass; marker: string } | null {
  const share = new RegExp(`compartir[\\s\\S]{0,100}${SOCIAL}[\\s\\S]{0,160}(?:destacadas|articulo anterior|articulo siguiente)`, 'i');
  const featured = /(?:^|\n)\s*destacadas\b[\s\S]{0,500}articulo anterior/i;
  const prevNext = /articulo anterior[\s\S]{0,240}articulo siguiente/i;
  const mShare = share.exec(folded);
  if (mShare && typeof mShare.index === 'number') {
    return { at: mShare.index, classification: 'SHARE_WIDGET_CONTENT', marker: 'compartir+social+destacadas' };
  }
  const mFeat = featured.exec(folded);
  if (mFeat && typeof mFeat.index === 'number') {
    const at = folded.indexOf('destacadas', mFeat.index);
    return { at: at >= 0 ? at : mFeat.index, classification: 'TEMPLATE_FEATURED_CONTENT', marker: 'destacadas+articulo anterior' };
  }
  const mPrev = prevNext.exec(folded);
  if (mPrev && typeof mPrev.index === 'number') {
    return { at: mPrev.index, classification: 'PREVIOUS_NEXT_ARTICLE', marker: 'articulo anterior+siguiente' };
  }
  return null;
}

function isRelatedTitleHost(n?: Pick<ContentLayers, 'url_original' | 'medio_id'>): boolean {
  const url = (n?.url_original ?? '').toLowerCase();
  const medio = (n?.medio_id ?? '').toUpperCase();
  return medio === 'MED-0201' || /conciencia/.test(url);
}

function isRelatedHeadline(paragraph: string): boolean {
  const t = paragraph.trim();
  if (!t || t.length > 180) return false;
  if (/[.!?…]$/.test(t)) return false;
  if (t.includes('\n')) return false;
  return t.split(/\s+/).length <= 22;
}

function stripTrailingRelatedHeadlines(text: string, n?: ContentLayers): string {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paras.length < 2) return text;
  let keep = paras.length;
  while (keep >= 2 && isRelatedHeadline(paras[keep - 1] ?? '')) keep -= 1;
  const stripped = paras.length - keep;
  if (stripped === 0) return text;
  const remaining = paras.slice(0, keep).join('\n\n').trim();
  if (remaining.length < MIN_BODY_CHARS) return text;
  if (stripped >= 2 || isRelatedTitleHost(n)) return remaining;
  return text;
}

/**
 * Conserva EDITORIAL_CONTENT y descarta la cola de plantilla/recirculación.
 * No corta un uso casual de “destacadas” o “artículo anterior” en prosa.
 */
export function extractEditorialSegment(text: string, n?: ContentLayers): EditorialSegment {
  const raw = (text ?? '').trim();
  if (!raw) {
    return { text: '', classification: 'EDITORIAL_CONTENT', cutAt: null, cutReason: null };
  }
  const folded = foldText(raw);
  const heading = findHeadingCut(folded);
  const cluster = findClusterCut(folded);
  let cut: { at: number; classification: TemplateContentClass; marker: string } | null = null;
  if (heading && cluster) cut = heading.at <= cluster.at ? heading : cluster;
  else cut = heading ?? cluster;
  if (cut) {
    const editorial = raw.slice(0, cut.at).trim();
    return {
      text: editorial,
      classification: editorial.length > 0 ? 'EDITORIAL_CONTENT' : cut.classification,
      cutAt: cut.at,
      cutReason: cut.marker,
    };
  }
  const scoped = stripTrailingRelatedHeadlines(raw, n);
  if (scoped !== raw) {
    return {
      text: scoped,
      classification: 'EDITORIAL_CONTENT',
      cutAt: scoped.length,
      cutReason: scoped.length < raw.length ? 'TEMPLATE_RELATED_CONTENT' : null,
    };
  }
  return { text: raw, classification: 'EDITORIAL_CONTENT', cutAt: null, cutReason: null };
}

export function classifyTemplateField(text: string, n?: ContentLayers): TemplateContentClass {
  const seg = extractEditorialSegment(text, n);
  if (seg.cutAt === null) return 'EDITORIAL_CONTENT';
  if (!seg.text) return seg.classification;
  return 'EDITORIAL_CONTENT';
}

export function hasStrongContamination(text: string): boolean {
  const seg = extractEditorialSegment(text);
  if (seg.cutAt === null) return false;
  const after = Math.max(0, text.trim().length - seg.text.length);
  return after / Math.max(text.trim().length, 1) >= 0.35;
}

function trustedFrom(
  text: string,
  campo: 'texto_cuerpo_nota' | 'texto_nota_limpia',
  calidad: string | null,
  status: 'BODY_TRUSTED' | 'BODY_FALLBACK_CLEAN',
  n?: ContentLayers,
): TrustedBody | null {
  const seg = extractEditorialSegment(text, n);
  if (seg.text.length < MIN_BODY_CHARS) return null;
  return {
    status,
    text: seg.text,
    campo,
    calidad,
    chars: seg.text.length,
    contaminated: seg.cutAt !== null,
  };
}

export function selectTrustedBody(
  n: ContentLayers,
  mode: MatchingMode,
): TrustedBody {
  const calidad = (n.calidad_extraccion ?? '').trim().toLowerCase() || null;
  const cuerpo = (n.texto_cuerpo_nota ?? '').trim();
  const limpia = (n.texto_nota_limpia ?? '').trim();
  const raw = (n.texto_extraido ?? '').trim();

  if (mode === 'current') {
    return { status: 'NO_BODY', text: '', campo: null, calidad, chars: 0, contaminated: false };
  }

  const cuerpoSeg = extractEditorialSegment(cuerpo, n);
  const limpiaSeg = extractEditorialSegment(limpia, n);
  const cuerpoContam = cuerpo.length > 0 && cuerpoSeg.cutAt !== null;
  const limpiaContam = limpia.length > 0 && limpiaSeg.cutAt !== null;

  if (cuerpo.length >= MIN_BODY_CHARS && calidad === 'alta') {
    const trusted = trustedFrom(cuerpo, 'texto_cuerpo_nota', calidad, 'BODY_TRUSTED', n);
    if (trusted) return trusted;
  }

  const allowCleanFallback = mode === 'body_high_plus_clean' || mode === 'body_v4';
  if (allowCleanFallback && limpia.length >= MIN_BODY_CHARS) {
    const calidadOk =
      mode === 'body_v4' ? calidad === 'alta' : calidad === 'alta' || calidad === 'media';
    if (calidadOk) {
      const fallback = trustedFrom(limpia, 'texto_nota_limpia', calidad, 'BODY_FALLBACK_CLEAN', n);
      if (fallback) return fallback;
    }
  }

  const had = cuerpo.length > 0 || limpia.length > 0 || raw.length > 0;
  return {
    status: had ? 'BODY_REJECTED' : 'NO_BODY',
    text: '',
    campo: null,
    calidad,
    chars: cuerpoSeg.text.length || limpiaSeg.text.length || raw.length,
    contaminated: cuerpoContam || limpiaContam,
  };
}

function editorialSignalText(text: string | null | undefined, n?: ContentLayers): string {
  const seg = extractEditorialSegment(text ?? '', n);
  if (!seg.text) return '';
  if (
    seg.classification === 'LISTING_CONTENT' ||
    seg.classification === 'LISTING_OR_TEMPLATE_CONTENT' ||
    seg.classification === 'TEMPLATE_FEATURED_CONTENT' ||
    seg.classification === 'SHARE_WIDGET_CONTENT' ||
    seg.classification === 'PREVIOUS_NEXT_ARTICLE'
  ) {
    return '';
  }
  return seg.text;
}

export function signalFields(n: ContentLayers): CampoBuscable[] {
  return [
    { nombre: 'titulo', texto: n.titulo ?? '', peso: PESOS_CAMPO.titulo! },
    { nombre: 'subtitulo', texto: n.subtitulo ?? '', peso: PESOS_CAMPO.subtitulo! },
    { nombre: 'resumen', texto: editorialSignalText(n.resumen, n), peso: PESOS_CAMPO.resumen! },
    { nombre: 'seccion', texto: n.seccion ?? '', peso: PESOS_CAMPO.seccion! },
  ];
}

export function buildTrustedMatchingFields(
  n: ContentLayers,
  opts: { mode: MatchingMode } = { mode: 'current' },
): { campos: CampoBuscable[]; body: TrustedBody } {
  const campos = signalFields(n);
  const body = selectTrustedBody(n, opts.mode);
  if (body.text && body.campo) {
    const peso =
      body.campo === 'texto_cuerpo_nota'
        ? (PESOS_CAMPO.texto_cuerpo_nota ?? PESOS_CAMPO.texto_extraido ?? 0.4)
        : (PESOS_CAMPO.texto_nota_limpia ?? 0.35);
    campos.push({ nombre: body.campo, texto: body.text, peso });
  }
  return { campos, body };
}

/** MATCHABLE: al menos un campo textual confiable. RAW no cuenta. */
export function hasTrustedSearchableText(n: ContentLayers): boolean {
  const fields = [n.titulo, n.subtitulo, editorialSignalText(n.resumen, n), n.seccion, n.texto_cuerpo_nota, n.texto_nota_limpia];
  return fields.some((f) => typeof f === 'string' && f.trim().length > 0);
}
