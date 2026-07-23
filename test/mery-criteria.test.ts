import { describe, it, expect } from 'vitest';
import {
  clasificarMery,
  estadoEditorialMery,
  tabDestinoMery,
  razonClasificacionMery,
  detectGrupoTemaMery,
  TIER_ALTA_IDS,
  TIER_BAJA_IDS,
  PRIORIDAD_CAT,
} from '../src/editorial/meryCriteria.js';
import { parseArgs } from '../scripts/export-mery-final-preview-no-pc.js';

// ─────────────────────────────────────────────────────────────────────────────
// clasificarMery
// ─────────────────────────────────────────────────────────────────────────────

describe('clasificarMery — Tier 1/2 (KEY-0040..0047)', () => {
  it('nombre en título → MENCION_DIRECTA', () => {
    expect(clasificarMery('Mery Pozos denuncia privatización del agua en Jalisco', 'KEY-0041')).toBe('MENCION_DIRECTA');
  });

  it('diputada Mery en título → MENCION_DIRECTA', () => {
    expect(clasificarMery('Hay presencia de plomo, denuncia diputada Mery Pozos', 'KEY-0045')).toBe('MENCION_DIRECTA');
  });

  it('Merilyn Gómez en título → MENCION_DIRECTA', () => {
    expect(clasificarMery('Merilyn Gómez Pozos rechaza propuesta de endeudamiento', 'KEY-0040')).toBe('MENCION_DIRECTA');
  });

  it('Mery Gómez Pozos en título → MENCION_DIRECTA', () => {
    expect(clasificarMery('Mery Gómez Pozos participa en debate legislativo', 'KEY-0042')).toBe('MENCION_DIRECTA');
  });

  it('título sin nombre (cuerpo match) + Tier 1 → CONTEXTO_POLITICO', () => {
    expect(clasificarMery('Crisis del agua en Jalisco expone divisiones en Morena', 'KEY-0040')).toBe('CONTEXTO_POLITICO');
  });

  it('título sin nombre + Tier 2 → CONTEXTO_POLITICO', () => {
    expect(clasificarMery('SIAPA: Gobierno de Jalisco abierto al diálogo', 'KEY-0046')).toBe('CONTEXTO_POLITICO');
  });

  it('todos los IDs Tier 1/2 producen MENCION_DIRECTA cuando nombre está en título', () => {
    for (const id of TIER_ALTA_IDS) {
      expect(clasificarMery('Mery Pozos habla sobre el agua', id)).toBe('MENCION_DIRECTA');
    }
  });
});

describe('clasificarMery — Tier 3 (KEY-0048..0051)', () => {
  it('cualquier título + Tier 3 → TEMA_RELACIONADO', () => {
    for (const id of TIER_BAJA_IDS) {
      expect(clasificarMery('Crisis del agua en Guadalajara', id)).toBe('TEMA_RELACIONADO');
    }
  });

  it('Tier 3 con nombre en título también es TEMA_RELACIONADO (no MENCION_DIRECTA)', () => {
    expect(clasificarMery('Mery Pozos lidera iniciativa', 'KEY-0048')).toBe('TEMA_RELACIONADO');
  });
});

describe('clasificarMery — POSIBLE_FP', () => {
  it('"La Tremenda Corte" → POSIBLE_FP con Tier 1', () => {
    expect(clasificarMery('La Tremenda Corte', 'KEY-0041')).toBe('POSIBLE_FP');
  });

  it('"La Tremenda Corte" → POSIBLE_FP con Tier 3', () => {
    expect(clasificarMery('La Tremenda Corte', 'KEY-0050')).toBe('POSIBLE_FP');
  });

  it('POSIBLE_FP tiene la mayor prioridad de fusión', () => {
    expect(PRIORIDAD_CAT['POSIBLE_FP']).toBeGreaterThan(PRIORIDAD_CAT['MENCION_DIRECTA']);
  });

  it('keyword_id desconocido → TEMA_RELACIONADO (no POSIBLE_FP, no EXCLUIR)', () => {
    expect(clasificarMery('Nota normal', 'KEY-9999')).toBe('TEMA_RELACIONADO');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// estadoEditorialMery
// ─────────────────────────────────────────────────────────────────────────────

describe('estadoEditorialMery', () => {
  it('MENCION_DIRECTA → GO_DIRECTA', () => {
    expect(estadoEditorialMery('MENCION_DIRECTA')).toBe('GO_DIRECTA');
  });

  it('CONTEXTO_POLITICO → GO_CONTEXTO', () => {
    expect(estadoEditorialMery('CONTEXTO_POLITICO')).toBe('GO_CONTEXTO');
  });

  it('TEMA_RELACIONADO → REVISION_HUMANA', () => {
    expect(estadoEditorialMery('TEMA_RELACIONADO')).toBe('REVISION_HUMANA');
  });

  it('POSIBLE_FP → REVISION_HUMANA', () => {
    expect(estadoEditorialMery('POSIBLE_FP')).toBe('REVISION_HUMANA');
  });

  it('EXCLUIR → EXCLUIDA', () => {
    expect(estadoEditorialMery('EXCLUIR')).toBe('EXCLUIDA');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tabDestinoMery
// ─────────────────────────────────────────────────────────────────────────────

describe('tabDestinoMery', () => {
  it('MENCION_DIRECTA → 16_Mery_Final_Preview', () => {
    expect(tabDestinoMery('MENCION_DIRECTA')).toBe('16_Mery_Final_Preview');
  });

  it('CONTEXTO_POLITICO → 16_Mery_Final_Preview', () => {
    expect(tabDestinoMery('CONTEXTO_POLITICO')).toBe('16_Mery_Final_Preview');
  });

  it('TEMA_RELACIONADO → 17_Mery_Revision_Humana', () => {
    expect(tabDestinoMery('TEMA_RELACIONADO')).toBe('17_Mery_Revision_Humana');
  });

  it('POSIBLE_FP → 17_Mery_Revision_Humana', () => {
    expect(tabDestinoMery('POSIBLE_FP')).toBe('17_Mery_Revision_Humana');
  });

  it('EXCLUIR → 18_Mery_Excluidas', () => {
    expect(tabDestinoMery('EXCLUIR')).toBe('18_Mery_Excluidas');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// razonClasificacionMery
// ─────────────────────────────────────────────────────────────────────────────

describe('razonClasificacionMery', () => {
  it('POSIBLE_FP incluye fragmento del título', () => {
    const razon = razonClasificacionMery('POSIBLE_FP', 'La Tremenda Corte', 'KEY-0041');
    expect(razon).toMatch(/tremenda corte/i);
    expect(razon).toMatch(/verificar/i);
  });

  it('MENCION_DIRECTA incluye keyword_id', () => {
    const razon = razonClasificacionMery('MENCION_DIRECTA', 'Mery Pozos...', 'KEY-0041');
    expect(razon).toContain('KEY-0041');
    expect(razon).toMatch(/título/i);
  });

  it('CONTEXTO_POLITICO incluye keyword_id', () => {
    const razon = razonClasificacionMery('CONTEXTO_POLITICO', 'Nota agua', 'KEY-0040');
    expect(razon).toContain('KEY-0040');
    expect(razon).toMatch(/cuerpo/i);
  });

  it('TEMA_RELACIONADO indica variante amplia', () => {
    const razon = razonClasificacionMery('TEMA_RELACIONADO', 'Jalisco', 'KEY-0050');
    expect(razon).toMatch(/tier 3|variante/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// detectGrupoTemaMery
// ─────────────────────────────────────────────────────────────────────────────

describe('detectGrupoTemaMery', () => {
  it('título con "agua" → JALISCO_AGUA', () => {
    expect(detectGrupoTemaMery('Crisis del agua en Guadalajara')).toBe('JALISCO_AGUA');
  });

  it('título con "SIAPA" → JALISCO_AGUA', () => {
    expect(detectGrupoTemaMery('SIAPA anuncia diálogo con diputados')).toBe('JALISCO_AGUA');
  });

  it('título legislativo → LEGISLATIVO', () => {
    expect(detectGrupoTemaMery('Comisión de la Cámara aprueba reforma')).toBe('LEGISLATIVO');
  });

  it('título electoral → ELECTORAL', () => {
    expect(detectGrupoTemaMery('Encuesta posiciona a candidata de Morena')).toBe('ELECTORAL');
  });

  it('título genérico → POLITICO_GENERAL', () => {
    expect(detectGrupoTemaMery('Declaración sobre política nacional')).toBe('POLITICO_GENERAL');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseArgs — seguridad de salida
// ─────────────────────────────────────────────────────────────────────────────

describe('parseArgs — output safety', () => {
  it('default es dry-run=false, output=console, windowDays=30', () => {
    const a = parseArgs([]);
    expect(a.dryRun).toBe(false);
    expect(a.output).toBe('console');
    expect(a.windowDays).toBe(30);
    expect(a.maxRows).toBe(200);
  });

  it('--dry-run activa dryRun', () => {
    expect(parseArgs(['--dry-run']).dryRun).toBe(true);
  });

  it('--output=sheet configura sheet', () => {
    expect(parseArgs(['--output=sheet']).output).toBe('sheet');
  });

  it('--window-days=7 configura ventana correctamente', () => {
    expect(parseArgs(['--window-days=7']).windowDays).toBe(7);
  });

  it('--max-rows=50 configura tope', () => {
    expect(parseArgs(['--max-rows=50']).maxRows).toBe(50);
  });

  it('argumento desconocido no rompe el parse', () => {
    expect(() => parseArgs(['--desconocido=xyz'])).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Invariantes de clasificación para los 29 artículos conocidos del backtest
// ─────────────────────────────────────────────────────────────────────────────

describe('clasificarMery — casos reales del backtest 2026-07-22', () => {
  it('Mery Pozos denuncia privatización (Político MX) → MENCION_DIRECTA', () => {
    expect(clasificarMery(
      'Mery Pozos denuncia intento de privatización del agua en Jalisco', 'KEY-0041',
    )).toBe('MENCION_DIRECTA');
  });

  it('Hay presencia de plomo y mercurio, denuncia diputada Mery Pozos (El Heraldo) → MENCION_DIRECTA', () => {
    expect(clasificarMery(
      'Hay presencia de plomo y mercurio en agua potable en Guadalajara, denuncia diputada Mery Pozos', 'KEY-0045',
    )).toBe('MENCION_DIRECTA');
  });

  it('SIAPA: Gobierno de Jalisco abierto al diálogo (El Informador) + KEY-0040 → CONTEXTO_POLITICO', () => {
    expect(clasificarMery(
      'SIAPA: Gobierno de Jalisco se dice abierto al diálogo ante propuesta de Consejo Consultivo del Agua', 'KEY-0040',
    )).toBe('CONTEXTO_POLITICO');
  });

  it('La Tremenda Corte (Milenio) → POSIBLE_FP independientemente del keyword', () => {
    for (const id of ['KEY-0040', 'KEY-0041', 'KEY-0046', 'KEY-0048', 'KEY-0050', 'KEY-0051']) {
      expect(clasificarMery('La Tremenda Corte', id)).toBe('POSIBLE_FP');
    }
  });

  it('POSIBLE_FP gana sobre MENCION_DIRECTA en prioridad de fusión', () => {
    expect(PRIORIDAD_CAT['POSIBLE_FP']).toBeGreaterThan(PRIORIDAD_CAT['MENCION_DIRECTA']);
    expect(PRIORIDAD_CAT['MENCION_DIRECTA']).toBeGreaterThan(PRIORIDAD_CAT['CONTEXTO_POLITICO']);
    expect(PRIORIDAD_CAT['CONTEXTO_POLITICO']).toBeGreaterThan(PRIORIDAD_CAT['TEMA_RELACIONADO']);
    expect(PRIORIDAD_CAT['TEMA_RELACIONADO']).toBeGreaterThan(PRIORIDAD_CAT['EXCLUIR']);
  });
});
