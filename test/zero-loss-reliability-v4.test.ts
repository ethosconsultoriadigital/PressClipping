import { describe, expect, it } from 'vitest';
import {
  buildRows,
  type MasterNewsRow,
} from '../scripts/mentions-master-fast-lane.js';
import { hasTrustedSearchableText, selectTrustedBody } from '../src/matching/trustedBody.js';
import { keywordGetsTrustedBody } from '../src/matching/masterBodyCanary.js';
import { simulatedCronGapRecovered, windowSinceHours } from '../src/matching/matchWindows.js';
import { paginationOutcome } from '../src/matching/recoveryPagination.js';
import { classifyPublisher, recoveryQueriesFromKeywords } from '../src/matching/googleNewsRecoveryRadar.js';
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
    noticia_id: '7a790fdf-49bb-47c9-8153-d341614c14a7',
    medio_id: 'MED-0001',
    medio_nombre: 'El Informador',
    titulo: null,
    subtitulo: null,
    resumen: null,
    url_original: null,
    fecha_publicacion: '2026-10-01T12:00:00.000Z',
    fecha_captura: '2026-10-01T12:10:00.000Z',
    autor: null,
    seccion: null,
    texto_extraido: null,
    texto_nota_limpia: null,
    texto_cuerpo_nota: null,
    tipo_nota: null,
    calidad_extraccion: 'alta',
    ...over,
  };
}

const BODY =
  'El espacio público requiere debate serio. '.repeat(15) +
  'Que Mery Gómez Pozos tendrá el foro idóneo. ' +
  'El recinto debe elevar la calidad. '.repeat(8);

const general = { masterBodyV2: true, bodyPolicy: 'general' as const, mode: 'body_v4' as const };

function grouped(kws: KeywordActivaRow[]) {
  return {
    keywordsByClient: new Map([['CLI-MERY-TEST', kws]]),
    clientNames: new Map([['CLI-MERY-TEST', 'Mery']]),
  };
}

describe('V4 eligibility', () => {
  it('T1 title phrase, summary NULL => match', () => {
    const g = grouped([kw({ keyword_id: 'KEY-0041', keyword: 'Mery Pozos' })]);
    const n = news({
      titulo: 'Mery Pozos destaca cercanía con tapatíos y defensa del presupuesto',
      resumen: null,
      url_original: 'https://www.informador.mx/nota',
    });
    expect(hasTrustedSearchableText(n)).toBe(true);
    const rows = buildRows([n], g.keywordsByClient, g.clientNames, general);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['campo_match']).toBe('TITULO');
  });

  it('T2 title NULL summary NULL trusted body => match', () => {
    const g = grouped([kw({ keyword_id: 'KEY-0042', keyword: 'Mery Gómez Pozos' })]);
    const n = news({
      titulo: null,
      resumen: null,
      url_original: 'https://ejemplo.mx/n',
      texto_cuerpo_nota: BODY,
    });
    const rows = buildRows([n], g.keywordsByClient, g.clientNames, general);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['campo_match']).toBe('TEXTO_CUERPO_NOTA');
  });

  it('T3 URL NULL trusted body, noticia_id valid => match', () => {
    const g = grouped([kw({ keyword_id: 'KEY-0042', keyword: 'Mery Gómez Pozos' })]);
    const n = news({ titulo: null, resumen: null, url_original: null, texto_cuerpo_nota: BODY });
    const rows = buildRows([n], g.keywordsByClient, g.clientNames, general);
    expect(rows).toHaveLength(1);
    expect(String(rows[0]?.['url'] ?? '')).toBe('');
    expect(rows[0]?.['dedupe_key']).toContain('cli-mery-test//');
  });

  it('T4 all trusted fields empty => no matchable', () => {
    const n = news({ texto_extraido: 'Mery Gómez Pozos en related' });
    expect(hasTrustedSearchableText(n)).toBe(false);
  });

  it('T5 RAW only => no productive match', () => {
    const g = grouped([kw({ keyword_id: 'KEY-0042', keyword: 'Mery Gómez Pozos' })]);
    const n = news({ texto_extraido: 'Mery Gómez Pozos en notas relacionadas' });
    const rows = buildRows([n], g.keywordsByClient, g.clientNames, general);
    expect(rows).toHaveLength(0);
  });

  it('T6 exacta_contextual BODY without contexto_incluir => NO match', () => {
    const g = grouped([
      kw({
        cliente_id: 'CLI-0010',
        keyword_id: 'KEY-IMU',
        keyword: 'IMU',
        tipo_keyword: 'exacta_contextual',
        contexto_incluir: 'publicidad|mobiliario',
      }),
    ]);
    const n = news({
      noticia_id: 'imu-1',
      titulo: 'Noticia deportiva',
      resumen: 'Jornada',
      texto_cuerpo_nota: `${'El club anunció fichajes. '.repeat(20)} IMU presentó números de taquilla.`,
    });
    const rows = buildRows([n], new Map([['CLI-0010', g.keywordsByClient.get('CLI-MERY-TEST')!]]), new Map([['CLI-0010', 'IMU']]), general);
    expect(rows).toHaveLength(0);
  });

  it('T7 exacta_contextual BODY with contexto_incluir => match', () => {
    const kws = [
      kw({
        cliente_id: 'CLI-0010',
        keyword_id: 'KEY-IMU',
        keyword: 'IMU',
        tipo_keyword: 'exacta_contextual',
        contexto_incluir: 'publicidad|mobiliario',
      }),
    ];
    const n = news({
      noticia_id: 'imu-2',
      titulo: 'Infraestructura urbana',
      resumen: 'Anuncio',
      texto_cuerpo_nota: `${'La ciudad renovó paradas. '.repeat(20)} IMU gana contrato de mobiliario urbano.`,
    });
    const rows = buildRows([n], new Map([['CLI-0010', kws]]), new Map([['CLI-0010', 'IMU']]), general);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['campo_match']).toBe('TEXTO_CUERPO_NOTA');
  });
});

describe('V4 windows and pagination', () => {
  it('T8 news outside 2h inside 24h recovered', () => {
    const now = new Date('2026-10-02T12:00:00.000Z');
    const captura = '2026-10-01T18:00:00.000Z';
    expect(captura < windowSinceHours(2, now)).toBe(true);
    expect(captura >= windowSinceHours(24, now)).toBe(true);
  });

  it('T9 already MASTER => same dedupe key', () => {
    const g = grouped([kw({ keyword_id: 'KEY-0041', keyword: 'Mery Pozos' })]);
    const n = news({ titulo: 'Mery Pozos en Guadalajara', resumen: 'x' });
    const a = buildRows([n], g.keywordsByClient, g.clientNames, general);
    const b = buildRows([n], g.keywordsByClient, g.clientNames, general);
    expect(a[0]?.['dedupe_key']).toBe(b[0]?.['dedupe_key']);
  });

  it('T10 cron gap 6h no loss after 24h recovery', () => {
    expect(
      simulatedCronGapRecovered({
        lastRunAgoHours: 6,
        recoveryWindowHours: 24,
        noticiaCapturaIso: new Date(Date.now() - 5 * 3600_000).toISOString(),
      }),
    ).toBe(true);
  });

  it('T11 late body same noticia_id recovers', () => {
    const g = grouped([kw({ keyword_id: 'KEY-0042', keyword: 'Mery Gómez Pozos' })]);
    const before = news({ titulo: 'Presupuesto estatal', resumen: 'Hacienda' });
    const after = news({ titulo: 'Presupuesto estatal', resumen: 'Hacienda', texto_cuerpo_nota: BODY });
    expect(buildRows([before], g.keywordsByClient, g.clientNames, general)).toHaveLength(0);
    expect(buildRows([after], g.keywordsByClient, g.clientNames, general)).toHaveLength(1);
  });

  it('T12 24h page count >1000 exhaustive', () => {
    expect(paginationOutcome({ lastBatchLen: 1000, pageSize: 1000, nextFrom: 1000, cap: 100_000 })).toEqual({
      complete: false,
      capHit: false,
    });
    expect(paginationOutcome({ lastBatchLen: 12, pageSize: 1000, nextFrom: 2012, cap: 100_000 })).toEqual({
      complete: true,
      capHit: false,
    });
  });

  it('T13 safety cap hit => RECOVERY_INCOMPLETE', () => {
    expect(paginationOutcome({ lastBatchLen: 1000, pageSize: 1000, nextFrom: 100_000, cap: 100_000 })).toEqual({
      complete: false,
      capHit: true,
    });
  });
});

describe('V4 RSS radar helpers', () => {
  it('T14 known publisher classified known', () => {
    const r = classifyPublisher('https://afondojalisco.com/nota', [
      { medio_id: 'MED-0202', nombre_medio: 'A Fondo Jalisco', url_base: 'https://afondojalisco.com' },
    ]);
    expect(r.kind).toBe('known');
    expect(r.medio_id).toBe('MED-0202');
  });

  it('T15 canonical URL equality is stable', () => {
    const a = 'https://concienciapublica.com.mx/2026/10/02/monreal-mery-pozos/';
    const b = 'https://concienciapublica.com.mx/2026/10/02/monreal-mery-pozos';
    expect(classifyPublisher(a, []).hostname).toBe(classifyPublisher(b, []).hostname);
  });

  it('T16 unknown publisher => no fake medio', () => {
    const r = classifyPublisher('https://host-desconocido-xyz.example/nota', [
      { medio_id: 'MED-0202', nombre_medio: 'A Fondo', url_base: 'https://afondojalisco.com' },
    ]);
    expect(r.kind).toBe('unknown');
    expect(r.medio_id).toBeNull();
  });

  it('T17 Entorno Informativo body-only sample', () => {
    const g = grouped([kw({ keyword_id: 'KEY-0043', keyword: 'Merilyn Gómez Pozos' })]);
    const n = news({
      titulo: 'Plantea fortalecer presupuesto a universidades públicas la rectora de Unison',
      resumen: 'UNISON',
      url_original: 'https://entornoinformativo.com.mx/plantea-fortalecer-presupuesto-a-universidades-publicas-la-rectora-de-unison-dena-maria-camarena/',
      texto_cuerpo_nota: BODY.replace('Mery Gómez Pozos', 'Merilyn Gómez Pozos'),
    });
    const rows = buildRows([n], g.keywordsByClient, g.clientNames, general);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['campo_match']).toBe('TEXTO_CUERPO_NOTA');
  });

  it('T18 Conciencia Pública title sample', () => {
    const g = grouped([kw({ keyword_id: 'KEY-0041', keyword: 'Mery Pozos' })]);
    const n = news({
      titulo: 'Monreal arropa a Mery Pozos',
      resumen: null,
      url_original: 'https://concienciapublica.com.mx/2026/10/02/monreal-mery-pozos/',
    });
    const rows = buildRows([n], g.keywordsByClient, g.clientNames, general);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['campo_match']).toBe('TITULO');
  });

  it('T19 A Fondo known host MED-0202', () => {
    const r = classifyPublisher(
      'https://afondojalisco.com/monreal-arropa-a-mery-pozos-durante-su-informe-fortalece-su-presencia-rumbo-a-guadalajara/',
      [{ medio_id: 'MED-0202', nombre_medio: 'A Fondo Jalisco', url_base: 'https://afondojalisco.com' }],
    );
    expect(r.medio_id).toBe('MED-0202');
  });

  it('T20 alerts remain off and queries skip short aliases', () => {
    const qs = recoveryQueriesFromKeywords([
      kw({ keyword_id: 'KEY-0041', keyword: 'Mery Pozos', tipo_keyword: 'frase_exacta' }),
      kw({ keyword_id: 'KEY-W', keyword: 'ab', tipo_keyword: 'frase_exacta' }),
      kw({ keyword_id: 'KEY-0021', keyword: 'trabajadores', tipo_keyword: 'contiene' }),
    ]);
    expect(qs.map((q) => q.query)).toEqual(['Mery Pozos']);
    expect(keywordGetsTrustedBody('KEY-0021', { masterBodyV2: true, bodyPolicy: 'general', tipoKeyword: 'contiene' })).toBe(false);
    expect(keywordGetsTrustedBody('KEY-0042', { masterBodyV2: true, bodyPolicy: 'general', tipoKeyword: 'frase_exacta' })).toBe(true);
    expect(selectTrustedBody(news({ texto_extraido: 'raw' }), 'body_v4').status).not.toBe('BODY_TRUSTED');
  });
});
