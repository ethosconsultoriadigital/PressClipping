import { describe, it, expect, vi, beforeEach } from 'vitest';
import { shouldRejectCrawlUrl } from '../src/crawlers/urlFilters.js';
import { crawlMedio } from '../src/crawlers/index.js';
import type { MedioRow } from '../src/supabase/repositories.js';

describe('shouldRejectCrawlUrl — listing/non-article, scoped by medio_id', () => {
  it('BEFORE: Proceso /temas/ hub is a listing; AFTER: rejected only for MED-0031', () => {
    const listing = 'https://www.proceso.com.mx/temas/periodistas-asesinados-15393.html';
    const article =
      'https://www.proceso.com.mx/nacional/2026/9/24/en-duda-el-huachicol-de-guanajuato-fgr-aun-revisa-permisos-de-los-59-millones-de-litros-380556.html';
    expect(shouldRejectCrawlUrl('MED-0031', listing)).toBe(true);
    expect(shouldRejectCrawlUrl('MED-0031', article)).toBe(false);
    expect(shouldRejectCrawlUrl('MED-0008', listing)).toBe(false);
  });

  it('MVS /temas/ rejected only for MED-0181', () => {
    const listing = 'https://mvsnoticias.com/temas/cdmx-14632.html';
    const article =
      'https://mvsnoticias.com/mundo/2026/9/23/alemania-aumenta-en-42-mil-efectivos-sus-fuerzas-armadas-747125.html';
    expect(shouldRejectCrawlUrl('MED-0181', listing)).toBe(true);
    expect(shouldRejectCrawlUrl('MED-0181', article)).toBe(false);
    expect(shouldRejectCrawlUrl('MED-0008', listing)).toBe(false);
  });

  it('Jalisco TV tag/category rejected; article slug kept', () => {
    expect(shouldRejectCrawlUrl('MED-0113', 'https://jaliscotv.com/tag/in-drive/')).toBe(true);
    expect(shouldRejectCrawlUrl('MED-0113', 'https://jaliscotv.com/category/campo/')).toBe(true);
    expect(shouldRejectCrawlUrl('MED-0113', 'https://jaliscotv.com/primer-duelo-de-pretemporada/')).toBe(
      false,
    );
    expect(shouldRejectCrawlUrl('MED-0005', 'https://jaliscotv.com/tag/in-drive/')).toBe(false);
  });

  it('Informador Cartucho cartoon rejected; news article kept', () => {
    expect(shouldRejectCrawlUrl('MED-0017', 'https://www.informador.mx/cartucho-h202609280001.html')).toBe(
      true,
    );
    expect(
      shouldRejectCrawlUrl(
        'MED-0017',
        'https://www.informador.mx/internacional/artico-zona-de-interes-mundial-que-podria-detonar-conflictos-especialistas-20260921-0183.html',
      ),
    ).toBe(false);
  });

  it('Grupomarmor homepage and radio landing rejected; dated posts kept', () => {
    expect(shouldRejectCrawlUrl('MED-0305', 'https://grupomarmor.com.mx/')).toBe(true);
    expect(shouldRejectCrawlUrl('MED-0305', 'https://grupomarmor.com.mx/radio-grupo-marmor/')).toBe(true);
    expect(shouldRejectCrawlUrl('MED-0305', 'https://grupomarmor.com.mx/2026/09/28/alguna-nota/')).toBe(
      false,
    );
  });

  it('Punto por Punto /secciones/article is NOT a listing (does not reject)', () => {
    expect(
      shouldRejectCrawlUrl(
        'MED-0212',
        'https://www.puntoporpunto.com/secciones/punto-g/autosexual-la-atraccion-por-uno-mismo/',
      ),
    ).toBe(false);
  });
});

vi.mock('../src/parsers/rss.js', () => ({ fetchRss: vi.fn() }));
vi.mock('../src/parsers/sitemap.js', () => ({ fetchSitemap: vi.fn() }));

import { fetchRss } from '../src/parsers/rss.js';
import { fetchSitemap } from '../src/parsers/sitemap.js';

const mockedFetchRss = fetchRss as unknown as ReturnType<typeof vi.fn>;
const mockedFetchSitemap = fetchSitemap as unknown as ReturnType<typeof vi.fn>;

function medio(over: Partial<MedioRow> = {}): MedioRow {
  return {
    medio_id: 'MED-0031',
    nombre_medio: 'Proceso',
    url_base: 'https://www.proceso.com.mx',
    metodo_extraccion: 'sitemap',
    rss_url: null,
    sitemap_url: 'https://www.proceso.com.mx/sitemaps/index.xml',
    secciones_urls: null,
    requiere_javascript: false,
    requiere_proxy: false,
    frecuencia_minutos: null,
    pais: 'MX',
    estado: null,
    municipio: null,
    region: null,
    prioridad: null,
    ultimo_estado: null,
    ultimo_scrapeo: null,
    ...over,
  };
}

describe('crawlMedio aplica filtro medio-específico sin tumbar artículos', () => {
  beforeEach(() => {
    mockedFetchRss.mockReset();
    mockedFetchSitemap.mockReset();
  });

  it('Proceso sitemap con hub /temas/ + artículo: solo el artículo llega a items', async () => {
    mockedFetchSitemap.mockResolvedValue([
      { url: 'https://www.proceso.com.mx/temas/xi-jinping-2440.html' },
      {
        url: 'https://www.proceso.com.mx/opinion/2026/9/28/pri-sobrevivir-o-desaparecer-380784.html',
      },
    ]);
    const result = await crawlMedio(medio(), 25);
    expect(result.estado).toBe('ok');
    expect(result.urls_detectadas).toBe(2);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.url_original).toContain('/opinion/');
  });

  it('otro medio con path /temas/ no se filtra (no blast radius)', async () => {
    mockedFetchRss.mockResolvedValue([{ url: 'https://www.proceso.com.mx/temas/xi-jinping-2440.html' }]);
    const result = await crawlMedio(medio({ medio_id: 'MED-0008', metodo_extraccion: 'rss', rss_url: 'https://x/rss' }), 25);
    expect(result.items).toHaveLength(1);
  });
});

describe('Wave 2 URL filters — print/archive, medio-scoped', () => {
  it('San Luis Hoy version-impresa rejected; city article kept', () => {
    expect(
      shouldRejectCrawlUrl('MED-0072', 'https://sanluishoy.com.mx/version-impresa/22-de-septiembre-3/133777/'),
    ).toBe(true);
    expect(
      shouldRejectCrawlUrl(
        'MED-0072',
        'https://sanluishoy.com.mx/ciudad/en-slp-esperan-90-pacientes-una-cornea-y-75-un-rinon/135059/',
      ),
    ).toBe(false);
    expect(
      shouldRejectCrawlUrl('MED-0008', 'https://sanluishoy.com.mx/version-impresa/22-de-septiembre-3/133777/'),
    ).toBe(false);
  });

  it('Meridiano edicion-impresa rejected; dated news kept', () => {
    expect(
      shouldRejectCrawlUrl(
        'MED-0316',
        'https://meridiano.mx/2026/09/28/edicion-impresa-28-de-septiembre-de-2026/',
      ),
    ).toBe(true);
    expect(
      shouldRejectCrawlUrl('MED-0316', 'https://meridiano.mx/2026/09/28/alguna-nota-de-nayarit/'),
    ).toBe(false);
  });

  it('Independiente BCS 2018 archive rejected; other years not this rule', () => {
    expect(
      shouldRejectCrawlUrl(
        'MED-0101',
        'https://www.diarioelindependiente.mx/2018/09/investigan-a-empresa-de-ramos-arizpe-por-posible-huachicol',
      ),
    ).toBe(true);
    expect(
      shouldRejectCrawlUrl(
        'MED-0101',
        'https://www.diarioelindependiente.mx/2026/09/nota-actual',
      ),
    ).toBe(false);
    expect(shouldRejectCrawlUrl('MED-0101', 'https://www.diarioelindependiente.mx/')).toBe(true);
  });

  it('Paralelo 19 listings rejected; dated article path kept', () => {
    expect(shouldRejectCrawlUrl('MED-0012', 'https://paralelo19.tv/blog/')).toBe(true);
    expect(shouldRejectCrawlUrl('MED-0012', 'https://paralelo19.tv/blog')).toBe(true);
    expect(shouldRejectCrawlUrl('MED-0012', 'https://paralelo19.tv/tag/morena-tlaxcala/')).toBe(true);
    expect(shouldRejectCrawlUrl('MED-0012', 'https://paralelo19.tv/puebla/estado/')).toBe(true);
    expect(
      shouldRejectCrawlUrl(
        'MED-0012',
        'https://paralelo19.tv/puebla/estado/2026/09/29/armenta-felicita-ana-lilia-rivera-candidata-morena-tlaxcala/',
      ),
    ).toBe(false);
    expect(
      shouldRejectCrawlUrl(
        'MED-0012',
        'https://paralelo19.tv/tendencia/2023/05/12/belinda-se-presento-con-exito-en-el-teatro-del-pueblo/',
      ),
    ).toBe(false);
    expect(shouldRejectCrawlUrl('MED-0008', 'https://paralelo19.tv/blog/')).toBe(false);
  });
});
