/**
 * Paginación real de getNoticiasParaEnriquecer: el fake PostgREST entrega
 * como máximo 1000 filas por .range(), igual que el cap silencioso de
 * producción. El caller debe ver 999, 1000, 1001 y >2000 completos.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

interface Llamada {
  metodo: string;
  args: unknown[];
}

const llamadas: Llamada[] = [];
let universo: Array<{ noticia_id: string }> = [];

function fakeBuilder(): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  let from = 0;
  let to = 999;
  const metodos = ['select', 'order', 'in', 'gte', 'lte', 'lt', 'gt', 'is', 'not', 'eq', 'limit', 'update'];
  for (const m of metodos) {
    builder[m] = (...args: unknown[]) => {
      llamadas.push({ metodo: m, args });
      return builder;
    };
  }
  builder['range'] = (a: number, b: number) => {
    from = a;
    to = b;
    llamadas.push({ metodo: 'range', args: [a, b] });
    return builder;
  };
  builder['then'] = (resolve: (v: unknown) => unknown) => {
    const slice = universo.slice(from, to + 1);
    return Promise.resolve({ data: slice, error: null }).then(resolve);
  };
  return builder;
}

vi.mock('../src/supabase/client.js', () => ({
  getSupabase: () => ({
    from: (tabla: string) => {
      llamadas.push({ metodo: 'from', args: [tabla] });
      return fakeBuilder();
    },
  }),
}));

const { getNoticiasParaEnriquecer } = await import('../src/supabase/repositories.js');

function ids(n: number): Array<{ noticia_id: string }> {
  return Array.from({ length: n }, (_, i) => ({ noticia_id: `n${String(i).padStart(4, '0')}` }));
}

beforeEach(() => {
  llamadas.length = 0;
  universo = [];
});

describe('getNoticiasParaEnriquecer — páginas PostgREST de 1000', () => {
  it('999 items: una página, ningún candidato perdido', async () => {
    universo = ids(999);
    const rows = await getNoticiasParaEnriquecer({ limit: 2000 });
    expect(rows).toHaveLength(999);
    expect(rows[0]?.noticia_id).toBe('n0000');
    expect(rows[998]?.noticia_id).toBe('n0998');
    expect(llamadas.filter((l) => l.metodo === 'range')).toHaveLength(1);
  });

  it('1000 items: una página llena, no pide fantasma', async () => {
    universo = ids(1000);
    const rows = await getNoticiasParaEnriquecer({ limit: 2000 });
    expect(rows).toHaveLength(1000);
    expect(rows[999]?.noticia_id).toBe('n0999');
    const ranges = llamadas.filter((l) => l.metodo === 'range').map((l) => l.args);
    expect(ranges).toEqual([[0, 999], [1000, 1999]]);
  });

  it('1001 items: la fila 1001 NO desaparece (segunda página)', async () => {
    universo = ids(1001);
    const rows = await getNoticiasParaEnriquecer({ limit: 2000 });
    expect(rows).toHaveLength(1001);
    expect(rows[1000]?.noticia_id).toBe('n1000');
    const ranges = llamadas.filter((l) => l.metodo === 'range').map((l) => l.args);
    expect(ranges[0]).toEqual([0, 999]);
    expect(ranges[1]).toEqual([1000, 1999]);
  });

  it('>2000 items: 2500 candidatos, tres páginas, todos visibles', async () => {
    universo = ids(2500);
    const rows = await getNoticiasParaEnriquecer({ limit: 2500 });
    expect(rows).toHaveLength(2500);
    expect(rows[0]?.noticia_id).toBe('n0000');
    expect(rows[999]?.noticia_id).toBe('n0999');
    expect(rows[1000]?.noticia_id).toBe('n1000');
    expect(rows[1999]?.noticia_id).toBe('n1999');
    expect(rows[2000]?.noticia_id).toBe('n2000');
    expect(rows[2499]?.noticia_id).toBe('n2499');
    const ranges = llamadas.filter((l) => l.metodo === 'range').map((l) => l.args);
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2499],
    ]);
  });

  it('sin limit: recorre hasta página corta (2501 visibles, no se queda en 1000)', async () => {
    universo = ids(2501);
    const rows = await getNoticiasParaEnriquecer({});
    expect(rows).toHaveLength(2501);
    expect(rows[2500]?.noticia_id).toBe('n2500');
  });
});
