import { describe, it, expect } from 'vitest';
import {
  clasificarAprobacion,
  esRevisionHumanaConocida,
  normalizarTitulo,
  TITULOS_APROBADOS,
  TITULOS_REVISION_HUMANA,
} from '../src/editorial/patronApproval.js';

describe('clasificarAprobacion', () => {
  it('las 6 aprobadas se clasifican APROBADO', () => {
    for (const t of TITULOS_APROBADOS) {
      expect(clasificarAprobacion(t)).toBe('APROBADO');
    }
  });

  it('las 3 retenidas se clasifican REVISION_HUMANA', () => {
    for (const t of TITULOS_REVISION_HUMANA) {
      expect(clasificarAprobacion(t)).toBe('REVISION_HUMANA');
    }
  });

  it('un título desconocido (no en ninguna lista) es REVISION_HUMANA por defecto', () => {
    expect(clasificarAprobacion('Un título completamente nuevo que nadie revisó')).toBe('REVISION_HUMANA');
  });

  it('exactamente 6 aprobadas y 3 en revisión (9 total, sin exclusiones)', () => {
    expect(TITULOS_APROBADOS).toHaveLength(6);
    expect(TITULOS_REVISION_HUMANA).toHaveLength(3);
  });

  it('ninguna aprobada coincide con las de revisión (conjuntos disjuntos)', () => {
    const aprobadasNorm = new Set(TITULOS_APROBADOS.map(normalizarTitulo));
    for (const t of TITULOS_REVISION_HUMANA) {
      expect(aprobadasNorm.has(normalizarTitulo(t))).toBe(false);
    }
  });
});

describe('esRevisionHumanaConocida', () => {
  it('identifica las 3 retenidas conocidas', () => {
    for (const t of TITULOS_REVISION_HUMANA) {
      expect(esRevisionHumanaConocida(t)).toBe(true);
    }
  });

  it('no marca las aprobadas como revisión conocida', () => {
    for (const t of TITULOS_APROBADOS) {
      expect(esRevisionHumanaConocida(t)).toBe(false);
    }
  });
});

describe('normalizarTitulo', () => {
  it('normaliza comillas curvas a rectas', () => {
    expect(normalizarTitulo('“Hay agave pirata”, acusa Miguel Márquez'))
      .toBe(normalizarTitulo('"Hay agave pirata", acusa Miguel Márquez'));
  });

  it('colapsa espacios múltiples', () => {
    expect(normalizarTitulo('Detectan   tequila   adulterado')).toBe('Detectan tequila adulterado');
  });

  it('recorta espacios al inicio/fin', () => {
    expect(normalizarTitulo('  Morelos avanza en certificación del mezcal  ')).toBe('Morelos avanza en certificación del mezcal');
  });
});
