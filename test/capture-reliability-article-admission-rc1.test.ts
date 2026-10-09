import { describe, expect, it } from 'vitest';
import { admitDiscoveredArticle, classifyPreFetch } from '../src/captureReliability/articleAdmission.js';
import { classifyNonArticle } from '../src/captureReliability/nonArticle.js';
import { automatedNonArticleCount, evaluateRecoveryQuality } from '../src/captureReliability/recoveryQualityGate.js';
import { isAutoWriteEligible } from '../src/captureReliability/writeEligibility.js';
import { isGoogleNewsUrl } from '../src/matching/bGapCandidateToCaptureGapRow.js';
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

const ALCANCE = {
  u1: 'https://www.alcancediario.mx/portada/que-pasaria-con-economia-puebla-volkswagen-reduce-produccion-enfrenta-huelga/',
  u2: 'https://www.alcancediario.mx/portada/hallan-sin-vida-doctora-71-anos-dentro-consultorio-puebla-estaba-silla-tenia-disparo/',
  u3: 'https://www.alcancediario.mx/portada/suspenden-clases-en-5-regiones-de-puebla-por-temporal-de-lluvias-regresan-el-12-de-octubre/',
} as const;

const APOCALIPSIS = [
  'https://periodicopalacio.com/la-pesada-portada-del-apocalipsis-es-invendible-dice-el-dueno-de-la-obra-de-salvador-dali-robada-en-francia/',
  'https://frontera.news/la-pesada-portada-del-apocalipsis-es-invendible-dice-el-dueno-de-la-obra-de-salvador-dali-robada-en-francia/',
  'https://cybermexico.mx/la-pesada-portada-del-apocalipsis-es-invendible-dice-el-dueno-de-la-obra-de-salvador-dali-robada-en-francia/',
  'https://altiempo.mx/la-pesada-portada-del-apocalipsis-es-invendible-dice-el-dueno-de-la-obra-de-salvador-dali-robada-en-francia/',
] as const;

describe('RC1 article admission — daily print covers vs /portada/ articles', () => {
  it('A — Notiver daily cover slug is PRINT_COVER without a title', () => {
    const url = 'https://www.notiver.com/primera/la-portada-miercoles-7-de-octubre-2026/';
    const r = admitDiscoveredArticle({ url, medioId: 'MED-0241', titulo: null });
    expect(r.admit).toBe(false);
    expect(r.reason).toBe('NON_ARTICLE_PRINT_COVER');
    expect(classifyNonArticle({ url }).reason).toBe('NON_ARTICLE_PRINT_COVER');
  });

  it('B — generic weekday cover slug is PRINT_COVER', () => {
    const url = 'https://medio.example/primera/la-portada-lunes-12-de-octubre-2026/';
    expect(admitDiscoveredArticle({ url, medioId: 'MED-1' }).reason).toBe('NON_ARTICLE_PRINT_COVER');
  });

  it('C — ISO dated cover slug is PRINT_COVER', () => {
    const url = 'https://medio.example/edicion/portada-2026-10-07/';
    expect(admitDiscoveredArticle({ url, medioId: 'MED-1' }).reason).toBe('NON_ARTICLE_PRINT_COVER');
  });

  it('D — real article under /portada/ stays eligible', () => {
    const url = 'https://www.alcancediario.mx/portada/que-pasaria-con-economia-puebla-volkswagen-reduce-produccion-enfrenta-huelga/';
    const r = admitDiscoveredArticle({
      url,
      medioId: 'MED-0009',
      titulo: '¿Qué pasaría con la economía de Puebla si Volkswagen reduce producción?',
      publishedAt: '2026-10-07T12:00:00.000Z',
    });
    expect(r.admit).toBe(true);
    expect(classifyNonArticle({ url }).nonArticle).toBe(false);
  });

  it('E — editorial title mentioning portada is not auto-rejected', () => {
    const url = 'https://medio.example/politica/el-presidente-responde-a-la-portada-del-diario-nacional/';
    const r = admitDiscoveredArticle({
      url,
      medioId: 'MED-1',
      titulo: 'El presidente responde a la portada del diario nacional',
      body: 'x'.repeat(400),
    });
    expect(r.admit).toBe(true);
    expect(r.reason).not.toBe('NON_ARTICLE_PRINT_COVER');
  });

  it('F — three Alcance Diario /portada/ editorials remain eligible', () => {
    for (const url of Object.values(ALCANCE)) {
      const r = admitDiscoveredArticle({ url, medioId: 'MED-0009', publishedAt: '2026-10-07T12:00:00.000Z' });
      expect(r.admit, url).toBe(true);
      expect(classifyNonArticle({ url }).reason, url).toBeNull();
    }
  });

  it('G — category, author hub, listing, Google and unknown window stay fail-closed', () => {
    expect(admitDiscoveredArticle({ url: FP.categoria, medioId: 'MED-0279' }).reason).toBe('NON_ARTICLE_CATEGORY');
    expect(admitDiscoveredArticle({ url: FP.afondo1, medioId: 'MED-0202', titulo: 'A Fondo Jalisco' }).reason).toBe(
      'NON_ARTICLE_AUTHOR_HUB',
    );
    expect(isGenericListing('https://example.com/category/sonora/')).toBe(true);
    expect(isGoogleNewsUrl('https://news.google.com/rss/articles/abc')).toBe(true);
    const unknown = isAutoWriteEligible(
      {
        status: 'QUEUED',
        medio_id: 'MED-1',
        discovered_via: 'sitemap',
        window_membership: 'WINDOW_MEMBERSHIP_UNKNOWN',
        published_at: null,
      },
      { start: '2026-10-06T20:00:00.000Z', end: '2026-10-07T18:00:00.000Z' },
      null,
    );
    expect(unknown.eligible).toBe(false);
    expect(unknown.reason).toBe('WINDOW_MEMBERSHIP_UNKNOWN');
  });

  it('H — print-cover classification is idempotent for the same URL', () => {
    const url = 'https://www.notiver.com/primera/la-portada-miercoles-7-de-octubre-2026/';
    const a = classifyNonArticle({ url });
    const b = classifyNonArticle({ url });
    expect(a).toEqual(b);
    expect(admitDiscoveredArticle({ url, medioId: 'MED-0241' })).toEqual(
      admitDiscoveredArticle({ url, medioId: 'MED-0241' }),
    );
  });
});

describe('RC1 article admission — dated plural print covers', () => {
  it('A — Notiver singular daily cover stays PRINT_COVER', () => {
    const url = 'https://www.notiver.com/primera/la-portada-miercoles-7-de-octubre-2026/';
    expect(admitDiscoveredArticle({ url, medioId: 'MED-0241' }).reason).toBe('NON_ARTICLE_PRINT_COVER');
  });

  it('B — dated plural /portadas-DD-MM-YY/ is PRINT_COVER', () => {
    const url = 'https://medio.example/portadas-07-10-26/';
    const r = admitDiscoveredArticle({
      url,
      medioId: 'MED-1',
      titulo: 'portadas 07-10-26',
      body: 'Portadas Nacionales 07.10.26 Descarga',
    });
    expect(r.admit).toBe(false);
    expect(r.reason).toBe('NON_ARTICLE_PRINT_COVER');
    expect(classifyNonArticle({ url }).reason).toBe('NON_ARTICLE_PRINT_COVER');
  });

  it('C — ISO, primeras-planas and portadas-impresas dated slugs are PRINT_COVER', () => {
    const urls = [
      'https://medio.example/portadas-2026-10-07/',
      'https://medio.example/primeras-planas-7-de-octubre-2026/',
      'https://medio.example/portadas-impresas-07-10-26/',
    ];
    for (const url of urls) {
      expect(admitDiscoveredArticle({ url, medioId: 'MED-1', titulo: 'Portadas 7 de octubre 2026' }).reason, url).toBe(
        'NON_ARTICLE_PRINT_COVER',
      );
    }
  });

  it('D — editorial article under /portadas/ stays eligible', () => {
    const url = 'https://medio.example/portadas/analisis-de-las-primeras-planas-y-su-impacto-politico/';
    const r = admitDiscoveredArticle({
      url,
      medioId: 'MED-1',
      titulo: 'Análisis de las primeras planas y su impacto político',
      body: 'x'.repeat(500),
    });
    expect(r.admit).toBe(true);
    expect(
      classifyNonArticle({
        url,
        titulo: 'Análisis de las primeras planas y su impacto político',
        body: 'x'.repeat(500),
      }).nonArticle,
    ).toBe(false);
  });

  it('E — Alcance Diario /portada/ editorials stay eligible', () => {
    for (const url of Object.values(ALCANCE)) {
      expect(admitDiscoveredArticle({ url, medioId: 'MED-0009', publishedAt: '2026-10-07T12:00:00.000Z' }).admit, url).toBe(
        true,
      );
    }
  });

  it('F — four editorial “pesada portada del apocalipsis” notes stay eligible', () => {
    for (const url of APOCALIPSIS) {
      const r = admitDiscoveredArticle({
        url,
        medioId: 'MED-1',
        titulo: 'La pesada portada del Apocalipsis es invendible, dice el dueño de la obra de Salvador Dalí',
        body: 'x'.repeat(400),
      });
      expect(r.admit, url).toBe(true);
      expect(r.reason, url).not.toBe('NON_ARTICLE_PRINT_COVER');
    }
  });

  it('G — real news whose title includes portadas is preserved', () => {
    const url =
      'https://oem.com.mx/elsoldemexico/metropoli/iztapalapa-convierte-sus-portadas-florales-en-patrimonio-cultural-inmateride-la-cdmx-32479169';
    const r = admitDiscoveredArticle({
      url,
      medioId: 'MED-1',
      titulo: 'Iztapalapa convierte sus portadas florales en patrimonio cultural',
      body: 'x'.repeat(400),
    });
    expect(r.admit).toBe(true);
    expect(r.reason).not.toBe('NON_ARTICLE_PRINT_COVER');
  });

  it('H — category, author hub, listing, template, Google and unknown window stay fail-closed', () => {
    expect(admitDiscoveredArticle({ url: FP.categoria, medioId: 'MED-0279' }).reason).toBe('NON_ARTICLE_CATEGORY');
    expect(admitDiscoveredArticle({ url: FP.afondo1, medioId: 'MED-0202', titulo: 'A Fondo Jalisco' }).reason).toBe(
      'NON_ARTICLE_AUTHOR_HUB',
    );
    expect(admitDiscoveredArticle({ url: FP.people, medioId: 'MED-0574' }).reason).toBe('NON_ARTICLE_DIRECTORY');
    expect(admitDiscoveredArticle({ url: FP.template, medioId: 'MED-0368', titulo: 'Header Template - Default PRO' }).reason).toBe(
      'NON_ARTICLE_TEMPLATE',
    );
    expect(isGenericListing('https://example.com/category/sonora/')).toBe(true);
    expect(isGoogleNewsUrl('https://news.google.com/rss/articles/abc')).toBe(true);
    const unknown = isAutoWriteEligible(
      {
        status: 'QUEUED',
        medio_id: 'MED-1',
        discovered_via: 'sitemap',
        window_membership: 'WINDOW_MEMBERSHIP_UNKNOWN',
        published_at: null,
      },
      { start: '2026-10-06T20:00:00.000Z', end: '2026-10-07T18:00:00.000Z' },
      null,
    );
    expect(unknown.eligible).toBe(false);
    expect(unknown.reason).toBe('WINDOW_MEMBERSHIP_UNKNOWN');
  });
});

describe('RC1 article admission — login wall and inventory', () => {
  const reformaArticle = 'https://www.reforma.com/camacho-camacho-2026-10-07/ca322114';
  const loginUrl = 'https://www.reforma.com/login/';
  const inventory404 =
    'https://www.autoexplora.com/inventario-de-seminuevos/2020-nissan-march-1-6-advance-manual-nissan-imperio-oriente-gv-6aa097702a7a68a7ddd0e701';
  const autoEditorial =
    'https://www.autoexplora.com/noticias/toyota-anuncia-nueva-plataforma-hibrida-en-mexico-2026/';

  it('rejects a literal login URL as NON_ARTICLE_LOGIN_PAGE', () => {
    const r = admitDiscoveredArticle({ url: loginUrl, medioId: 'MED-0027', titulo: 'Login' });
    expect(r.admit).toBe(false);
    expect(r.reason).toBe('NON_ARTICLE_LOGIN_PAGE');
    expect(classifyNonArticle({ url: loginUrl }).reason).toBe('NON_ARTICLE_LOGIN_PAGE');
  });

  it('does not persist Login Grupo Reforma extract even with dated permalink', () => {
    const r = admitDiscoveredArticle({
      url: reformaArticle,
      medioId: 'MED-0027',
      titulo: 'Login Grupo Reforma',
      publishedAt: '2026-10-07T06:00:00.000Z',
      body: '',
    });
    expect(r.admit).toBe(false);
    expect(r.reason).toBe('AUTH_WALL_EXTRACT');
    expect(classifyNonArticle({ url: reformaArticle, titulo: 'Login Grupo Reforma' }).nonArticle).toBe(false);
  });

  it('quality FAIL on persisted login extract', () => {
    const q = evaluateRecoveryQuality({
      url: reformaArticle,
      medioId: 'MED-0027',
      expectedMedioId: 'MED-0027',
      titulo: 'Login Grupo Reforma',
      body: '',
      fechaPublicacion: '2026-10-07T06:00:00.000Z',
    });
    expect(q.verdict).toBe('FAIL');
    expect(q.reasons).toContain('auth_wall_extract');
  });

  it('rejects vehicle-not-found and inventory listings', () => {
    expect(
      admitDiscoveredArticle({
        url: inventory404,
        medioId: 'MED-0570',
        titulo: 'Vehículo no encontrado · Autoexplora',
        publishedAt: '2026-10-07T12:00:00.000Z',
      }).reason,
    ).toBe('NON_ARTICLE_INVENTORY');
    expect(
      admitDiscoveredArticle({
        url: inventory404,
        medioId: 'MED-0570',
        titulo: '2018 Chevrolet Aveo 1.5 Ls Mt | Seminuevos Autoexplora',
        body: 'x'.repeat(80),
      }).reason,
    ).toBe('NON_ARTICLE_INVENTORY');
  });

  it('keeps a legitimate Autoexplora editorial', () => {
    const r = admitDiscoveredArticle({
      url: autoEditorial,
      medioId: 'MED-0570',
      titulo: 'Toyota anuncia nueva plataforma híbrida en México',
      body: 'x'.repeat(400),
      publishedAt: '2026-10-07T12:00:00.000Z',
    });
    expect(r.admit).toBe(true);
    expect(r.reason).not.toBe('NON_ARTICLE_INVENTORY');
  });

  it('is idempotent for login extract and inventory URL', () => {
    const a = admitDiscoveredArticle({ url: reformaArticle, medioId: 'MED-0027', titulo: 'Login Grupo Reforma' });
    const b = admitDiscoveredArticle({ url: reformaArticle, medioId: 'MED-0027', titulo: 'Login Grupo Reforma' });
    expect(a).toEqual(b);
    const c = classifyNonArticle({ url: inventory404, titulo: 'Vehículo no encontrado · Autoexplora' });
    const d = classifyNonArticle({ url: inventory404, titulo: 'Vehículo no encontrado · Autoexplora' });
    expect(c).toEqual(d);
  });
});
