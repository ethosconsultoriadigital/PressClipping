import { describe, it, expect, vi } from 'vitest';
import { chunkArray, ejecutarPorLotes, type ResultadoLote } from '../src/utils/chunk.js';

type RunFn = (lote: string[], index: number, total: number) => Promise<ResultadoLote>;
const ok: RunFn = async () => ({ error: null });

describe('chunkArray', () => {
  it('divide 831 IDs en 5 lotes de 200 (último de 31)', () => {
    const ids = Array.from({ length: 831 }, (_, i) => `id-${i}`);
    const lotes = chunkArray(ids, 200);
    expect(lotes).toHaveLength(5);
    expect(lotes.slice(0, 4).every((l) => l.length === 200)).toBe(true);
    expect(lotes[4]).toHaveLength(31);
    // No se pierde ni duplica ningún elemento.
    expect(lotes.flat()).toEqual(ids);
  });

  it('lista vacía → sin lotes', () => {
    expect(chunkArray([], 200)).toEqual([]);
  });

  it('lista <= size → un solo lote', () => {
    expect(chunkArray([1, 2, 3], 200)).toEqual([[1, 2, 3]]);
  });

  it('lanza si size <= 0 o no es entero', () => {
    expect(() => chunkArray([1], 0)).toThrow();
    expect(() => chunkArray([1], -5)).toThrow();
    expect(() => chunkArray([1], 1.5)).toThrow();
  });
});

describe('ejecutarPorLotes', () => {
  it('procesa 831 IDs en varios lotes y suma el total', async () => {
    const ids = Array.from({ length: 831 }, (_, i) => `id-${i}`);
    const run = vi.fn<RunFn>(ok);
    const total = await ejecutarPorLotes(ids, 200, run);
    expect(total).toBe(831);
    expect(run).toHaveBeenCalledTimes(5);
    // Verifica índices/tamaños reportados a la operación.
    expect(run.mock.calls[0]?.[1]).toBe(0);
    expect(run.mock.calls[0]?.[2]).toBe(5);
    expect(run.mock.calls[4]?.[0].length).toBe(31);
  });

  it('lista vacía → NO hace request y devuelve 0', async () => {
    const run = vi.fn<RunFn>(ok);
    const total = await ejecutarPorLotes([], 200, run);
    expect(total).toBe(0);
    expect(run).not.toHaveBeenCalled();
  });

  it('lista <= batchSize → un solo request', async () => {
    const run = vi.fn<RunFn>(ok);
    const total = await ejecutarPorLotes(['a', 'b'], 200, run);
    expect(total).toBe(2);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('si un lote falla, reporta el lote específico y no oculta parciales', async () => {
    const ids = Array.from({ length: 831 }, (_, i) => `id-${i}`);
    // Falla en el 3er lote (índice 2).
    const run = vi.fn(async (_lote: string[], index: number): Promise<ResultadoLote> =>
      index === 2 ? { error: { message: 'URI too long' } } : { error: null },
    );
    await expect(ejecutarPorLotes(ids, 200, run)).rejects.toThrow(/lote 3\/5/);
    await expect(ejecutarPorLotes(ids, 200, run)).rejects.toThrow(/ya_procesados=400/);
    await expect(ejecutarPorLotes(ids, 200, run)).rejects.toThrow(/URI too long/);
  });
});
