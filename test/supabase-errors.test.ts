/**
 * Tests de clasificación de errores de PostgREST.
 *
 * El caso crítico: "Could not query the database for the schema cache" (PGRST002)
 * es TRANSITORIO y NO debe confundirse con "Could not find the table ... in the
 * schema cache" (PGRST205), que sí significa migración faltante. Ambos mensajes
 * contienen la frase "schema cache", que era la causa del diagnóstico erróneo.
 */
import { describe, it, expect } from 'vitest';
import {
  classifySupabaseError,
  isTransientSupabaseError,
  isMissingTableError,
  describeSupabaseError,
  hintForSupabaseError,
  retryPostgrest,
} from '../src/supabase/errors.js';

const ERR_SCHEMA_CACHE_TRANSITORIO = {
  code: 'PGRST002',
  message: 'Could not query the database for the schema cache. Retrying.',
};

const ERR_TABLA_FALTANTE = {
  code: 'PGRST205',
  message: "Could not find the table 'public.comparativo_pressclipping' in the schema cache",
};

const ERR_TABLA_FALTANTE_LEGACY = {
  code: '42P01',
  message: 'relation "public.comparativo_pressclipping" does not exist',
};

describe('classifySupabaseError', () => {
  it('PGRST002 es transitorio, NO tabla faltante', () => {
    expect(classifySupabaseError(ERR_SCHEMA_CACHE_TRANSITORIO)).toBe('transient_schema_cache');
    expect(isTransientSupabaseError(ERR_SCHEMA_CACHE_TRANSITORIO)).toBe(true);
    expect(isMissingTableError(ERR_SCHEMA_CACHE_TRANSITORIO)).toBe(false);
  });

  it('detecta PGRST002 por mensaje aunque falte el código', () => {
    const sinCodigo = { message: 'Could not query the database for the schema cache. Retrying.' };
    expect(classifySupabaseError(sinCodigo)).toBe('transient_schema_cache');
    expect(isMissingTableError(sinCodigo)).toBe(false);
  });

  it('PGRST205 es tabla faltante pese a decir "schema cache"', () => {
    expect(classifySupabaseError(ERR_TABLA_FALTANTE)).toBe('missing_table');
    expect(isMissingTableError(ERR_TABLA_FALTANTE)).toBe(true);
    expect(isTransientSupabaseError(ERR_TABLA_FALTANTE)).toBe(false);
  });

  it('42P01 (legacy) es tabla faltante', () => {
    expect(isMissingTableError(ERR_TABLA_FALTANTE_LEGACY)).toBe(true);
  });

  it('columna inexistente se clasifica aparte', () => {
    expect(classifySupabaseError({ code: '42703', message: 'column x does not exist' })).toBe('missing_column');
  });

  it('errores de conexión/timeout son transitorios', () => {
    for (const msg of ['fetch failed', 'ECONNRESET', 'socket hang up', 'service unavailable']) {
      expect(isTransientSupabaseError({ message: msg })).toBe(true);
    }
    expect(isTransientSupabaseError({ code: '53300', message: 'too many connections' })).toBe(true);
  });

  it('problemas de credenciales no son transitorios', () => {
    expect(classifySupabaseError({ message: 'Invalid API key' })).toBe('permission');
    expect(isTransientSupabaseError({ message: 'Invalid API key' })).toBe(false);
  });

  it('error desconocido cae en "other" y no se reintenta', () => {
    expect(classifySupabaseError({ message: 'algo raro' })).toBe('other');
    expect(isTransientSupabaseError({ message: 'algo raro' })).toBe(false);
  });
});

describe('describeSupabaseError / hintForSupabaseError', () => {
  it('la descripción incluye clasificación y código', () => {
    const d = describeSupabaseError(ERR_SCHEMA_CACHE_TRANSITORIO);
    expect(d).toContain('transient_schema_cache');
    expect(d).toContain('PGRST002');
  });

  it('la pista de PGRST002 aclara que NO es migración faltante', () => {
    const h = hintForSupabaseError(ERR_SCHEMA_CACHE_TRANSITORIO);
    expect(h).toContain('NO es una migración faltante');
  });

  it('la pista de tabla faltante sí manda a migraciones', () => {
    expect(hintForSupabaseError(ERR_TABLA_FALTANTE)).toContain('migraciones');
  });
});

describe('retryPostgrest', () => {
  it('reintenta ante PGRST002 y devuelve el éxito posterior', async () => {
    let intentos = 0;
    const res = await retryPostgrest(
      'test',
      async (): Promise<{ data: string[] | null; error: typeof ERR_SCHEMA_CACHE_TRANSITORIO | null }> => {
        intentos += 1;
        if (intentos < 3) return { data: null, error: ERR_SCHEMA_CACHE_TRANSITORIO };
        return { data: ['ok'], error: null };
      },
      4,
    );
    expect(intentos).toBe(3);
    expect(res.error).toBeNull();
    expect(res.data).toEqual(['ok']);
  }, 30_000);

  it('NO reintenta ante tabla faltante (falla rápido)', async () => {
    let intentos = 0;
    const res = await retryPostgrest('test', async () => {
      intentos += 1;
      return { data: null, error: ERR_TABLA_FALTANTE };
    });
    expect(intentos).toBe(1);
    expect(res.error).toBe(ERR_TABLA_FALTANTE);
  });

  it('devuelve el último error si agota intentos', async () => {
    let intentos = 0;
    const res = await retryPostgrest(
      'test',
      async () => {
        intentos += 1;
        return { data: null, error: ERR_SCHEMA_CACHE_TRANSITORIO };
      },
      2,
    );
    expect(intentos).toBe(2);
    expect(res.error).toBe(ERR_SCHEMA_CACHE_TRANSITORIO);
  }, 30_000);

  it('convierte una excepción de transporte en error transitorio reintentable', async () => {
    let intentos = 0;
    const res = await retryPostgrest(
      'test',
      async (): Promise<{ data: string[] | null; error: null }> => {
        intentos += 1;
        if (intentos === 1) throw new Error('fetch failed');
        return { data: [], error: null };
      },
      3,
    );
    expect(intentos).toBe(2);
    expect(res.error).toBeNull();
  }, 30_000);
});
