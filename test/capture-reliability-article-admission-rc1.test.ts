import { describe, expect, it } from 'vitest';
import { admitDiscoveredArticle, classifyPreFetch } from '../src/captureReliability/articleAdmission.js';
import { classifyNonArticle } from '../src/captureReliability/nonArticle.js';
import { automatedNonArticleCount, evaluateRecoveryQuality } from '../src/captureReliability/recoveryQualityGate.js';
import { isGenericListing } from '../src/mediaValidation/certScore.js';

const FP = {
  categoria: 'https://tutucuman.com/categoria/espectaculos/',
  afondo1: 'https://afondojalisco.com/seccion/opinion/horacio-villasenor-manzanedo/',
  afondo2: 'https://afondojalisco.com/seccion/opinion/rodolfo-aceves-jimenez/',
  afondo3: 'https://afondojalisco.com/seccion/opinion/gabriel-torres-espinoza/',
  portada: 'https://www.elgrafico.mx/portada-impresa/2026/10/05/portada-el-grafico-lunes-5-de-octubre-de-2026/',
  template: 'https://www.portalhidalgo.com/tdb_templates/header-template-default-pro/',
  people: 'https://www.pv-magazine-mexico.com/people-companies/ampyr-distributed-energy/',
} as const;

describe('RC1 article admission — confirmed false positives rejected', () => {
  it('rejects all 7 confirmed recovery false positives', () => {
    expect(admitDiscoveredArticle({ url: FP.categoria, medioId: 'MED-0279', titulo: 'Espectáculos archivos - Tu Tucumán', body: 'x'.repeat(200) }).reason).toBe(
      'NON_ARTICLE_CATEGORY',
    );
    expect(admitDiscoveredArticle({ url: FP.afondo1, medioId: 'MED-0202', titulo: 'A Fondo Jalisco', body: 'x'.repeat(2000) }).reason).toBe(
      'NON_ARTICLE_AUTHOR_HUB',
    );
    expect(admitDiscoveredArticle({ url: FP.afondo2, medioId: 'MED-0202', titulo: 'A Fondo Jalisco', body: 'x'.repeat(1600) }).reason).toBe(
      'NON_ARTICLE_AUTHOR_HUB',
    );
    expect(admitDiscoveredArticle({ url: FP.afondo3, medioId: 'MED-0202', titulo: 'A Fondo Jalisco', body: 'x'.repeat(1600) }).reason).toBe(
      'NON_ARTICLE_AUTHOR_HUB',
    );
    expect(
      admitDiscoveredArticle({
        url: FP.portada,
        medioId: 'MED-0306',
        titulo: 'Portada El Gráfico | Lunes 5 de Octubre de 2026',
        body: '',
      }).reason,
    ).toBe('NON_ARTICLE_PRINT_COVER');
    expect(
      admitDiscoveredArticle({
        url: FP.template,
        medioId: 'MED-0368',
        titulo: 'Header Template - Default PRO - Portal Hidalgo',
        body: null,
      }).reason,
    ).toBe('NON_ARTICLE_TEMPLATE');
    expect(admitDiscoveredArticle({ url: FP.people, medioId: 'MED-0574', titulo: 'AMPYR Distributed Energy - pv magazine México', body: 'ampyr' }).reason).toBe(
      'NON_ARTICLE_DIRECTORY',
    );
    for (const url of Object.values(FP)) {
      expect(admitDiscoveredArticle({ url, medioId: 'MED-1', body: 'x'.repeat(500) }).admit).toBe(false);
      expect(classifyPreFetch({ url, medioId: 'MED-1', body: 'x'.repeat(500) }, 'sitemap').disposition).toBe('REJECT');
    }
  });
});

describe('RC1 article admission — valid articles not overblocked', () => {
  it('accepts a deep opinion editorial article', () => {
    const url = 'https://medio.example/opinion/editoriales/el-congreso-debe-aprobar-el-presupuesto-2026/';
    expect(admitDiscoveredArticle({ url, medioId: 'MED-1', titulo: 'El Congreso debe aprobar el presupuesto', body: 'x'.repeat(400) }).admit).toBe(true);
  });

  it('accepts a section/article permalink', () => {
    const url = 'https://medio.example/politica/congreso-aprueba-reforma-fiscal-historica/';
    expect(classifyPreFetch({ url, medioId: 'MED-1' }, 'sitemap').disposition).toBe('ADMIT');
  });

  it('accepts a long dated permalink', () => {
    expect(
      admitDiscoveredArticle({
        url: 'https://labrecha.me/informacion-principal/destacada/2026/10/05/sapsam-conmemora-el-dia-interamericano-del-agua/',
        medioId: 'MED-0081',
        titulo: 'Sapsam Conmemora el Día Interamericano del Agua',
        publishedAt: '2026-10-05T16:02:29.000Z',
      }).admit,
    ).toBe(true);
  });

  it('does not reject a real article only because title equals the site name', () => {
    const r = admitDiscoveredArticle({
      url: 'https://afondojalisco.com/jalisco/gobierno-anuncia-plan-de-seguridad-metropolitana-2026/',
      medioId: 'MED-0202',
      titulo: 'A Fondo Jalisco',
      body: 'x'.repeat(500),
    });
    expect(r.admit).toBe(true);
  });

  it('accepts a deep sitemap-style path', () => {
    expect(
      admitDiscoveredArticle({
        url: 'https://www.eleconomista.com.mx/economia/panorama-favorable-economia-igae-expande-julio-20261005-836958.html',
        medioId: 'MED-0001',
        titulo: 'Panorama favorable para la economía',
        publishedAt: '2026-10-05T20:54:44.000Z',
      }).admit,
    ).toBe(true);
  });
});

describe('isGenericListing hierarchy', () => {
  it('detects Spanish categoria hubs and keeps busca- article slugs', () => {
    expect(isGenericListing('https://tutucuman.com/categoria/espectaculos/')).toBe(true);
    expect(isGenericListing('https://example.com/category/sonora/')).toBe(true);
    expect(isGenericListing('https://example.com/busca/')).toBe(true);
    expect(isGenericListing('https://coahuilaenlinea.com/busca-gabriel-elizondo-reconocer-derechos-de-cuidadoras/')).toBe(false);
    expect(isGenericListing('https://medio.example/seccion/politica/congreso-aprueba-reforma-fiscal-historica/')).toBe(false);
  });
});

describe('quality gate uses the same admission classifier', () => {
  it('counts confirmed non-articles as automated FAIL and blocks escalation', () => {
    const rows = [
      { url: FP.categoria, medioId: 'MED-0279', expectedMedioId: 'MED-0279', titulo: 'Espectáculos archivos', body: 'x'.repeat(200) },
      {
        url: 'https://medio.example/politica/congreso-aprueba-reforma-fiscal-historica/',
        medioId: 'MED-1',
        expectedMedioId: 'MED-1',
        titulo: 'Congreso aprueba reforma',
        body: 'x'.repeat(400),
      },
    ];
    expect(evaluateRecoveryQuality(rows[0]!).verdict).toBe('FAIL');
    expect(evaluateRecoveryQuality(rows[0]!).automatedNonArticle).toBe(true);
    expect(evaluateRecoveryQuality(rows[1]!).verdict).toBe('PASS');
    expect(automatedNonArticleCount(rows)).toBe(1);
  });

  it('short real titles with dated permalink and body are WARN not FAIL', () => {
    const q = evaluateRecoveryQuality({
      url: 'https://elvalle.com.mx/2026/10/04/debate-676/',
      medioId: 'MED-0410',
      expectedMedioId: 'MED-0410',
      titulo: 'DEBATE',
      body: 'x'.repeat(800),
      fechaPublicacion: '2026-10-05T07:33:02.000Z',
      windowStart: '2026-10-04T21:00:00.000Z',
      windowEnd: '2026-10-05T21:00:00.000Z',
      cuerpoNotaChars: 3552,
    });
    expect(q.verdict).toBe('WARN');
    expect(q.automatedNonArticle).toBe(false);
  });

  it('classifyNonArticle is explicit per class', () => {
    expect(classifyNonArticle({ url: FP.template, titulo: 'Header Template - Default PRO' }).reason).toBe('NON_ARTICLE_TEMPLATE');
    expect(classifyNonArticle({ url: FP.people }).reason).toBe('NON_ARTICLE_DIRECTORY');
    expect(classifyNonArticle({ url: FP.portada, titulo: 'Portada El Gráfico | Lunes 5 de Octubre de 2026' }).reason).toBe(
      'NON_ARTICLE_PRINT_COVER',
    );
  });
});
