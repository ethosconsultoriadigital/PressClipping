/**
 * Métricas de certificación sobre un ancla temporal (puro).
 * Permite T0 / T0+30m / T0+60m sobre el mismo snapshot de notas+probe.
 */
import { eligibleArticleNotes } from './certEligibility.js';
import { classifyOperational, type CertProbe } from './certClassify.js';
import { validLatencyHours, LATENCY_P95_THRESHOLD_H } from './certLatency.js';
import { productionCaptureHealth, type SourceHealthClass } from './certProbe.js';

export { LATENCY_P95_THRESHOLD_H };

export interface CertNote {
  noticia_id?: string;
  url_original: string | null;
  titulo: string | null;
  fecha_publicacion: string | null;
  created_at: string | null;
  texto_cuerpo_nota: string | null;
  texto_nota_limpia: string | null;
}

export interface ScoreOpts {
  medioId: string;
  notes30: readonly CertNote[];
  probe: CertProbe;
  lastEstado: string | null;
  lastError: string | null;
  paywallNotes: boolean;
  /** Ancla ISO; n7 = created_at >= anchor - 7d. */
  anchorIso: string;
  /** newest item del probe de fuente (RSS/sitemap), si se conoce. */
  sourceNewestIso?: string | null;
}

function isoAgo(anchorMs: number, ms: number): string {
  return new Date(anchorMs - ms).toISOString();
}

function ratio(n: number, d: number): number | null {
  if (!d) return null;
  return n / d;
}

function pctile(nums: number[], p: number): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[i]!;
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)]!;
}

export function isHomepage(url: string): boolean {
  try {
    const u = new URL(url);
    const p = u.pathname.replace(/\/+$/, '') || '/';
    if (p !== '/' && p !== '') return false;
    // Permalinks WP/ASP en la raíz (`/?p=123`, `/?id=456`) son notas, no portada.
    const pParam = u.searchParams.get('p');
    const idParam = u.searchParams.get('id');
    if (pParam && /^\d+$/.test(pParam)) return false;
    if (idParam && /^\d+$/.test(idParam)) return false;
    return true;
  } catch {
    return false;
  }
}

export function isGenericListing(url: string): boolean {
  try {
    const path = new URL(url).pathname;
    const segs = path.split('/').filter(Boolean);
    if (segs.length > 2) return false;
    return /\/(?:category|tag|author|seccion|secciones|tema|temas|etiqueta|section|search|busca)(?:\/|$)|\/page\/\d+/i.test(
      path,
    );
  } catch {
    return false;
  }
}

export function usableText(body: string | null, clean: string | null): string {
  const b = (body ?? '').trim();
  if (b.length >= 40) return b;
  return (clean ?? '').trim();
}

function looksMojibake(s: string): boolean {
  return /Ã.|Â.|â€|�|Ã¡|Ã©|Ã­|Ã³|Ãº/.test(s);
}

function looksBoilerplate(s: string): boolean {
  const t = s.toLowerCase();
  if (t.length < 40) return false;
  const hits = [
    /aceptar cookies/,
    /política de privacidad/,
    /todos los derechos reservados/,
    /síguenos en/,
    /te puede interesar/,
    /lee también/,
    /contenido relacionado/,
    /suscríbete/,
    /newsletter/,
    /menú principal/,
  ].filter((re) => re.test(t)).length;
  return hits >= 2 || (hits >= 1 && t.length < 400);
}

export function scoreMediaAtAnchor(opts: ScoreOpts) {
  const anchorMs = Date.parse(opts.anchorIso);
  const T24 = isoAgo(anchorMs, 24 * 3600e3);
  const T48 = isoAgo(anchorMs, 48 * 3600e3);
  const T7 = isoAgo(anchorMs, 7 * 864e5);

  const { eligible: elig30, rejected: rej30 } = eligibleArticleNotes(opts.medioId, opts.notes30);
  const n24 = elig30.filter((n) => n.created_at && n.created_at >= T24);
  const n48 = elig30.filter((n) => n.created_at && n.created_at >= T48);
  const n7 = elig30.filter((n) => n.created_at && n.created_at >= T7);
  const set = n7;
  const production = productionCaptureHealth(opts.lastEstado, opts.lastError);

  const urlOkN = set.filter((n) => /^https?:\/\//i.test(n.url_original ?? '') && (n.url_original ?? '').length > 12)
    .length;
  const titleOkN = set.filter((n) => (n.titulo ?? '').trim().length > 0).length;
  const pubOkN = set.filter((n) => n.fecha_publicacion && Number.isFinite(Date.parse(n.fecha_publicacion))).length;
  const capOkN = set.filter((n) => n.created_at && Number.isFinite(Date.parse(n.created_at))).length;
  const cleanN = set.filter((n) => (n.texto_nota_limpia ?? '').trim().length > 0).length;
  const bodyN = set.filter((n) => (n.texto_cuerpo_nota ?? '').trim().length > 0).length;
  const usableN = set.filter((n) => usableText(n.texto_cuerpo_nota, n.texto_nota_limpia).length >= 40).length;
  const encodingN = set.filter((n) =>
    looksMojibake(`${n.titulo ?? ''} ${usableText(n.texto_cuerpo_nota, n.texto_nota_limpia)}`),
  ).length;
  const boilN = set.filter((n) => looksBoilerplate(usableText(n.texto_cuerpo_nota, n.texto_nota_limpia))).length;
  const listN = set.filter((n) => isGenericListing(n.url_original ?? '')).length;
  const homeN = set.filter((n) => isHomepage(n.url_original ?? '')).length;
  const shortN = set.filter((n) => {
    const t = usableText(n.texto_cuerpo_nota, n.texto_nota_limpia);
    return t.length > 0 && t.length < 80;
  }).length;

  const bodyMap = new Map<string, Set<string>>();
  for (const n of set) {
    const b = (n.texto_cuerpo_nota ?? '').trim();
    if (b.length < 80) continue;
    const key = b.slice(0, 400);
    if (!bodyMap.has(key)) bodyMap.set(key, new Set());
    bodyMap.get(key)!.add((n.titulo ?? '').trim());
  }
  const cloneNotes = set.filter((n) => {
    const key = (n.texto_cuerpo_nota ?? '').trim().slice(0, 400);
    return (bodyMap.get(key)?.size ?? 0) >= 3;
  }).length;

  const { hours: lats, invalid: invalidLatencyPairs } = validLatencyHours(set);
  const usable30 = elig30.filter((n) => usableText(n.texto_cuerpo_nota, n.texto_nota_limpia).length >= 40).length;

  const sourceRecent =
    opts.sourceNewestIso && Number.isFinite(Date.parse(opts.sourceNewestIso))
      ? (anchorMs - Date.parse(opts.sourceNewestIso)) / 864e5 <= 7
      : null;
  const d = classifyOperational({
    n7: n7.length,
    n30: elig30.length,
    urlOk: ratio(urlOkN, set.length),
    titleOk: ratio(titleOkN, set.length),
    pubOk: ratio(pubOkN, set.length),
    capOk: ratio(capOkN, set.length),
    usable: ratio(usableN, set.length),
    body: ratio(bodyN, set.length),
    homepage: ratio(homeN, set.length),
    listing: ratio(listN, set.length),
    encoding: ratio(encodingN, set.length),
    clone: ratio(cloneNotes, set.length),
    boilerplate: ratio(boilN, set.length),
    shortPct: ratio(shortN, set.length),
    probe: opts.probe,
    production,
    lastError: opts.lastError,
    lastEstado: opts.lastEstado,
    paywallNotes: opts.paywallNotes,
    latencyP95: pctile(lats, 95),
    sourceRecent,
    allInventoryNonArticle: opts.notes30.length > 0 && elig30.length === 0,
  });

  return {
    noticias_24h: n24.length,
    noticias_48h: n48.length,
    noticias_7d: n7.length,
    noticias_30d: elig30.length,
    excluded_non_article_30d: rej30.length,
    excluded_non_article_7d: rej30.filter((n) => n.created_at && n.created_at >= T7).length,
    url_ok_pct: ratio(urlOkN, set.length),
    title_ok_pct: ratio(titleOkN, set.length),
    publication_date_ok_pct: ratio(pubOkN, set.length),
    capture_date_ok_pct: ratio(capOkN, set.length),
    clean_text_pct: ratio(cleanN, set.length),
    body_text_pct: ratio(bodyN, set.length),
    texto_usable_pct_7d: ratio(usableN, set.length),
    texto_usable_pct_30d: ratio(usable30, elig30.length),
    listing_pct: ratio(listN, set.length),
    homepage_pct: ratio(homeN, set.length),
    clone_pct: ratio(cloneNotes, set.length),
    encoding_pct: ratio(encodingN, set.length),
    boilerplate_pct: ratio(boilN, set.length),
    short_pct: ratio(shortN, set.length),
    latency_n: lats.length,
    latency_invalid_pairs: invalidLatencyPairs,
    latency_median_h: median(lats),
    latency_p95_h: pctile(lats, 95),
    production_health: production as SourceHealthClass,
    certification_class: d.cls,
    certification_reason: d.reason,
    primary_defect: d.primary,
    secondary_defect: d.secondary,
    technical_status: d.tech,
    repairable: d.repairable,
    repair_priority: d.prio,
  };
}
