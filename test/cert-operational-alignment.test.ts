import { describe, it, expect } from 'vitest';
import { shouldRejectCrawlUrl } from '../src/crawlers/urlFilters.js';
import { isNonArticleUrl, eligibleArticleNotes } from '../src/mediaValidation/certEligibility.js';
import { isValidLatencyPair, LATENCY_P95_THRESHOLD_H } from '../src/mediaValidation/certLatency.js';
import {
  productionCaptureHealth,
  transientAffectsArticleClass,
} from '../src/mediaValidation/certProbe.js';
import { classifyOperational } from '../src/mediaValidation/certClassify.js';
import { scoreMediaAtAnchor, isGenericListing, isHomepage, type CertNote } from '../src/mediaValidation/certScore.js';

describe('cert eligibility reuses shouldRejectCrawlUrl (no prefix list duplicada)', () => {
  it('valid article INCLUDED; /tag archive EXCLUDED (Jalisco)', () => {
    const article = 'https://jaliscotv.com/rehabilitan-escuela-artes-jalisco/';
    const tag = 'https://jaliscotv.com/tag/jalisco/';
    expect(shouldRejectCrawlUrl('MED-0113', article)).toBe(false);
    expect(isNonArticleUrl('MED-0113', article)).toBe(false);
    expect(shouldRejectCrawlUrl('MED-0113', tag)).toBe(true);
    expect(isNonArticleUrl('MED-0113', tag)).toBe(true);
  });

  it('/autor page EXCLUDED; dated article INCLUDED (MVS)', () => {
    expect(isNonArticleUrl('MED-0181', 'https://mvsnoticias.com/autor/felipe-larios.html')).toBe(true);
    expect(
      isNonArticleUrl(
        'MED-0181',
        'https://mvsnoticias.com/nacional/estados/2026/9/29/huracan-polo-toca-tierra-747905.html',
      ),
    ).toBe(false);
  });

  it('/version-impresa listing EXCLUDED; web article INCLUDED (San Luis Hoy)', () => {
    expect(isNonArticleUrl('MED-0072', 'https://sanluishoy.com.mx/version-impresa/28-de-septiembre-3/135033/')).toBe(
      true,
    );
    expect(isNonArticleUrl('MED-0072', 'https://sanluishoy.com.mx/sucesos/polo-toca-tierra/135234/')).toBe(false);
  });

  it('Proceso /temas/ hub EXCLUDED; /nacional/2026 article INCLUDED', () => {
    expect(isNonArticleUrl('MED-0031', 'https://www.proceso.com.mx/temas/nfl-543.html')).toBe(true);
    expect(
      isNonArticleUrl(
        'MED-0031',
        'https://www.proceso.com.mx/nacional/2026/9/29/polo-toca-tierra-en-baja-california-sur-380830.html',
      ),
    ).toBe(false);
  });

  it('Yucatán /juegos/ EXCLUDED; dated article INCLUDED', () => {
    expect(isNonArticleUrl('MED-0182', 'https://www.yucatan.com.mx/juegos/sudoku/')).toBe(true);
    expect(isNonArticleUrl('MED-0182', 'https://www.yucatan.com.mx/merida/2026/9/29/nota-real.html')).toBe(false);
  });

  it('eligibleArticleNotes splits inventory without dropping real articles', () => {
    const notes = [
      { url_original: 'https://www.proceso.com.mx/temas/nfl-543.html' },
      { url_original: 'https://www.proceso.com.mx/nacional/2026/9/29/nota-380830.html' },
    ];
    const { eligible, rejected } = eligibleArticleNotes('MED-0031', notes);
    expect(rejected).toHaveLength(1);
    expect(eligible).toHaveLength(1);
    expect(eligible[0]!.url_original).toContain('/nacional/');
  });
});

const aQuality = {
  n7: 50,
  n30: 80,
  urlOk: 1,
  titleOk: 1,
  pubOk: 1,
  capOk: 1,
  usable: 1,
  body: 1,
  homepage: 0,
  listing: 0,
  encoding: 0,
  clone: 0,
  boilerplate: 0,
  shortPct: 0,
  lastError: null,
  lastEstado: 'ok',
  paywallNotes: false,
  latencyP95: 4,
  sourceRecent: true as boolean | null,
};

describe('diagnostic TRANSIENT vs production TRANSIENT', () => {
  it('diagnostic transient: visible as probe TRANSIENT, does NOT degrade A-quality class', () => {
    const r = classifyOperational({
      ...aQuality,
      probe: { class: 'TRANSIENT', status: 200, error: 'few_items' },
      production: 'HEALTHY',
    });
    expect(r.cls).toBe('A');
    expect(transientAffectsArticleClass('TRANSIENT', 'HEALTHY')).toBe(false);
  });

  it('production transient: visible as OTHER but does not drop A-quality article inventory', () => {
    expect(transientAffectsArticleClass('TRANSIENT', 'TRANSIENT')).toBe(true);
    const r = classifyOperational({
      ...aQuality,
      probe: { class: 'TRANSIENT', status: null, error: 'timeout' },
      production: 'TRANSIENT',
      lastEstado: 'error',
      lastError: 'timeout connecting to rss',
    });
    expect(r.cls).toBe('A');
    expect(r.secondary).toBe('OTHER');
  });

  it('diagnostic TRANSIENT + stale production PERSISTENT does not add OTHER', () => {
    expect(transientAffectsArticleClass('TRANSIENT', 'PERSISTENT')).toBe(false);
  });

  it('ultimo_estado=ok is production HEALTHY even if diagnostic probe timed out', () => {
    expect(productionCaptureHealth('ok', null)).toBe('HEALTHY');
    expect(productionCaptureHealth('error', 'timeout rss')).toBe('TRANSIENT');
  });

  it('stale last_error 403 with currently HEALTHY probe does not drop A-quality media', () => {
    const r = classifyOperational({
      ...aQuality,
      probe: { class: 'HEALTHY', status: 200, error: null },
      production: 'PERSISTENT',
      lastEstado: 'error',
      lastError: 'HTTP 403 en feed',
    });
    expect(r.cls).toBe('A');
  });
});

describe('latency pairs: invalid timestamps excluded, threshold unchanged', () => {
  it('24h threshold is still 24', () => {
    expect(LATENCY_P95_THRESHOLD_H).toBe(24);
  });

  it('2018 pubDate + 2026 capture is invalid (does not inflate p95)', () => {
    const v = isValidLatencyPair('2018-09-01T00:00:00.000Z', '2026-09-29T18:00:00.000Z');
    expect(v.valid).toBe(false);
    if (!v.valid) expect(v.reason).toBe('pub_too_old');
  });

  it('same-day capture of a 2026 article is valid', () => {
    const v = isValidLatencyPair('2026-09-29T12:00:00.000Z', '2026-09-29T18:00:00.000Z');
    expect(v.valid).toBe(true);
    if (v.valid) expect(v.hours).toBe(6);
  });

  it('epoch / unparseable pub is invalid', () => {
    expect(isValidLatencyPair('not-a-date', '2026-09-29T18:00:00.000Z').valid).toBe(false);
  });

  it('p95 > 24h with no other minors stays A (secondary LATENCY); threshold unchanged', () => {
    const r = classifyOperational({
      ...aQuality,
      probe: { class: 'HEALTHY', status: 200, error: null },
      production: 'HEALTHY',
      latencyP95: 48,
    });
    expect(r.cls).toBe('A');
    expect(r.secondary).toBe('LATENCY');
  });

  it('p95 > 24h plus another minor remains B LATENCY', () => {
    const r = classifyOperational({
      ...aQuality,
      listing: 0.12,
      probe: { class: 'HEALTHY', status: 200, error: null },
      production: 'HEALTHY',
      latencyP95: 48,
    });
    expect(r.cls).toBe('B');
    expect(r.primary).toBe('LATENCY');
  });
});

describe('scoreMediaAtAnchor — non-article URLs out of the quality denominator', () => {
  const anchor = '2026-09-29T23:00:00.000Z';
  const article: CertNote = {
    url_original: 'https://www.proceso.com.mx/nacional/2026/9/28/nota-real-380809.html',
    titulo: 'Nota real',
    fecha_publicacion: '2026-09-28T12:00:00.000Z',
    created_at: '2026-09-28T14:00:00.000Z',
    texto_cuerpo_nota: 'x'.repeat(200),
    texto_nota_limpia: 'x'.repeat(200),
  };
  const hub: CertNote = {
    url_original: 'https://www.proceso.com.mx/temas/nfl-543.html',
    titulo: 'NFL | Proceso',
    fecha_publicacion: '2026-09-28T12:00:00.000Z',
    created_at: '2026-09-28T14:00:00.000Z',
    texto_cuerpo_nota: null,
    texto_nota_limpia: null,
  };

  it('hubs do not pull usable below A; article remains', () => {
    const s = scoreMediaAtAnchor({
      medioId: 'MED-0031',
      notes30: [article, hub, hub, hub],
      probe: { class: 'HEALTHY', status: 200, error: null },
      lastEstado: 'ok',
      lastError: null,
      paywallNotes: false,
      anchorIso: anchor,
    });
    expect(s.noticias_7d).toBe(1);
    expect(s.excluded_non_article_7d).toBe(3);
    expect(s.texto_usable_pct_7d).toBe(1);
    expect(s.listing_pct).toBe(0);
    expect(s.certification_class).toBe('A');
  });

  it('Yucatán /juegos/ EXCLUDED; dated article INCLUDED', () => {
    expect(isNonArticleUrl('MED-0182', 'https://www.yucatan.com.mx/juegos/sudoku/')).toBe(true);
    expect(isNonArticleUrl('MED-0182', 'https://www.yucatan.com.mx/merida/2026/9/29/nota-real.html')).toBe(false);
  });

  it('Hidrocálido print-only 7d → n7=0 NO_RECENT_CONTENT, not extraction C', () => {
    const print: CertNote = {
      url_original: 'https://www.hidrocalidodigital.com/hidrocalido-23-de-septiembre-de-2026/',
      titulo: 'Edición impresa',
      fecha_publicacion: '2026-09-23T12:00:00.000Z',
      created_at: '2026-09-28T14:00:00.000Z',
      texto_cuerpo_nota: null,
      texto_nota_limpia: 'Accede a tu cuenta',
    };
    const s = scoreMediaAtAnchor({
      medioId: 'MED-0166',
      notes30: [print],
      probe: { class: 'HEALTHY', status: 200, error: null },
      lastEstado: 'ok',
      lastError: null,
      paywallNotes: false,
      anchorIso: anchor,
    });
    expect(s.noticias_7d).toBe(0);
    expect(s.certification_class).toBe('B');
    expect(s.primary_defect).toBe('NO_RECENT_CONTENT');
  });

  it('2018 pubDates are dropped from p95; remaining valid pair does not become B LATENCY', () => {
    const old: CertNote = {
      url_original: 'https://cadenanoticias.com/nota-old',
      titulo: 'Vieja',
      fecha_publicacion: '2018-09-01T00:00:00.000Z',
      created_at: '2026-09-28T14:00:00.000Z',
      texto_cuerpo_nota: 'x'.repeat(200),
      texto_nota_limpia: 'x'.repeat(200),
    };
    const fresh: CertNote = {
      url_original: 'https://cadenanoticias.com/nota-fresh',
      titulo: 'Nueva',
      fecha_publicacion: '2026-09-28T12:00:00.000Z',
      created_at: '2026-09-28T14:00:00.000Z',
      texto_cuerpo_nota: 'x'.repeat(200),
      texto_nota_limpia: 'x'.repeat(200),
    };
    const s = scoreMediaAtAnchor({
      medioId: 'MED-0095',
      notes30: [old, fresh],
      probe: { class: 'HEALTHY', status: 200, error: null },
      lastEstado: 'ok',
      lastError: null,
      paywallNotes: false,
      anchorIso: anchor,
    });
    expect(s.latency_invalid_pairs).toBe(1);
    expect(s.latency_n).toBe(1);
    expect(s.latency_p95_h).toBe(2);
    expect(s.certification_class).toBe('A');
  });
});

describe('403 fetch on healthy RSS is BLOCKED_EXTERNAL, not repairable extractor C', () => {
  it('usable=0 + lastError 403 → C BLOCKED_EXTERNAL repairable=false', () => {
    const r = classifyOperational({
      ...aQuality,
      usable: 0,
      body: 0,
      probe: { class: 'HEALTHY', status: 200, error: null },
      production: 'HEALTHY',
      lastEstado: 'ok',
      lastError: 'HTTP 403 fetching article',
    });
    expect(r.cls).toBe('C');
    expect(r.primary).toBe('BLOCKED_EXTERNAL');
    expect(r.repairable).toBe(false);
  });
});

describe('isHomepage treats WordPress /?p= permalinks as articles', () => {
  it('bare origin is homepage; /?p=745709 is not', () => {
    expect(isHomepage('https://www.diarioimagen.net/')).toBe(true);
    expect(
      isHomepage(
        'https://www.diarioimagen.net/?p=745709&utm_source=rss&utm_medium=rss&utm_campaign=fuerzas-de-eu',
      ),
    ).toBe(false);
    expect(isHomepage('https://www.lajornadamaya.mx/')).toBe(true);
  });
});

describe('isGenericListing does not treat /busca- slugs as hubs', () => {
  it('article slug starting with busca- is not a listing; /busca/ hub is', () => {
    expect(
      isGenericListing('https://coahuilaenlinea.com/busca-gabriel-elizondo-reconocer-derechos-de-cuidadoras/'),
    ).toBe(false);
    expect(isGenericListing('https://example.com/busca/')).toBe(true);
    expect(isGenericListing('https://example.com/category/sonora/')).toBe(true);
  });
});
