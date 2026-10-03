import { describe, expect, it } from 'vitest';
import {
  buildRows,
  type MasterNewsRow,
} from '../scripts/mentions-master-fast-lane.js';
import { hasTrustedSearchableText } from '../src/matching/trustedBody.js';
import {
  laneForCapturaAgeHours,
  recoveredBy24h,
  recoveredBy72h,
} from '../src/matching/matchWindows.js';
import {
  discoveryStatus,
  googleArticleId,
  isGoogleNewsHost,
  publisherUrlFromHtml,
  publisherUrlFromQueryParams,
  publisherUrlsFromGoogleToken,
  resolveGoogleNewsUrl,
} from '../src/matching/googleNewsUrlUnwind.js';
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
    noticia_id: 'n-v5',
    medio_id: 'MED-0001',
    medio_nombre: 'El Informador',
    titulo: null,
    subtitulo: null,
    resumen: null,
    url_original: null,
    fecha_publicacion: null,
    fecha_captura: '2026-10-01T12:00:00.000Z',
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

describe('V5 Google News unwind (deterministic, no network)', () => {
  it('does not classify a still-google URL as unknown publisher', () => {
    expect(isGoogleNewsHost('https://news.google.com/rss/articles/CBMiabc')).toBe(true);
    expect(discoveryStatus({ resolved: false, inLake: false, knownSource: false })).toBe(
      'UNRESOLVED_GOOGLE_URL',
    );
    expect(discoveryStatus({ resolved: true, inLake: false, knownSource: false })).toBe('UNKNOWN_SOURCE');
    expect(discoveryStatus({ resolved: true, inLake: false, knownSource: true })).toBe(
      'MISSING_KNOWN_SOURCE',
    );
  });

  it('unwinds url= query param without fetching', () => {
    const wrapped =
      'https://news.google.com/rss/articles/CBMiabc?url=https%3A%2F%2Fwww.informador.mx%2Fjalisco%2Fnota.html';
    expect(publisherUrlFromQueryParams(wrapped)).toContain('informador.mx');
    expect(googleArticleId(wrapped)).toBe('CBMiabc');
  });

  it('extracts embedded publisher from legacy token when present', () => {
    const token = Buffer.from('padhttps://entornoinformativo.com.mx/nota-x pad', 'utf8').toString('base64url');
    const urls = publisherUrlsFromGoogleToken(token);
    expect(urls.some((u) => u.includes('entornoinformativo.com.mx'))).toBe(true);
  });

  it('reads canonical from wrapper HTML', () => {
    const html = '<html><link rel="canonical" href="https://concienciapublica.com.mx/2026/10/02/monreal-mery-pozos/"></html>';
    expect(publisherUrlFromHtml(html)).toContain('concienciapublica.com.mx');
  });

  it('resolveGoogleNewsUrl without network leaves opaque google ids unresolved', async () => {
    const r = await resolveGoogleNewsUrl(
      'https://news.google.com/rss/articles/CBMiOPAQUETOKENWITHOUTURL',
      { allowNetwork: false },
    );
    expect(r.status).toBe('GOOGLE_URL_UNRESOLVED');
    expect(r.publisher_final_url).toBeNull();
  });

  it('non-google URLs resolve immediately', async () => {
    const r = await resolveGoogleNewsUrl('https://afondojalisco.com/nota/', { allowNetwork: false });
    expect(r.status).toBe('GOOGLE_URL_RESOLVED');
    expect(r.method).toBe('not_google');
    expect(r.publisher_hostname).toBe('afondojalisco.com');
  });
});

describe('V5 cron gap lanes', () => {
  it('AB-AE: 2h/6h/12h/23h recovered by 24h', () => {
    expect(recoveredBy24h(2)).toBe(true);
    expect(recoveredBy24h(6)).toBe(true);
    expect(recoveredBy24h(12)).toBe(true);
    expect(recoveredBy24h(23)).toBe(true);
    expect(laneForCapturaAgeHours(6)).toBe('recovery_24h');
    expect(laneForCapturaAgeHours(1)).toBe('live');
  });

  it('AF-AG: 26h/48h missed by 24h, recovered by 72h', () => {
    expect(recoveredBy24h(26)).toBe(false);
    expect(recoveredBy24h(48)).toBe(false);
    expect(recoveredBy72h(26)).toBe(true);
    expect(recoveredBy72h(48)).toBe(true);
    expect(laneForCapturaAgeHours(26)).toBe('deep_72h');
    expect(laneForCapturaAgeHours(48)).toBe('deep_72h');
    expect(recoveredBy72h(80)).toBe(false);
    expect(laneForCapturaAgeHours(80)).toBe('lost');
  });
});

describe('V5 null matrix', () => {
  const g = {
    keywordsByClient: new Map([['CLI-MERY-TEST', [kw({ keyword_id: 'KEY-0041', keyword: 'Mery Pozos' })]]]),
    clientNames: new Map([['CLI-MERY-TEST', 'Mery']]),
  };

  it('matchable iff noticia_id + at least one trusted field', () => {
    const trustedKeys = ['titulo', 'subtitulo', 'resumen', 'seccion', 'texto_cuerpo_nota', 'texto_nota_limpia'] as const;
    for (const key of trustedKeys) {
      const n = news({ [key]: key === 'titulo' ? 'Mery Pozos informa' : 'Mery Pozos en el texto editorial largo suficiente para cuerpo. '.repeat(8) });
      expect(hasTrustedSearchableText(n)).toBe(true);
    }
    const empty = news({ texto_extraido: 'Mery Pozos RAW' });
    expect(hasTrustedSearchableText(empty)).toBe(false);
    expect(buildRows([empty], g.keywordsByClient, g.clientNames, general)).toHaveLength(0);
  });

  it('RAW never enables matching when trusted empty', () => {
    const n = news({
      titulo: null,
      resumen: null,
      url_original: null,
      texto_extraido: 'Mery Pozos '.repeat(40),
    });
    expect(buildRows([n], g.keywordsByClient, g.clientNames, general)).toHaveLength(0);
  });
});

describe('V5 dedupe stress', () => {
  it('live+24h+72h+radar collapse to one cliente_id//noticia_id', () => {
    const g = {
      keywordsByClient: new Map([['CLI-MERY-TEST', [kw({ keyword_id: 'KEY-0041', keyword: 'Mery Pozos' })]]]),
      clientNames: new Map([['CLI-MERY-TEST', 'Mery']]),
    };
    const n = news({ noticia_id: 'same-id', titulo: 'Mery Pozos en Guadalajara' });
    const live = buildRows([n], g.keywordsByClient, g.clientNames, general);
    const rec24 = buildRows([n], g.keywordsByClient, g.clientNames, general);
    const rec72 = buildRows([n], g.keywordsByClient, g.clientNames, general);
    const radar = buildRows([n], g.keywordsByClient, g.clientNames, general);
    const keys = [...live, ...rec24, ...rec72, ...radar].map((r) => String(r['dedupe_key']));
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe('cli-mery-test//same-id');
    const existing = new Set(keys);
    const would = radar.filter((r) => !existing.has(String(r['dedupe_key'])));
    expect(would).toHaveLength(0);
  });

  it('already in MASTER => 0 append', () => {
    const g = {
      keywordsByClient: new Map([['CLI-MERY-TEST', [kw({ keyword_id: 'KEY-0041', keyword: 'Mery Pozos' })]]]),
      clientNames: new Map([['CLI-MERY-TEST', 'Mery']]),
    };
    const rows = buildRows(
      [news({ noticia_id: 'master-1', titulo: 'Mery Pozos' })],
      g.keywordsByClient,
      g.clientNames,
      general,
    );
    const master = new Set(rows.map((r) => String(r['dedupe_key']).toLowerCase()));
    expect(rows.filter((r) => !master.has(String(r['dedupe_key']).toLowerCase()))).toHaveLength(0);
  });
});

describe('V5 body-only still uses trusted body', () => {
  it('title null + trusted body matches; raw ignored', () => {
    const g = {
      keywordsByClient: new Map([['CLI-MERY-TEST', [kw({ keyword_id: 'KEY-0042', keyword: 'Mery Gómez Pozos' })]]]),
      clientNames: new Map([['CLI-MERY-TEST', 'Mery']]),
    };
    const n = news({ titulo: null, resumen: null, url_original: null, texto_cuerpo_nota: BODY });
    expect(buildRows([n], g.keywordsByClient, g.clientNames, general)).toHaveLength(1);
  });
});
