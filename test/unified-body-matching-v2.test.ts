import { describe, expect, it } from 'vitest';
import {
  buildRows,
  matchingFields,
  type MasterNewsRow,
} from '../scripts/mentions-master-fast-lane.js';
import { matchKeyword, splitTerminos, type KeywordRule } from '../src/matchers/keyword.js';
import {
  buildTrustedMatchingFields,
  isBodyMatchingV2Enabled,
  selectTrustedBody,
} from '../src/matching/trustedBody.js';
import { DEFAULT_BODY_PROXIMITY_CHARS } from '../src/matching/bodyProximity.js';
import type { KeywordActivaRow } from '../src/supabase/repositories.js';

function kw(over: Partial<KeywordActivaRow> & Pick<KeywordActivaRow, 'keyword_id' | 'keyword'>): KeywordActivaRow {
  return {
    cliente_id: 'CLI-MERY-TEST',
    alias_o_variantes: null,
    tipo_keyword: 'frase_exacta',
    regla: null,
    contexto_incluir: null,
    contexto_excluir: null,
    alerta: false,
    ...over,
  };
}

function news(over: Partial<MasterNewsRow> = {}): MasterNewsRow {
  return {
    noticia_id: '498630e1-5b8e-42d2-b6c5-cbc70387004f',
    medio_id: 'MED-0030',
    medio_nombre: 'Milenio',
    titulo: 'La Tremenda Corte',
    subtitulo: null,
    resumen: 'Editorial de Jalisco sobre el foro legislativo.',
    url_original:
      'https://www.milenio.com/opinion/editoriales/la-tremenda-corte-jalisco/la-tremenda-corte_2462',
    fecha_publicacion: '2026-09-30T12:00:00.000Z',
    fecha_captura: '2026-09-30T12:10:00.000Z',
    autor: 'Editorial',
    seccion: 'Opinion',
    texto_extraido: null,
    texto_nota_limpia: null,
    texto_cuerpo_nota: null,
    tipo_nota: 'opinion',
    calidad_extraccion: 'alta',
    ...over,
  };
}

const MERY_BODY =
  'El espacio público requiere debate serio. '.repeat(20) +
  'Que Mery Gómez Pozos tendrá el foro idóneo para plantear la agenda jalisciense. ' +
  'El recinto debe elevar la calidad de la discusión. '.repeat(10);

const meryKws = [
  kw({ keyword_id: 'KEY-0042', keyword: 'Mery Gómez Pozos', tipo_keyword: 'frase_exacta' }),
  kw({ keyword_id: 'KEY-0044', keyword: 'Mery Gomez Pozos', tipo_keyword: 'frase_exacta' }),
];

function grouped(kws = meryKws, clientId = 'CLI-MERY-TEST') {
  return {
    keywordsByClient: new Map([[clientId, kws]]),
    clientNames: new Map([[clientId, 'Mery Pozos']]),
  };
}

describe('BODY_MATCHING_V2 flag default off', () => {
  it('does not enable production body matching', () => {
    expect(isBodyMatchingV2Enabled({ BODY_MATCHING_V2: undefined })).toBe(false);
    expect(isBodyMatchingV2Enabled({ BODY_MATCHING_V2: 'false' })).toBe(false);
    expect(isBodyMatchingV2Enabled({ BODY_MATCHING_V2: 'true' })).toBe(true);
    expect(matchingFields(news({ texto_cuerpo_nota: MERY_BODY })).map((c) => c.nombre)).toEqual([
      'titulo',
      'subtitulo',
      'resumen',
      'seccion',
    ]);
  });
});

describe('Unified Matching V2 regressions', () => {
  it('TEST 1 — Milenio/Mery body-only canary', () => {
    const g = grouped();
    const n = news({ texto_cuerpo_nota: MERY_BODY, calidad_extraccion: 'alta' });
    expect(/mery/i.test(n.titulo ?? '')).toBe(false);
    expect(/mery/i.test(n.resumen ?? '')).toBe(false);
    const current = buildRows([n], g.keywordsByClient, g.clientNames);
    expect(current).toHaveLength(0);
    const v2 = buildRows([n], g.keywordsByClient, g.clientNames, { bodyMatchingV2: true });
    expect(v2).toHaveLength(1);
    expect(v2[0]?.['cliente_id']).toBe('CLI-MERY-TEST');
    expect(String(v2[0]?.['campo_match'])).toBe('TEXTO_CUERPO_NOTA');
    expect(v2[0]?.['dedupe_key']).toBe(
      'cli-mery-test//498630e1-5b8e-42d2-b6c5-cbc70387004f',
    );
  });

  it('TEST 2 — raw related noise does not match', () => {
    const g = grouped();
    const n = news({
      texto_cuerpo_nota: `${'El editorial habla del clima legislativo. '.repeat(15)}`,
      texto_extraido: 'NOTAS RELACIONADAS\nMery Gómez Pozos presenta iniciativa...',
      calidad_extraccion: 'alta',
    });
    const v2 = buildRows([n], g.keywordsByClient, g.clientNames, { bodyMatchingV2: true });
    expect(v2).toHaveLength(0);
  });

  it('TEST 3 — title match still works', () => {
    const g = grouped();
    const n = news({
      titulo: 'Mery Gómez Pozos en el Congreso',
      texto_cuerpo_nota: 'Sin cuerpo relevante. '.repeat(20),
    });
    const rows = buildRows([n], g.keywordsByClient, g.clientNames);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['campo_match']).toBe('TITULO');
  });

  it('TEST 4 — summary match still works', () => {
    const g = grouped();
    const n = news({
      titulo: 'Foro legislativo',
      resumen: 'Participa Mery Gómez Pozos en el recinto.',
      texto_cuerpo_nota: null,
    });
    const rows = buildRows([n], g.keywordsByClient, g.clientNames);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['campo_match']).toBe('RESUMEN');
  });

  it('TEST 5 — title + body multi keyword, one row', () => {
    const kws = [
      kw({ keyword_id: 'KEY-T', keyword: 'Tremenda Corte', tipo_keyword: 'frase_exacta' }),
      kw({ keyword_id: 'KEY-0042', keyword: 'Mery Gómez Pozos', tipo_keyword: 'frase_exacta' }),
    ];
    const g = grouped(kws);
    const n = news({ texto_cuerpo_nota: MERY_BODY });
    const rows = buildRows([n], g.keywordsByClient, g.clientNames, { bodyMatchingV2: true });
    expect(rows).toHaveLength(1);
    const ids = String(rows[0]?.['keyword_ids_matched']);
    expect(ids).toContain('KEY-T');
    expect(ids).toContain('KEY-0042');
  });

  it('TEST 6 — two clients, two rows', () => {
    const n = news({
      titulo: 'Jumex y el foro',
      texto_cuerpo_nota: MERY_BODY,
    });
    const keywordsByClient = new Map<string, KeywordActivaRow[]>([
      ['CLI-MERY-TEST', meryKws],
      [
        'CLI-0001',
        [
          kw({
            cliente_id: 'CLI-0001',
            keyword_id: 'KEY-0001',
            keyword: 'Jumex',
            tipo_keyword: 'exacta',
          }),
        ],
      ],
    ]);
    const clientNames = new Map([
      ['CLI-MERY-TEST', 'Mery'],
      ['CLI-0001', 'Jumex'],
    ]);
    const rows = buildRows([n], keywordsByClient, clientNames, { bodyMatchingV2: true });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r['cliente_id']))).toEqual(new Set(['CLI-MERY-TEST', 'CLI-0001']));
  });

  it('TEST 7 — contextual far context vs proximity', () => {
    const rule: KeywordRule = {
      keyword_id: 'KEY-W',
      cliente_id: 'CLI-0003',
      keyword: 'trabajadores',
      terminos: splitTerminos('trabajadores'),
      tipo: 'exacta_contextual',
      regla: null,
      contextoIncluir: ['huelga'],
      contextoExcluir: [],
    };
    const far = `Los trabajadores pidieron insumos. ${'x '.repeat(800)} Estalló una huelga en otra planta.`;
    const campos = buildTrustedMatchingFields(
      {
        titulo: 'Nota laboral',
        resumen: 'Actualización',
        seccion: '',
        texto_cuerpo_nota: far,
        calidad_extraccion: 'alta',
      },
      { mode: 'body_high' },
    ).campos;
    const full = matchKeyword(rule, campos);
    const prox = matchKeyword(rule, campos, { contextRadius: 300 });
    expect(full).not.toBeNull();
    expect(prox).toBeNull();
    expect(DEFAULT_BODY_PROXIMITY_CHARS).toBe(400);
  });

  it('TEST 8 — clean fallback measured, not assumed production', () => {
    const n = news({
      texto_cuerpo_nota: null,
      texto_nota_limpia: `${'Artículo limpio. '.repeat(20)} Mery Gómez Pozos asistió.`,
      calidad_extraccion: 'media',
    });
    const high = buildRows([n], grouped().keywordsByClient, grouped().clientNames, {
      mode: 'body_high',
    });
    const fallback = buildRows([n], grouped().keywordsByClient, grouped().clientNames, {
      mode: 'body_high_plus_clean',
    });
    expect(high).toHaveLength(0);
    expect(fallback).toHaveLength(1);
    expect(fallback[0]?.['campo_match']).toBe('TEXTO_NOTA_LIMPIA');
    expect(selectTrustedBody(n, 'body_high').status).toBe('BODY_REJECTED');
    expect(selectTrustedBody(n, 'body_high_plus_clean').status).toBe('BODY_FALLBACK_CLEAN');
  });

  it('TEST 9 — raw only never matches productively', () => {
    const n = news({
      texto_cuerpo_nota: null,
      texto_nota_limpia: null,
      texto_extraido: 'Mery Gómez Pozos en notas relacionadas.',
      calidad_extraccion: 'alta',
    });
    const v2 = buildRows([n], grouped().keywordsByClient, grouped().clientNames, {
      bodyMatchingV2: true,
    });
    expect(v2).toHaveLength(0);
    expect(selectTrustedBody(n, 'body_high').status).toBe('BODY_REJECTED');
  });

  it('TEST 10 — dedupe rerun same client/news', () => {
    const g = grouped();
    const n = news({ texto_cuerpo_nota: MERY_BODY });
    const a = buildRows([n], g.keywordsByClient, g.clientNames, { bodyMatchingV2: true });
    const b = buildRows([n], g.keywordsByClient, g.clientNames, { bodyMatchingV2: true });
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0]?.['dedupe_key']).toBe(b[0]?.['dedupe_key']);
  });
});
