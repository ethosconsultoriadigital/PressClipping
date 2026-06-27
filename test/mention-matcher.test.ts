import { describe, it, expect } from 'vitest';
import {
  normalizeUrl,
  normalizeTitulo,
  normalizeMedio,
  calcSimilarity,
  matchMenciones,
  type MencionNorm,
} from '../src/comparators/mentionMatcher.js';

// ─────────────────────────────────────────────────────────────────────────────
// normalizeUrl
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeUrl', () => {
  it('elimina parámetros UTM', () => {
    expect(normalizeUrl('https://ejemplo.mx/nota?utm_source=fb&utm_medium=social'))
      .toBe('https://ejemplo.mx/nota');
  });

  it('elimina fbclid y gclid', () => {
    expect(normalizeUrl('https://ejemplo.mx/nota?fbclid=abc123'))
      .toBe('https://ejemplo.mx/nota');
    expect(normalizeUrl('https://ejemplo.mx/nota?gclid=xyz'))
      .toBe('https://ejemplo.mx/nota');
  });

  it('elimina fragmentos (#)', () => {
    expect(normalizeUrl('https://ejemplo.mx/nota#comentarios'))
      .toBe('https://ejemplo.mx/nota');
  });

  it('elimina trailing slash (excepto raíz)', () => {
    expect(normalizeUrl('https://ejemplo.mx/nota/'))
      .toBe('https://ejemplo.mx/nota');
    // Raíz sin path — conserva
    expect(normalizeUrl('https://ejemplo.mx/'))
      .toBe('https://ejemplo.mx/');
  });

  it('conserva parámetros que no son tracking', () => {
    expect(normalizeUrl('https://ejemplo.mx/buscar?q=tequila'))
      .toBe('https://ejemplo.mx/buscar?q=tequila');
  });

  it('devuelve cadena vacía para entrada vacía o null', () => {
    expect(normalizeUrl('')).toBe('');
    expect(normalizeUrl(null)).toBe('');
    expect(normalizeUrl(undefined)).toBe('');
  });

  it('normaliza esquema y host a minúsculas', () => {
    expect(normalizeUrl('HTTPS://Ejemplo.MX/Nota'))
      .toBe('https://ejemplo.mx/Nota');
  });

  it('elimina múltiples parámetros tracking juntos', () => {
    const url = 'https://ejemplo.mx/nota?utm_source=google&utm_campaign=verano&ref=home';
    expect(normalizeUrl(url)).toBe('https://ejemplo.mx/nota');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// normalizeTitulo
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeTitulo', () => {
  it('convierte a minúsculas', () => {
    expect(normalizeTitulo('REFORMA LABORAL AVANZA')).toBe('reforma laboral avanza');
  });

  it('elimina acentos', () => {
    expect(normalizeTitulo('Denominación de Origen')).toBe('denominacion de origen');
    expect(normalizeTitulo('Jalisco impulsa económia')).toBe('jalisco impulsa economia');
  });

  it('elimina ñ → n', () => {
    expect(normalizeTitulo('Mañana habrá reunión')).toBe('manana habra reunion');
  });

  it('elimina puntuación fuerte', () => {
    const r = normalizeTitulo('¡Alerta! Tequila: pros y contras (2026)');
    expect(r).not.toContain('¡');
    expect(r).not.toContain(':');
    expect(r).not.toContain('(');
    expect(r).toContain('tequila');
  });

  it('colapsa espacios múltiples', () => {
    expect(normalizeTitulo('  Reforma   laboral  ')).toBe('reforma laboral');
  });

  it('devuelve cadena vacía para null o undefined', () => {
    expect(normalizeTitulo(null)).toBe('');
    expect(normalizeTitulo(undefined)).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// normalizeMedio
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeMedio', () => {
  it('normaliza a minúsculas sin acentos', () => {
    expect(normalizeMedio('Jalisco TV')).toBe('jalisco tv');
  });

  it('elimina sufijos genéricos', () => {
    const r = normalizeMedio('NTR Noticias Guadalajara');
    expect(r).not.toContain('noticias');
  });

  it('devuelve cadena vacía para null', () => {
    expect(normalizeMedio(null)).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// calcSimilarity
// ─────────────────────────────────────────────────────────────────────────────

describe('calcSimilarity', () => {
  it('cadenas idénticas → 1.0', () => {
    expect(calcSimilarity('reforma laboral', 'reforma laboral')).toBe(1.0);
  });

  it('cadenas sin relación → valor bajo', () => {
    expect(calcSimilarity('tequila exportacion', 'clima municipio norte')).toBeLessThan(0.5);
  });

  it('cadenas vacías → 1.0', () => {
    expect(calcSimilarity('', '')).toBe(1.0);
  });

  it('una vacía, otra con texto → 0', () => {
    expect(calcSimilarity('', 'algo')).toBe(0);
    expect(calcSimilarity('algo', '')).toBe(0);
  });

  it('títulos casi idénticos → similitud alta', () => {
    const a = 'reforma laboral avanza en jalisco';
    const b = 'reforma laboral avanza en jalisco hoy';
    expect(calcSimilarity(a, b)).toBeGreaterThan(0.85);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// matchMenciones — MATCH_FUERTE
// ─────────────────────────────────────────────────────────────────────────────

describe('matchMenciones — MATCH_FUERTE por URL', () => {
  it('detecta MATCH cuando las URL normalizadas son iguales', () => {
    const ethos: MencionNorm[] = [{
      fuente: 'Ethos',
      fecha: '2026-06-10',
      medio: 'Jalisco TV',
      titulo: 'Reforma laboral avanza',
      url: 'https://jaliscotv.com/nota/1234?utm_source=tw',
      keyword: 'reforma laboral',
    }];
    const pc: MencionNorm[] = [{
      fuente: 'PressClipping',
      fecha: '2026-06-10',
      medio: 'Jalisco TV',
      titulo: 'Reforma laboral avanza',
      url: 'https://jaliscotv.com/nota/1234',
    }];

    const resultados = matchMenciones(ethos, pc);
    expect(resultados).toHaveLength(1);
    expect(resultados[0]!.match_tipo).toBe('MATCH_FUERTE');
    expect(resultados[0]!.estado_comparativo).toBe('MATCH');
    expect(resultados[0]!.en_ethos).toBe(true);
    expect(resultados[0]!.en_pressclipping).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// matchMenciones — MATCH_PROBABLE
// ─────────────────────────────────────────────────────────────────────────────

describe('matchMenciones — MATCH_PROBABLE por título+medio+fecha', () => {
  it('detecta MATCH_PROBABLE cuando título ≥ 85%, mismo medio, fecha ±3 días', () => {
    // Diferencia mínima: una sola palabra al final → similitud > 0.85
    const ethos: MencionNorm[] = [{
      fuente: 'Ethos',
      fecha: '2026-06-10',
      medio: 'Jalisco TV',
      titulo: 'Reforma laboral avanza en Jalisco',
      url: 'https://jaliscotv.com/nota/1234-v2',
      keyword: 'reforma laboral',
    }];
    const pc: MencionNorm[] = [{
      fuente: 'PressClipping',
      fecha: '2026-06-11',
      medio: 'Jalisco TV',
      titulo: 'Reforma laboral avanza en Jalisco hoy',
      url: 'https://jaliscotv.com/nota/1234-v3',
    }];

    const resultados = matchMenciones(ethos, pc);
    expect(resultados).toHaveLength(1);
    expect(resultados[0]!.match_tipo).toBe('MATCH_PROBABLE');
    expect(resultados[0]!.estado_comparativo).toBe('MATCH_PROBABLE');
    expect(resultados[0]!.score_similitud).toBeGreaterThan(0.84);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// matchMenciones — SOLO_ETHOS
// ─────────────────────────────────────────────────────────────────────────────

describe('matchMenciones — SOLO_ETHOS', () => {
  it('marca SOLO_ETHOS cuando no hay ningún match en PressClipping', () => {
    const ethos: MencionNorm[] = [{
      fuente: 'Ethos',
      fecha: '2026-06-10',
      medio: 'NTR Guadalajara',
      titulo: 'COMERCAM revisa norma de mezcal',
      url: 'https://ntrguadalajara.com/nota/5678',
      keyword: 'COMERCAM',
    }];
    const pc: MencionNorm[] = [{
      fuente: 'PressClipping',
      fecha: '2026-06-10',
      medio: 'El Universal',
      titulo: 'Política exterior de México',
      url: 'https://eluniversal.com/nota/999',
    }];

    const resultados = matchMenciones(ethos, pc);
    const soloEthos = resultados.find(r => r.en_ethos && !r.en_pressclipping);
    expect(soloEthos).toBeDefined();
    expect(soloEthos!.estado_comparativo).toBe('SOLO_ETHOS');
    expect(soloEthos!.match_tipo).toBe('SIN_MATCH');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// matchMenciones — SOLO_PRESSCLIPPING
// ─────────────────────────────────────────────────────────────────────────────

describe('matchMenciones — SOLO_PRESSCLIPPING', () => {
  it('marca SOLO_PRESSCLIPPING cuando PressClipping tiene registros sin equivalente en Ethos', () => {
    const ethos: MencionNorm[] = [];
    const pc: MencionNorm[] = [{
      fuente: 'PressClipping',
      fecha: '2026-05-15',
      medio: 'Milenio',
      titulo: 'Industria tequilera cierra trimestre',
      url: 'https://milenio.com/nota/abc',
      keyword: 'tequila',
    }];

    const resultados = matchMenciones(ethos, pc);
    expect(resultados).toHaveLength(1);
    expect(resultados[0]!.estado_comparativo).toBe('SOLO_PRESSCLIPPING');
    expect(resultados[0]!.en_ethos).toBe(false);
    expect(resultados[0]!.en_pressclipping).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// No matchear medio distinto con similitud baja
// ─────────────────────────────────────────────────────────────────────────────

describe('matchMenciones — no matchear por medio distinto + baja similitud', () => {
  it('no produce MATCH_PROBABLE si el medio es distinto aunque el título sea parecido', () => {
    const ethos: MencionNorm[] = [{
      fuente: 'Ethos',
      fecha: '2026-06-10',
      medio: 'Jalisco TV',
      titulo: 'Tequila impulsa exportaciones mexicanas',
      url: 'https://jaliscotv.com/nota/export',
      keyword: 'tequila',
    }];
    const pc: MencionNorm[] = [{
      fuente: 'PressClipping',
      fecha: '2026-06-10',
      medio: 'El Universal',           // medio distinto
      titulo: 'Tequila impulsa exportaciones mexicanas',
      url: 'https://eluniversal.com/nota/export',
    }];

    const resultados = matchMenciones(ethos, pc);
    // Puede haber MATCH_PROBABLE o SIN_MATCH pero no MATCH_FUERTE
    const r = resultados.find(r => r.en_ethos);
    expect(r!.match_tipo).not.toBe('MATCH_FUERTE');
    // El medio es distinto → no debería ser MATCH_PROBABLE
    expect(r!.estado_comparativo).not.toBe('MATCH');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Array vacíos
// ─────────────────────────────────────────────────────────────────────────────

describe('matchMenciones — arrays vacíos', () => {
  it('ambos vacíos → resultado vacío', () => {
    expect(matchMenciones([], [])).toHaveLength(0);
  });

  it('solo ethos, sin PC → todo SOLO_ETHOS', () => {
    const ethos: MencionNorm[] = [
      { fuente: 'Ethos', titulo: 'nota A', medio: 'Jalisco TV', url: 'https://a.mx/1' },
      { fuente: 'Ethos', titulo: 'nota B', medio: 'NTR', url: 'https://b.mx/2' },
    ];
    const res = matchMenciones(ethos, []);
    expect(res.every(r => r.estado_comparativo === 'SOLO_ETHOS')).toBe(true);
  });

  it('solo PC, sin ethos → todo SOLO_PRESSCLIPPING', () => {
    const pc: MencionNorm[] = [
      { fuente: 'PressClipping', titulo: 'nota X', medio: 'Milenio', url: 'https://m.mx/1' },
    ];
    const res = matchMenciones([], pc);
    expect(res.every(r => r.estado_comparativo === 'SOLO_PRESSCLIPPING')).toBe(true);
  });
});
