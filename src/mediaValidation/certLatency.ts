/**
 * Latencia operacional: solo pares de timestamps técnicamente válidos.
 *
 * El umbral p95 (24h) NO se mueve. Lo que se excluye es basura de reloj
 * (epoch, año 2018 en un corpus 2026, pubDate 8 años antes de created_at).
 */
export const LATENCY_P95_THRESHOLD_H = 24;
/** Sesgo de reloj permitido: publicación un poco después de created_at. */
const MAX_PUB_AFTER_CAP_H = 6;
/** Captura de un artículo publicado hace más de 30d no mide latencia de feed. */
const MAX_LATENCY_H = 30 * 24;
const MIN_PUB_MS = Date.parse('2025-01-01T00:00:00.000Z');

export type LatencyPairVerdict =
  | { valid: true; hours: number }
  | { valid: false; hours: null; reason: 'missing' | 'unparseable' | 'pub_too_old' | 'pub_after_capture' | 'span_too_large' };

export function isValidLatencyPair(
  fechaPublicacion: string | null | undefined,
  createdAt: string | null | undefined,
): LatencyPairVerdict {
  if (!fechaPublicacion || !createdAt) return { valid: false, hours: null, reason: 'missing' };
  const pub = Date.parse(fechaPublicacion);
  const cap = Date.parse(createdAt);
  if (!Number.isFinite(pub) || !Number.isFinite(cap)) {
    return { valid: false, hours: null, reason: 'unparseable' };
  }
  if (pub < MIN_PUB_MS) return { valid: false, hours: null, reason: 'pub_too_old' };
  const hours = (cap - pub) / 3600000;
  if (hours < -MAX_PUB_AFTER_CAP_H) return { valid: false, hours: null, reason: 'pub_after_capture' };
  if (hours > MAX_LATENCY_H) return { valid: false, hours: null, reason: 'span_too_large' };
  return { valid: true, hours };
}

export function validLatencyHours(
  pairs: Array<{ fecha_publicacion: string | null; created_at: string | null }>,
): { hours: number[]; invalid: number } {
  const hours: number[] = [];
  let invalid = 0;
  for (const p of pairs) {
    const v = isValidLatencyPair(p.fecha_publicacion, p.created_at);
    if (v.valid) hours.push(v.hours);
    else invalid += 1;
  }
  return { hours, invalid };
}
