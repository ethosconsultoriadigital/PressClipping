import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  OVERLAP_MINUTES,
  parseArgs,
  groupKeywordsByActiveClient,
  buildRows,
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

describe('Fast Lane overlap = 10', () => {
  it('default parseado es 10 y no se clampa a 15', () => {
    expect(OVERLAP_MINUTES).toBe(10);
    expect(parseArgs([]).overlapMinutes).toBe(10);
    expect(parseArgs(['--overlap-minutes=10']).overlapMinutes).toBe(10);
    expect(parseArgs(['--overlap-minutes=1']).overlapMinutes).toBe(1);
  });

  it('workflow default y fallback son 10; cron 30m se conserva', () => {
    const wf = readFileSync(join(ROOT, '.github/workflows/mentions-master-fast-lane.yml'), 'utf8');
    expect(wf).toMatch(/default:\s*'10'/);
    expect(wf).toContain("|| '10'");
    expect(wf).not.toMatch(/default:\s*'90'/);
    expect(wf).not.toContain("|| '90'");
    expect(wf).toContain("cron: '17,47 * * * *'");
    expect(wf).toContain("default: '5'");
    expect(wf).toContain("default: '3'");
    expect(wf).toContain("default: '10'");
    expect(wf).toContain("default: '60'");
    expect(wf).toContain('timeout-minutes: 28');
  });

  it('script y workflow no vuelven a 90', () => {
    const script = readFileSync(join(ROOT, 'scripts/mentions-master-fast-lane.ts'), 'utf8');
    const wf = readFileSync(join(ROOT, '.github/workflows/mentions-master-fast-lane.yml'), 'utf8');
    expect(script).toContain('export const OVERLAP_MINUTES = 10');
    expect(script).toContain('Math.max(1, parseIntOrNull(val)');
    expect(script).not.toContain('Math.max(15,');
    expect(wf).not.toMatch(/overlap_minutes[\s\S]{0,80}default:\s*'90'/);
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
