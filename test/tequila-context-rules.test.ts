import { describe, it, expect } from 'vitest';
import {
  esKeywordTequilaAmpliaCli0002,
  tieneContextoCrisisTequila,
  tieneContextoIndustriaTequila,
  esContextoTequilaBajoValor,
  pasaPuertaContextualTequilaCli0002,
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

/** Regla tequila con la config REAL rígida de KEY-0003 (para probar el bypass). */
function reglaTequila(): KeywordRule {
  return {
    keyword_id: 'KEY-0003',
    cliente_id: 'CLI-0002',
    keyword: 'tequila',
    terminos: ['tequila', 'industria tequilera', 'agave'],
    tipo: 'contiene',
    regla: 'contiene',
    contextoIncluir: [
      'industria tequilera', 'Consejo Regulador del Tequila', 'CRT',
      'denominación de origen', 'agave azul', 'producción de tequila',
      'exportación de tequila', 'Jalisco', 'tequilero',
    ],
    contextoExcluir: [
      'vodka', 'ron', 'licor', 'desalojo', 'aseguramiento', 'operativo',
      'decomiso', 'botellas', 'bar', 'cantina', 'fiesta', 'CNDH', 'drogas',
      'detenido', 'detenidos', 'policia', 'fiscalia',
    ],
  };
}

describe('esKeywordTequilaAmpliaCli0002', () => {
  it('detecta la keyword amplia (folded)', () => {
    for (const k of ['tequila', 'Tequila', 'TEQUILA', 'industria tequilera', 'agave']) {
      expect(esKeywordTequilaAmpliaCli0002(k)).toBe(true);
    }
  });
  it('no marca otras keywords', () => {
    for (const k of ['mezcal', 'bebidas adulteradas', 'T-MEC', 'Jumex', 'tequila añejo']) {
      expect(esKeywordTequilaAmpliaCli0002(k)).toBe(false);
    }
  });
});

describe('detección de niveles', () => {
  it('Nivel A — crisis/salud cercana a tequila', () => {
    expect(tieneContextoCrisisTequila('Tequila adulterado deja intoxicados', '')).toBe(true);
    expect(tieneContextoCrisisTequila('Muere hombre por tequila con metanol', '')).toBe(true);
    expect(tieneContextoCrisisTequila('Caen ventas de tequila Centenario tras intoxicaciones en Guanajuato', '')).toBe(true);
  });
  it('Nivel B — industria/comercio cercana a tequila', () => {
    expect(tieneContextoIndustriaTequila('Aranceles al tequila golpean exportaciones', '')).toBe(true);
    expect(tieneContextoIndustriaTequila('Industria tequilera ante el T-MEC', '')).toBe(true);
  });
  it('Nivel C — bajo valor', () => {
    expect(esContextoTequilaBajoValor('Pueblo Mágico Tequila atrae turistas')).toBe(true);
    expect(esContextoTequilaBajoValor('Festival del tequila con conciertos')).toBe(true);
  });
});

describe('pasaPuertaContextualTequilaCli0002 (política 3 niveles)', () => {
  const bloquea = [
    'Pueblo Mágico Tequila atrae turistas este verano',
    'Festival del tequila 2026 con conciertos en vivo',
    'Recetas con tequila para el verano',
    'Ranking de destinos para tomar tequila',
    'Wendy Guevara inaugura cantina con degustación de tequila',
    'Tequila Patrón amplía campaña para celebrar el orgullo mexicano',
  ];
  for (const t of bloquea) {
    it(`bloquea bajo valor: "${t.slice(0, 40)}"`, () => {
      const r = pasaPuertaContextualTequilaCli0002({ cliente_id: 'CLI-0002', keyword: 'tequila', texto: t, titulo: t, cuerpo: '' });
      expect(r.pasa).toBe(false);
    });
  }

  const crisis = [
    'Tequila adulterado deja intoxicados en Guanajuato',
    'Muere hombre por tequila con metanol',
    'COFEPRIS alerta por tequila adulterado',
    'Catean vinaterías por venta de tequila adulterado',
    'Caen ventas de tequila Centenario tras intoxicaciones en Guanajuato',
  ];
  for (const t of crisis) {
    it(`permite crisis (A): "${t.slice(0, 40)}"`, () => {
      const r = pasaPuertaContextualTequilaCli0002({ cliente_id: 'CLI-0002', keyword: 'tequila', texto: t, titulo: t, cuerpo: '' });
      expect(r.pasa).toBe(true);
      expect(r.nivel).toBe('A');
    });
  }

  const industria = [
    'Aranceles al tequila golpean exportaciones',
    'Exportación de tequila rompe récord hacia Reino Unido',
    'Industria tequilera se prepara ante el T-MEC',
    'CRT advierte impacto regulatorio en el tequila',
    'IEPS a bebidas alcohólicas afectará al tequila',
    'Patrón y Bacardí ante nuevos aranceles al tequila',
  ];
  for (const t of industria) {
    it(`permite industria (B): "${t.slice(0, 40)}"`, () => {
      const r = pasaPuertaContextualTequilaCli0002({ cliente_id: 'CLI-0002', keyword: 'tequila', texto: t, titulo: t, cuerpo: '' });
      expect(r.pasa).toBe(true);
      expect(r.nivel).toBe('B');
    });
  }

  it('bloquea por contexto insuficiente', () => {
    const r = pasaPuertaContextualTequilaCli0002({ cliente_id: 'CLI-0002', keyword: 'tequila', texto: 'Tequila', titulo: 'Tequila', cuerpo: '' });
    expect(r.pasa).toBe(false);
    expect(r.razon).toBe('tequila_contexto_insuficiente');
  });

  it('override: título de evento bloquea aunque el cuerpo tenga industria', () => {
    const r = pasaPuertaContextualTequilaCli0002({
      cliente_id: 'CLI-0002', keyword: 'tequila',
      texto: '', titulo: 'Fiesta de la Cerveza reúne a productores en Cuerámaro',
      cuerpo: 'El evento destacó la denominación de origen del agave y la industria tequilera.',
    });
    expect(r.pasa).toBe(false);
    expect(r.razon).toBe('tequila_contexto_bajo_valor');
  });

  it('industria real (título no evento) pasa aunque el cuerpo mencione fiesta', () => {
    const r = pasaPuertaContextualTequilaCli0002({
      cliente_id: 'CLI-0002', keyword: 'tequila',
      texto: '', titulo: 'Exportación de tequila crece hacia Reino Unido',
      cuerpo: 'La noticia se dio durante la fiesta patronal del municipio.',
    });
    expect(r.pasa).toBe(true);
    expect(r.nivel).toBe('B');
  });

  it('la crisis gana sobre el bajo valor (adulterado en festival)', () => {
    const t = 'Muertes por tequila adulterado durante festival';
    const r = pasaPuertaContextualTequilaCli0002({ cliente_id: 'CLI-0002', keyword: 'tequila', texto: t, titulo: t, cuerpo: '' });
    expect(r.pasa).toBe(true);
    expect(r.nivel).toBe('A');
  });
});

describe('matchKeyword con KEY-0003 real (el gate de código es autoridad)', () => {
  it('RECUPERA crisis que la config rígida bloqueaba (sin término industrial)', () => {
    // "tequila adulterado ... Guanajuato" no tiene contexto_incluir industrial ni
    // Jalisco → antes se bloqueaba; ahora el gate de código lo permite (Nivel A).
    const m = matchKeyword(reglaTequila(), campos({
      titulo: 'Tequila adulterado deja intoxicados en Guanajuato',
      texto: 'La COFEPRIS emitió una alerta sanitaria por metanol.',
    }));
    expect(m).not.toBeNull();
  });

  it('BLOQUEA turismo pese a que contexto_excluir no cubría todo', () => {
    const m = matchKeyword(reglaTequila(), campos({
      titulo: 'Ruta turística del tequila en el Pueblo Mágico',
      texto: 'Un destino ideal para viajar y conocer la cultura del agave.',
    }));
    expect(m).toBeNull();
  });

  it('permite industria/comercio real', () => {
    const m = matchKeyword(reglaTequila(), campos({
      titulo: 'Exportación de tequila rompe récord ante aranceles',
      texto: 'La industria tequilera analiza el impacto del T-MEC.',
    }));
    expect(m).not.toBeNull();
  });

  it('bloquea homónimo del municipio (crimen sin crisis de bebida)', () => {
    const m = matchKeyword(reglaTequila(), campos({
      titulo: 'Detienen a hombre armado en Tequila',
      texto: 'El detenido fue puesto a disposición de la fiscalía por robo.',
    }));
    expect(m).toBeNull();
  });
});

describe('no regresión de otros clientes/keywords', () => {
  function regla(keyword: string, cliente_id: string | null, extra?: Partial<KeywordRule>): KeywordRule {
    return {
      keyword_id: 'k', cliente_id, keyword, terminos: [keyword], tipo: 'contiene',
      regla: null, contextoIncluir: [], contextoExcluir: [], ...extra,
    };
  }

  it('keywords de crisis dedicadas de CLI-0002 no se ven afectadas', () => {
    const m = matchKeyword(regla('alcohol adulterado', 'CLI-0002', { tipo: 'frase_exacta' }), campos({
      titulo: 'Alcohol adulterado deja varios muertos',
    }));
    expect(m).not.toBeNull();
  });

  it('CLI-0001 Jumex no pasa por el gate de tequila', () => {
    const m = matchKeyword(regla('Jumex', 'CLI-0001'), campos({
      titulo: 'Jumex lanza nuevo néctar de mango',
    }));
    expect(m).not.toBeNull();
  });

  it('CLI-0003 laboral sigue exigiendo contexto laboral', () => {
    const r = pasaPuertaContextualClienteKeyword({
      cliente_id: 'CLI-0003', keyword: 'trabajadores',
      texto: 'Los trabajadores del hotel disfrutaron el torneo de futbol',
    });
    expect(r.pasa).toBe(false);
  });

  it('comercio amplio CLI-0002 sigue exigiendo bebidas', () => {
    const r = pasaPuertaContextualClienteKeyword({
      cliente_id: 'CLI-0002', keyword: 'aranceles',
      texto: 'Trump impone aranceles a la industria automotriz',
      titulo: 'Trump impone aranceles a la industria automotriz', cuerpo: '',
    });
    expect(r.pasa).toBe(false);
  });
});
