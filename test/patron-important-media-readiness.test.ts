/**
 * Tests de la lógica pura de clasificación de readiness de medios importantes
 * (replica el clasificador de estado/tipo_senal de
 * audit-patron-important-media-readiness.ts / audit-patron-brand-keywords.ts).
 */
import { describe, it, expect } from 'vitest';
import { foldText } from '../src/matchers/text.js';

// ─── Clasificación de estado por medio ───────────────────────────────────────

function clasificarEstado(opts: {
  enCatalogo: boolean; enCron: boolean; ultimoEstado: string | null; noticias7d: number; textoOkPct: number;
}): string {
  const { enCatalogo, enCron, ultimoEstado, noticias7d, textoOkPct } = opts;
  if (!enCatalogo) return 'NO_CATALOGADO';
  if (/error|blocked|403|404/i.test(ultimoEstado ?? '')) return 'BLOQUEADO';
  if (!enCron) return 'CATALOGO_NO_CRON';
  if (noticias7d === 0) return 'EN_CRON_SIN_NOTICIAS';
  if (textoOkPct < 30) return 'NECESITA_REENRICH';
  if (textoOkPct < 70) return 'EN_CRON_TEXTO_MALO';
  return 'LISTO_LEYENDO';
}

describe('clasificarEstado (readiness medios Patrón)', () => {
  it('no catalogado → NO_CATALOGADO', () => {
    expect(clasificarEstado({ enCatalogo: false, enCron: false, ultimoEstado: null, noticias7d: 0, textoOkPct: 0 })).toBe('NO_CATALOGADO');
  });
  it('estado error → BLOQUEADO (aunque esté en catálogo)', () => {
    expect(clasificarEstado({ enCatalogo: true, enCron: false, ultimoEstado: 'error', noticias7d: 0, textoOkPct: 0 })).toBe('BLOQUEADO');
  });
  it('404 en ultimo_estado → BLOQUEADO', () => {
    expect(clasificarEstado({ enCatalogo: true, enCron: true, ultimoEstado: 'HTTP 404 en sitemap', noticias7d: 5, textoOkPct: 100 })).toBe('BLOQUEADO');
  });
  it('en catálogo, no cron → CATALOGO_NO_CRON', () => {
    expect(clasificarEstado({ enCatalogo: true, enCron: false, ultimoEstado: 'ok', noticias7d: 0, textoOkPct: 0 })).toBe('CATALOGO_NO_CRON');
  });
  it('en cron sin noticias → EN_CRON_SIN_NOTICIAS', () => {
    expect(clasificarEstado({ enCatalogo: true, enCron: true, ultimoEstado: 'ok', noticias7d: 0, textoOkPct: 0 })).toBe('EN_CRON_SIN_NOTICIAS');
  });
  it('cuerpo vacío (texto<30%) → NECESITA_REENRICH (caso El Economista real)', () => {
    expect(clasificarEstado({ enCatalogo: true, enCron: true, ultimoEstado: 'ok', noticias7d: 87, textoOkPct: 0 })).toBe('NECESITA_REENRICH');
  });
  it('texto 30-70% → EN_CRON_TEXTO_MALO', () => {
    expect(clasificarEstado({ enCatalogo: true, enCron: true, ultimoEstado: 'ok', noticias7d: 10, textoOkPct: 50 })).toBe('EN_CRON_TEXTO_MALO');
  });
  it('texto >=70% con noticias → LISTO_LEYENDO (caso Periódico Correo real)', () => {
    expect(clasificarEstado({ enCatalogo: true, enCron: true, ultimoEstado: 'ok', noticias7d: 21, textoOkPct: 95.2 })).toBe('LISTO_LEYENDO');
  });
});

// ─── Clasificación de tipo de señal por keyword ──────────────────────────────

const MARCA = ['patron', 'tequila patron', 'casa patron', 'bacardi', 'atotonilco'];
const CRISIS = ['adulterad', 'clandestin', 'intoxicac', 'metanol', 'decomiso', 'falsific', 'contaminad'];
const INDUSTRIA = ['exportacion', 'arancel', 't-mec', 'tmec', 'comercio', 'denominacion', 'nom-', 'comercam', 'consejo regulador', 'crt', 'ieps', 'industria'];

function tipoSenal(keyword: string): 'MARCA_DIRECTA' | 'SECTOR_CRISIS' | 'INDUSTRIA' | 'RUIDO' {
  const k = foldText(keyword);
  if (MARCA.some((m) => k.includes(m))) return 'MARCA_DIRECTA';
  if (CRISIS.some((c) => k.includes(c))) return 'SECTOR_CRISIS';
  if (INDUSTRIA.some((i) => k.includes(i))) return 'INDUSTRIA';
  return 'RUIDO';
}

describe('tipoSenal (clasificación de keywords Patrón)', () => {
  it('Tequila Patrón / Casa Patrón / Bacardí / Patrón → MARCA_DIRECTA', () => {
    for (const k of ['Tequila Patrón', 'Casa Patrón', 'Bacardí', 'Patrón', 'Atotonilco el Alto']) {
      expect(tipoSenal(k)).toBe('MARCA_DIRECTA');
    }
  });
  it('tequila adulterado / bebidas clandestinas / intoxicación → SECTOR_CRISIS', () => {
    for (const k of ['tequila adulterado', 'bebidas clandestinas', 'intoxicación por alcohol', 'decomiso de alcohol']) {
      expect(tipoSenal(k)).toBe('SECTOR_CRISIS');
    }
  });
  it('exportación de tequila / T-MEC / IEPS / CRT → INDUSTRIA', () => {
    for (const k of ['exportación de tequila', 'T-MEC', 'IEPS alcohol', 'Consejo Regulador del Tequila']) {
      expect(tipoSenal(k)).toBe('INDUSTRIA');
    }
  });
});
