import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildRows,
  matchingFields,
  type MasterNewsRow,
} from '../scripts/mentions-master-fast-lane.js';
import { camposDe } from '../src/matching/detectMentionsCore.js';
import {
  describeMasterBodyPolicy,
  isDetectMentionsBodyV2Enabled,
  isMentionsMasterBodyV2Enabled,
  keywordGetsTrustedBody,
  MERY_CONTEXTUAL_EXCLUDED_FROM_CANARY,
  MERY_FRASE_EXACTA_BODY_KEYWORD_IDS,
  parseKeywordAllowlist,
} from '../src/matching/masterBodyCanary.js';
import type { KeywordActivaRow } from '../src/supabase/repositories.js';
import type { NoticiaScanRow } from '../src/supabase/repositories.js';

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

const meryAllow = [...MERY_FRASE_EXACTA_BODY_KEYWORD_IDS];
const canaryOpts = { masterBodyV2: true, keywordAllowlist: meryAllow };

function grouped(kws: KeywordActivaRow[], clientId = 'CLI-MERY-TEST') {
  return {
    keywordsByClient: new Map([[clientId, kws]]),
    clientNames: new Map([[clientId, 'Mery Pozos']]),
  };
}

function scanNews(over: Partial<NoticiaScanRow> = {}): NoticiaScanRow {
  return {
    noticia_id: 'n1',
    medio_id: 'MED-0030',
    titulo: 'La Tremenda Corte',
    subtitulo: null,
    resumen: 'Editorial',
    texto_extraido: MERY_BODY,
    texto_nota_limpia: MERY_BODY,
    texto_cuerpo_nota: MERY_BODY,
    seccion: 'Opinion',
    medio_nombre: 'Milenio',
    ...over,
  };
}

describe('Master body flags vs detector', () => {
  it('MASTER flag does not enable detector', () => {
    expect(isMentionsMasterBodyV2Enabled({ MENTIONS_MASTER_BODY_V2: 'true' })).toBe(true);
    expect(isDetectMentionsBodyV2Enabled({ MENTIONS_MASTER_BODY_V2: 'true' })).toBe(false);
    expect(isDetectMentionsBodyV2Enabled({ DETECT_MENTIONS_BODY_V2: 'true' })).toBe(true);
    expect(parseKeywordAllowlist(meryAllow.join(','))).toEqual(meryAllow);
    expect(MERY_CONTEXTUAL_EXCLUDED_FROM_CANARY).toEqual([
      'KEY-0048',
      'KEY-0049',
      'KEY-0050',
      'KEY-0051',
    ]);
  });

  it('allowlist is required for MASTER body', () => {
    expect(
      keywordGetsTrustedBody('KEY-0042', { masterBodyV2: true, keywordAllowlist: [] }),
    ).toBe(false);
    expect(
      keywordGetsTrustedBody('KEY-0042', { masterBodyV2: true, keywordAllowlist: meryAllow }),
    ).toBe(true);
    expect(
      keywordGetsTrustedBody('KEY-0021', { masterBodyV2: true, keywordAllowlist: meryAllow }),
    ).toBe(false);
  });
});

describe('Selective BODY canary regressions', () => {
  it('1 — allowlisted keyword body-only MATCH', () => {
    const g = grouped([kw({ keyword_id: 'KEY-0042', keyword: 'Mery Gómez Pozos' })]);
    const n = news({ texto_cuerpo_nota: MERY_BODY });
    const rows = buildRows([n], g.keywordsByClient, g.clientNames, canaryOpts);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['campo_match']).toBe('TEXTO_CUERPO_NOTA');
  });

  it('2 — same keyword without allowlist body-only NO MATCH', () => {
    const g = grouped([kw({ keyword_id: 'KEY-0042', keyword: 'Mery Gómez Pozos' })]);
    const n = news({ texto_cuerpo_nota: MERY_BODY });
    const rows = buildRows([n], g.keywordsByClient, g.clientNames, {
      masterBodyV2: true,
      keywordAllowlist: ['KEY-0040'],
    });
    expect(rows).toHaveLength(0);
  });

  it('3 — non-allowlisted title still MATCH CURRENT', () => {
    const g = grouped(
      [kw({ cliente_id: 'CLI-0003', keyword_id: 'KEY-0021', keyword: 'trabajadores', tipo_keyword: 'contiene' })],
      'CLI-0003',
    );
    const n = news({
      titulo: 'Trabajadores anuncian paro',
      resumen: 'La jornada inicia mañana.',
      texto_cuerpo_nota: MERY_BODY,
    });
    const rows = buildRows([n], g.keywordsByClient, g.clientNames, canaryOpts);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['campo_match']).toBe('TITULO');
  });

  it('4 — trabajadores only in BODY stays NO MATCH', () => {
    const g = grouped(
      [kw({ cliente_id: 'CLI-0003', keyword_id: 'KEY-0021', keyword: 'trabajadores', tipo_keyword: 'contiene' })],
      'CLI-0003',
    );
    const n = news({
      titulo: 'Actualización regional',
      resumen: 'Sin mención laboral en encabezado.',
      texto_cuerpo_nota: `${'El recinto legislativo abre. '.repeat(12)} Los trabajadores pidieron huelga.`,
    });
    const rows = buildRows([n], g.keywordsByClient, g.clientNames, canaryOpts);
    expect(rows).toHaveLength(0);
  });

  it('5 — title keyword + allowlisted BODY → 1 row both keywords', () => {
    const kws = [
      kw({ keyword_id: 'KEY-T', keyword: 'Tremenda Corte', tipo_keyword: 'frase_exacta' }),
      kw({ keyword_id: 'KEY-0042', keyword: 'Mery Gómez Pozos' }),
    ];
    const g = grouped(kws);
    const n = news({ texto_cuerpo_nota: MERY_BODY });
    const rows = buildRows([n], g.keywordsByClient, g.clientNames, canaryOpts);
    expect(rows).toHaveLength(1);
    const ids = String(rows[0]?.['keyword_ids_matched']);
    expect(ids).toContain('KEY-T');
    expect(ids).toContain('KEY-0042');
  });

  it('6 — dedupe rerun', () => {
    const g = grouped([kw({ keyword_id: 'KEY-0042', keyword: 'Mery Gómez Pozos' })]);
    const n = news({ texto_cuerpo_nota: MERY_BODY });
    const a = buildRows([n], g.keywordsByClient, g.clientNames, canaryOpts);
    const b = buildRows([n], g.keywordsByClient, g.clientNames, canaryOpts);
    expect(a[0]?.['dedupe_key']).toBe(b[0]?.['dedupe_key']);
    expect(a[0]?.['dedupe_key']).toBe(
      'cli-mery-test//498630e1-5b8e-42d2-b6c5-cbc70387004f',
    );
  });

  it('7 — Milenio/Mery real canary', () => {
    const g = grouped([
      kw({ keyword_id: 'KEY-0042', keyword: 'Mery Gómez Pozos' }),
      kw({ keyword_id: 'KEY-0044', keyword: 'Mery Gomez Pozos' }),
    ]);
    const n = news({ texto_cuerpo_nota: MERY_BODY, calidad_extraccion: 'alta' });
    expect(/mery/i.test(n.titulo ?? '')).toBe(false);
    const current = buildRows([n], g.keywordsByClient, g.clientNames);
    expect(current).toHaveLength(0);
    const canary = buildRows([n], g.keywordsByClient, g.clientNames, canaryOpts);
    expect(canary).toHaveLength(1);
    expect(canary[0]?.['cliente_id']).toBe('CLI-MERY-TEST');
    expect(canary[0]?.['campo_match']).toBe('TEXTO_CUERPO_NOTA');
    expect(canary[0]?.['dedupe_key']).toBe(
      'cli-mery-test//498630e1-5b8e-42d2-b6c5-cbc70387004f',
    );
  });

  it('8 — RAW related noise NO MATCH', () => {
    const g = grouped([kw({ keyword_id: 'KEY-0042', keyword: 'Mery Gómez Pozos' })]);
    const n = news({
      texto_cuerpo_nota: `${'El editorial habla del clima legislativo. '.repeat(15)}`,
      texto_extraido: 'NOTAS RELACIONADAS\nMery Gómez Pozos presenta iniciativa...',
      calidad_extraccion: 'alta',
    });
    const rows = buildRows([n], g.keywordsByClient, g.clientNames, canaryOpts);
    expect(rows).toHaveLength(0);
  });

  it('9 — detector campos unchanged when MASTER canary env is on', () => {
    const prevMaster = process.env.MENTIONS_MASTER_BODY_V2;
    const prevIds = process.env.MENTIONS_MASTER_BODY_V2_KEYWORD_IDS;
    const prevDetect = process.env.DETECT_MENTIONS_BODY_V2;
    const prevLegacy = process.env.BODY_MATCHING_V2;
    try {
      process.env.MENTIONS_MASTER_BODY_V2 = 'true';
      process.env.MENTIONS_MASTER_BODY_V2_KEYWORD_IDS = meryAllow.join(',');
      delete process.env.DETECT_MENTIONS_BODY_V2;
      delete process.env.BODY_MATCHING_V2;
      const names = camposDe(scanNews()).map((c) => c.nombre);
      expect(names).toEqual(['titulo', 'subtitulo', 'resumen', 'seccion', 'texto_extraido', 'medio']);
      expect(names).not.toContain('texto_cuerpo_nota');
    } finally {
      if (prevMaster === undefined) delete process.env.MENTIONS_MASTER_BODY_V2;
      else process.env.MENTIONS_MASTER_BODY_V2 = prevMaster;
      if (prevIds === undefined) delete process.env.MENTIONS_MASTER_BODY_V2_KEYWORD_IDS;
      else process.env.MENTIONS_MASTER_BODY_V2_KEYWORD_IDS = prevIds;
      if (prevDetect === undefined) delete process.env.DETECT_MENTIONS_BODY_V2;
      else process.env.DETECT_MENTIONS_BODY_V2 = prevDetect;
      if (prevLegacy === undefined) delete process.env.BODY_MATCHING_V2;
      else process.env.BODY_MATCHING_V2 = prevLegacy;
    }
  });

  it('10 — flags unset = CURRENT bit-for-bit', () => {
    const g = grouped([kw({ keyword_id: 'KEY-0042', keyword: 'Mery Gómez Pozos' })]);
    const n = news({ texto_cuerpo_nota: MERY_BODY });
    const unset = buildRows([n], g.keywordsByClient, g.clientNames).map((r) => {
      const { matched_at: _a, latencia_minutos: _b, ...rest } = r;
      return rest;
    });
    const current = buildRows([n], g.keywordsByClient, g.clientNames, { mode: 'current' }).map((r) => {
      const { matched_at: _a, latencia_minutos: _b, ...rest } = r;
      return rest;
    });
    expect(unset).toEqual(current);
    expect(matchingFields(n).map((c) => c.nombre)).toEqual([
      'titulo',
      'subtitulo',
      'resumen',
      'seccion',
    ]);
    expect(describeMasterBodyPolicy({}).body_v2_enabled).toBe(false);
    expect(describeMasterBodyPolicy({}).matching_fields).toBe(
      'titulo,subtitulo,resumen,seccion',
    );
  });
});

describe('Fast Lane workflow stays CURRENT', () => {
  it('does not set DETECT_MENTIONS_BODY_V2 or BODY_MATCHING_V2', () => {
    const wf = readFileSync(join(process.cwd(), '.github/workflows/mentions-master-fast-lane.yml'), 'utf8');
    expect(wf).toContain("MENTIONS_MASTER_BODY_V2: 'true'");
    expect(wf).toContain('KEY-0040,KEY-0041,KEY-0042,KEY-0043,KEY-0044,KEY-0045,KEY-0046,KEY-0047,KEY-0076,KEY-0077');
    expect(wf).not.toContain('KEY-0048');
    expect(wf).not.toContain('DETECT_MENTIONS_BODY_V2');
    expect(wf).not.toContain('BODY_MATCHING_V2');
  });
});
