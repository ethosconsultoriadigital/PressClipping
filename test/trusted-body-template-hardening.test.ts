import { describe, expect, it } from 'vitest';
import { buildRows, type MasterNewsRow } from '../scripts/mentions-master-fast-lane.js';
import { extractEditorialSegment, selectTrustedBody } from '../src/matching/trustedBody.js';
import { MERY_FRASE_EXACTA_BODY_KEYWORD_IDS } from '../src/matching/masterBodyCanary.js';
import type { KeywordActivaRow } from '../src/supabase/repositories.js';

const ALLOW = [...MERY_FRASE_EXACTA_BODY_KEYWORD_IDS];
const BODY_OPTS = {
  masterBodyV2: true,
  bodyPolicy: 'allowlist' as const,
  keywordAllowlist: ALLOW,
  mode: 'body_v4' as const,
};

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
    noticia_id: '00000000-0000-4000-8000-000000000001',
    medio_id: 'MED-0001',
    medio_nombre: 'Diario',
    titulo: 'Nota editorial',
    subtitulo: null,
    resumen: 'Resumen editorial de la nota.',
    url_original: 'https://ejemplo.mx/nota',
    fecha_publicacion: '2026-10-06T12:00:00.000Z',
    fecha_captura: '2026-10-06T12:10:00.000Z',
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

const EDITORIAL =
  'El reencuentro con la afición se vivió en las gradas. '.repeat(12) +
  'El recinto recuperó el pulso de la temporada. '.repeat(6);

function grouped(kws: KeywordActivaRow[], clientId = 'CLI-MERY-TEST', name = 'Mery Pozos') {
  return {
    keywordsByClient: new Map([[clientId, kws]]),
    clientNames: new Map([[clientId, name]]),
  };
}

const mery = [kw({ keyword_id: 'KEY-0041', keyword: 'Mery Pozos' })];
const cofepris = [kw({
  cliente_id: 'CLI-0002',
  keyword_id: 'KEY-0039',
  keyword: 'Cofepris',
  tipo_keyword: 'exacta',
})];

describe('template contamination hardening', () => {
  it('A — keyword editorial before related block is preserved', () => {
    const g = grouped(mery);
    const n = news({
      titulo: 'Foro local',
      resumen: 'Sin keyword en el resumen.',
      texto_cuerpo_nota:
        `${EDITORIAL} Que Mery Pozos tendrá el foro idóneo para plantear la agenda.\nNotas relacionadas\nOtra nota distinta`,
    });
    const rows = buildRows([n], g.keywordsByClient, g.clientNames, BODY_OPTS);
    expect(rows).toHaveLength(1);
    expect(String(rows[0]?.['campo_match'])).toBe('TEXTO_CUERPO_NOTA');
  });

  it('B — keyword only after Notas relacionadas does not match', () => {
    const g = grouped(mery);
    const n = news({
      titulo: 'Foro local',
      resumen: 'Sin keyword en el resumen.',
      texto_cuerpo_nota: `${EDITORIAL}\nNotas relacionadas\nGuadalajara y el mensaje que dejó Mery Pozos`,
    });
    const rows = buildRows([n], g.keywordsByClient, g.clientNames, BODY_OPTS);
    expect(rows).toHaveLength(0);
    const body = selectTrustedBody(n, 'body_v4');
    expect(body.text).not.toMatch(/Mery Pozos/i);
  });

  it('C — concatenated Compartir + Destacadas + keyword + Artículo anterior does not match', () => {
    const g = grouped(cofepris, 'CLI-0002', 'Jumex');
    const n = news({
      titulo: 'Y NO PASA NADA… | Diario Marca',
      resumen:
        'Compartir Facebook X Pinterest WhatsApp Destacadas Cofepris alerta por Aderogyl adulterado Artículo anterior Portada Artículo siguiente Cartón',
      texto_cuerpo_nota: EDITORIAL,
    });
    const rows = buildRows([n], g.keywordsByClient, g.clientNames, BODY_OPTS);
    expect(rows).toHaveLength(0);
  });

  it('D — title match survives template body', () => {
    const g = grouped(mery);
    const n = news({
      titulo: 'Guadalajara y el mensaje que dejó Mery Pozos',
      resumen: 'Compartir Facebook Destacadas Cofepris alerta Artículo anterior',
      texto_cuerpo_nota: `${EDITORIAL}\nNotas relacionadas\nOtra nota`,
    });
    const rows = buildRows([n], g.keywordsByClient, g.clientNames, BODY_OPTS);
    expect(rows).toHaveLength(1);
    expect(String(rows[0]?.['campo_match'])).toBe('TITULO');
  });

  it('E — casual “destacadas” in prose is not a cut', () => {
    const text =
      `${EDITORIAL} Las noticias destacadas del trimestre confirmaron que Mery Pozos asistió al foro. ` +
      'El recinto cerró la sesión con votación nominal.';
    const seg = extractEditorialSegment(text);
    expect(seg.cutAt).toBeNull();
    expect(seg.text).toMatch(/Mery Pozos/);
    const g = grouped(mery);
    const rows = buildRows(
      [news({ titulo: 'Balance', resumen: 'Sin keyword.', texto_cuerpo_nota: text })],
      g.keywordsByClient,
      g.clientNames,
      BODY_OPTS,
    );
    expect(rows).toHaveLength(1);
  });

  it('F — Conciencia related tail does not produce BODY match', () => {
    const g = grouped(mery);
    const n = news({
      noticia_id: 'e23391ca-7c6e-4482-9a39-5a41debb41fc',
      medio_id: 'MED-0201',
      titulo: 'Crónica de un reencuentro con la pasión',
      resumen: 'Crónica deportiva sin la keyword.',
      url_original: 'https://concienciapublica.com.mx/2026/10/04/cronica-de-un-reencuentro-con-la-pasion/',
      texto_cuerpo_nota:
        `${EDITORIAL}\n\nGuadalajara y el mensaje que dejó Mery Pozos\n\nSi los gobernantes fueran santos`,
    });
    expect(buildRows([n], g.keywordsByClient, g.clientNames, BODY_OPTS)).toHaveLength(0);
  });

  it('G — Diario Marca Destacadas does not produce RESUMEN match', () => {
    const g = grouped(cofepris, 'CLI-0002', 'Jumex');
    const n = news({
      noticia_id: 'af136bd8-2988-4053-a5b0-104f96381791',
      medio_id: 'MED-0373',
      titulo: 'Y NO PASA NADA… | Diario Marca',
      resumen:
        'Compartir\nFacebook\nX\nPinterest\nWhatsApp\nDestacadas\nCofepris alerta por Aderogyl adulterado\nArtículo anterior\nArtículo siguiente',
      texto_cuerpo_nota: EDITORIAL,
    });
    expect(buildRows([n], g.keywordsByClient, g.clientNames, BODY_OPTS)).toHaveLength(0);
  });

  it('H — Diario Marca listing/portada does not produce RESUMEN match', () => {
    const g = grouped(cofepris, 'CLI-0002', 'Jumex');
    const n = news({
      noticia_id: '232919cb-9be8-4402-b654-0b268403a69c',
      medio_id: 'MED-0373',
      titulo: 'MARTES 06 DE OCTUBRE DE 2026 | Diario Marca',
      resumen:
        'Destacadas Cofepris alerta por Aderogyl adulterado y dos medicamentos falsificados Artículo anterior Cartón Artículo siguiente Portada',
      texto_cuerpo_nota: null,
    });
    expect(buildRows([n], g.keywordsByClient, g.clientNames, BODY_OPTS)).toHaveLength(0);
  });

  it('I — four true positives still match', () => {
    const cases: Array<{ n: MasterNewsRow; kws: KeywordActivaRow[]; client: string; name: string }> = [
      {
        n: news({
          noticia_id: '44022aec-a8a1-421a-9d97-54181371f9a6',
          titulo: 'Guadalajara y el mensaje que dejó Mery Pozos',
          resumen: 'La diputada habló en Guadalajara.',
        }),
        kws: mery,
        client: 'CLI-MERY-TEST',
        name: 'Mery Pozos',
      },
      {
        n: news({
          noticia_id: '9eefeabe-2844-40d0-9215-aede1be2f1b7',
          titulo: 'SUTIEMS amenaza con movilizaciones y huelga en el IEMS',
          resumen: 'El sindicato advirtió movilizaciones.',
        }),
        kws: [kw({ cliente_id: 'CLI-0003', keyword_id: 'KEY-0017', keyword: 'huelga', tipo_keyword: 'exacta' })],
        client: 'CLI-0003',
        name: 'SUTIEMS',
      },
      {
        n: news({
          noticia_id: 'f4fbb0cd-583b-46fa-a26e-b8c85ad086ef',
          titulo: 'Cofepris alerta por Aderogyl adulterado y dos medicamentos falsificados',
          resumen: 'La autoridad sanitaria emitió una alerta.',
        }),
        kws: cofepris,
        client: 'CLI-0002',
        name: 'Jumex',
      },
      {
        n: news({
          noticia_id: '2a1763c4-c81b-4bca-8bf8-fa3c832f0698',
          titulo: 'Volkswagen Puebla es estratégica, pero huelga pondría proyectos en riesgo: UPAEP',
          resumen: 'La universidad advirtió el riesgo.',
        }),
        kws: [kw({ cliente_id: 'CLI-0003', keyword_id: 'KEY-0017', keyword: 'huelga', tipo_keyword: 'exacta' })],
        client: 'CLI-0003',
        name: 'SUTIEMS',
      },
    ];
    for (const c of cases) {
      const g = grouped(c.kws, c.client, c.name);
      const rows = buildRows([c.n], g.keywordsByClient, g.clientNames, BODY_OPTS);
      expect(rows, c.n.noticia_id).toHaveLength(1);
      expect(String(rows[0]?.['campo_match'])).toBe('TITULO');
    }
  });
});
