/**
 * Tests del módulo de simulación de keywords candidatas (puro, sin DB).
 * Verifica: conversión a regla, respeto de gates de contexto, flag de FP y conteos.
 */
import { describe, it, expect } from 'vitest';
import {
  toCandidateRule,
  simulate,
  flagFP,
  contarPor,
  type CandidateRow,
  type SimNoticia,
} from '../src/sim/candidateSimulation.js';

function noticia(over: Partial<SimNoticia> = {}): SimNoticia {
  return {
    noticia_id: over.noticia_id ?? 'N1',
    medio_id: over.medio_id ?? 'MED-0030',
    medio_nombre: over.medio_nombre ?? 'Milenio',
    titulo: over.titulo ?? '',
    subtitulo: over.subtitulo ?? '',
    resumen: over.resumen ?? '',
    seccion: over.seccion ?? '',
    texto_extraido: over.texto_extraido ?? '',
    texto_nota_limpia: over.texto_nota_limpia ?? null,
    texto_cuerpo_nota: over.texto_cuerpo_nota ?? null,
    url_original: over.url_original ?? 'https://example.com/nota',
    fecha: over.fecha ?? '2026-06-30T00:00:00Z',
  };
}

const kwSindicato: CandidateRow = {
  keyword_id: 'CAND-LAB-02', cliente_id: 'CLI-0003', cliente: 'Reforma laboral',
  keyword: 'sindicato', alias_o_variantes: 'sindicatos', tipo_keyword: 'contiene',
  contexto_incluir: 'laboral|huelga|salario', contexto_excluir: 'futbol|club', alerta: false,
};

describe('toCandidateRule', () => {
  it('expande términos y gates desde celdas multivalor', () => {
    const rule = toCandidateRule(kwSindicato);
    expect(rule.terminos).toContain('sindicato');
    expect(rule.terminos).toContain('sindicatos');
    expect(rule.contextoIncluir).toEqual(['laboral', 'huelga', 'salario']);
    expect(rule.contextoExcluir).toEqual(['futbol', 'club']);
    expect(rule.tipo).toBe('contiene');
  });

  it('tipo inválido degrada a "contiene"', () => {
    const rule = toCandidateRule({ ...kwSindicato, tipo_keyword: 'xxx' });
    expect(rule.tipo).toBe('contiene');
  });
});

describe('simulate — gates de contexto', () => {
  it('matchea cuando hay contexto_incluir presente y sin exclusión', () => {
    const ns = [noticia({ titulo: 'El sindicato negocia salario', texto_cuerpo_nota: 'tema laboral' })];
    const m = simulate(ns, [kwSindicato]);
    expect(m).toHaveLength(1);
    expect(m[0]!.keyword).toBe('sindicato');
  });

  it('NO matchea si falta contexto_incluir', () => {
    const ns = [noticia({ titulo: 'El sindicato de aficionados', texto_cuerpo_nota: 'fiesta' })];
    expect(simulate(ns, [kwSindicato])).toHaveLength(0);
  });

  it('NO matchea si aparece contexto_excluir', () => {
    const ns = [noticia({ titulo: 'sindicato de jugadores', texto_cuerpo_nota: 'laboral en el club de futbol' })];
    expect(simulate(ns, [kwSindicato])).toHaveLength(0);
  });
});

describe('flagFP', () => {
  it('marca FP por sección deportiva', () => {
    expect(flagFP(noticia({ seccion: 'deportes' })).fp).toBe(true);
  });

  it('marca FP por título de Mundial', () => {
    expect(flagFP(noticia({ titulo: 'México vs Ecuador, Mundial 2026 en vivo' })).fp).toBe(true);
  });

  it('no marca FP en nota laboral normal', () => {
    expect(flagFP(noticia({ seccion: 'nacional', titulo: 'Reforma laboral avanza' })).fp).toBe(false);
  });
});

describe('contarPor', () => {
  it('agrupa matches por clave', () => {
    const ns = [
      noticia({ noticia_id: 'A', titulo: 'sindicato y salario laboral' }),
      noticia({ noticia_id: 'B', medio_id: 'MED-0008', titulo: 'sindicato huelga laboral' }),
    ];
    const m = simulate(ns, [kwSindicato]);
    const porMedio = contarPor(m, (x) => x.medio_id ?? 'null');
    expect(porMedio['MED-0030']).toBe(1);
    expect(porMedio['MED-0008']).toBe(1);
  });
});
