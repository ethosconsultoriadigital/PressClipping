/**
 * Tests para la lógica pura de los scripts de emergencia (reemplazo PressClipping):
 * - audit-operational-clients.ts (estadoOperativo)
 * - audit-owned-media-coverage.ts (clasificarMedio)
 * - audit-operational-readiness-no-pc.ts (estadoYPorcentaje)
 */
import { describe, it, expect } from 'vitest';

// ─── Replica de audit-operational-clients.ts ─────────────────────────────────

type EstadoOperativoCliente = 'OPERATIVO_INTERNO' | 'OPERATIVO_PARCIAL' | 'SIN_ACTIVIDAD' | 'INACTIVO';

function estadoOperativoCliente(opts: { activo: boolean; keywordsActivas: number; menciones7d: number }): EstadoOperativoCliente {
  if (!opts.activo) return 'INACTIVO';
  if (opts.keywordsActivas === 0) return 'SIN_ACTIVIDAD';
  if (opts.menciones7d > 0) return 'OPERATIVO_INTERNO';
  return 'OPERATIVO_PARCIAL';
}

describe('estadoOperativoCliente', () => {
  it('cliente inactivo siempre es INACTIVO', () => {
    expect(estadoOperativoCliente({ activo: false, keywordsActivas: 10, menciones7d: 50 })).toBe('INACTIVO');
  });

  it('sin keywords activas es SIN_ACTIVIDAD', () => {
    expect(estadoOperativoCliente({ activo: true, keywordsActivas: 0, menciones7d: 0 })).toBe('SIN_ACTIVIDAD');
  });

  it('con menciones recientes es OPERATIVO_INTERNO', () => {
    expect(estadoOperativoCliente({ activo: true, keywordsActivas: 5, menciones7d: 10 })).toBe('OPERATIVO_INTERNO');
  });

  it('con keywords pero sin menciones es OPERATIVO_PARCIAL', () => {
    expect(estadoOperativoCliente({ activo: true, keywordsActivas: 5, menciones7d: 0 })).toBe('OPERATIVO_PARCIAL');
  });

  it('CLI-0002 real (27 keywords, 59 menciones/7d) es OPERATIVO_INTERNO', () => {
    expect(estadoOperativoCliente({ activo: true, keywordsActivas: 27, menciones7d: 59 })).toBe('OPERATIVO_INTERNO');
  });

  it('CLI-0001 real (7 keywords, 5 menciones/7d) es OPERATIVO_INTERNO', () => {
    expect(estadoOperativoCliente({ activo: true, keywordsActivas: 7, menciones7d: 5 })).toBe('OPERATIVO_INTERNO');
  });
});

// ─── Replica de audit-owned-media-coverage.ts ────────────────────────────────

type EstadoMedio =
  | 'OPERATIVO_OK' | 'OPERATIVO_SIN_NOTICIAS' | 'OPERATIVO_TEXTO_MALO'
  | 'NECESITA_REENRICH' | 'NECESITA_REPARAR_FUENTE' | 'BLOQUEADO' | 'BAJO_VALOR';

function clasificarMedio(opts: { enCron: boolean; ultimoEstado: string | null; noticias7d: number; textoOkPct: number }): EstadoMedio {
  const estadoLower = (opts.ultimoEstado ?? '').toLowerCase();
  if (!opts.enCron) return 'BAJO_VALOR';
  if (estadoLower.includes('error') || estadoLower.includes('blocked') || estadoLower.includes('403')) return 'BLOQUEADO';
  if (opts.noticias7d === 0) return 'OPERATIVO_SIN_NOTICIAS';
  if (opts.textoOkPct < 30) return 'NECESITA_REENRICH';
  if (opts.textoOkPct < 70) return 'OPERATIVO_TEXTO_MALO';
  return 'OPERATIVO_OK';
}

describe('clasificarMedio', () => {
  it('fuera de cron es BAJO_VALOR sin importar el resto', () => {
    expect(clasificarMedio({ enCron: false, ultimoEstado: 'ok', noticias7d: 100, textoOkPct: 100 })).toBe('BAJO_VALOR');
  });

  it('estado error es BLOQUEADO', () => {
    expect(clasificarMedio({ enCron: true, ultimoEstado: 'error', noticias7d: 10, textoOkPct: 50 })).toBe('BLOQUEADO');
  });

  it('estado BLOCKED_403 es BLOQUEADO', () => {
    expect(clasificarMedio({ enCron: true, ultimoEstado: 'BLOCKED_403_CRAWLER', noticias7d: 0, textoOkPct: 0 })).toBe('BLOQUEADO');
  });

  it('sin noticias en 7d es OPERATIVO_SIN_NOTICIAS', () => {
    expect(clasificarMedio({ enCron: true, ultimoEstado: 'ok', noticias7d: 0, textoOkPct: 0 })).toBe('OPERATIVO_SIN_NOTICIAS');
  });

  it('texto_ok < 30% es NECESITA_REENRICH', () => {
    expect(clasificarMedio({ enCron: true, ultimoEstado: 'ok', noticias7d: 30, textoOkPct: 0 })).toBe('NECESITA_REENRICH');
  });

  it('texto_ok entre 30-70% es OPERATIVO_TEXTO_MALO', () => {
    expect(clasificarMedio({ enCron: true, ultimoEstado: 'ok', noticias7d: 6, textoOkPct: 50 })).toBe('OPERATIVO_TEXTO_MALO');
  });

  it('texto_ok >= 70% es OPERATIVO_OK', () => {
    expect(clasificarMedio({ enCron: true, ultimoEstado: 'ok', noticias7d: 43, textoOkPct: 100 })).toBe('OPERATIVO_OK');
  });

  it('El Financiero real (30 noticias, 0% texto ok) es NECESITA_REENRICH', () => {
    expect(clasificarMedio({ enCron: true, ultimoEstado: 'ok', noticias7d: 30, textoOkPct: 0 })).toBe('NECESITA_REENRICH');
  });
});

// ─── Replica de audit-operational-readiness-no-pc.ts ─────────────────────────

type EstadoOperativoNoPc = 'OPERATIVO_INTERNO' | 'OPERATIVO_PARCIAL' | 'NECESITA_COBERTURA' | 'NECESITA_TEXTO_LIMPIO' | 'NO_LISTO';

function estadoYPorcentaje(opts: {
  keywordsActivas: number; mediosEnCron: number; textoOkPct: number; errores: number;
  detectFunciona: boolean; menciones7d: number;
}): { estado: EstadoOperativoNoPc; porcentaje: number } {
  const { keywordsActivas, mediosEnCron, textoOkPct, errores, detectFunciona, menciones7d } = opts;
  if (keywordsActivas === 0 || !detectFunciona) return { estado: 'NO_LISTO', porcentaje: 0 };
  if (textoOkPct < 40) return { estado: 'NECESITA_TEXTO_LIMPIO', porcentaje: 25 };
  if (mediosEnCron < 10) return { estado: 'NECESITA_COBERTURA', porcentaje: 40 };
  const criteriosInterno = keywordsActivas > 0 && mediosEnCron >= 20 && textoOkPct >= 70 && errores === 0 && detectFunciona;
  if (criteriosInterno) return { estado: 'OPERATIVO_INTERNO', porcentaje: menciones7d > 0 ? 90 : 75 };
  return { estado: 'OPERATIVO_PARCIAL', porcentaje: 60 };
}

describe('estadoYPorcentaje', () => {
  it('sin keywords activas es NO_LISTO con 0%', () => {
    expect(estadoYPorcentaje({ keywordsActivas: 0, mediosEnCron: 39, textoOkPct: 100, errores: 0, detectFunciona: true, menciones7d: 0 }))
      .toEqual({ estado: 'NO_LISTO', porcentaje: 0 });
  });

  it('detect no funciona es NO_LISTO', () => {
    expect(estadoYPorcentaje({ keywordsActivas: 10, mediosEnCron: 39, textoOkPct: 100, errores: 0, detectFunciona: false, menciones7d: 0 }).estado)
      .toBe('NO_LISTO');
  });

  it('texto_ok < 40% es NECESITA_TEXTO_LIMPIO', () => {
    expect(estadoYPorcentaje({ keywordsActivas: 10, mediosEnCron: 39, textoOkPct: 20, errores: 0, detectFunciona: true, menciones7d: 5 }).estado)
      .toBe('NECESITA_TEXTO_LIMPIO');
  });

  it('menos de 10 medios en cron es NECESITA_COBERTURA', () => {
    expect(estadoYPorcentaje({ keywordsActivas: 10, mediosEnCron: 5, textoOkPct: 100, errores: 0, detectFunciona: true, menciones7d: 5 }).estado)
      .toBe('NECESITA_COBERTURA');
  });

  it('CLI-0002 real (27 kw, 39 medios, 100% texto, 0 errores, 59 menciones) es OPERATIVO_INTERNO 90%', () => {
    expect(estadoYPorcentaje({ keywordsActivas: 27, mediosEnCron: 39, textoOkPct: 100, errores: 0, detectFunciona: true, menciones7d: 59 }))
      .toEqual({ estado: 'OPERATIVO_INTERNO', porcentaje: 90 });
  });

  it('CLI-0001 real (7 kw, 39 medios, 100% texto, 0 errores, 5 menciones) es OPERATIVO_INTERNO 90%', () => {
    expect(estadoYPorcentaje({ keywordsActivas: 7, mediosEnCron: 39, textoOkPct: 100, errores: 0, detectFunciona: true, menciones7d: 5 }))
      .toEqual({ estado: 'OPERATIVO_INTERNO', porcentaje: 90 });
  });

  it('cumple criterios internos pero sin menciones recientes es 75%', () => {
    expect(estadoYPorcentaje({ keywordsActivas: 10, mediosEnCron: 39, textoOkPct: 100, errores: 0, detectFunciona: true, menciones7d: 0 }))
      .toEqual({ estado: 'OPERATIVO_INTERNO', porcentaje: 75 });
  });

  it('con errores de medios no llega a OPERATIVO_INTERNO', () => {
    expect(estadoYPorcentaje({ keywordsActivas: 10, mediosEnCron: 39, textoOkPct: 100, errores: 2, detectFunciona: true, menciones7d: 5 }).estado)
      .toBe('OPERATIVO_PARCIAL');
  });

  it('menos de 20 medios en cron (pero >=10) no llega a OPERATIVO_INTERNO', () => {
    expect(estadoYPorcentaje({ keywordsActivas: 10, mediosEnCron: 15, textoOkPct: 100, errores: 0, detectFunciona: true, menciones7d: 5 }).estado)
      .toBe('OPERATIVO_PARCIAL');
  });
});
