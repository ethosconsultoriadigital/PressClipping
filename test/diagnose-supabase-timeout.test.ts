/**
 * Tests del timeout del diagnóstico de Supabase.
 *
 * Regresión cubierta: `npm run diagnose:supabase` se colgaba indefinidamente en
 * el primer probe cuando PostgREST no respondía. El helper debe cortar siempre y
 * abortar la operación subyacente para que el proceso pueda terminar.
 */
import { describe, it, expect, vi } from 'vitest';
import { conTimeout, TIMEOUT_POR_CHECK_MS } from '../scripts/diagnose-supabase.js';

const nunca = (signal: AbortSignal): Promise<string> =>
  new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('AbortError')));
  });

describe('TIMEOUT_POR_CHECK_MS', () => {
  it('es de 10 segundos como máximo', () => {
    expect(TIMEOUT_POR_CHECK_MS).toBe(10_000);
    expect(TIMEOUT_POR_CHECK_MS).toBeLessThanOrEqual(10_000);
  });
});

describe('conTimeout', () => {
  it('devuelve el valor cuando la operación responde a tiempo', async () => {
    const r = await conTimeout('rapido', async () => 'listo', 1_000);
    expect(r.estado).toBe('ok');
    if (r.estado === 'ok') expect(r.valor).toBe('listo');
  });

  it('corta con estado timeout cuando la operación nunca responde', async () => {
    const r = await conTimeout('colgado', nunca, 50);
    expect(r.estado).toBe('timeout');
  });

  it('aborta la operación subyacente al expirar (libera el socket)', async () => {
    let abortada = false;
    const r = await conTimeout(
      'colgado',
      (signal) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            abortada = true;
            reject(new Error('AbortError'));
          });
        }),
      50,
    );
    expect(r.estado).toBe('timeout');
    expect(abortada).toBe(true);
  });

  it('no deja unhandled rejections tras abortar', async () => {
    const onUnhandled = vi.fn();
    process.on('unhandledRejection', onUnhandled);
    try {
      await conTimeout('colgado', nunca, 50);
      // Damos una vuelta al event loop para que aflorase cualquier rechazo.
      await new Promise((r) => setTimeout(r, 60));
      expect(onUnhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('propaga los errores de la operación en vez de tragárselos', async () => {
    await expect(
      conTimeout('falla', async () => { throw new Error('boom'); }, 1_000),
    ).rejects.toThrow('boom');
  });

  it('no espera el timeout completo si la operación termina antes', async () => {
    const inicio = Date.now();
    await conTimeout('rapido', async () => 'ok', 5_000);
    expect(Date.now() - inicio).toBeLessThan(1_000);
  });
});
