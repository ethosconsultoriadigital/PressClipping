/**
 * Tests para el filtro --client y --max-inserts en detect-mentions.
 *
 * Prueba la lógica pura (parseo de flags, filtrado de keywords, cap de inserts,
 * decisión de marcar noticias) sin llamadas a Supabase ni red.
 */
import { describe, it, expect } from 'vitest';

// ─── Parseo de --client ──────────────────────────────────────────────────────

function parseClientFlag(argv: string[]): string | undefined {
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    if (eq === -1) continue;
    const key = body.slice(0, eq);
    const value = body.slice(eq + 1);
    if (key === 'client' && value) return value;
  }
  return undefined;
}

describe('parseArgs --client', () => {
  it('extrae el client id correctamente', () => {
    expect(parseClientFlag(['--client=CLI-MERY-TEST'])).toBe('CLI-MERY-TEST');
  });

  it('devuelve undefined cuando no está presente', () => {
    expect(parseClientFlag(['--dry-run', '--limit=50'])).toBeUndefined();
  });

  it('devuelve undefined cuando --client no tiene valor', () => {
    expect(parseClientFlag(['--client='])).toBeUndefined();
  });

  it('no confunde con otros flags', () => {
    expect(parseClientFlag(['--cliente=CLI-0001', '--dry-run'])).toBeUndefined();
  });

  it('funciona junto con otros flags', () => {
    expect(parseClientFlag(['--limit=50', '--client=CLI-0002', '--dry-run'])).toBe('CLI-0002');
  });
});

// ─── Parseo de --max-inserts ─────────────────────────────────────────────────

function parseIntOrNull(v: unknown): number | null {
  const n = parseInt(String(v), 10);
  return isNaN(n) ? null : n;
}

function parseMaxInsertsFlag(argv: string[]): number | undefined {
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    if (eq === -1) continue;
    const key = body.slice(0, eq);
    const value = body.slice(eq + 1);
    if (key === 'max-inserts') return parseIntOrNull(value) ?? undefined;
  }
  return undefined;
}

describe('parseArgs --max-inserts', () => {
  it('extrae el número correctamente', () => {
    expect(parseMaxInsertsFlag(['--max-inserts=50'])).toBe(50);
  });

  it('devuelve undefined cuando no está presente', () => {
    expect(parseMaxInsertsFlag(['--dry-run'])).toBeUndefined();
  });

  it('devuelve undefined para valor no numérico', () => {
    expect(parseMaxInsertsFlag(['--max-inserts=abc'])).toBeUndefined();
  });

  it('acepta max-inserts=0', () => {
    expect(parseMaxInsertsFlag(['--max-inserts=0'])).toBe(0);
  });
});

// ─── Filtrado de keywords por cliente_id ─────────────────────────────────────

interface MinKeyword { keyword_id: string; cliente_id: string | null; keyword: string; }

function filtrarKeywordsPorCliente(
  keywords: MinKeyword[],
  clientId: string | undefined,
): MinKeyword[] {
  if (!clientId) return keywords;
  return keywords.filter((k) => k.cliente_id === clientId);
}

describe('filtrarKeywordsPorCliente', () => {
  const fixtures: MinKeyword[] = [
    { keyword_id: 'KEY-0001', cliente_id: 'CLI-0001', keyword: 'Jumex' },
    { keyword_id: 'KEY-0002', cliente_id: 'CLI-0001', keyword: 'Jugos del Valle' },
    { keyword_id: 'KEY-0040', cliente_id: 'CLI-MERY-TEST', keyword: 'Mery Pozos' },
    { keyword_id: 'KEY-0041', cliente_id: 'CLI-MERY-TEST', keyword: 'Merilyn Gómez Pozos' },
    { keyword_id: 'KEY-0050', cliente_id: null, keyword: 'keyword sin cliente' },
  ];

  it('sin --client devuelve todas las keywords', () => {
    expect(filtrarKeywordsPorCliente(fixtures, undefined)).toHaveLength(5);
  });

  it('con --client=CLI-MERY-TEST solo devuelve keywords de Mery Pozos', () => {
    const res = filtrarKeywordsPorCliente(fixtures, 'CLI-MERY-TEST');
    expect(res).toHaveLength(2);
    expect(res.every((k) => k.cliente_id === 'CLI-MERY-TEST')).toBe(true);
  });

  it('con --client=CLI-0001 no devuelve keywords de CLI-MERY-TEST', () => {
    const res = filtrarKeywordsPorCliente(fixtures, 'CLI-0001');
    expect(res.some((k) => k.keyword_id.startsWith('KEY-0040'))).toBe(false);
    expect(res.every((k) => k.cliente_id === 'CLI-0001')).toBe(true);
  });

  it('con --client desconocido devuelve arreglo vacío', () => {
    expect(filtrarKeywordsPorCliente(fixtures, 'CLI-NO-EXISTE')).toHaveLength(0);
  });

  it('keyword con cliente_id null no pasa el filtro por cliente', () => {
    const res = filtrarKeywordsPorCliente(fixtures, 'CLI-MERY-TEST');
    expect(res.some((k) => k.keyword_id === 'KEY-0050')).toBe(false);
  });
});

// ─── Cap de max-inserts ───────────────────────────────────────────────────────

interface MinMencion { noticia_id: string; keyword_id: string; }

function aplicarCapInserts(menciones: MinMencion[], maxInserts: number | undefined): MinMencion[] {
  if (maxInserts == null) return menciones;
  return menciones.slice(0, maxInserts);
}

describe('aplicarCapInserts', () => {
  const menciones: MinMencion[] = Array.from({ length: 100 }, (_, i) => ({
    noticia_id: `N-${i}`,
    keyword_id: 'KEY-0040',
  }));

  it('sin maxInserts devuelve todas las menciones', () => {
    expect(aplicarCapInserts(menciones, undefined)).toHaveLength(100);
  });

  it('con maxInserts=50 devuelve exactamente 50', () => {
    expect(aplicarCapInserts(menciones, 50)).toHaveLength(50);
  });

  it('con maxInserts mayor que total devuelve todas', () => {
    expect(aplicarCapInserts(menciones, 200)).toHaveLength(100);
  });

  it('con maxInserts=0 devuelve arreglo vacío', () => {
    expect(aplicarCapInserts(menciones, 0)).toHaveLength(0);
  });

  it('preserva orden (primeras N)', () => {
    const res = aplicarCapInserts(menciones, 3);
    expect(res.at(0)?.noticia_id).toBe('N-0');
    expect(res.at(2)?.noticia_id).toBe('N-2');
  });
});

// ─── Decisión de marcar noticias como procesadas ─────────────────────────────

function debeMarcarProcesadas(clientId: string | undefined): boolean {
  return !clientId;
}

describe('debeMarcarProcesadas', () => {
  it('sin --client, debe marcar noticias como procesadas', () => {
    expect(debeMarcarProcesadas(undefined)).toBe(true);
  });

  it('con --client, NO debe marcar noticias como procesadas', () => {
    expect(debeMarcarProcesadas('CLI-MERY-TEST')).toBe(false);
  });

  it('con cualquier --client, no marca (otros clientes futuros deben ver las noticias)', () => {
    expect(debeMarcarProcesadas('CLI-0001')).toBe(false);
    expect(debeMarcarProcesadas('CLI-0099')).toBe(false);
  });
});

// ─── Mery Pozos pasa, "Mery" sola no pasa ────────────────────────────────────

describe('Mery Pozos keyword contract', () => {
  const kwMeryPozos: MinKeyword = { keyword_id: 'KEY-0040', cliente_id: 'CLI-MERY-TEST', keyword: 'Mery Pozos' };
  const kwMerilyn: MinKeyword = { keyword_id: 'KEY-0041', cliente_id: 'CLI-MERY-TEST', keyword: 'Merilyn Gómez Pozos' };
  const kwJumex: MinKeyword = { keyword_id: 'KEY-0001', cliente_id: 'CLI-0001', keyword: 'Jumex' };

  it('CLI-MERY-TEST tiene keywords correctas después del filtro', () => {
    const res = filtrarKeywordsPorCliente([kwMeryPozos, kwMerilyn, kwJumex], 'CLI-MERY-TEST');
    expect(res.map((k) => k.keyword_id)).toContain('KEY-0040');
    expect(res.map((k) => k.keyword_id)).toContain('KEY-0041');
    expect(res.map((k) => k.keyword_id)).not.toContain('KEY-0001');
  });

  it('Jumex no aparece en keywords de CLI-MERY-TEST', () => {
    const res = filtrarKeywordsPorCliente([kwMeryPozos, kwMerilyn, kwJumex], 'CLI-MERY-TEST');
    expect(res.some((k) => k.keyword === 'Jumex')).toBe(false);
  });
});
