import { describe, it, expect } from 'vitest';
import {
  ClasificacionSchema,
  buildUserPrompt,
  computeRequiereAlerta,
  type ClassifyInput,
  type Clasificacion,
} from '../src/ai/classifier.js';

function input(over: Partial<ClassifyInput> = {}): ClassifyInput {
  return {
    titulo: over.titulo ?? 'Tequila premium crece en exportaciones',
    resumen: over.resumen ?? 'La marca reporta un alza.',
    medio: over.medio ?? 'El Universal',
    keyword: over.keyword ?? 'tequila',
    cliente: over.cliente ?? 'Jumex',
    industria: over.industria ?? 'Bebidas',
    marcas: over.marcas ?? 'Jumex|Boing',
    competidores: over.competidores ?? 'Del Valle',
    temas_sensibles: over.temas_sensibles ?? 'azúcar',
  };
}

describe('buildUserPrompt', () => {
  it('incluye los campos presentes de nota y cliente', () => {
    const p = buildUserPrompt(input());
    expect(p).toContain('Cliente: Jumex');
    expect(p).toContain('Título: Tequila premium crece en exportaciones');
    expect(p).toContain('Medio: El Universal');
    expect(p).toContain('Industria: Bebidas');
    expect(p).toContain('Competidores: Del Valle');
  });
  it('omite líneas de campos vacíos', () => {
    const p = buildUserPrompt({
      titulo: 'Solo título',
      resumen: null,
      medio: null,
      keyword: 'tequila',
      cliente: 'Jumex',
      industria: null,
      marcas: null,
      competidores: '',
      temas_sensibles: null,
    });
    expect(p).not.toContain('Medio:');
    expect(p).not.toContain('Competidores:');
    expect(p).not.toContain('Industria:');
    expect(p).toContain('Título: Solo título');
  });
});

describe('ClasificacionSchema', () => {
  it('valida una clasificación bien formada', () => {
    const ok: Clasificacion = {
      sentimiento: 'positivo',
      relevancia: 'alta',
      tema: 'Exportaciones',
      subtema: 'Tequila',
      resumen_ejecutivo: 'Crecen las exportaciones.',
      riesgo_reputacional: 'bajo',
      recomendacion_pr: 'Amplificar la nota.',
      requiere_alerta: false,
    };
    expect(ClasificacionSchema.safeParse(ok).success).toBe(true);
  });
  it('rechaza enums fuera de dominio', () => {
    const bad = {
      sentimiento: 'muy positivo',
      relevancia: 'alta',
      tema: 'x',
      subtema: 'y',
      resumen_ejecutivo: 'z',
      riesgo_reputacional: 'bajo',
      recomendacion_pr: 'w',
      requiere_alerta: false,
    };
    expect(ClasificacionSchema.safeParse(bad).success).toBe(false);
  });
});

describe('computeRequiereAlerta', () => {
  const base = { requiere_alerta: false, sentimiento: 'neutral', riesgo_reputacional: 'bajo' } as const;

  it('respeta la alerta directa de la IA', () => {
    expect(computeRequiereAlerta({ ...base, requiere_alerta: true }, false)).toBe(true);
  });
  it('dispara si la keyword tiene alerta y el sentimiento es negativo', () => {
    expect(computeRequiereAlerta({ ...base, sentimiento: 'negativo' }, true)).toBe(true);
  });
  it('dispara si la keyword tiene alerta y el riesgo es alto', () => {
    expect(computeRequiereAlerta({ ...base, riesgo_reputacional: 'alto' }, true)).toBe(true);
  });
  it('no dispara si la keyword no tiene alerta aunque haya señal negativa', () => {
    expect(computeRequiereAlerta({ ...base, sentimiento: 'negativo' }, false)).toBe(false);
  });
  it('no dispara con keyword en alerta pero señal no negativa', () => {
    expect(computeRequiereAlerta(base, true)).toBe(false);
  });
});
