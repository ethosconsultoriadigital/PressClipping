import { describe, it, expect } from 'vitest';
import { canonicalizeUrl } from '../src/normalizers/url.js';
import { sha256, normalizeForHash, hashContenido } from '../src/utils/hash.js';

describe('canonicalizeUrl', () => {
  it('quita parámetros de tracking', () => {
    expect(
      canonicalizeUrl('https://medio.com/nota?utm_source=fb&id=5&fbclid=xyz'),
    ).toBe('https://medio.com/nota?id=5');
  });
  it('quita fragmento y barra final', () => {
    expect(canonicalizeUrl('https://Medio.com/Nota/#seccion')).toBe(
      'https://medio.com/Nota',
    );
  });
  it('normaliza host a minúsculas conservando el path', () => {
    expect(canonicalizeUrl('https://WWW.Medio.COM/A/B')).toBe(
      'https://www.medio.com/A/B',
    );
  });
  it('dos URLs equivalentes producen el mismo hash_url', () => {
    const a = canonicalizeUrl('https://medio.com/x?utm_source=tw');
    const b = canonicalizeUrl('https://medio.com/x#top');
    expect(sha256(a)).toBe(sha256(b));
  });
  it('devuelve la entrada si no es URL válida', () => {
    expect(canonicalizeUrl('  no-es-url ')).toBe('no-es-url');
  });
});

describe('normalizeForHash', () => {
  it('ignora acentos, mayúsculas y puntuación', () => {
    expect(normalizeForHash('¡Atención! El AVIÓN, sí.')).toBe('atencion el avion si');
  });
});

describe('hashContenido', () => {
  it('mismo contenido con variaciones tipográficas → mismo hash', () => {
    const h1 = hashContenido('Crisis Política', 'El país, hoy.');
    const h2 = hashContenido('crisis politica', 'el pais hoy');
    expect(h1).toBe(h2);
  });
  it('null si no hay contenido', () => {
    expect(hashContenido(null, null)).toBeNull();
  });
});
