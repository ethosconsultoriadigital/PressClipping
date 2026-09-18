/**
 * Regresión del query LEGACY de enrich (`getNoticiasParaEnriquecer`).
 *
 * El drain V1 añade una ruta nueva; la vieja no puede cambiar de semántica por
 * accidente, porque la usan enrich-news, los tiers sombra y el batch runner de
 * validación. Este test fija el contrato observable del builder.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

interface Llamada {
  metodo: string;
  args: unknown[];
}

const llamadas: Llamada[] = [];
let respuesta: { data: unknown; error: unknown } = { data: [], error: null };

function fakeBuilder(): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  const metodos = ['select', 'order', 'in', 'gte', 'lte', 'lt', 'gt', 'is', 'not', 'eq', 'limit', 'update', 'range'];
  for (const m of metodos) {
    builder[m] = (...args: unknown[]) => {
      llamadas.push({ metodo: m, args });
      return builder;
    };
  }
  builder['then'] = (resolve: (v: unknown) => unknown) => Promise.resolve(respuesta).then(resolve);
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

function metodosCon(metodo: string): unknown[][] {
  return llamadas.filter((l) => l.metodo === metodo).map((l) => l.args);
}

beforeEach(() => {
  llamadas.length = 0;
  respuesta = { data: [], error: null };
});

describe('getNoticiasParaEnriquecer — contrato legacy intacto', () => {
  it('default: tabla noticias, orden created_at ascendente, sin filtros de texto', async () => {
    await getNoticiasParaEnriquecer({});
    expect(metodosCon('from')).toEqual([['noticias']]);
    expect(metodosCon('order')).toEqual([['created_at', { ascending: true }]]);
    expect(metodosCon('is')).toEqual([]);
    expect(metodosCon('eq')).toEqual([]);
  });

  it('recentFirst ordena por fecha_publicacion descendente', async () => {
    await getNoticiasParaEnriquecer({ recentFirst: true });
    expect(metodosCon('order')).toEqual([['fecha_publicacion', { ascending: false }]]);
  });

  it('only-missing-clean-text sigue siendo texto_nota_limpia IS NULL', async () => {
    await getNoticiasParaEnriquecer({ onlyMissingCleanText: true });
    expect(metodosCon('is')).toContainEqual(['texto_nota_limpia', null]);
  });

  it('only-missing-body-text sigue exigiendo clean NOT NULL + body IS NULL', async () => {
    await getNoticiasParaEnriquecer({ onlyMissingBodyText: true });
    expect(metodosCon('not')).toContainEqual(['texto_nota_limpia', 'is', null]);
    expect(metodosCon('is')).toContainEqual(['texto_cuerpo_nota', null]);
  });

  it('only-pending-mentions sigue filtrando menciones_procesado=false', async () => {
    await getNoticiasParaEnriquecer({ onlyPendingMentions: true });
    expect(metodosCon('eq')).toContainEqual(['menciones_procesado', false]);
  });

  it('medioIds, windowDays y limit se aplican igual que antes', async () => {
    await getNoticiasParaEnriquecer({ medioIds: ['MED-0039'], windowDays: 7, limit: 500 });
    expect(metodosCon('in')).toContainEqual(['medio_id', ['MED-0039']]);
    expect(metodosCon('gte')[0]?.[0]).toBe('fecha_publicacion');
    expect(metodosCon('limit')).toEqual([[500]]);
  });

  it('el query legacy NO conoce la metadata nueva del drain', async () => {
    await getNoticiasParaEnriquecer({ onlyMissingCleanText: true, recentFirst: true, limit: 500 });
    const serial = JSON.stringify(llamadas);
    expect(serial).not.toContain('enrich_last_attempt_at');
    expect(serial).not.toContain('enrich_next_attempt_at');
    expect(serial).not.toContain('enrich_failure_class');
  });
});
