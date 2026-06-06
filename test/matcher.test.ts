import { describe, it, expect } from 'vitest';
import {
  matchKeyword,
  splitTerminos,
  PESOS_CAMPO,
  type KeywordRule,
  type CampoBuscable,
} from '../src/matchers/keyword.js';
import { evalBoolean } from '../src/matchers/boolean.js';
import { foldText } from '../src/matchers/text.js';

function campos(parts: Partial<Record<string, string>>): CampoBuscable[] {
  return [
    { nombre: 'titulo', texto: parts.titulo ?? '', peso: PESOS_CAMPO.titulo! },
    { nombre: 'subtitulo', texto: parts.subtitulo ?? '', peso: PESOS_CAMPO.subtitulo! },
    { nombre: 'resumen', texto: parts.resumen ?? '', peso: PESOS_CAMPO.resumen! },
    { nombre: 'seccion', texto: parts.seccion ?? '', peso: PESOS_CAMPO.seccion! },
    { nombre: 'texto_extraido', texto: parts.texto ?? '', peso: PESOS_CAMPO.texto_extraido! },
    { nombre: 'medio', texto: parts.medio ?? '', peso: PESOS_CAMPO.medio! },
  ];
}

function rule(over: Partial<KeywordRule>): KeywordRule {
  return {
    keyword_id: 'k1',
    cliente_id: 'c1',
    keyword: over.keyword ?? 'tequila',
    terminos: over.terminos ?? ['tequila'],
    tipo: over.tipo ?? 'exacta',
    regla: over.regla ?? null,
    contextoIncluir: over.contextoIncluir ?? [],
    contextoExcluir: over.contextoExcluir ?? [],
  };
}

describe('foldText', () => {
  it('pliega acentos y ñ conservando longitud', () => {
    expect(foldText('Tequila Añejo ÓÚ')).toBe('tequila anejo ou');
    expect(foldText('Mañana').length).toBe('Mañana'.length);
  });
});

describe('regla exacta', () => {
  it('coincide como palabra completa, ignorando acentos', () => {
    const r = rule({ tipo: 'exacta', terminos: ['tequila'] });
    const res = matchKeyword(r, campos({ titulo: 'El Téquila premium gana premio' }));
    expect(res).not.toBeNull();
    expect(res!.tipo_match).toBe('exacta');
    expect(res!.campo).toBe('titulo');
    expect(res!.score).toBe(1.0);
  });
  it('NO coincide con subcadena dentro de otra palabra', () => {
    const r = rule({ tipo: 'exacta', terminos: ['tequila'] });
    const res = matchKeyword(r, campos({ titulo: 'compró un tequilazo enorme' }));
    expect(res).toBeNull();
  });
});

describe('regla contiene', () => {
  it('coincide como subcadena', () => {
    const r = rule({ tipo: 'contiene', terminos: ['tequil'] });
    const res = matchKeyword(r, campos({ resumen: 'la tequilera anunció...' }));
    expect(res).not.toBeNull();
    expect(res!.campo).toBe('resumen');
    expect(res!.score).toBe(PESOS_CAMPO.resumen);
  });
});

describe('regla frase_exacta', () => {
  it('coincide con la frase completa y tolera espacios múltiples', () => {
    const r = rule({ tipo: 'frase_exacta', terminos: ['agave azul'] });
    const res = matchKeyword(r, campos({ titulo: 'cosecha de Agave   Azul en Jalisco' }));
    expect(res).not.toBeNull();
  });
  it('no coincide si las palabras están separadas por otras', () => {
    const r = rule({ tipo: 'frase_exacta', terminos: ['agave azul'] });
    const res = matchKeyword(r, campos({ titulo: 'agave de color azul' }));
    expect(res).toBeNull();
  });
});

describe('alias / variantes', () => {
  it('cualquier término del conjunto produce match', () => {
    const r = rule({ tipo: 'exacta', terminos: splitTerminos('Jumex', 'jugos jumex|grupo jumex') });
    const res = matchKeyword(r, campos({ titulo: 'Grupo Jumex reporta ventas' }));
    expect(res).not.toBeNull();
  });
});

describe('contexto incluir / excluir', () => {
  it('excluir bloquea el match', () => {
    const r = rule({ tipo: 'exacta', terminos: ['tequila'], contextoExcluir: ['receta'] });
    const res = matchKeyword(r, campos({ titulo: 'tequila', resumen: 'una receta de cocina' }));
    expect(res).toBeNull();
  });
  it('incluir exige al menos un contexto presente', () => {
    const r = rule({ tipo: 'exacta', terminos: ['tequila'], contextoIncluir: ['exportación'] });
    const sin = matchKeyword(r, campos({ titulo: 'tequila premium' }));
    expect(sin).toBeNull();
    const con = matchKeyword(r, campos({ titulo: 'tequila premium', resumen: 'crece la exportacion' }));
    expect(con).not.toBeNull();
  });
});

describe('regla booleana', () => {
  it('evalúa AND/OR/NOT con límite de palabra', () => {
    expect(evalBoolean('tequila AND jalisco', 'el tequila de Jalisco')).toBe(true);
    expect(evalBoolean('tequila AND oaxaca', 'el tequila de Jalisco')).toBe(false);
    expect(evalBoolean('tequila OR mezcal', 'solo mezcal aquí')).toBe(true);
    expect(evalBoolean('tequila AND NOT receta', 'tequila en receta')).toBe(false);
    expect(evalBoolean('tequila AND NOT receta', 'tequila premium')).toBe(true);
  });
  it('soporta paréntesis y frases entre comillas', () => {
    expect(evalBoolean('(tequila OR mezcal) AND "agave azul"', 'mezcal de agave azul')).toBe(true);
    expect(evalBoolean('(tequila OR mezcal) AND "agave azul"', 'mezcal de agave verde')).toBe(false);
  });
  it('matchKeyword aplica la regla booleana y arma snippet', () => {
    const r = rule({ tipo: 'booleana', regla: 'jumex AND nestlé', terminos: [] });
    const res = matchKeyword(r, campos({ titulo: 'Jumex y Nestle firman acuerdo' }));
    expect(res).not.toBeNull();
    expect(res!.tipo_match).toBe('booleana');
    expect(res!.texto_match.toLowerCase()).toContain('jumex');
  });
});

describe('selección de campo de mayor peso', () => {
  it('prefiere título sobre resumen para el score', () => {
    const r = rule({ tipo: 'contiene', terminos: ['tequila'] });
    const res = matchKeyword(r, campos({ titulo: 'tequila', resumen: 'otro tequila' }));
    expect(res!.campo).toBe('titulo');
    expect(res!.score).toBe(1.0);
  });
});
