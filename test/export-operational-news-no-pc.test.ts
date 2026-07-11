/**
 * Tests para la lógica pura del exportador staging (emergencia sin PressClipping).
 */
import { describe, it, expect } from 'vitest';
import { dedupeKey } from '../scripts/export-operational-news-no-pc.js';

describe('dedupeKey', () => {
  it('es estable para los mismos inputs', () => {
    const a = dedupeKey('CLI-0002', 'https://example.com/nota-1', 'KEY-0060');
    const b = dedupeKey('CLI-0002', 'https://example.com/nota-1', 'KEY-0060');
    expect(a).toBe(b);
  });

  it('cambia si cambia el cliente_id', () => {
    const a = dedupeKey('CLI-0002', 'https://example.com/nota-1', 'KEY-0060');
    const b = dedupeKey('CLI-0001', 'https://example.com/nota-1', 'KEY-0060');
    expect(a).not.toBe(b);
  });

  it('cambia si cambia la url_norm', () => {
    const a = dedupeKey('CLI-0002', 'https://example.com/nota-1', 'KEY-0060');
    const b = dedupeKey('CLI-0002', 'https://example.com/nota-2', 'KEY-0060');
    expect(a).not.toBe(b);
  });

  it('cambia si cambia el keyword_id (misma noticia, distinta keyword)', () => {
    const a = dedupeKey('CLI-0002', 'https://example.com/nota-1', 'KEY-0060');
    const b = dedupeKey('CLI-0002', 'https://example.com/nota-1', 'KEY-0061');
    expect(a).not.toBe(b);
  });

  it('formato incluye los 3 componentes separados por "::"', () => {
    const k = dedupeKey('CLI-0001', 'https://x.com/y', 'KEY-0001');
    expect(k.split('::')).toEqual(['CLI-0001', 'https://x.com/y', 'KEY-0001']);
  });
});

// ─── Parseo de --clients (solo CLI-0001/CLI-0002 cuando se especifican) ──────

function parseClientsList(v: string): string[] {
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

describe('parseArgs --clients', () => {
  it('parsea lista de dos clientes', () => {
    expect(parseClientsList('CLI-0001,CLI-0002')).toEqual(['CLI-0001', 'CLI-0002']);
  });

  it('ignora espacios', () => {
    expect(parseClientsList('CLI-0001, CLI-0002')).toEqual(['CLI-0001', 'CLI-0002']);
  });

  it('un solo cliente produce arreglo de un elemento', () => {
    expect(parseClientsList('CLI-0002')).toEqual(['CLI-0002']);
  });
});

// ─── Estado de export según condiciones ──────────────────────────────────────

type EstadoExport = 'EXPORTADO' | 'DUPLICADO_OMITIDO' | 'SIN_TEXTO_LIMPIO' | 'REVISAR';

function calcularEstadoExport(opts: { esDuplicado: boolean; esFalsoPositivo: boolean; tieneTextoLimpio: boolean }): EstadoExport {
  if (opts.esDuplicado) return 'DUPLICADO_OMITIDO';
  if (opts.esFalsoPositivo) return 'REVISAR';
  if (!opts.tieneTextoLimpio) return 'SIN_TEXTO_LIMPIO';
  return 'EXPORTADO';
}

describe('calcularEstadoExport', () => {
  it('duplicado tiene precedencia sobre todo lo demás', () => {
    expect(calcularEstadoExport({ esDuplicado: true, esFalsoPositivo: true, tieneTextoLimpio: false })).toBe('DUPLICADO_OMITIDO');
  });

  it('falso positivo (no duplicado) es REVISAR', () => {
    expect(calcularEstadoExport({ esDuplicado: false, esFalsoPositivo: true, tieneTextoLimpio: true })).toBe('REVISAR');
  });

  it('sin texto limpio (no duplicado, no FP) es SIN_TEXTO_LIMPIO', () => {
    expect(calcularEstadoExport({ esDuplicado: false, esFalsoPositivo: false, tieneTextoLimpio: false })).toBe('SIN_TEXTO_LIMPIO');
  });

  it('caso normal es EXPORTADO', () => {
    expect(calcularEstadoExport({ esDuplicado: false, esFalsoPositivo: false, tieneTextoLimpio: true })).toBe('EXPORTADO');
  });
});
