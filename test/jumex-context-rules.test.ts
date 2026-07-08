import { describe, it, expect } from 'vitest';
import {
  esKeywordJumexAmpliaCli0001,
  tieneContextoCrisisJumex,
  tieneContextoRegulatorioJumex,
  tieneContextoCorporativoJumex,
  esContextoJumexBajoValor,
  esTituloJumexBajoValor,
  pasaPuertaContextualJumexCli0001,
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

/** Regla Jumex amplia (KEY-0001) para probar el gate a través del matcher. */
function reglaJumex(keyword = 'Jumex', keyword_id = 'KEY-0001'): KeywordRule {
  return {
    keyword_id,
    cliente_id: 'CLI-0001',
    keyword,
    terminos: keyword === 'Jumex' ? ['jumex', 'grupo jumex'] : [keyword.toLowerCase()],
    tipo: 'contiene',
    regla: 'contiene',
    contextoIncluir: [],
    contextoExcluir: [],
  };
}

describe('CLI-0001 Jumex — identificación de keyword amplia', () => {
  it('reconoce las keywords amplias que se gatean', () => {
    expect(esKeywordJumexAmpliaCli0001('Jumex')).toBe(true);
    expect(esKeywordJumexAmpliaCli0001('bebidas azucaradas')).toBe(true);
    expect(esKeywordJumexAmpliaCli0001('jugos')).toBe(true);
    expect(esKeywordJumexAmpliaCli0001('néctares')).toBe(true);
  });
  it('NO gatea Museo Jumex (marca específica del museo)', () => {
    expect(esKeywordJumexAmpliaCli0001('Museo Jumex')).toBe(false);
  });
});

describe('CLI-0001 Jumex — Nivel A crisis/regulatorio (permitir)', () => {
  const casos: Array<[string, string]> = [
    ['COFEPRIS emite alerta sobre producto Jumex contaminado', ''],
    ['Profeco sanciona a Jumex por publicidad engañosa', ''],
    ['Retiro de lote de jugo Jumex por contaminación', ''],
    ['Planta Jumex enfrenta huelga de trabajadores', ''],
  ];
  for (const [titulo, cuerpo] of casos) {
    it(`permite: "${titulo}"`, () => {
      const r = pasaPuertaContextualJumexCli0001({ cliente_id: 'CLI-0001', keyword: 'Jumex', texto: `${titulo}\n${cuerpo}`, titulo, cuerpo, terminos: ['jumex'] });
      expect(r.pasa).toBe(true);
      expect(r.nivel).toBe('A');
    });
  }

  it('permite IEPS a bebidas azucaradas que impacta jugos y néctares (regulatorio con categoría)', () => {
    const titulo = 'IEPS a bebidas azucaradas impacta a jugos y néctares del país';
    const r = pasaPuertaContextualJumexCli0001({ cliente_id: 'CLI-0001', keyword: 'bebidas azucaradas', texto: titulo, titulo, cuerpo: '', terminos: ['bebidas azucaradas', 'jugos', 'nectares'] });
    expect(r.pasa).toBe(true);
    expect(r.nivel).toBe('A');
  });

  it('permite etiquetado frontal que afecta bebidas azucaradas y jugos', () => {
    const titulo = 'Etiquetado frontal afecta a bebidas azucaradas y jugos';
    const r = pasaPuertaContextualJumexCli0001({ cliente_id: 'CLI-0001', keyword: 'bebidas azucaradas', texto: titulo, titulo, cuerpo: '', terminos: ['bebidas azucaradas', 'jugos'] });
    expect(r.pasa).toBe(true);
  });
});

describe('CLI-0001 Jumex — Nivel B corporativo (permitir sin urgencia)', () => {
  it('permite: Grupo Jumex anuncia inversión en nueva planta', () => {
    const titulo = 'Grupo Jumex anuncia inversión de mil millones en nueva planta';
    const r = pasaPuertaContextualJumexCli0001({ cliente_id: 'CLI-0001', keyword: 'Jumex', texto: titulo, titulo, cuerpo: '', terminos: ['jumex', 'grupo jumex'] });
    expect(r.pasa).toBe(true);
    expect(r.nivel).toBe('B');
  });
  it('permite: Jumex incrementa exportaciones de jugos', () => {
    const titulo = 'Jumex incrementa sus exportaciones de jugos a Estados Unidos';
    const r = pasaPuertaContextualJumexCli0001({ cliente_id: 'CLI-0001', keyword: 'Jumex', texto: titulo, titulo, cuerpo: '', terminos: ['jumex'] });
    expect(r.pasa).toBe(true);
    expect(r.nivel).toBe('B');
  });
});

describe('CLI-0001 Jumex — Nivel C promo retail / bajo valor (bloquear)', () => {
  const bloquear: string[] = [
    'Julio Regalado en Soriana: ofertas de Jumex que puedes aprovechar',
    'Jumex 3x2 en el supermercado esta semana',
    'Descuento en jugo Jumex durante la Temporada Naranja',
    'Receta: agua fresca con jugo Jumex para el verano',
    'Lonchera saludable con Jumex para regreso a clases',
    'Catálogo de ofertas Soriana con los mejores precios',
  ];
  for (const titulo of bloquear) {
    it(`bloquea: "${titulo}"`, () => {
      const r = pasaPuertaContextualJumexCli0001({ cliente_id: 'CLI-0001', keyword: 'Jumex', texto: titulo, titulo, cuerpo: '', terminos: ['jumex'] });
      expect(r.pasa).toBe(false);
      expect(r.razon).toMatch(/promocion_retail|bajo_valor/);
    });
  }

  it('bloquea bebidas azucaradas genéricas sin Jumex ni IEPS ni categoría relevante', () => {
    const titulo = 'Consejos para reducir el consumo de bebidas azucaradas en verano';
    const r = pasaPuertaContextualJumexCli0001({ cliente_id: 'CLI-0001', keyword: 'bebidas azucaradas', texto: titulo, titulo, cuerpo: 'Nutriólogos recomiendan agua simple.', terminos: ['bebidas azucaradas'] });
    expect(r.pasa).toBe(false);
    expect(r.razon).toBe('jumex_contexto_insuficiente');
  });

  it('bloquea jugo sin marca en receta', () => {
    const titulo = 'Prepara este coctel con jugo natural';
    const r = pasaPuertaContextualJumexCli0001({ cliente_id: 'CLI-0001', keyword: 'jugos', texto: titulo, titulo, cuerpo: '', terminos: ['jugos', 'jugo'] });
    expect(r.pasa).toBe(false);
  });
});

describe('CLI-0001 Jumex — crisis domina sobre promo en título', () => {
  it('permite crisis aunque haya término de oferta (Profeco > promo)', () => {
    const titulo = 'Profeco investiga promoción engañosa de Jumex en Soriana';
    // 'promocion'/'soriana' está en título (bajo valor) pero crisis Profeco+Jumex debe ganar (Nivel A primero).
    const r = pasaPuertaContextualJumexCli0001({ cliente_id: 'CLI-0001', keyword: 'Jumex', texto: titulo, titulo, cuerpo: '', terminos: ['jumex'] });
    expect(r.pasa).toBe(true);
    expect(r.nivel).toBe('A');
  });
});

describe('CLI-0001 Jumex — integración con matchKeyword (bypass contexto BD)', () => {
  it('bloquea promo retail Soriana aun con Jumex en título', () => {
    expect(matchKeyword(reglaJumex(), campos({ titulo: 'Julio Regalado en Soriana: ofertas de Jumex 3x2' }))).toBeNull();
  });
  it('permite crisis real de Jumex', () => {
    expect(matchKeyword(reglaJumex(), campos({ titulo: 'Profeco sanciona a Jumex por etiquetado' }))).not.toBeNull();
  });
  it('permite corporativo real de Jumex', () => {
    expect(matchKeyword(reglaJumex(), campos({ titulo: 'Grupo Jumex anuncia inversión en planta' }))).not.toBeNull();
  });
});

describe('CLI-0001 Jumex — helpers de contexto', () => {
  it('esTituloJumexBajoValor detecta promo retail en título', () => {
    expect(esTituloJumexBajoValor('Ofertas Julio Regalado Soriana')).toBe(true);
    expect(esTituloJumexBajoValor('Grupo Jumex invierte en planta')).toBe(false);
  });
  it('esContextoJumexBajoValor detecta supermercado/gastronomía', () => {
    expect(esContextoJumexBajoValor('descuento en chedraui')).toBe(true);
    expect(esContextoJumexBajoValor('receta de licuado')).toBe(true);
    expect(esContextoJumexBajoValor('inversión en exportaciones')).toBe(false);
  });
  it('tieneContextoCrisisJumex y regulatorio/corporativo responden por proximidad', () => {
    expect(tieneContextoCrisisJumex('COFEPRIS alerta por Jumex', '', ['jumex'])).toBe(true);
    expect(tieneContextoRegulatorioJumex('IEPS a jugos', '', ['jugos'])).toBe(true);
    expect(tieneContextoCorporativoJumex('Grupo Jumex nueva planta', '', ['jumex', 'grupo jumex'])).toBe(true);
  });
});

describe('no regresión — otros clientes no se afectan por el gate Jumex', () => {
  it('CLI-0002 tequila adulterado sigue permitido', () => {
    const r = pasaPuertaContextualClienteKeyword({ cliente_id: 'CLI-0002', keyword: 'tequila', texto: 'Tequila adulterado deja intoxicados', titulo: 'Tequila adulterado deja intoxicados', cuerpo: '', terminos: ['tequila'] });
    expect(r.pasa).toBe(true);
  });
  it('CLI-0002 turismo tequila sigue bloqueado', () => {
    const r = pasaPuertaContextualClienteKeyword({ cliente_id: 'CLI-0002', keyword: 'tequila', texto: 'Festival del tequila con conciertos', titulo: 'Festival del tequila con conciertos', cuerpo: '', terminos: ['tequila'] });
    expect(r.pasa).toBe(false);
  });
  it('CLI-0003 keyword laboral amplia sin contexto se bloquea; con huelga pasa', () => {
    const base = { cliente_id: 'CLI-0003', keyword: 'trabajadores' };
    expect(pasaPuertaContextualClienteKeyword({ ...base, texto: 'Trabajadores disfrutan del clima' }).pasa).toBe(false);
    expect(pasaPuertaContextualClienteKeyword({ ...base, texto: 'Trabajadores estallan huelga en la planta' }).pasa).toBe(true);
  });
  it('CLI-0001 keyword NO amplia (Museo Jumex) no pasa por el gate (pasa por defecto)', () => {
    const r = pasaPuertaContextualClienteKeyword({ cliente_id: 'CLI-0001', keyword: 'Museo Jumex', texto: 'Exposición en el Museo Jumex', titulo: 'Exposición en el Museo Jumex', cuerpo: '' });
    expect(r.pasa).toBe(true);
  });
});
