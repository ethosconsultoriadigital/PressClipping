import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  OVERLAP_MINUTES,
  MASTER_SNIPPET_CHARS,
  parseArgs,
  groupKeywordsByActiveClient,
  buildRows,
  windowSinceIso,
  newsInOverlapWindow,
  matchingFields,
  type MasterNewsRow,
} from '../scripts/mentions-master-fast-lane.js';
import { toKeywordRule } from '../src/matching/detectMentionsCore.js';
import { splitTerminos } from '../src/matchers/keyword.js';
import type { KeywordActivaRow } from '../src/supabase/repositories.js';

const ROOT = process.cwd();

function kw(over: Partial<KeywordActivaRow> & Pick<KeywordActivaRow, 'keyword_id' | 'keyword'>): KeywordActivaRow {
  return {
    cliente_id: 'CLI-A',
    alias_o_variantes: null,
    tipo_keyword: 'exacta',
    regla: null,
    contexto_incluir: null,
    contexto_excluir: null,
    alerta: false,
    ...over,
  };
}

function news(over: Partial<MasterNewsRow> = {}): MasterNewsRow {
  return {
    noticia_id: 'NOT-1',
    medio_id: 'MED-1',
    medio_nombre: 'Diario Alpha',
    titulo: 'AlphaBrand anuncia resultados',
    subtitulo: null,
    resumen: 'La empresa AlphaBrand reportó crecimiento en el trimestre.',
    url_original: 'https://ejemplo.mx/nota-alpha',
    fecha_publicacion: '2026-09-28T12:00:00.000Z',
    fecha_captura: '2026-09-28T12:10:00.000Z',
    autor: 'Redacción',
    seccion: 'Negocios',
    texto_extraido: null,
    texto_nota_limpia: null,
    texto_cuerpo_nota: null,
    tipo_nota: null,
    calidad_extraccion: null,
    ...over,
  };
}

describe('Fast Lane overlap = 60', () => {
  it('default parseado es 60 y cubre T+5/T+15/T+25 a T+30', () => {
    expect(OVERLAP_MINUTES).toBe(60);
    expect(parseArgs([]).overlapMinutes).toBe(60);
    expect(parseArgs(['--overlap-minutes=60']).overlapMinutes).toBe(60);
    const prev = new Date('2026-09-29T15:17:00.000Z');
    const next = new Date('2026-09-29T15:47:00.000Z');
    const since60 = windowSinceIso(next, 60);
    const since10 = windowSinceIso(next, 10);
    const arrivals = [
      new Date(prev.getTime() + 5 * 60_000).toISOString(),
      new Date(prev.getTime() + 15 * 60_000).toISOString(),
      new Date(prev.getTime() + 25 * 60_000).toISOString(),
    ];
    expect(arrivals.every((iso) => newsInOverlapWindow(iso, since60))).toBe(true);
    expect(newsInOverlapWindow(arrivals[0]!, since10)).toBe(false);
    expect(newsInOverlapWindow(arrivals[1]!, since10)).toBe(false);
    expect(newsInOverlapWindow(arrivals[2]!, since10)).toBe(true);
  });

  it('workflow overlap default/fallback 60; cron 30m se conserva', () => {
    const wf = readFileSync(join(ROOT, '.github/workflows/mentions-master-fast-lane.yml'), 'utf8');
    expect(wf).toContain("inputs.overlap_minutes || '60'");
    expect(wf).toMatch(/overlap_minutes:[\s\S]{0,120}default:\s*'60'/);
    expect(wf).not.toContain("inputs.overlap_minutes || '10'");
    expect(wf).not.toContain("inputs.overlap_minutes || '90'");
    expect(wf).toContain("cron: '17,47 * * * *'");
    expect(wf).toContain('group: mentions-master-fast-lane');
    expect(wf).toContain('cancel-in-progress: false');
    expect(wf).toContain('no ejecutar canary/write local');
    expect(wf).toContain("default: '5'");
    expect(wf).toContain("default: '3'");
    expect(wf).toContain("default: '10'");
    expect(wf).toContain('timeout-minutes: 28');
  });

  it('script default 60 y no clampa 60 a 15', () => {
    const script = readFileSync(join(ROOT, 'scripts/mentions-master-fast-lane.ts'), 'utf8');
    expect(script).toContain('export const OVERLAP_MINUTES = 60');
    expect(script).toContain('Math.max(1, parseIntOrNull(val)');
    expect(script).not.toContain('Math.max(15,');
    expect(script).toContain('Global News Lake sweep');
  });
});

describe('Fast Lane scope = Control Plane V1', () => {
  it('omite cliente inactivo y keyword huérfana', () => {
    const grouped = groupKeywordsByActiveClient(
      [
        { cliente_id: 'CLI-A', nombre_cliente: 'Activo', activo: true },
        { cliente_id: 'CLI-B', nombre_cliente: 'Inactivo', activo: false },
      ],
      [
        kw({ keyword_id: 'KEY-A', keyword: 'AlphaBrand', cliente_id: 'CLI-A' }),
        kw({ keyword_id: 'KEY-B', keyword: 'BetaBrand', cliente_id: 'CLI-B' }),
        kw({ keyword_id: 'KEY-X', keyword: 'Huérfana', cliente_id: null }),
      ],
    );
    expect([...grouped.clientNames.keys()]).toEqual(['CLI-A']);
    expect([...grouped.keywordsByClient.keys()]).toEqual(['CLI-A']);
    expect(grouped.keywordsByClient.get('CLI-A')?.map((k) => k.keyword_id)).toEqual(['KEY-A']);
  });

  it('toKeywordRule comparte aliases y contexto con el detector', () => {
    const row = kw({
      keyword_id: 'KEY-A',
      keyword: 'AlphaBrand',
      alias_o_variantes: 'Alpha Brand, AB',
      contexto_incluir: 'resultados, trimestre',
      contexto_excluir: 'publicidad',
      tipo_keyword: 'exacta',
    });
    const rule = toKeywordRule(row);
    expect(rule.terminos).toEqual(splitTerminos(row.keyword, row.alias_o_variantes));
    expect(rule.contextoIncluir).toEqual(splitTerminos(row.contexto_incluir));
    expect(rule.contextoExcluir).toEqual(splitTerminos(row.contexto_excluir));
    expect(rule.tipo).toBe('exacta');
  });
});

describe('Fast Lane consolidación MASTER', () => {
  it('1 noticia + 1 cliente = 1 fila; varias keywords se consolidan', () => {
    const grouped = groupKeywordsByActiveClient(
      [{ cliente_id: 'CLI-A', nombre_cliente: 'Activo', activo: true }],
      [
        kw({ keyword_id: 'KEY-A1', keyword: 'AlphaBrand' }),
        kw({ keyword_id: 'KEY-A2', keyword: 'AlphaBrand', tipo_keyword: 'contiene' }),
      ],
    );
    const rows = buildRows([news()], grouped.keywordsByClient, grouped.clientNames);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['cliente_id']).toBe('CLI-A');
    expect(rows[0]?.['dedupe_key']).toBe('cli-a//not-1');
    expect(String(rows[0]?.['keywords_matched'])).toContain('AlphaBrand');
    expect(String(rows[0]?.['keyword_ids_matched'])).toMatch(/KEY-A1/);
    expect(String(rows[0]?.['keyword_ids_matched'])).toMatch(/KEY-A2/);
    expect(rows[0]?.['latencia_minutos']).toEqual(expect.any(Number));
    expect(rows[0]?.['url']).toBe('https://ejemplo.mx/nota-alpha');
    expect(rows[0]?.['titulo / titular']).toBe('AlphaBrand anuncia resultados');
    expect(rows[0]?.['resumen']).toContain('AlphaBrand');
  });

  it('misma noticia + dos clientes = dos filas', () => {
    const grouped = groupKeywordsByActiveClient(
      [
        { cliente_id: 'CLI-A', nombre_cliente: 'A', activo: true },
        { cliente_id: 'CLI-C', nombre_cliente: 'C', activo: true },
      ],
      [
        kw({ keyword_id: 'KEY-A', keyword: 'AlphaBrand', cliente_id: 'CLI-A' }),
        kw({ keyword_id: 'KEY-C', keyword: 'AlphaBrand', cliente_id: 'CLI-C' }),
      ],
    );
    const rows = buildRows([news()], grouped.keywordsByClient, grouped.clientNames);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r['dedupe_key']).sort()).toEqual(['cli-a//not-1', 'cli-c//not-1']);
  });

  it('rerun in-memory: misma dedupe_key no duplica el set', () => {
    const grouped = groupKeywordsByActiveClient(
      [{ cliente_id: 'CLI-A', nombre_cliente: 'Activo', activo: true }],
      [kw({ keyword_id: 'KEY-A', keyword: 'AlphaBrand' })],
    );
    const first = buildRows([news()], grouped.keywordsByClient, grouped.clientNames);
    const second = buildRows([news()], grouped.keywordsByClient, grouped.clientNames);
    const existing = new Set(first.map((r) => String(r['dedupe_key']).toLowerCase()));
    const unique = second.filter((r) => !existing.has(String(r['dedupe_key']).toLowerCase()));
    expect(first).toHaveLength(1);
    expect(unique).toHaveLength(0);
  });
});

describe('live-mentions-fresh sigue dispatch-only', () => {
  it('no tiene schedule', () => {
    const wf = readFileSync(join(ROOT, '.github/workflows/live-mentions-fresh.yml'), 'utf8');
    expect(wf).not.toMatch(/^\s*schedule:/m);
    expect(wf).toContain('workflow_dispatch');
  });
});

describe('Fast Lane matching sin body no confiable', () => {
  const grouped = () => groupKeywordsByActiveClient(
    [{ cliente_id: 'CLI-A', nombre_cliente: 'Activo', activo: true }],
    [kw({ keyword_id: 'KEY-T', keyword: 'trabajadores', tipo_keyword: 'contiene' })],
  );

  it('Caso A: keyword solo en basura concatenada del body → NO MATCH', () => {
    const g = grouped();
    const rows = buildRows([news({
      titulo: 'Clima estable en la región',
      resumen: 'El pronóstico no anticipa cambios.',
      texto_cuerpo_nota: 'Relacionadas:\nMarcha de trabajadores en otra ciudad\nVer más notas',
      calidad_extraccion: 'alta',
    })], g.keywordsByClient, g.clientNames);
    expect(rows).toHaveLength(0);
    expect(matchingFields(news()).map((c) => c.nombre)).toEqual([
      'titulo', 'subtitulo', 'resumen', 'seccion',
    ]);
  });

  it('Caso B: keyword en título → MATCH', () => {
    const g = grouped();
    const rows = buildRows([news({
      titulo: 'Trabajadores anuncian paro',
      resumen: 'La jornada inicia mañana.',
      texto_cuerpo_nota: null,
    })], g.keywordsByClient, g.clientNames);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['campo_match']).toBe('TITULO');
  });

  it('Caso C: keyword en resumen → MATCH', () => {
    const g = grouped();
    const rows = buildRows([news({
      titulo: 'Actualización laboral',
      resumen: 'Los trabajadores pidieron insumos.',
      texto_cuerpo_nota: null,
    })], g.keywordsByClient, g.clientNames);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['campo_match']).toBe('RESUMEN');
  });
});

describe('Milenio fuera de capture plan sigue siendo matchable', () => {
  it('título con Mery Pozos genera fila aunque medio_id=MED-0030', () => {
    const grouped = groupKeywordsByActiveClient(
      [{ cliente_id: 'CLI-MERY-TEST', nombre_cliente: 'Mery Pozos', activo: true }],
      [kw({
        keyword_id: 'KEY-0041',
        keyword: 'Mery Pozos',
        cliente_id: 'CLI-MERY-TEST',
        tipo_keyword: 'frase_exacta',
      })],
    );
    const rows = buildRows([news({
      noticia_id: 'b0e73785-1f18-4f67-9281-f07d4f57bf10',
      medio_id: 'MED-0030',
      medio_nombre: 'Milenio',
      titulo: 'Morena Jalisco pedirá a Itzul Barrera y Mery Pozos que se deslinden públicamente de bardas publicitarias',
      resumen: 'Pedirá a las diputadas Itzul Barrera y Mery Pozos que formalicen públicamente su deslinde',
      url_original: 'https://www.milenio.com/comunidad/buscan-itzul-barrera-mery-pozos-deslinden-bardas',
    })], grouped.keywordsByClient, grouped.clientNames);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['cliente_id']).toBe('CLI-MERY-TEST');
    expect(rows[0]?.['keywords_matched']).toContain('Mery Pozos');
    expect(rows[0]?.['campo_match']).toBe('TITULO');
  });
});

describe('MASTER snippet operacional', () => {
  it('nota completa no excede 3000 chars', () => {
    expect(MASTER_SNIPPET_CHARS).toBe(3000);
    const grouped = groupKeywordsByActiveClient(
      [{ cliente_id: 'CLI-A', nombre_cliente: 'Activo', activo: true }],
      [kw({ keyword_id: 'KEY-A', keyword: 'AlphaBrand' })],
    );
    const body = `AlphaBrand ${'x'.repeat(5000)}`;
    const rows = buildRows([news({
      titulo: 'AlphaBrand reporta',
      resumen: 'Corto',
      texto_cuerpo_nota: body,
    })], grouped.keywordsByClient, grouped.clientNames);
    expect(String(rows[0]?.['nota completa']).length).toBeLessThanOrEqual(MASTER_SNIPPET_CHARS);
    expect(String(rows[0]?.['nota completa'])).toContain('SNIPPET OPERACIONAL');
  });
});
