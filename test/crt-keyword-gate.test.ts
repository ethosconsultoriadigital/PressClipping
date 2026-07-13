/**
 * Tests de la afinación de la keyword CRT (KEY-0063) a nivel matcher.
 *
 * Replica la regla afinada (exacta_contextual + contexto_incluir tequilero) y
 * verifica que "CRT" solo matchee con contexto de tequila/bebidas, bloqueando
 * los FP de tecnología ("CRT monitor/display/technology").
 */
import { describe, it, expect } from 'vitest';
import { matchKeyword, splitTerminos, PESOS_CAMPO, type KeywordRule, type CampoBuscable } from '../src/matchers/keyword.js';

const CONTEXTO_INCLUIR =
  'tequila|agave|mezcal|destilado|destilados|bebida|bebidas|alcohol|alcoholica|alcoholicas|' +
  'licor|licores|denominación de origen|denominacion de origen|consejo regulador|' +
  'industria tequilera|tequilera|espirituosa|espirituosas|NOM-006|NOM-070|COMERCAM';

const REGLA_CRT: KeywordRule = {
  keyword_id: 'KEY-0063',
  cliente_id: 'CLI-0002',
  keyword: 'Consejo Regulador del Tequila',
  terminos: splitTerminos('Consejo Regulador del Tequila', 'CRT'),
  tipo: 'exacta_contextual',
  regla: null,
  contextoIncluir: splitTerminos(CONTEXTO_INCLUIR),
  contextoExcluir: [],
};

function campos(titulo: string, cuerpo = ''): CampoBuscable[] {
  return [
    { nombre: 'titulo', texto: titulo, peso: PESOS_CAMPO.titulo! },
    { nombre: 'texto_extraido', texto: cuerpo, peso: PESOS_CAMPO.texto_extraido! },
    { nombre: 'medio', texto: 'Medio X', peso: PESOS_CAMPO.medio! },
  ];
}

describe('CRT keyword gate (KEY-0063 afinada)', () => {
  it('"Consejo Regulador del Tequila" pasa (frase completa con tequila)', () => {
    expect(matchKeyword(REGLA_CRT, campos('El Consejo Regulador del Tequila anuncia nuevas normas'))).not.toBeNull();
  });

  it('"CRT del tequila" pasa (CRT + contexto tequila)', () => {
    expect(matchKeyword(REGLA_CRT, campos('El CRT del tequila reporta cifras récord'))).not.toBeNull();
  });

  it('"tequila ... CRT" pasa (contexto tequila + CRT)', () => {
    expect(matchKeyword(REGLA_CRT, campos('Producción de tequila crece; el CRT lo confirma'))).not.toBeNull();
  });

  it('"CRT monitor" BLOQUEA (tech, sin contexto tequila)', () => {
    expect(matchKeyword(REGLA_CRT, campos('Reparar un CRT monitor viejo: guía paso a paso'))).toBeNull();
  });

  it('"CRT display" BLOQUEA (tech)', () => {
    expect(matchKeyword(REGLA_CRT, campos('La nostalgia de los CRT display en videojuegos'))).toBeNull();
  });

  it('"CRT technology" BLOQUEA (tech)', () => {
    expect(matchKeyword(REGLA_CRT, campos('CRT technology returns in a niche gaming market'))).toBeNull();
  });

  it('"CFE Internet…" (FP real observado) BLOQUEA', () => {
    expect(matchKeyword(REGLA_CRT, campos('CFE Internet por 35 pesos al mes: qué incluye el paquete CRT'))).toBeNull();
  });

  it('"certificado CRT" sin tequila BLOQUEA', () => {
    expect(matchKeyword(REGLA_CRT, campos('Empresa obtiene certificado CRT de calidad industrial'))).toBeNull();
  });

  it('contexto tequila en el cuerpo (no solo título) también abre la puerta', () => {
    expect(matchKeyword(REGLA_CRT, campos('El CRT emite comunicado', 'El organismo regula la industria del tequila y el agave azul'))).not.toBeNull();
  });
});
