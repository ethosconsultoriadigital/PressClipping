/**
 * Hashing determinista para deduplicación.
 *
 * - hash_url: identifica una noticia de forma única (barrera anti-duplicado).
 * - hash_contenido: identifica el contenido para agrupar republicaciones.
 */
import { createHash } from 'node:crypto';

/** SHA-256 en hexadecimal de una cadena. */
export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Normaliza texto para hashing de contenido: minúsculas, sin acentos, sin
 * puntuación y con espacios colapsados. Así pequeñas variaciones tipográficas
 * entre republicaciones producen el mismo hash_contenido.
 */
export function normalizeForHash(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Hash de contenido a partir de título + resumen (lo disponible en MVP). */
export function hashContenido(titulo: string | null, resumen: string | null): string | null {
  const base = normalizeForHash(`${titulo ?? ''} ${resumen ?? ''}`);
  if (base.length === 0) return null;
  return sha256(base);
}
