import { describe, it, expect } from 'vitest';
import {
  esKeywordComercioAmpliaCli0002,
  tieneContextoBebidas,
  esCrisisBebidasDirecta,
  pasaPuertaContextualClienteKeyword,
} from '../src/matching/contextualKeywordRules.js';
import {
  matchKeyword,
  PESOS_CAMPO,
  type KeywordRule,
  type CampoBuscable,
} from '../src/matchers/keyword.js';

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

function reglaComercio(keyword: string, cliente_id = 'CLI-0002'): KeywordRule {
  return {
    keyword_id: 'k', cliente_id, keyword,
    terminos: [keyword], tipo: 'contiene', regla: null,
    contextoIncluir: [], contextoExcluir: [],
  };
}

describe('helpers de contexto', () => {
  it('esKeywordComercioAmpliaCli0002 detecta las amplias (folded)', () => {
    for (const k of ['T-MEC', 'TMEC', 'aranceles', 'Arancel', 'comercio exterior', 'exportación', 'Exportaciones']) {
      expect(esKeywordComercioAmpliaCli0002(k)).toBe(true);
    }
  });
  it('esKeywordComercioAmpliaCli0002 NO marca keywords específicas de bebidas', () => {
    for (const k of ['tequila', 'arancel al tequila', 'exportación de tequila', 'mezcal']) {
      expect(esKeywordComercioAmpliaCli0002(k)).toBe(false);
    }
  });
  it('tieneContextoBebidas detecta familias de bebidas', () => {
    expect(tieneContextoBebidas('exportación de tequila crece')).toBe(true);
    expect(tieneContextoBebidas('la industria tequilera de Jalisco')).toBe(true);
    expect(tieneContextoBebidas('Bacardí y Patrón')).toBe(true);
    expect(tieneContextoBebidas('el agave azul')).toBe(true);
    expect(tieneContextoBebidas('Trump y los aranceles a los autos')).toBe(false);
    expect(tieneContextoBebidas('T-MEC y la ciudadanía')).toBe(false);
  });
  it('esCrisisBebidasDirecta reconoce metanol/adulterado', () => {
    expect(esCrisisBebidasDirecta('metanol en la bebida')).toBe(true);
    expect(esCrisisBebidasDirecta('tequila adulterado decomisado')).toBe(true);
    expect(esCrisisBebidasDirecta('aranceles a China')).toBe(false);
  });
});

describe('CLI-0002 comercio DEBE bloquear (sin bebidas)', () => {
  const casos: [string, string][] = [
    ['T-MEC', 'Trump no rompe el T-MEC, lo desgasta'],
    ['aranceles', 'Nuevos aranceles a los autos y al acero de China'],
    ['comercio exterior', 'Comercio exterior y el debate por la ciudadanía y migración'],
    ['aranceles', 'Aranceles golpean al dólar y a la bolsa'],
    ['T-MEC', 'Revisión general del T-MEC: revés a Trump'],
    ['exportaciones', 'Crecen las exportaciones de aguacate y maíz'],
  ];
  for (const [kw, titulo] of casos) {
    it(`bloquea "${kw}" en: ${titulo}`, () => {
      const res = matchKeyword(reglaComercio(kw), campos({ titulo }));
      expect(res).toBeNull();
      const puerta = pasaPuertaContextualClienteKeyword({ cliente_id: 'CLI-0002', keyword: kw, texto: titulo });
      expect(puerta.pasa).toBe(false);
      expect(puerta.razon).toBe('contexto_bebidas_ausente');
    });
  }
});

describe('CLI-0002 comercio DEBE pasar (con contexto bebidas)', () => {
  const casos: [string, Partial<Record<string, string>>][] = [
    ['T-MEC', { titulo: 'T-MEC y la exportación de tequila a EU' }],
    ['aranceles', { titulo: 'Aranceles al tequila preocupan a la industria' }],
    ['comercio exterior', { titulo: 'Comercio exterior', texto: 'la industria tequilera exporta más' }],
    ['exportaciones', { titulo: 'Exportaciones de mezcal rompen récord' }],
    ['aranceles', { titulo: 'Bacardí y Patrón ante nuevos aranceles' }],
    ['T-MEC', { titulo: 'El agave y el T-MEC: futuro del sector' }],
    ['comercio exterior', { titulo: 'Bebidas alcohólicas y comercio exterior' }],
  ];
  for (const [kw, parts] of casos) {
    it(`pasa "${kw}" en: ${parts.titulo}`, () => {
      const res = matchKeyword(reglaComercio(kw), campos(parts));
      expect(res).not.toBeNull();
    });
  }
});

describe('CLI-0002 crisis directa no se rompe', () => {
  // Las keywords de crisis NO son comerciales amplias → la puerta no aplica.
  it('keyword de crisis pasa aunque no sea comercial', () => {
    const r: KeywordRule = { keyword_id: 'k', cliente_id: 'CLI-0002', keyword: 'tequila adulterado',
      terminos: ['tequila adulterado'], tipo: 'frase_exacta', regla: null, contextoIncluir: [], contextoExcluir: [] };
    expect(matchKeyword(r, campos({ titulo: 'Cofepris alerta por tequila adulterado' }))).not.toBeNull();
  });
  it('comercio + crisis directa (metanol) pasa', () => {
    const p = pasaPuertaContextualClienteKeyword({ cliente_id: 'CLI-0002', keyword: 'aranceles', texto: 'metanol en bebidas decomisadas' });
    expect(p.pasa).toBe(true);
  });
});

describe('no regresión: otros clientes/keywords', () => {
  it('CLI-0003 laboral no es afectado por la puerta comercio', () => {
    for (const kw of ['huelga', 'paro', 'contrato colectivo', 'trabajadores', 'sindicato']) {
      const p = pasaPuertaContextualClienteKeyword({ cliente_id: 'CLI-0003', keyword: kw, texto: 'huelga de trabajadores en la planta' });
      expect(p.pasa).toBe(true);
    }
  });
  it('CLI-0002 con keyword NO comercial (tequila) no requiere puerta extra', () => {
    const r: KeywordRule = { keyword_id: 'k', cliente_id: 'CLI-0002', keyword: 'tequila',
      terminos: ['tequila'], tipo: 'exacta', regla: null, contextoIncluir: [], contextoExcluir: [] };
    expect(matchKeyword(r, campos({ titulo: 'Nuevo tequila premium en el mercado' }))).not.toBeNull();
  });
  it('otro cliente con keyword comercial no se bloquea', () => {
    const r = reglaComercio('aranceles', 'CLI-0009');
    expect(matchKeyword(r, campos({ titulo: 'Aranceles a los autos de China' }))).not.toBeNull();
  });
});
