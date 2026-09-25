import { describe, it, expect } from 'vitest';
import { evaluarTitleOnly } from '../src/matching/titleOnlyLane.js';
import {
  aplicarTopeTitleOnly,
  fusionarTitleOnly,
  paginaRange,
  puedeInsertarTitleOnly,
  type FilaTitleOnly,
} from '../src/matching/titleOnlySweep.js';
import type { KeywordRule } from '../src/matchers/keyword.js';

const MERY: KeywordRule = {
  keyword_id: 'KEY-0041',
  cliente_id: 'CLI-MERY-TEST',
  keyword: 'Mery Pozos',
  terminos: ['Mery Pozos'],
  tipo: 'frase_exacta',
  regla: null,
  contextoIncluir: [],
  contextoExcluir: [],
};

function lote(n: number, matchEn: number): FilaTitleOnly[] {
  const base = Date.parse('2026-09-25T12:00:00.000Z');
  return Array.from({ length: n }, (_, i) => ({
    noticia_id: `n-${String(i).padStart(5, '0')}`,
    titulo: i === matchEn ? 'Mery Pozos destaca presupuesto histórico' : 'Congreso analiza presupuesto',
    subtitulo: null,
    resumen: null,
    fecha_publicacion: new Date(base - i * 1000).toISOString(),
    fecha_captura: new Date(base - i * 1000).toISOString(),
  }));
}

describe('title-only full sweep', () => {
  it('encuentra el match en la posición 875 de 1200', () => {
    const filas = fusionarTitleOnly(lote(1200, 874), []);
    const barrido = aplicarTopeTitleOnly(filas, 10000);
    expect(barrido.truncated).toBe(false);
    expect(barrido.rows).toHaveLength(1200);
    expect(barrido.rows.slice(0, 500).some((r) => String(r.noticia_id).endsWith('00874'))).toBe(false);
    const hits = barrido.rows.flatMap((fila) => evaluarTitleOnly(fila, [MERY]));
    expect(hits).toHaveLength(1);
    expect(hits[0]!.mark_processed).toBe(false);
  });

  it('encuentra un match cerca del final de 2500 con maxScan 5000', () => {
    const barrido = aplicarTopeTitleOnly(fusionarTitleOnly(lote(2500, 2490), []), 5000);
    expect(barrido.truncated).toBe(false);
    expect(barrido.rows.flatMap((fila) => evaluarTitleOnly(fila, [MERY]))).toHaveLength(1);
  });

  it('10001 elegibles con maxScan 10000 trunca y no inserta', () => {
    const barrido = aplicarTopeTitleOnly(fusionarTitleOnly(lote(10001, 10000), []), 10000);
    expect(barrido.eligible).toBe(10001);
    expect(barrido.truncated).toBe(true);
    expect(barrido.eligibleOverCap).toBe(true);
    expect(barrido.scanned).toBe(10000);
    expect(puedeInsertarTitleOnly({ dryRun: false, truncated: true })).toBe(false);
    expect(puedeInsertarTitleOnly({ dryRun: true, truncated: true })).toBe(false);
    expect(puedeInsertarTitleOnly({ dryRun: true, truncated: false })).toBe(false);
  });

  it('pagina de a 500', () => {
    expect(paginaRange(0, 500)).toEqual({ from: 0, to: 499 });
    expect(paginaRange(500, 500)).toEqual({ from: 500, to: 999 });
  });
});
