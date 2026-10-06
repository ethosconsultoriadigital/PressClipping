import { admitDiscoveredArticle, isNonArticleAdmission } from './articleAdmission.js';
import { isGoogleNewsUrl } from '../matching/bGapCandidateToCaptureGapRow.js';
import { isHomepage } from '../mediaValidation/certScore.js';

export type RecoveryQualityVerdict = 'PASS' | 'WARN' | 'FAIL';

export interface RecoveryQualityRow {
  url: string;
  canonicalUrl?: string | null;
  medioId: string | null;
  expectedMedioId?: string | null;
  titulo?: string | null;
  body?: string | null;
  fechaPublicacion?: string | null;
  windowStart?: string;
  windowEnd?: string;
  windowMembership?: string | null;
  hashCount?: number;
  canonicalCount?: number;
  fuenteExtraccion?: string | null;
  calidadExtraccion?: string | null;
  cuerpoNotaChars?: number | null;
}

export interface RecoveryQualityResult {
  verdict: RecoveryQualityVerdict;
  reasons: string[];
  automatedNonArticle: boolean;
  nonArticleReason: string | null;
}

function inWindow(iso: string | null | undefined, start?: string, end?: string): boolean {
  if (!iso || !start || !end) return false;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  return t >= Date.parse(start) && t <= Date.parse(end);
}

/**
 * Same classifier as pre-persist admission. A confirmed non-article is FAIL.
 * Waves must STOP when automatedNonArticleCount > 0.
 */
export function evaluateRecoveryQuality(row: RecoveryQualityRow): RecoveryQualityResult {
  const reasons: string[] = [];
  const fail: string[] = [];
  const url = row.url;
  const admission = admitDiscoveredArticle({
    url,
    medioId: row.medioId,
    titulo: row.titulo,
    body: row.body,
  });
  const nonArticle = !admission.admit && isNonArticleAdmission(admission.reason);
  if (nonArticle) fail.push(admission.reason);
  if (isGoogleNewsUrl(url) || isGoogleNewsUrl(row.canonicalUrl)) fail.push('google_redirect');
  if (isHomepage(url)) fail.push('homepage');
  if (row.expectedMedioId && row.medioId && row.medioId !== row.expectedMedioId) {
    fail.push(`wrong_source:${row.medioId}`);
  }
  if (row.fechaPublicacion) {
    if (row.windowStart && row.windowEnd && !inWindow(row.fechaPublicacion, row.windowStart, row.windowEnd)) {
      fail.push('outside_window');
    }
  }
  if ((row.hashCount ?? 1) > 1) fail.push('duplicate_hash');
  if ((row.canonicalCount ?? 1) > 1) fail.push('duplicate_canonical');
  const title = (row.titulo ?? '').trim();
  const body = row.body ?? '';
  if (!title) fail.push('empty_or_weak_title');
  else if (title.length < 8) reasons.push('short_title');
  if (/inicio\s*\|\s*contacto|all rights reserved/i.test(body) && body.length < 400) fail.push('garbage_extraction');
  if (row.calidadExtraccion === 'baja' || row.calidadExtraccion === 'fallida') reasons.push(`calidad:${row.calidadExtraccion}`);
  if ((row.cuerpoNotaChars ?? 0) > 0 && (row.cuerpoNotaChars ?? 0) < 200) reasons.push('short_body');

  if (fail.length) {
    return {
      verdict: 'FAIL',
      reasons: [...fail, ...reasons],
      automatedNonArticle: nonArticle,
      nonArticleReason: nonArticle ? admission.reason : null,
    };
  }
  if (reasons.length) {
    return { verdict: 'WARN', reasons, automatedNonArticle: false, nonArticleReason: null };
  }
  return { verdict: 'PASS', reasons: [], automatedNonArticle: false, nonArticleReason: null };
}

export function automatedNonArticleCount(rows: RecoveryQualityRow[]): number {
  return rows.filter((r) => evaluateRecoveryQuality(r).automatedNonArticle).length;
}
