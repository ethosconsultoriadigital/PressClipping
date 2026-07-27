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
import {
  parseArgs,
  cleanTextForSheet,
  buildNotaCompletaLimpia,
  buildExtractLimpio,
  selectBestText,
  HEADERS,
} from '../scripts/export-mery-final-preview-no-pc.js';

// ─────────────────────────────────────────────────────────────────────────────
// clasificarMery — Tier 1/2
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

  it('título sin nombre + Tier 1 → CONTEXTO_POLITICO', () => {
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

  it('POSIBLE_FP → REVISION_HUMANA (La Tremenda Corte no se excluye, va a revisión)', () => {
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

  it('POSIBLE_FP → 17_Mery_Revision_Humana (no excluida)', () => {
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
// cleanTextForSheet
// ─────────────────────────────────────────────────────────────────────────────

describe('cleanTextForSheet', () => {
  it('elimina tabs', () => {
    expect(cleanTextForSheet('texto\tcon\ttabs')).toBe('texto con tabs');
  });

  it('normaliza saltos de línea múltiples a máximo dos', () => {
    const raw = 'párrafo uno\n\n\n\n\npárrafo dos';
    expect(cleanTextForSheet(raw)).toBe('párrafo uno\n\npárrafo dos');
  });

  it('colapsa espacios múltiples', () => {
    expect(cleanTextForSheet('texto  con   espacios')).toBe('texto con espacios');
  });

  it('trim de cada línea', () => {
    const raw = '  línea con espacio   \n  otra línea  ';
    const result = cleanTextForSheet(raw);
    expect(result).toBe('línea con espacio\notra línea');
  });

  it('null/undefined → string vacío', () => {
    expect(cleanTextForSheet(null)).toBe('');
    expect(cleanTextForSheet(undefined)).toBe('');
    expect(cleanTextForSheet('')).toBe('');
  });

  it('CRLF normalizado a LF', () => {
    expect(cleanTextForSheet('línea\r\notro')).toBe('línea\notro');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildNotaCompletaLimpia
// ─────────────────────────────────────────────────────────────────────────────

describe('buildNotaCompletaLimpia', () => {
  it('elimina "MÁS SOBRE ESTE TEMA"', () => {
    const raw = 'Cuerpo de la nota.\nMÁS SOBRE ESTE TEMA: Agua en Jalisco\nOtro párrafo.';
    const { texto } = buildNotaCompletaLimpia(raw);
    expect(texto).not.toMatch(/más sobre este tema/i);
    expect(texto).toContain('Cuerpo de la nota');
    expect(texto).toContain('Otro párrafo');
  });

  it('elimina "Ver más en"', () => {
    const raw = 'Contenido real.\nVer más en: elinfomador.com\nMás contenido.';
    const { texto } = buildNotaCompletaLimpia(raw);
    expect(texto).not.toMatch(/ver más en/i);
  });

  it('elimina "Únete a nuestro canal"', () => {
    const raw = 'Nota política.\nÚnete a nuestro canal de WhatsApp\nSiguiente párrafo.';
    const { texto } = buildNotaCompletaLimpia(raw);
    expect(texto).not.toMatch(/únete a nuestro canal/i);
  });

  it('elimina "Publicidad"', () => {
    const raw = 'Párrafo uno.\nPublicidad\nPárrafo dos.';
    const { texto } = buildNotaCompletaLimpia(raw);
    expect(texto).not.toMatch(/\bPublicidad\b/i);
  });

  it('elimina "Suscríbete"', () => {
    const raw = 'Nota real.\nSuscríbete a nuestro newsletter\nFin.';
    const { texto } = buildNotaCompletaLimpia(raw);
    expect(texto).not.toMatch(/suscr[íi]bete/i);
  });

  it('preserva párrafos legítimos con saltos de línea simples', () => {
    const raw = 'Párrafo uno.\n\nPárrafo dos.\n\nPárrafo tres.';
    const { texto } = buildNotaCompletaLimpia(raw);
    expect(texto).toBe('Párrafo uno.\n\nPárrafo dos.\n\nPárrafo tres.');
  });

  it('texto vacío → truncada=false, texto vacío', () => {
    const { texto, truncada } = buildNotaCompletaLimpia('');
    expect(texto).toBe('');
    expect(truncada).toBe(false);
  });

  it('texto corto → no truncado', () => {
    const { truncada } = buildNotaCompletaLimpia('Texto corto.');
    expect(truncada).toBe(false);
  });

  it('texto largo → truncado=true, texto termina en "…"', () => {
    const largo = 'a'.repeat(5000);
    const { texto, truncada } = buildNotaCompletaLimpia(largo, 4000);
    expect(truncada).toBe(true);
    expect(texto.endsWith('…')).toBe(true);
    expect(texto.length).toBeLessThanOrEqual(4010);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildExtractLimpio
// ─────────────────────────────────────────────────────────────────────────────

describe('buildExtractLimpio', () => {
  it('texto corto → sale completo, sin saltos de línea', () => {
    const result = buildExtractLimpio('Mery Pozos habló sobre el agua.', 'Mery Pozos');
    expect(result).toBe('Mery Pozos habló sobre el agua.');
    expect(result).not.toContain('\n');
  });

  it('saltos de línea se convierten en espacios', () => {
    const raw = 'Primera línea.\nSegunda línea.\nTercera.';
    const result = buildExtractLimpio(raw, 'línea', 600);
    expect(result).not.toContain('\n');
  });

  it('texto largo → se trunca a maxChars', () => {
    const largo = 'x'.repeat(1000);
    const result = buildExtractLimpio(largo, 'y', 600);
    expect(result.length).toBeLessThanOrEqual(605); // +elipsis
  });

  it('keyword al centro: extracto incluye la keyword', () => {
    const inicio = 'a'.repeat(400);
    const fin = 'b'.repeat(400);
    const raw = `${inicio}Mery Pozos${fin}`;
    const result = buildExtractLimpio(raw, 'Mery Pozos', 200);
    expect(result.toLowerCase()).toContain('mery pozos');
  });

  it('sin keyword match → trunca desde el inicio', () => {
    const raw = 'texto sin keyword '.repeat(50);
    const result = buildExtractLimpio(raw, 'XYZ_NO_EXISTE', 100);
    expect(result.length).toBeLessThanOrEqual(105);
  });

  it('null → string vacío', () => {
    expect(buildExtractLimpio(null, 'Mery Pozos')).toBe('');
    expect(buildExtractLimpio(undefined, 'Mery Pozos')).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// selectBestText
// ─────────────────────────────────────────────────────────────────────────────

describe('selectBestText', () => {
  it('prioriza texto_nota_limpia sobre todo', () => {
    const result = selectBestText({
      texto_nota_limpia: 'limpia',
      texto_cuerpo_nota: 'cuerpo',
      texto_extraido: 'extraido',
      resumen: 'resumen',
    }, 'match');
    expect(result).toBe('limpia');
  });

  it('cae a texto_cuerpo_nota si nota_limpia es null', () => {
    const result = selectBestText({
      texto_nota_limpia: null,
      texto_cuerpo_nota: 'cuerpo',
      texto_extraido: 'extraido',
      resumen: 'resumen',
    }, 'match');
    expect(result).toBe('cuerpo');
  });

  it('cae a texto_extraido si cuerpo_nota es null', () => {
    const result = selectBestText({
      texto_nota_limpia: null,
      texto_cuerpo_nota: null,
      texto_extraido: 'extraido',
      resumen: 'resumen',
    }, 'match');
    expect(result).toBe('extraido');
  });

  it('cae a resumen si extraido es null', () => {
    const result = selectBestText({
      texto_nota_limpia: null,
      texto_cuerpo_nota: null,
      texto_extraido: null,
      resumen: 'resumen',
    }, 'match');
    expect(result).toBe('resumen');
  });

  it('último fallback: texto_match', () => {
    const result = selectBestText({
      texto_nota_limpia: null,
      texto_cuerpo_nota: null,
      texto_extraido: null,
      resumen: null,
    }, 'match');
    expect(result).toBe('match');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HEADERS — columnas requeridas
// ─────────────────────────────────────────────────────────────────────────────

describe('HEADERS — columnas operativas', () => {
  it('incluye nota_completa_limpia', () => {
    expect(HEADERS).toContain('nota_completa_limpia');
  });

  it('incluye extracto_limpio', () => {
    expect(HEADERS).toContain('extracto_limpio');
  });

  it('incluye nota_completa_chars', () => {
    expect(HEADERS).toContain('nota_completa_chars');
  });

  it('incluye nota_completa_truncada', () => {
    expect(HEADERS).toContain('nota_completa_truncada');
  });

  it('mantiene columnas legacy (dedupe_key, url_norm, extracto_match)', () => {
    expect(HEADERS).toContain('dedupe_key');
    expect(HEADERS).toContain('url_norm');
    expect(HEADERS).toContain('extracto_match');
  });

  it('nota_completa_limpia aparece antes de campos legacy', () => {
    const idxNota = HEADERS.indexOf('nota_completa_limpia');
    const idxLegacy = HEADERS.indexOf('url_norm');
    expect(idxNota).toBeLessThan(idxLegacy);
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
// Casos reales del backtest 2026-07-22
// ─────────────────────────────────────────────────────────────────────────────

describe('clasificarMery — casos reales del backtest 2026-07-22', () => {
  it('Mery Pozos denuncia privatización (Político MX) → MENCION_DIRECTA', () => {
    expect(clasificarMery(
      'Mery Pozos denuncia intento de privatización del agua en Jalisco', 'KEY-0041',
    )).toBe('MENCION_DIRECTA');
  });

  it('denuncia diputada Mery Pozos (El Heraldo) → MENCION_DIRECTA', () => {
    expect(clasificarMery(
      'Hay presencia de plomo y mercurio en agua potable en Guadalajara, denuncia diputada Mery Pozos', 'KEY-0045',
    )).toBe('MENCION_DIRECTA');
  });

  it('SIAPA: Gobierno de Jalisco (El Informador) + KEY-0040 → CONTEXTO_POLITICO', () => {
    expect(clasificarMery(
      'SIAPA: Gobierno de Jalisco se dice abierto al diálogo ante propuesta de Consejo Consultivo del Agua', 'KEY-0040',
    )).toBe('CONTEXTO_POLITICO');
  });

  it('La Tremenda Corte (Milenio) → POSIBLE_FP → sigue en REVISION_HUMANA, no excluida', () => {
    for (const id of ['KEY-0040', 'KEY-0041', 'KEY-0046', 'KEY-0048', 'KEY-0050', 'KEY-0051']) {
      const cat = clasificarMery('La Tremenda Corte', id);
      expect(cat).toBe('POSIBLE_FP');
      expect(estadoEditorialMery(cat)).toBe('REVISION_HUMANA');
      expect(tabDestinoMery(cat)).toBe('17_Mery_Revision_Humana');
    }
  });

  it('prioridad de categorías: POSIBLE_FP > MENCION_DIRECTA > CONTEXTO_POLITICO > TEMA_RELACIONADO > EXCLUIR', () => {
    expect(PRIORIDAD_CAT['POSIBLE_FP']).toBeGreaterThan(PRIORIDAD_CAT['MENCION_DIRECTA']);
    expect(PRIORIDAD_CAT['MENCION_DIRECTA']).toBeGreaterThan(PRIORIDAD_CAT['CONTEXTO_POLITICO']);
    expect(PRIORIDAD_CAT['CONTEXTO_POLITICO']).toBeGreaterThan(PRIORIDAD_CAT['TEMA_RELACIONADO']);
    expect(PRIORIDAD_CAT['TEMA_RELACIONADO']).toBeGreaterThan(PRIORIDAD_CAT['EXCLUIR']);
  });
});
