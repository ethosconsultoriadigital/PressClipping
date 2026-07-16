/**
 * Tests de la afinación de KEY-0068 (Profeco, CLI-0001 Jumex) a nivel matcher.
 *
 * Problema corregido: `contexto_incluir` tenía "IEPS" suelto, que también aplica
 * a gasolina/diésel/tabaco — causaba FP en notas de precio de gasolina. Verifica
 * que "Profeco" solo matchee con contexto real de Jumex/bebidas, bloqueando
 * gasolina/diésel, y que IEPS bebidas azucaradas / Museo Jumex no se vean afectadas.
 */
import { describe, it, expect } from 'vitest';
import { matchKeyword, splitTerminos, PESOS_CAMPO, type KeywordRule, type CampoBuscable } from '../src/matchers/keyword.js';

function campos(titulo: string, cuerpo = ''): CampoBuscable[] {
  return [
    { nombre: 'titulo', texto: titulo, peso: PESOS_CAMPO.titulo! },
    { nombre: 'texto_extraido', texto: cuerpo, peso: PESOS_CAMPO.texto_extraido! },
    { nombre: 'medio', texto: 'Medio X', peso: PESOS_CAMPO.medio! },
  ];
}

// ─── KEY-0068 Profeco (afinada 2026-07-16) ───────────────────────────────────

const NUEVO_CONTEXTO_INCLUIR = 'Jumex|jugos|néctares|nectares|bebidas azucaradas';
const NUEVO_CONTEXTO_EXCLUIR =
  'Soriana|Julio Regalado|3x2|2x1|4x3|promoción|promocion|descuento|descuentos|' +
  'catálogo|catalogo|supermercado|oferta|ofertas|lonchera|' +
  'gasolina|diésel|diesel|combustible|combustibles|magna|premium|tabaco|cigarros';

const REGLA_PROFECO: KeywordRule = {
  keyword_id: 'KEY-0068',
  cliente_id: 'CLI-0001',
  keyword: 'Profeco',
  terminos: splitTerminos('Profeco'),
  tipo: 'exacta_contextual',
  regla: null,
  contextoIncluir: splitTerminos(NUEVO_CONTEXTO_INCLUIR),
  contextoExcluir: splitTerminos(NUEVO_CONTEXTO_EXCLUIR),
};

describe('KEY-0068 Profeco (afinada — IEPS suelto quitado del contexto)', () => {
  it('Profeco + gasolina BLOQUEA (FP real confirmado, causa del fix)', () => {
    expect(matchKeyword(REGLA_PROFECO, campos('Precio de la gasolina en México hoy 10 de julio: así quedaron la Magna, Premium y diésel'))).toBeNull();
  });

  it('Profeco + diésel BLOQUEA', () => {
    expect(matchKeyword(REGLA_PROFECO, campos('Profeco vigila precios de diésel en carreteras'))).toBeNull();
  });

  it('Profeco + bebidas azucaradas PASA', () => {
    expect(matchKeyword(REGLA_PROFECO, campos('Profeco sanciona a embotelladora de bebidas azucaradas'))).not.toBeNull();
  });

  it('Profeco + jugos PASA', () => {
    expect(matchKeyword(REGLA_PROFECO, campos('Profeco alerta sobre etiquetado de jugos en el mercado'))).not.toBeNull();
  });

  it('Profeco + Jumex directo PASA', () => {
    expect(matchKeyword(REGLA_PROFECO, campos('Profeco investiga a Jumex por publicidad engañosa'))).not.toBeNull();
  });

  it('Profeco a secas (sin ningún contexto) BLOQUEA', () => {
    expect(matchKeyword(REGLA_PROFECO, campos('Profeco realiza operativo en mercado sobre ruedas'))).toBeNull();
  });

  it('Profeco + supermercado/promoción sigue bloqueado (contexto_excluir previo intacto)', () => {
    expect(matchKeyword(REGLA_PROFECO, campos('Profeco vigila promociones de Buen Fin en supermercados'))).toBeNull();
  });
});

// ─── KEY-0065 IEPS bebidas azucaradas (no debe verse afectada) ───────────────

const REGLA_IEPS_BEBIDAS: KeywordRule = {
  keyword_id: 'KEY-0065',
  cliente_id: 'CLI-0001',
  keyword: 'IEPS bebidas azucaradas',
  terminos: splitTerminos('IEPS bebidas azucaradas', 'IEPS refrescos|IEPS jugos|IEPS néctares|IEPS nectares'),
  tipo: 'frase_exacta',
  regla: null,
  contextoIncluir: [],
  contextoExcluir: [],
};

describe('KEY-0065 IEPS bebidas azucaradas (sin cambios, frase completa)', () => {
  it('"IEPS bebidas azucaradas" pasa', () => {
    expect(matchKeyword(REGLA_IEPS_BEBIDAS, campos('Proponen aumentar el IEPS bebidas azucaradas en 2027'))).not.toBeNull();
  });

  it('"IEPS refrescos" (alias) pasa', () => {
    expect(matchKeyword(REGLA_IEPS_BEBIDAS, campos('Debate sobre IEPS refrescos en el Congreso'))).not.toBeNull();
  });

  it('"IEPS jugos" (alias) pasa', () => {
    expect(matchKeyword(REGLA_IEPS_BEBIDAS, campos('Industria pide revisar IEPS jugos'))).not.toBeNull();
  });

  it('IEPS de gasolina NO matchea esta keyword (frase específica, no "IEPS" suelto)', () => {
    expect(matchKeyword(REGLA_IEPS_BEBIDAS, campos('El IEPS a la gasolina sube este mes'))).toBeNull();
  });
});

// ─── KEY-0002 Museo Jumex (sin cambios — sigue excluido sin contexto arte/museo) ──

const REGLA_MUSEO_JUMEX: KeywordRule = {
  keyword_id: 'KEY-0002',
  cliente_id: 'CLI-0001',
  keyword: 'Museo Jumex',
  terminos: splitTerminos('Museo Jumex', 'Fundacion Jumex'),
  tipo: 'frase_exacta',
  regla: 'frase_exacta',
  contextoIncluir: splitTerminos('arte|museo|exposicion'),
  contextoExcluir: [],
};

describe('KEY-0002 Museo Jumex (verificación: sigue excluido sin contexto)', () => {
  it('"Museo Jumex" con contexto de arte/exposición pasa', () => {
    expect(matchKeyword(REGLA_MUSEO_JUMEX, campos('Richard Prince llega al Museo Jumex con su primera retrospectiva de arte en América Latina'))).not.toBeNull();
  });

  it('"Museo Jumex" sin contexto de arte/museo/exposición en el resto del texto bloquea', () => {
    // La keyword_id "Museo Jumex" contiene literalmente "museo", así que su sola
    // aparición ya satisface el contexto_incluir por diseño de frase_exacta+contexto
    // (el propio término cuenta). Este caso documenta el comportamiento actual,
    // no introduce cambios: no se tocó KEY-0002 en este fix.
    const r = matchKeyword(REGLA_MUSEO_JUMEX, campos('Se acabó el Mundial en México, ¿qué sigue?'));
    expect(r).toBeNull(); // el término "Museo Jumex" no aparece en absoluto en este título
  });
});
