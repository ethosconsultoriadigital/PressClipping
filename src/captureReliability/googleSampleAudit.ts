import { nextUnusedSurface } from './sitemapCursor.js';

export type GoogleSamplePath = 'PAGINATE_FROM_CURSOR' | 'SECOND_SURFACE' | 'SURFACE_PROBE' | 'UNRESOLVED';

export interface SoloGoogleSample {
  url: string;
  medio_id: string;
  rss: boolean;
  sitemap: boolean;
  listing: boolean;
  paywall: boolean;
  path: GoogleSamplePath;
  cause: string;
}

/** 11 SOLO_GOOGLE already identified. Classification is read-only; Google redirect is never a recovery target. */
export const SOLO_GOOGLE_SAMPLE: SoloGoogleSample[] = [
  {
    url: 'https://www.nmas.com.mx/ciudad-de-mexico/movilidad/marchas/llaman-huelga-nacional-imss-trabajadores-demandan-mejoras-laborales-en-2026',
    medio_id: 'MED-0178',
    rss: false,
    sitemap: true,
    listing: false,
    paywall: false,
    path: 'PAGINATE_FROM_CURSOR',
    cause: 'sitemap_only_may_need_later_page',
  },
  {
    url: 'https://www.jornada.com.mx/noticia/2026/10/08/estados/durango-mina-san-dimas-entra-en-huelga-tras-paro-iniciado-el-18-de-septiembre',
    medio_id: 'MED-0029',
    rss: true,
    sitemap: true,
    listing: false,
    paywall: false,
    path: 'SECOND_SURFACE',
    cause: 'rss_first_surface_miss_sitemap_available',
  },
  {
    url: 'https://www.vozenred.com/2015/notas.php?i=412999',
    medio_id: 'MED-0021',
    rss: false,
    sitemap: false,
    listing: true,
    paywall: false,
    path: 'SURFACE_PROBE',
    cause: 'no_rss_no_sitemap_probe_listing_home',
  },
  {
    url: 'https://www.jornada.com.mx/noticia/2026/10/08/sociedad/sindicato-minero-estalla-huelga-en-mina-toyoltita-en-durango-denuncia-violaciones-al-cct',
    medio_id: 'MED-0029',
    rss: true,
    sitemap: true,
    listing: false,
    paywall: false,
    path: 'SECOND_SURFACE',
    cause: 'rss_first_surface_miss_sitemap_available',
  },
  {
    url: 'https://www.nmas.com.mx/tamaulipas/sociedad/reabre-el-nacional-monte-de-piedad-tras-casi-un-ano-de-huelga-en-matamoros-tamaulipas',
    medio_id: 'MED-0178',
    rss: false,
    sitemap: true,
    listing: false,
    paywall: false,
    path: 'PAGINATE_FROM_CURSOR',
    cause: 'sitemap_only_may_need_later_page',
  },
  {
    url: 'https://lasillarota.com/hidalgo/estado/2026/10/8/exalcalde-de-hidalgo-inicia-huelga-de-hambre-desde-la-carcel-por-este-motivo-532180.html',
    medio_id: 'MED-0191',
    rss: false,
    sitemap: true,
    listing: false,
    paywall: false,
    path: 'PAGINATE_FROM_CURSOR',
    cause: 'sitemap_only_may_need_later_page',
  },
  {
    url: 'https://www.record.com.mx/historia/el-reporte-ponce-atlas-esta-por-empatar-a-chivas-2026100906422718748',
    medio_id: 'MED-0238',
    rss: true,
    sitemap: false,
    listing: true,
    paywall: false,
    path: 'SECOND_SURFACE',
    cause: 'rss_only_listing_available',
  },
  {
    url: 'https://www.publimetro.com.mx/entretenimiento/2026/10/09/atlas-vs-chivas-te-regalamos-boletos',
    medio_id: 'MED-0053',
    rss: true,
    sitemap: true,
    listing: false,
    paywall: false,
    path: 'SECOND_SURFACE',
    cause: 'rss_first_surface_miss_sitemap_available',
  },
  {
    url: 'https://www.reforma.com/prohibido-perder-para-santi-sandoval-y-menos-contra-el-atlas/ar3291352',
    medio_id: 'MED-0027',
    rss: false,
    sitemap: false,
    listing: false,
    paywall: true,
    path: 'UNRESOLVED',
    cause: 'no_discovery_surface_paywall_probe_unlikely',
  },
  {
    url: 'https://www.mural.com.mx/exigen-vecinos-conocer-proyecto-de-estadio-del-atlas/ar3291317',
    medio_id: 'MED-0037',
    rss: false,
    sitemap: false,
    listing: true,
    paywall: false,
    path: 'SURFACE_PROBE',
    cause: 'no_rss_no_sitemap_probe_home_sections',
  },
  {
    url: 'https://lucesdelsiglo.com/2026/10/09/cancun-esta-a-la-vanguardia-con-atlas-de-riesgos-moderno-y-al-dia-local',
    medio_id: 'MED-0275',
    rss: true,
    sitemap: false,
    listing: true,
    paywall: false,
    path: 'SECOND_SURFACE',
    cause: 'rss_only_listing_available',
  },
];

export function classifySoloGoogleFollowUp(sample: Pick<SoloGoogleSample, 'rss' | 'sitemap' | 'listing' | 'paywall'>): GoogleSamplePath {
  if (sample.paywall && !sample.rss && !sample.sitemap && !sample.listing) return 'UNRESOLVED';
  if (!sample.rss && !sample.sitemap) return 'SURFACE_PROBE';
  if (sample.rss && nextUnusedSurface(['rss'], [
    ...(sample.sitemap ? ['sitemap'] : []),
    ...(sample.rss ? ['rss'] : []),
    ...(sample.listing ? ['listing'] : []),
  ])) {
    return 'SECOND_SURFACE';
  }
  if (sample.sitemap && !sample.rss) return 'PAGINATE_FROM_CURSOR';
  if (sample.sitemap) return 'PAGINATE_FROM_CURSOR';
  return 'UNRESOLVED';
}

export function groupSoloGoogleSample(rows = SOLO_GOOGLE_SAMPLE) {
  return {
    pagination: rows.filter((r) => r.path === 'PAGINATE_FROM_CURSOR'),
    secondSurface: rows.filter((r) => r.path === 'SECOND_SURFACE'),
    probe: rows.filter((r) => r.path === 'SURFACE_PROBE'),
    unresolved: rows.filter((r) => r.path === 'UNRESOLVED'),
  };
}
