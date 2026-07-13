/**
 * Tests de la lógica pura del puente Patrón (tab 12 → tab 13 preview).
 * Replica el predicado de filtro y el dedupe_key_final del script.
 */
import { describe, it, expect } from 'vitest';

const CLIENTE = 'CLI-0002';
const RELEVANCIA_GO = new Set(['ALTA_RELEVANCIA', 'MEDIA_RELEVANCIA']);
const ESTADO_GO = new Set(['GO_ALTA', 'GO_MEDIA']);

interface Fila12 { cliente_id: string; relevancia_editorial: string; estado_editorial: string; url_norm: string; }

/** Predicado: ¿la fila de tab 12 entra al preview Patrón? */
function pasaFiltroPatron(f: Fila12): boolean {
  if (f.cliente_id !== CLIENTE) return false;
  return RELEVANCIA_GO.has(f.relevancia_editorial) || ESTADO_GO.has(f.estado_editorial);
}

function dedupeKeyFinal(clienteId: string, urlNorm: string): string {
  return `${clienteId}::${urlNorm}`;
}

describe('pasaFiltroPatron', () => {
  it('CLI-0002 ALTA_RELEVANCIA / GO_ALTA pasa', () => {
    expect(pasaFiltroPatron({ cliente_id: 'CLI-0002', relevancia_editorial: 'ALTA_RELEVANCIA', estado_editorial: 'GO_ALTA', url_norm: 'u' })).toBe(true);
  });

  it('CLI-0002 MEDIA_RELEVANCIA / GO_MEDIA pasa', () => {
    expect(pasaFiltroPatron({ cliente_id: 'CLI-0002', relevancia_editorial: 'MEDIA_RELEVANCIA', estado_editorial: 'GO_MEDIA', url_norm: 'u' })).toBe(true);
  });

  it('CLI-0002 POSIBLE_FP / EXCLUIR NO pasa', () => {
    expect(pasaFiltroPatron({ cliente_id: 'CLI-0002', relevancia_editorial: 'POSIBLE_FP', estado_editorial: 'EXCLUIR', url_norm: 'u' })).toBe(false);
  });

  it('CLI-0002 BAJA_RELEVANCIA / REVISAR NO pasa', () => {
    expect(pasaFiltroPatron({ cliente_id: 'CLI-0002', relevancia_editorial: 'BAJA_RELEVANCIA', estado_editorial: 'REVISAR', url_norm: 'u' })).toBe(false);
  });

  it('CLI-0001 (Jumex) NUNCA pasa, aunque sea ALTA', () => {
    expect(pasaFiltroPatron({ cliente_id: 'CLI-0001', relevancia_editorial: 'ALTA_RELEVANCIA', estado_editorial: 'GO_ALTA', url_norm: 'u' })).toBe(false);
  });

  it('CLI-0001 MUSEO_JUMEX_EXCLUIR NUNCA pasa', () => {
    expect(pasaFiltroPatron({ cliente_id: 'CLI-0001', relevancia_editorial: 'POSIBLE_FP', estado_editorial: 'MUSEO_JUMEX_EXCLUIR', url_norm: 'u' })).toBe(false);
  });

  it('el filtro excluye POSIBLE_FP incluso si el estado quedara raro', () => {
    // relevancia POSIBLE_FP no está en GO; estado desconocido tampoco → excluida.
    expect(pasaFiltroPatron({ cliente_id: 'CLI-0002', relevancia_editorial: 'POSIBLE_FP', estado_editorial: 'DESCONOCIDO', url_norm: 'u' })).toBe(false);
  });
});

describe('dedupeKeyFinal', () => {
  it('es estable y = cliente_id::url_norm', () => {
    expect(dedupeKeyFinal('CLI-0002', 'https://x.com/y')).toBe('CLI-0002::https://x.com/y');
  });

  it('distingue URLs distintas', () => {
    expect(dedupeKeyFinal('CLI-0002', 'a')).not.toBe(dedupeKeyFinal('CLI-0002', 'b'));
  });
});

// ─── Aplicado a un lote (simula tab 12) ──────────────────────────────────────
describe('filtro Patrón sobre lote tab 12', () => {
  const tab12: Fila12[] = [
    { cliente_id: 'CLI-0002', relevancia_editorial: 'ALTA_RELEVANCIA', estado_editorial: 'GO_ALTA', url_norm: 'a' },
    { cliente_id: 'CLI-0002', relevancia_editorial: 'MEDIA_RELEVANCIA', estado_editorial: 'GO_MEDIA', url_norm: 'b' },
    { cliente_id: 'CLI-0002', relevancia_editorial: 'POSIBLE_FP', estado_editorial: 'EXCLUIR', url_norm: 'c' },
    { cliente_id: 'CLI-0002', relevancia_editorial: 'BAJA_RELEVANCIA', estado_editorial: 'REVISAR', url_norm: 'd' },
    { cliente_id: 'CLI-0001', relevancia_editorial: 'ALTA_RELEVANCIA', estado_editorial: 'GO_ALTA', url_norm: 'e' },
    { cliente_id: 'CLI-0001', relevancia_editorial: 'POSIBLE_FP', estado_editorial: 'MUSEO_JUMEX_EXCLUIR', url_norm: 'f' },
  ];

  it('solo pasan las 2 filas CLI-0002 GO', () => {
    const out = tab12.filter(pasaFiltroPatron);
    expect(out).toHaveLength(2);
    expect(out.every((f) => f.cliente_id === 'CLI-0002')).toBe(true);
    expect(out.map((f) => f.url_norm)).toEqual(['a', 'b']);
  });

  it('ninguna fila Jumex pasa', () => {
    const out = tab12.filter(pasaFiltroPatron);
    expect(out.some((f) => f.cliente_id === 'CLI-0001')).toBe(false);
  });
});
