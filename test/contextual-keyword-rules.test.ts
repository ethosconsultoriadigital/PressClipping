import { describe, it, expect } from 'vitest';
import {
  esKeywordComercioAmpliaCli0002,
  tieneContextoBebidas,
  esCrisisBebidasDirecta,
  esKeywordLaboralAmpliaCli0003,
  tieneContextoLaboralAccionable,
  esOffTopicLaboral,
  pasaPuertaContextualLaboralCli0003,
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

// ---------------------------------------------------------------------------
// CLI-0003 Reforma laboral — puerta laboral
// ---------------------------------------------------------------------------

function reglaLaboral(keyword: string, cliente_id = 'CLI-0003'): KeywordRule {
  return {
    keyword_id: 'k', cliente_id, keyword,
    terminos: [keyword], tipo: 'contiene', regla: null,
    contextoIncluir: [], contextoExcluir: [],
  };
}

describe('CLI-0003 helpers', () => {
  it('esKeywordLaboralAmpliaCli0003 detecta las amplias', () => {
    for (const k of ['trabajadores', 'sindicato', 'derechos laborales', 'reforma laboral']) {
      expect(esKeywordLaboralAmpliaCli0003(k)).toBe(true);
    }
  });
  it('NO marca laborales fuertes como amplias', () => {
    for (const k of ['huelga', 'paro', 'contrato colectivo', 'salario mínimo', 'STPS', 'tribunal laboral']) {
      expect(esKeywordLaboralAmpliaCli0003(k)).toBe(false);
    }
  });
  it('tieneContextoLaboralAccionable reconoce señales fuertes y combos', () => {
    expect(tieneContextoLaboralAccionable('estalla huelga en la planta')).toBe(true);
    expect(tieneContextoLaboralAccionable('retenciones de salario ilegales')).toBe(true);
    expect(tieneContextoLaboralAccionable('acuden al tribunal laboral')).toBe(true);
    expect(tieneContextoLaboralAccionable('Sindicato Minero denuncia intromisión del narco')).toBe(true);
    expect(tieneContextoLaboralAccionable('columna de opinión sobre política general')).toBe(false);
  });
  it('esOffTopicLaboral marca off-topic sin contexto accionable', () => {
    expect(esOffTopicLaboral('análisis del T-MEC y la bolsa')).toBe(true);
    expect(esOffTopicLaboral('T-MEC y su capítulo laboral: nueva huelga')).toBe(false);
  });
});

describe('CLI-0003 DEBE bloquear (sin contexto laboral accionable)', () => {
  const casos: [string, Partial<Record<string, string>>][] = [
    ['trabajadores', { titulo: 'De la muerte del T-MEC al purgatorio de 10 años', texto: 'análisis político del tratado y sus trabajadores afectados' }],
    ['derechos laborales', { titulo: 'El valor de la palabra dada', texto: 'columna de opinión sobre la confianza y los derechos laborales del ciudadano' }],
    ['sindicato', { titulo: 'El sindicato de músicos cumple 70 años', texto: 'aniversario histórico sin conflicto actual' }],
    ['trabajadores', { titulo: 'Regreso a clases: trabajadores de limpieza preparan escuelas', texto: 'labores de mantenimiento' }],
    ['sindicato', { titulo: 'Sindicato de taxistas informa trámites vehiculares', texto: 'renovación de placas' }],
    ['trabajadores', { titulo: 'El dólar sube y golpea a los trabajadores', texto: 'macroeconomía y bolsa' }],
  ];
  for (const [kw, parts] of casos) {
    it(`bloquea "${kw}" en: ${parts.titulo}`, () => {
      expect(matchKeyword(reglaLaboral(kw), campos(parts))).toBeNull();
      const p = pasaPuertaContextualLaboralCli0003({ cliente_id: 'CLI-0003', keyword: kw, texto: `${parts.titulo} ${parts.texto ?? ''}` });
      expect(p.pasa).toBe(false);
      expect(p.razon).toBe('contexto_laboral_ausente');
    });
  }
});

describe('CLI-0003 DEBE pasar (con contexto laboral accionable)', () => {
  const casos: [string, Partial<Record<string, string>>][] = [
    ['trabajadores', { titulo: 'Trabajadores del Monte de Piedad estallan huelga' }],
    ['trabajadores', { titulo: 'Paro de trabajadores de la UAS por adeudos' }],
    ['sindicato', { titulo: 'Sindicato firma contrato colectivo con la empresa' }],
    ['sindicato', { titulo: 'El sindicato avanza en la negociación colectiva' }],
    ['derechos laborales', { titulo: 'Denuncian retenciones de salario', texto: 'derechos laborales vulnerados' }],
    ['trabajadores', { titulo: 'Trabajadores desaparecidos de la CFE' }],
    ['sindicato', { titulo: 'Sindicato Minero denuncia intromisión del narco' }],
    ['trabajadores', { titulo: 'Despidos masivos en la planta', texto: 'trabajadores afectados' }],
    ['trabajadores', { titulo: 'STPS interviene en el tribunal laboral', texto: 'trabajadores presentan queja' }],
    ['sindicato', { titulo: 'Denuncian outsourcing ilegal', texto: 'el sindicato exige subcontratación regulada' }],
  ];
  for (const [kw, parts] of casos) {
    it(`pasa "${kw}" en: ${parts.titulo}`, () => {
      expect(matchKeyword(reglaLaboral(kw), campos(parts))).not.toBeNull();
    });
  }
});

describe('CLI-0003 no afecta keywords fuertes ni otros clientes', () => {
  it('keyword fuerte "huelga" pasa sin exigir contexto extra', () => {
    expect(matchKeyword(reglaLaboral('huelga'), campos({ titulo: 'Estalla la huelga' }))).not.toBeNull();
  });
  it('salario mínimo (fuerte) pasa', () => {
    expect(matchKeyword(reglaLaboral('salario mínimo'), campos({ titulo: 'Sube el salario mínimo' }))).not.toBeNull();
  });
  it('trabajadores en otro cliente no se bloquea', () => {
    expect(matchKeyword(reglaLaboral('trabajadores', 'CLI-0001'), campos({ titulo: 'Los trabajadores de la empresa' }))).not.toBeNull();
  });
});
