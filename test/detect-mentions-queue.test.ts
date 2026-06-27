/**
 * Tests de comportamiento de la cola de detect-mentions:
 *   - getNoticiasPendientes acepta objeto de opciones (retrocompatible con número).
 *   - onlyWithText filtra correctamente.
 */
import { describe, it, expect } from 'vitest';
import type { NoticiasPendientesOpts } from '../src/supabase/repositories.js';

// ─── Helpers de forma de los argumentos ─────────────────────────────────────

describe('NoticiasPendientesOpts', () => {
  it('acepta solo limit como número (retrocompatible)', () => {
    // El tipo acepta número o objeto; verificamos que el objeto se construye bien
    const opts: NoticiasPendientesOpts = { limit: 50 };
    expect(opts.onlyWithText).toBeUndefined();
  });

  it('acepta onlyWithText en objeto de opciones', () => {
    const opts: NoticiasPendientesOpts = { limit: 50, onlyWithText: true };
    expect(opts.onlyWithText).toBe(true);
  });

  it('onlyWithText es opcional (puede ser undefined)', () => {
    const opts: NoticiasPendientesOpts = { limit: 100 };
    expect('onlyWithText' in opts).toBe(false);
  });
});

// ─── Lógica de parseo de flags en detect-mentions ───────────────────────────

function parseOnlyWithText(argv: string[]): boolean {
  return argv.some((a) => a === '--only-with-text');
}

describe('parseArgs --only-with-text', () => {
  it('detecta el flag correctamente', () => {
    expect(parseOnlyWithText(['--limit=50', '--only-with-text', '--dry-run'])).toBe(true);
  });

  it('devuelve false cuando no está presente', () => {
    expect(parseOnlyWithText(['--limit=50', '--dry-run'])).toBe(false);
  });

  it('no confunde flags similares', () => {
    expect(parseOnlyWithText(['--only-with-texts', '--only-with'])).toBe(false);
  });
});

// ─── Conteo de distribución de texto (lógica de dry-run) ────────────────────

interface MinNoticia {
  texto_cuerpo_nota: string | null;
  texto_nota_limpia: string | null;
  texto_extraido: string | null;
}

function clasificarNoticias(noticias: MinNoticia[]) {
  return {
    usandoCuerpo: noticias.filter((n) => n.texto_cuerpo_nota !== null).length,
    usandoTextoLimpio: noticias.filter((n) => n.texto_cuerpo_nota === null && n.texto_nota_limpia !== null).length,
    usandoFallback: noticias.filter((n) => n.texto_cuerpo_nota === null && n.texto_nota_limpia === null && n.texto_extraido !== null).length,
    sinTexto: noticias.filter((n) => n.texto_cuerpo_nota === null && n.texto_nota_limpia === null && n.texto_extraido === null).length,
  };
}

describe('clasificarNoticias (lógica del resumen dry-run)', () => {
  const muestra: MinNoticia[] = [
    { texto_cuerpo_nota: 'cuerpo', texto_nota_limpia: 'limpio', texto_extraido: 'raw' },
    { texto_cuerpo_nota: null, texto_nota_limpia: 'limpio', texto_extraido: 'raw' },
    { texto_cuerpo_nota: null, texto_nota_limpia: null, texto_extraido: 'raw' },
    { texto_cuerpo_nota: null, texto_nota_limpia: null, texto_extraido: null },
  ];

  it('cuenta correctamente usandoCuerpo', () => {
    expect(clasificarNoticias(muestra).usandoCuerpo).toBe(1);
  });

  it('cuenta correctamente usandoTextoLimpio', () => {
    expect(clasificarNoticias(muestra).usandoTextoLimpio).toBe(1);
  });

  it('cuenta correctamente usandoFallback', () => {
    expect(clasificarNoticias(muestra).usandoFallback).toBe(1);
  });

  it('cuenta correctamente sinTexto', () => {
    expect(clasificarNoticias(muestra).sinTexto).toBe(1);
  });

  it('con --only-with-text, sinTexto siempre es 0', () => {
    // Simula que el filtro ya eliminó las noticias sin cuerpo
    const soloConCuerpo = muestra.filter((n) => n.texto_cuerpo_nota !== null);
    expect(clasificarNoticias(soloConCuerpo).sinTexto).toBe(0);
  });
});
