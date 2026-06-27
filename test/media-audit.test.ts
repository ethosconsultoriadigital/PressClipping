import { describe, it, expect } from 'vitest';
import {
  clasificarFuenteMedio,
  confianzaFuente,
  cumpleEstricto,
  esDominioAgregador,
  prioridadReparacion,
  urlsCandidatas,
  esNewsSitemap,
  type AuditInput,
  type FuenteCandidata,
} from '../src/validation/mediaAudit.js';

function fuente(over: Partial<FuenteCandidata>): FuenteCandidata {
  return {
    url: over.url ?? 'https://m.mx/feed',
    tipo: over.tipo ?? 'rss',
    items: over.items ?? 20,
    recientes: over.recientes ?? 10,
    fechasDisponibles: over.fechasDisponibles ?? true,
    dominioOk: over.dominioOk ?? true,
    esIndiceMasivo: over.esIndiceMasivo ?? false,
    esConfigurada: over.esConfigurada ?? false,
    esIndice: over.esIndice ?? false,
  };
}

function input(over: Partial<AuditInput>): AuditInput {
  return {
    metodo_extraccion: over.metodo_extraccion ?? null,
    rss_url: over.rss_url ?? null,
    sitemap_url: over.sitemap_url ?? null,
    url_base: over.url_base ?? 'https://m.mx',
    requiere_javascript: over.requiere_javascript ?? false,
    requiere_proxy: over.requiere_proxy ?? false,
    configurada: over.configurada ?? null,
    candidatas: over.candidatas ?? [],
    directOk: over.directOk ?? false,
    anyTimeout: over.anyTimeout ?? false,
    anyBlocked: over.anyBlocked ?? false,
    esAgregador: over.esAgregador ?? false,
  };
}

describe('esDominioAgregador', () => {
  it('detecta agregadores conocidos', () => {
    expect(esDominioAgregador('https://www.msn.com/es-mx/x')).toBe(true);
    expect(esDominioAgregador('https://news.google.com/x')).toBe(true);
  });
  it('no marca medios normales', () => {
    expect(esDominioAgregador('https://www.informador.mx')).toBe(false);
    expect(esDominioAgregador(null)).toBe(false);
  });
});

describe('esNewsSitemap', () => {
  it('reconoce news-sitemaps', () => {
    expect(esNewsSitemap('https://m.mx/news-sitemap.xml')).toBe(true);
    expect(esNewsSitemap('https://m.mx/sitemaps/googlenews.xml')).toBe(true);
    expect(esNewsSitemap('https://m.mx/sitemap_index.xml')).toBe(false);
  });
});

describe('urlsCandidatas', () => {
  it('antepone fuentes configuradas y prioriza news-sitemap sobre índice', () => {
    const c = urlsCandidatas({ url_base: 'https://m.mx/', rss_url: 'https://m.mx/feed-custom', sitemap_url: null });
    expect(c.rss[0]).toBe('https://m.mx/feed-custom');
    expect(c.sitemap.indexOf('https://m.mx/news-sitemap.xml'))
      .toBeLessThan(c.sitemap.indexOf('https://m.mx/sitemap_index.xml'));
    expect(c.robots).toBe('https://m.mx/robots.txt');
  });
});

describe('confianzaFuente', () => {
  it('fuente fuerte y reciente → alta confianza', () => {
    expect(confianzaFuente(fuente({ items: 50, recientes: 20, dominioOk: true }), false)).toBeGreaterThanOrEqual(0.9);
  });
  it('dominio incorrecto baja mucho la confianza', () => {
    expect(confianzaFuente(fuente({ dominioOk: false }), false)).toBeLessThan(0.7);
  });
  it('índice masivo con news-sitemap mejor disponible → fuerte penalización', () => {
    expect(confianzaFuente(fuente({ tipo: 'sitemap', esIndiceMasivo: true, items: 1000 }), true)).toBeLessThan(0.7);
  });
  it('pocos items → baja confianza', () => {
    expect(confianzaFuente(fuente({ items: 3 }), false)).toBeLessThan(0.7);
  });
});

describe('cumpleEstricto', () => {
  it('exige items, frescura, dominio y no-índice', () => {
    expect(cumpleEstricto(fuente({ items: 20, recientes: 5, dominioOk: true }))).toBe(true);
    expect(cumpleEstricto(fuente({ items: 5 }))).toBe(false);
    expect(cumpleEstricto(fuente({ recientes: 0, fechasDisponibles: true }))).toBe(false);
    expect(cumpleEstricto(fuente({ dominioOk: false }))).toBe(false);
    expect(cumpleEstricto(fuente({ esIndiceMasivo: true }))).toBe(false);
  });
});

describe('clasificarFuenteMedio', () => {
  it('configurada funcionando → READY_KEEP_CURRENT (no tocar)', () => {
    const v = clasificarFuenteMedio(input({
      metodo_extraccion: 'sitemap', sitemap_url: 'https://m.mx/news-sitemap.xml',
      configurada: fuente({ tipo: 'sitemap', url: 'https://m.mx/news-sitemap.xml', items: 152, recientes: 30, esConfigurada: true }),
    }));
    expect(v.estado_fuente).toBe('READY_KEEP_CURRENT');
  });

  it('caso Forbes: configurada buena + alternativa índice masivo → READY_KEEP_CURRENT con aviso', () => {
    const v = clasificarFuenteMedio(input({
      metodo_extraccion: 'sitemap', sitemap_url: 'https://m.mx/news-sitemap.xml',
      configurada: fuente({ tipo: 'sitemap', url: 'https://m.mx/news-sitemap.xml', items: 152, recientes: 30, esConfigurada: true }),
      candidatas: [fuente({ tipo: 'sitemap', url: 'https://m.mx/sitemap_index.xml', items: 1000, esIndiceMasivo: true })],
    }));
    expect(v.estado_fuente).toBe('READY_KEEP_CURRENT');
    expect(v.accion_recomendada).toMatch(/índice masivo/i);
  });

  it('configurada es sitemap index resuelto → READY_SITEMAP_INDEX', () => {
    const v = clasificarFuenteMedio(input({
      metodo_extraccion: 'sitemap', sitemap_url: 'https://m.mx/sitemaps/indexnews.asp',
      configurada: fuente({ tipo: 'sitemap', url: 'https://m.mx/sitemaps/indexnews.asp', items: 60, recientes: 40, esConfigurada: true, esIndice: true }),
    }));
    expect(v.estado_fuente).toBe('READY_SITEMAP_INDEX');
    expect(v.accion_recomendada).toMatch(/SITEMAP_INDEX_RESOLVED/);
  });

  it('configurada rota + RSS alterno validado → REPAIRABLE_RSS_HIGH_CONFIDENCE', () => {
    const v = clasificarFuenteMedio(input({
      metodo_extraccion: 'sitemap',
      configurada: null,
      candidatas: [fuente({ tipo: 'rss', url: 'https://m.mx/feed', items: 30, recientes: 15, dominioOk: true })],
    }));
    expect(v.estado_fuente).toBe('REPAIRABLE_RSS_HIGH_CONFIDENCE');
    expect(v.confidence_score).toBeGreaterThanOrEqual(0.9);
  });

  it('alterna plausible pero confianza media → REPAIRABLE_NEEDS_REVIEW', () => {
    const v = clasificarFuenteMedio(input({
      configurada: null,
      candidatas: [fuente({ tipo: 'rss', items: 12, recientes: 0, fechasDisponibles: true, dominioOk: true })],
    }));
    expect(v.estado_fuente).toBe('REPAIRABLE_NEEDS_REVIEW');
  });

  it('solo índice masivo disponible → DO_NOT_TOUCH', () => {
    const v = clasificarFuenteMedio(input({
      configurada: null,
      candidatas: [fuente({ tipo: 'sitemap', url: 'https://m.mx/sitemap_index.xml', items: 1000, esIndiceMasivo: true })],
    }));
    expect(v.estado_fuente).toBe('DO_NOT_TOUCH');
  });

  it('proxy/JS sin fuente → PROXY_REQUIRED / JS_REQUIRED', () => {
    expect(clasificarFuenteMedio(input({ requiere_proxy: true })).estado_fuente).toBe('PROXY_REQUIRED');
    expect(clasificarFuenteMedio(input({ requiere_javascript: true })).estado_fuente).toBe('JS_REQUIRED');
  });

  it('sin feed pero página responde → DIRECT_EXTRACTION_ONLY', () => {
    expect(clasificarFuenteMedio(input({ directOk: true })).estado_fuente).toBe('DIRECT_EXTRACTION_ONLY');
  });

  it('bloqueo / timeout / nada', () => {
    expect(clasificarFuenteMedio(input({ anyBlocked: true })).estado_fuente).toBe('BLOCKED');
    expect(clasificarFuenteMedio(input({ anyTimeout: true })).estado_fuente).toBe('TIMEOUT');
    expect(clasificarFuenteMedio(input({})).estado_fuente).toBe('NO_FEED');
  });

  it('agregador → LOW_VALUE_AGGREGATOR aunque tenga feed', () => {
    const v = clasificarFuenteMedio(input({ esAgregador: true, candidatas: [fuente({ items: 50 })] }));
    expect(v.estado_fuente).toBe('LOW_VALUE_AGGREGATOR');
  });
});

describe('prioridadReparacion', () => {
  it('agregador → 4; READY/DO_NOT_TOUCH → 0', () => {
    expect(prioridadReparacion('LOW_VALUE_AGGREGATOR', 5, true)).toBe(4);
    expect(prioridadReparacion('READY_KEEP_CURRENT', 5, true)).toBe(0);
    expect(prioridadReparacion('DO_NOT_TOUCH', 5, true)).toBe(0);
  });
  it('high-confidence: gap+alto valor → 1; sin gap → 2', () => {
    expect(prioridadReparacion('REPAIRABLE_RSS_HIGH_CONFIDENCE', 3, true)).toBe(1);
    expect(prioridadReparacion('REPAIRABLE_SITEMAP_HIGH_CONFIDENCE', 0, false)).toBe(2);
  });
  it('needs-review → 3', () => {
    expect(prioridadReparacion('REPAIRABLE_NEEDS_REVIEW', 3, true)).toBe(3);
  });
});
