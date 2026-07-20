import { describe, it, expect } from 'vitest';
import {
  clasificarCategoriaJumexPorId,
  clasificarCategoriaJumexPorNombre,
  resumirCategoriasJumex,
  evaluarGoNoGoJumex,
  type CategoriaJumex,
} from '../src/editorial/jumexCriteria.js';

describe('clasificarCategoriaJumexPorId', () => {
  it('KEY-0001 (Jumex) → MARCA_DIRECTA', () => {
    expect(clasificarCategoriaJumexPorId('KEY-0001')).toBe('MARCA_DIRECTA');
  });
  it('KEY-0002 (Museo Jumex) → EXCLUIR', () => {
    expect(clasificarCategoriaJumexPorId('KEY-0002')).toBe('EXCLUIR');
  });
  it('KEY-0009 (bebidas azucaradas genérico) → SECTOR_GENERAL', () => {
    expect(clasificarCategoriaJumexPorId('KEY-0009')).toBe('SECTOR_GENERAL');
  });
  it('KEY-0065/0066/0067/0068 (IEPS/etiquetado/retiro/Profeco) → SECTOR_REGULATORIO_ALTO', () => {
    for (const id of ['KEY-0065', 'KEY-0066', 'KEY-0067', 'KEY-0068']) {
      expect(clasificarCategoriaJumexPorId(id)).toBe('SECTOR_REGULATORIO_ALTO');
    }
  });
  it('keyword_id desconocido cae en SECTOR_GENERAL por default (nunca EXCLUIR ni MARCA_DIRECTA por accidente)', () => {
    expect(clasificarCategoriaJumexPorId('KEY-9999')).toBe('SECTOR_GENERAL');
  });
});

describe('clasificarCategoriaJumexPorNombre (fallback por texto)', () => {
  it('Museo Jumex / Fundación Jumex → EXCLUIR', () => {
    expect(clasificarCategoriaJumexPorNombre('Museo Jumex')).toBe('EXCLUIR');
    expect(clasificarCategoriaJumexPorNombre('Fundación Jumex')).toBe('EXCLUIR');
  });
  it('Jumex / Grupo Jumex / Jugos Jumex → MARCA_DIRECTA', () => {
    expect(clasificarCategoriaJumexPorNombre('Jumex')).toBe('MARCA_DIRECTA');
    expect(clasificarCategoriaJumexPorNombre('Grupo Jumex')).toBe('MARCA_DIRECTA');
    expect(clasificarCategoriaJumexPorNombre('Jugos Jumex')).toBe('MARCA_DIRECTA');
  });
  it('Profeco → SECTOR_REGULATORIO_ALTO (ya excluye gasolina en su propio gate de keyword)', () => {
    expect(clasificarCategoriaJumexPorNombre('Profeco')).toBe('SECTOR_REGULATORIO_ALTO');
  });
  it('bebidas azucaradas → SECTOR_GENERAL', () => {
    expect(clasificarCategoriaJumexPorNombre('bebidas azucaradas')).toBe('SECTOR_GENERAL');
  });
});

describe('resumirCategoriasJumex', () => {
  it('cuenta correctamente cada categoría (caso real 2026-07-20: 16 menciones/30d)', () => {
    const categorias: CategoriaJumex[] = [
      ...Array(7).fill('SECTOR_GENERAL'),
      ...Array(6).fill('EXCLUIR'),
      ...Array(2).fill('SECTOR_REGULATORIO_ALTO'),
      'MARCA_DIRECTA',
    ] as CategoriaJumex[];
    const r = resumirCategoriasJumex(categorias);
    expect(r).toEqual({ total: 16, marca_directa: 1, sector_regulatorio_alto: 2, sector_general: 7, excluir: 6 });
  });

  it('lista vacía → todos en cero', () => {
    expect(resumirCategoriasJumex([])).toEqual({ total: 0, marca_directa: 0, sector_regulatorio_alto: 0, sector_general: 0, excluir: 0 });
  });
});

describe('evaluarGoNoGoJumex', () => {
  it('0 MARCA_DIRECTA → NO-GO explícito', () => {
    const r = evaluarGoNoGoJumex({ total: 16, marca_directa: 0, sector_regulatorio_alto: 2, sector_general: 7, excluir: 6 });
    expect(r.go).toBe(false);
    expect(r.motivo).toMatch(/0 menciones MARCA_DIRECTA/);
  });

  it('1-2 MARCA_DIRECTA → NO-GO (insuficiente, requiere autorización expresa)', () => {
    const r = evaluarGoNoGoJumex({ total: 16, marca_directa: 1, sector_regulatorio_alto: 2, sector_general: 7, excluir: 6 });
    expect(r.go).toBe(false);
    expect(r.motivo).toMatch(/insuficiente/);
  });

  it('>=3 MARCA_DIRECTA → GO condicionado', () => {
    const r = evaluarGoNoGoJumex({ total: 20, marca_directa: 3, sector_regulatorio_alto: 2, sector_general: 7, excluir: 6 });
    expect(r.go).toBe(true);
    expect(r.motivo).toMatch(/GO condicionado/);
  });
});
