/**
 * Proximity context candidate for BODY (shadow only unless explicitly passed).
 * No se activa en producción con BODY_MATCHING_V2.
 */
import { foldText, indexOfWord, indexOfSubstring } from '../matchers/text.js';
import type { TipoKeyword } from '../matchers/keyword.js';

export const DEFAULT_BODY_PROXIMITY_CHARS = 400;

const BROAD_HINTS = [
  'trabajadores',
  'huelga',
  'sindicato',
  'reforma',
  'presupuesto',
  'tequila',
  'alcohol',
  'congreso',
  'aranceles',
  'comercio',
];

export function isBroadOrContextualKeyword(
  keyword: string,
  tipo: TipoKeyword,
): boolean {
  if (tipo === 'exacta_contextual' || tipo === 'contiene') {
    const f = foldText(keyword);
    if (f.split(/\s+/).length <= 2 && BROAD_HINTS.some((h) => f.includes(h) || h.includes(f))) {
      return true;
    }
    if (tipo === 'exacta_contextual') return true;
  }
  return false;
}

export function windowsAroundHits(
  text: string,
  terms: string[],
  tipo: TipoKeyword,
  radius = DEFAULT_BODY_PROXIMITY_CHARS,
): string {
  if (!text.trim()) return '';
  const folded = foldText(text);
  const spans: Array<{ start: number; end: number }> = [];
  for (const term of terms) {
    if (!term.trim()) continue;
    const idx = tipo === 'contiene' ? indexOfSubstring(term, folded) : indexOfWord(term, folded);
    if (idx < 0) continue;
    spans.push({
      start: Math.max(0, idx - radius),
      end: Math.min(text.length, idx + term.length + radius),
    });
  }
  if (spans.length === 0) return '';
  spans.sort((a, b) => a.start - b.start);
  const merged: typeof spans = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else merged.push({ ...s });
  }
  return merged.map((s) => text.slice(s.start, s.end)).join('\n');
}
