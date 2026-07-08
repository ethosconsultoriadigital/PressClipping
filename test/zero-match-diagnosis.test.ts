/**
 * Regresión del diagnóstico MATCH=0 (fase "Diagnóstico y Corrección del MATCH=0").
 *
 * El comparador NO tenía bug: con Ethos y PressClipping cubriendo artículos
 * DISJUNTOS (medios/URLs/títulos distintos) el resultado correcto es 0 MATCH
 * (brecha real de cobertura), NO un match espurio. Estos tests protegen contra:
 *   - regresiones que "inventen" matches al relajar el umbral (falsos positivos);
 *   - regresiones que dejen de matchear un mismo artículo dentro de ventana.
 */
import { describe, it, expect } from 'vitest';
import { matchMenciones, type MencionNorm } from '../src/comparators/mentionMatcher.js';

describe('MATCH=0 es brecha real cuando los conjuntos son disjuntos', () => {
  const ethos: MencionNorm[] = [
    { fuente: 'Ethos', fecha: '2026-07-06', medio: 'Publimetro Mexico', titulo: 'Sindicato negocia salario mínimo', url: 'https://publimetro.com.mx/nota/sind-1', keyword: 'sindicato' },
    { fuente: 'Ethos', fecha: '2026-07-06', medio: 'Uno TV Noticias', titulo: 'Intoxicación por alcohol en fiesta', url: 'https://unotv.com/nota/intox-2', keyword: 'intoxicación por alcohol' },
    { fuente: 'Ethos', fecha: '2026-07-07', medio: 'Revista Espejo', titulo: 'Mezcal artesanal gana premio', url: 'https://revistaespejo.com/nota/mezcal-3', keyword: 'mezcal' },
  ];
  const pc: MencionNorm[] = [
    { fuente: 'PressClipping', fecha: '2026-07-06', medio: 'lado.mx', titulo: 'Tequila rompe récord de exportación', url: 'https://lado.mx/economia/tequila-record', keyword: 'Tequila' },
    { fuente: 'PressClipping', fecha: '2026-07-06', medio: 'Milenio', titulo: 'Reforma laboral en el Congreso', url: 'https://milenio.com/politica/reforma-laboral', keyword: 'Reforma laboral' },
    { fuente: 'PressClipping', fecha: '2026-07-07', medio: 'La Crónica de Hoy', titulo: 'Jumex anuncia inversión', url: 'https://cronica.com.mx/negocios/jumex-inversion', keyword: 'Jumex' },
  ];

  it('no produce ningún MATCH ni MATCH_PROBABLE', () => {
    const res = matchMenciones(ethos, pc);
    expect(res.filter((r) => r.estado_comparativo === 'MATCH')).toHaveLength(0);
    expect(res.filter((r) => r.estado_comparativo === 'MATCH_PROBABLE')).toHaveLength(0);
  });

  it('clasifica todo PC como SOLO_PRESSCLIPPING y todo Ethos como SOLO_ETHOS', () => {
    const res = matchMenciones(ethos, pc);
    expect(res.filter((r) => r.estado_comparativo === 'SOLO_PRESSCLIPPING')).toHaveLength(pc.length);
    expect(res.filter((r) => r.estado_comparativo === 'SOLO_ETHOS')).toHaveLength(ethos.length);
  });
});

describe('el mismo artículo dentro de ventana SÍ debe matchear (no romper por robustez)', () => {
  it('URL idéntica (con tracking) → MATCH_FUERTE', () => {
    const ethos: MencionNorm[] = [{ fuente: 'Ethos', fecha: '2026-07-06', medio: 'Uno TV Noticias', titulo: 'Intoxicación por alcohol adulterado', url: 'https://unotv.com/estados/intox?utm_source=tw' }];
    const pc: MencionNorm[] = [{ fuente: 'PressClipping', fecha: '2026-07-06', medio: 'Uno TV', titulo: 'Intoxicación por alcohol adulterado', url: 'https://unotv.com/estados/intox' }];
    const res = matchMenciones(ethos, pc);
    expect(res).toHaveLength(1);
    expect(res[0]!.estado_comparativo).toBe('MATCH');
  });

  it('título ~idéntico + mismo medio + fecha ±3d → MATCH_PROBABLE', () => {
    const ethos: MencionNorm[] = [{ fuente: 'Ethos', fecha: '2026-07-06', medio: 'Publimetro', titulo: 'Sindicato negocia salario minimo en Puebla', url: 'https://publimetro.com.mx/a' }];
    const pc: MencionNorm[] = [{ fuente: 'PressClipping', fecha: '2026-07-08', medio: 'Publimetro', titulo: 'Sindicato negocia salario minimo en Puebla hoy', url: 'https://publimetro.com.mx/b' }];
    const res = matchMenciones(ethos, pc);
    const r = res.find((x) => x.en_ethos && x.en_pressclipping);
    expect(r?.estado_comparativo).toBe('MATCH_PROBABLE');
  });
});
