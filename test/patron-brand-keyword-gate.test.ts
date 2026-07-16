/**
 * Tests a nivel matcher de las keywords de marca Patrón reforzadas (CLI-0002).
 *
 * Verifica que:
 *  - "Patrón" solo (KEY-0069, exacta_contextual) matchee con contexto de marca/
 *    tequila y BLOQUEE la palabra común (jefe, patrón de conducta/diseño, santo
 *    patrón, etc.).
 *  - El orden invertido "Patrón Tequila" (alias de KEY-0060) matchee.
 *  - "Bacardí México" (alias de KEY-0015) matchee como marca.
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

// ─── KEY-0069 "Patrón" solo (exacta_contextual) ──────────────────────────────

const CTX_PATRON_MARCA =
  'tequila|Casa Patrón|Casa Patron|Atotonilco|Bacardí|Bacardi|agave|destilería|destileria|' +
  'Consejo Regulador|CRT|denominación de origen|denominacion de origen|John Paul DeJoria|' +
  'spirits|espirituosa|espirituoso|licor|añejo|anejo|reposado|blanco|cristalino';
const EXC_PATRON_COMUN =
  'patrón de conducta|patron de conducta|patrón de comportamiento|patron de comportamiento|' +
  'patrón de consumo|patron de consumo|patrón de diseño|patron de diseno|patrón climático|patron climatico|' +
  'patrón de oro|patron de oro|patrón alimentario|patron alimentario|patrón de sueño|patron de sueno|' +
  'jefe|empleador|patrón-trabajador|relación laboral|relacion laboral|santo patrón|santo patron|' +
  'patrón cultural|patron cultural|el patrón del mal|patrón de medida|patron de medida|patrón de gasto|patron de gasto';

const REGLA_PATRON: KeywordRule = {
  keyword_id: 'KEY-0069',
  cliente_id: 'CLI-0002',
  keyword: 'Patrón',
  terminos: splitTerminos('Patrón', 'Patron'),
  tipo: 'exacta_contextual',
  regla: null,
  contextoIncluir: splitTerminos(CTX_PATRON_MARCA),
  contextoExcluir: splitTerminos(EXC_PATRON_COMUN),
};

describe('KEY-0069 "Patrón" marca directa (exacta_contextual)', () => {
  it('"Patrón" con contexto tequila PASA', () => {
    expect(matchKeyword(REGLA_PATRON, campos('Patrón lanza nuevo tequila añejo cristalino'))).not.toBeNull();
  });

  it('"Patrón" + Casa Patrón/Atotonilco PASA', () => {
    expect(matchKeyword(REGLA_PATRON, campos('Patrón invierte en su destilería de Atotonilco'))).not.toBeNull();
  });

  it('"Patrón" + Bacardí (dueño de la marca) PASA', () => {
    expect(matchKeyword(REGLA_PATRON, campos('Bacardí reporta crecimiento de Patrón en el mercado de agave'))).not.toBeNull();
  });

  it('"patrón de conducta" BLOQUEA (palabra común)', () => {
    expect(matchKeyword(REGLA_PATRON, campos('Analizan el patrón de conducta de los votantes'))).toBeNull();
  });

  it('"patrón" como jefe/empleador BLOQUEA', () => {
    expect(matchKeyword(REGLA_PATRON, campos('El patrón no pagó el aguinaldo; conflicto con el empleador'))).toBeNull();
  });

  it('"santo patrón" BLOQUEA', () => {
    expect(matchKeyword(REGLA_PATRON, campos('Festejan al santo patrón del pueblo'))).toBeNull();
  });

  it('"patrón de diseño" BLOQUEA', () => {
    expect(matchKeyword(REGLA_PATRON, campos('Un nuevo patrón de diseño en arquitectura de software'))).toBeNull();
  });

  it('"Patrón" sin ningún contexto de marca/tequila BLOQUEA (exige contexto)', () => {
    expect(matchKeyword(REGLA_PATRON, campos('Cambia el patrón climático en el norte del país'))).toBeNull();
  });
});

// ─── KEY-0060 orden invertido "Patrón Tequila" (frase_exacta) ────────────────

const REGLA_TEQUILA_PATRON: KeywordRule = {
  keyword_id: 'KEY-0060',
  cliente_id: 'CLI-0002',
  keyword: 'Tequila Patrón',
  terminos: splitTerminos('Tequila Patrón', 'Tequila Patron|Patrón Tequila|Patron Tequila'),
  tipo: 'frase_exacta',
  regla: null,
  contextoIncluir: [],
  contextoExcluir: [],
};

describe('KEY-0060 orden invertido "Patrón Tequila"', () => {
  it('"Tequila Patrón" (orden original) PASA', () => {
    expect(matchKeyword(REGLA_TEQUILA_PATRON, campos('Tequila Patrón gana premio internacional'))).not.toBeNull();
  });

  it('"Patrón Tequila" (orden invertido, alias nuevo) PASA', () => {
    expect(matchKeyword(REGLA_TEQUILA_PATRON, campos('Patrón Tequila expands its US distribution'))).not.toBeNull();
  });

  it('"Patron Tequila" sin acento PASA', () => {
    expect(matchKeyword(REGLA_TEQUILA_PATRON, campos('Patron Tequila announces new bottling'))).not.toBeNull();
  });
});

// ─── KEY-0015 "Bacardí México" (contiene con contexto) ───────────────────────

const REGLA_BACARDI: KeywordRule = {
  keyword_id: 'KEY-0015',
  cliente_id: 'CLI-0002',
  keyword: 'Bacardí',
  terminos: splitTerminos('Bacardí', 'Bacardi|Bacardí México|Bacardi Mexico|Bacardí Mexico'),
  tipo: 'contiene',
  regla: null,
  contextoIncluir: splitTerminos('ron|bebidas alcohólicas|bebidas alcoholicas|destilados|marca|industria|producción|produccion|exportación|exportacion|spirits|Bacardí México|Bacardi Limited'),
  contextoExcluir: splitTerminos('calle|avenida|colonia|fraccionamiento|plaza|bulevar|residencial|apellido|persona|dirección|direccion|domicilio'),
};

describe('KEY-0015 "Bacardí México"', () => {
  it('"Bacardí México" con contexto de industria PASA', () => {
    expect(matchKeyword(REGLA_BACARDI, campos('Bacardí México anuncia inversión en su producción de ron y destilados'))).not.toBeNull();
  });

  it('"Bacardí" como nombre de calle BLOQUEA (contexto_excluir)', () => {
    expect(matchKeyword(REGLA_BACARDI, campos('Choque en la avenida Bacardí de la colonia centro'))).toBeNull();
  });
});
