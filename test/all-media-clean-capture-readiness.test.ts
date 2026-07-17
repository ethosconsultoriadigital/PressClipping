/**
 * Tests de la lógica pura de `audit-all-media-clean-capture-readiness.ts`
 * (mediana, paywall heurístico, clasificación de estado_operativo). El script
 * no exporta estas funciones (mismo patrón que
 * audit-patron-important-media-readiness.ts / su test hermano) — se replican
 * aquí para fijar el contrato de negocio con tests reales.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('arquitectura: captura general NO depende de keywords (invariante ETHOS NEWS LAKE)', () => {
  it('scripts/crawl.ts no referencia la tabla/concepto de keywords ni clientes', () => {
    const src = readFileSync(join(process.cwd(), 'scripts/crawl.ts'), 'utf-8');
    expect(src).not.toMatch(/from\(['"]keywords['"]\)/);
    expect(src).not.toMatch(/from\(['"]clientes['"]\)/);
  });

  it('src/enrichers/enrichNews.ts no referencia keywords ni clientes', () => {
    const src = readFileSync(join(process.cwd(), 'src/enrichers/enrichNews.ts'), 'utf-8');
    expect(src).not.toMatch(/from\(['"]keywords['"]\)/);
    expect(src).not.toMatch(/from\(['"]clientes['"]\)/);
  });

  it('scripts/detect-mentions.ts SÍ referencia keywords (la detección por cliente vive ahí, no en captura)', () => {
    const src = readFileSync(join(process.cwd(), 'scripts/detect-mentions.ts'), 'utf-8');
    expect(src).toMatch(/keywords/);
  });
});

function mediana(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (s.length % 2 === 0) {
    const a = s[mid - 1] ?? 0;
    const b = s[mid] ?? 0;
    return Math.round((a + b) / 2);
  }
  return s[mid] ?? 0;
}

const GRUPOS_PAYWALL = ['grupo reforma', 'el norte', 'mural', 'reforma'];
function esPaywallProbable(grupoMedio: string | null, notasTecnicas: string | null): boolean {
  const grupo = (grupoMedio ?? '').toLowerCase();
  const notas = (notasTecnicas ?? '').toLowerCase();
  return GRUPOS_PAYWALL.some((g) => grupo.includes(g)) || notas.includes('paywall');
}

function clasificarEstado(opts: {
  bloqueado: boolean; paywallProbable: boolean; enCron: boolean;
  noticias7d: number; textoOk7d: number; textoOk30d: number;
}): string {
  const { bloqueado, paywallProbable, enCron, noticias7d, textoOk7d, textoOk30d } = opts;
  if (bloqueado) return 'BLOQUEADO';
  if (paywallProbable && !enCron) return 'PAYWALL_NO_VIABLE';
  if (!enCron) return 'CATALOGO_NO_CRON';
  if (noticias7d === 0) return 'EN_CRON_SIN_NOTICIAS';
  if (textoOk7d < 30 && textoOk30d >= 50) return 'NECESITA_REENRICH_RECIENTE';
  if (textoOk7d < 30) return 'NECESITA_REPARAR_FUENTE';
  if (textoOk7d < 70) return 'EN_CRON_TEXTO_MALO';
  if (noticias7d < 3) return 'BAJO_VALOR';
  return 'LISTO_LEYENDO';
}

describe('mediana', () => {
  it('devuelve 0 para lista vacía', () => {
    expect(mediana([])).toBe(0);
  });
  it('impar: devuelve el valor central', () => {
    expect(mediana([100, 500, 300])).toBe(300);
  });
  it('par: promedia los dos centrales', () => {
    expect(mediana([100, 200, 300, 400])).toBe(250);
  });
});

describe('esPaywallProbable', () => {
  it('detecta Grupo Reforma por grupo_medio', () => {
    expect(esPaywallProbable('Grupo Reforma', null)).toBe(true);
  });
  it('detecta por notas_tecnicas que mencionan paywall', () => {
    expect(esPaywallProbable(null, 'Sitio con paywall duro confirmado')).toBe(true);
  });
  it('medio sin señal de paywall → false', () => {
    expect(esPaywallProbable('OEM', 'Sitemap RSS válido')).toBe(false);
  });
});

describe('clasificarEstado (readiness general de captura)', () => {
  it('bloqueado tiene prioridad sobre todo lo demás', () => {
    expect(clasificarEstado({ bloqueado: true, paywallProbable: true, enCron: true, noticias7d: 100, textoOk7d: 100, textoOk30d: 100 })).toBe('BLOQUEADO');
  });
  it('paywall probable + no en cron → PAYWALL_NO_VIABLE', () => {
    expect(clasificarEstado({ bloqueado: false, paywallProbable: true, enCron: false, noticias7d: 0, textoOk7d: 0, textoOk30d: 0 })).toBe('PAYWALL_NO_VIABLE');
  });
  it('no en cron (sin paywall) → CATALOGO_NO_CRON', () => {
    expect(clasificarEstado({ bloqueado: false, paywallProbable: false, enCron: false, noticias7d: 0, textoOk7d: 0, textoOk30d: 0 })).toBe('CATALOGO_NO_CRON');
  });
  it('en cron sin noticias 7d → EN_CRON_SIN_NOTICIAS', () => {
    expect(clasificarEstado({ bloqueado: false, paywallProbable: false, enCron: true, noticias7d: 0, textoOk7d: 0, textoOk30d: 0 })).toBe('EN_CRON_SIN_NOTICIAS');
  });
  it('texto malo en 7d pero bueno en 30d → NECESITA_REENRICH_RECIENTE (caso Forbes real)', () => {
    expect(clasificarEstado({ bloqueado: false, paywallProbable: false, enCron: true, noticias7d: 225, textoOk7d: 28, textoOk30d: 60 })).toBe('NECESITA_REENRICH_RECIENTE');
  });
  it('texto malo en 7d Y en 30d → NECESITA_REPARAR_FUENTE', () => {
    expect(clasificarEstado({ bloqueado: false, paywallProbable: false, enCron: true, noticias7d: 50, textoOk7d: 10, textoOk30d: 15 })).toBe('NECESITA_REPARAR_FUENTE');
  });
  it('texto 30-70% → EN_CRON_TEXTO_MALO (caso El Heraldo real)', () => {
    expect(clasificarEstado({ bloqueado: false, paywallProbable: false, enCron: true, noticias7d: 1103, textoOk7d: 47, textoOk30d: 47 })).toBe('EN_CRON_TEXTO_MALO');
  });
  it('texto bueno pero volumen muy bajo (<3) → BAJO_VALOR', () => {
    expect(clasificarEstado({ bloqueado: false, paywallProbable: false, enCron: true, noticias7d: 2, textoOk7d: 100, textoOk30d: 100 })).toBe('BAJO_VALOR');
  });
  it('texto bueno y volumen suficiente → LISTO_LEYENDO', () => {
    expect(clasificarEstado({ bloqueado: false, paywallProbable: false, enCron: true, noticias7d: 100, textoOk7d: 95, textoOk30d: 95 })).toBe('LISTO_LEYENDO');
  });
});
