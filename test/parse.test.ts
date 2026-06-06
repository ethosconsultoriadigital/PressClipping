import { describe, it, expect } from 'vitest';
import {
  normalizeHeader,
  parseBool,
  parseIntOrNull,
  parseList,
  parseTextOrNull,
  parseDateToUtcIso,
} from '../src/utils/parse.js';

describe('normalizeHeader', () => {
  it('quita acentos, espacios y pasa a minúsculas con guion bajo', () => {
    expect(normalizeHeader('  Método Extracción ')).toBe('metodo_extraccion');
    expect(normalizeHeader('URL Base')).toBe('url_base');
    expect(normalizeHeader('medio_id')).toBe('medio_id');
  });
});

describe('parseBool', () => {
  it('interpreta valores verdaderos comunes', () => {
    for (const v of ['TRUE', 'true', 'Sí', 'si', '1', 'x', 'YES']) {
      expect(parseBool(v)).toBe(true);
    }
  });
  it('interpreta valores falsos comunes', () => {
    for (const v of ['FALSE', 'no', '0', '']) {
      expect(parseBool(v)).toBe(false);
    }
  });
  it('usa el fallback ante valores no reconocibles', () => {
    expect(parseBool('quizá', true)).toBe(true);
    expect(parseBool('quizá', false)).toBe(false);
  });
});

describe('parseIntOrNull', () => {
  it('parsea enteros y limpia separadores', () => {
    expect(parseIntOrNull('60')).toBe(60);
    expect(parseIntOrNull('1,000')).toBe(1000);
  });
  it('devuelve null si está vacío o no es numérico', () => {
    expect(parseIntOrNull('')).toBeNull();
    expect(parseIntOrNull('abc')).toBeNull();
    expect(parseIntOrNull(undefined)).toBeNull();
  });
});

describe('parseList', () => {
  it('separa por | y limpia espacios y vacíos', () => {
    expect(parseList('a | b ||c')).toEqual(['a', 'b', 'c']);
    expect(parseList('')).toEqual([]);
    expect(parseList(undefined)).toEqual([]);
  });
});

describe('parseTextOrNull', () => {
  it('recorta y convierte vacío en null', () => {
    expect(parseTextOrNull('  hola ')).toBe('hola');
    expect(parseTextOrNull('   ')).toBeNull();
  });
});

describe('parseDateToUtcIso', () => {
  it('parsea ISO 8601', () => {
    const iso = parseDateToUtcIso('2026-06-01T12:00:00Z');
    expect(iso).toBe('2026-06-01T12:00:00.000Z');
  });
  it('parsea dd/MM/yyyy', () => {
    const iso = parseDateToUtcIso('01/06/2026');
    expect(iso).toBe('2026-06-01T00:00:00.000Z');
  });
  it('devuelve null ante basura', () => {
    expect(parseDateToUtcIso('no es fecha')).toBeNull();
    expect(parseDateToUtcIso('')).toBeNull();
  });
});
