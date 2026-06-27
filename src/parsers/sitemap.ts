/**
 * Parser de sitemaps XML → RawItem[].
 *
 * Soporta:
 *  - urlset (sitemap normal): <url><loc>, <lastmod>
 *  - sitemap de noticias: <news:news><news:title>, <news:publication_date>
 *  - sitemapindex: lista de sub-sitemaps; se resuelven hasta `maxIndexFollow`.
 */
import { XMLParser } from 'fast-xml-parser';
import { fetchText } from '../utils/http.js';
import type { RawItem } from '../normalizers/noticia.js';

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true, // news:title -> title, news:news -> news
  isArray: (name) => name === 'url' || name === 'sitemap',
});

interface SitemapUrl {
  loc?: string;
  lastmod?: string;
  news?: {
    title?: string;
    publication_date?: string;
    publication?: { name?: string };
  };
}

function asText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return String(v).trim() || null;
}

/** Parsea una cadena XML de sitemap. Devuelve items y/o sub-sitemaps. */
export function parseSitemapString(xml: string): {
  items: RawItem[];
  subSitemaps: string[];
} {
  const doc = parser.parse(xml) as Record<string, any>;

  // Índice de sitemaps
  if (doc.sitemapindex?.sitemap) {
    const subs: string[] = [];
    for (const s of doc.sitemapindex.sitemap as { loc?: string }[]) {
      const loc = asText(s.loc);
      if (loc) subs.push(loc);
    }
    return { items: [], subSitemaps: subs };
  }

  // Sitemap normal
  const urls: SitemapUrl[] = doc.urlset?.url ?? [];
  const items: RawItem[] = [];
  for (const u of urls) {
    const loc = asText(u.loc);
    if (!loc) continue;
    items.push({
      url: loc,
      titulo: asText(u.news?.title),
      fecha: asText(u.news?.publication_date) ?? asText(u.lastmod),
      resumen: null,
    });
  }
  return { items, subSitemaps: [] };
}

/**
 * Ordena items por fecha descendente (más recientes primero).
 * Los items sin fecha quedan al final (no se pierden, pero no desplazan recientes).
 * Esto evita que `slice(0, limit)` descarte las notas nuevas cuando el
 * sitemap lista las URLs en orden ascendente o arbitrario.
 */
function ordenarPorFechaDesc(items: RawItem[]): RawItem[] {
  return [...items].sort((a, b) => {
    const fa = a.fecha ?? '';
    const fb = b.fecha ?? '';
    if (fa && fb) return fb.localeCompare(fa);
    if (fa) return -1; // a tiene fecha, va primero
    if (fb) return 1;  // b tiene fecha, va primero
    return 0;
  });
}

export interface ResolverSitemapOpts {
  /** Máximo de items a devolver (tras ordenar por fecha desc). */
  limit?: number;
  /** Máximo de sub-sitemaps a descargar en total (presupuesto global). */
  maxSubSitemaps?: number;
  /** Profundidad máxima de recursión de índices (1 = solo el raíz). */
  maxDepth?: number;
}

export interface ResolverSitemapResult {
  items: RawItem[];
  /** ¿El sitemap raíz era un <sitemapindex>? */
  esIndice: boolean;
  /** Número de sub-sitemaps efectivamente descargados. */
  subsVisitados: number;
  /** Sub-sitemaps que fallaron (bloqueados / rotos). */
  subsFallidos: number;
}

/**
 * Resuelve un sitemap (normal o index) usando un `fetcher` inyectable
 * (testeable sin red). Soporta índices con recursión controlada:
 *  - Hasta `maxSubSitemaps` descargas de sub-sitemaps (presupuesto global).
 *  - Hasta `maxDepth` niveles de índice (un sub-sitemap puede ser otro índice).
 *  - Deduplica URLs por `loc`.
 *  - Un sub-sitemap roto/bloqueado no tumba la resolución.
 */
export async function resolverSitemap(
  rootUrl: string,
  fetcher: (url: string) => Promise<string>,
  opts: ResolverSitemapOpts = {},
): Promise<ResolverSitemapResult> {
  const { limit = 200, maxSubSitemaps = 20, maxDepth = 2 } = opts;
  const vistos = new Set<string>();           // sub-sitemaps ya descargados (evita ciclos)
  const urlsVistas = new Set<string>();       // dedupe de URLs de notas
  const acumulado: RawItem[] = [];
  let esIndiceRaiz = false;
  let subsVisitados = 0;
  let subsFallidos = 0;

  const raizXml = await fetcher(rootUrl);
  const raiz = parseSitemapString(raizXml);

  const pushItems = (items: RawItem[]): void => {
    for (const it of items) {
      if (it.url && urlsVistas.has(it.url)) continue;
      if (it.url) urlsVistas.add(it.url);
      acumulado.push(it);
    }
  };

  if (raiz.items.length > 0 || raiz.subSitemaps.length === 0) {
    pushItems(raiz.items);
    return { items: ordenarPorFechaDesc(acumulado).slice(0, limit), esIndice: false, subsVisitados, subsFallidos };
  }

  esIndiceRaiz = true;
  // BFS por niveles respetando maxDepth y el presupuesto de descargas.
  let nivel: string[] = raiz.subSitemaps.slice();
  let depth = 1; // el raíz ya consumió el nivel 0
  while (nivel.length > 0 && depth < maxDepth && subsVisitados < maxSubSitemaps) {
    const siguiente: string[] = [];
    for (const sub of nivel) {
      if (subsVisitados >= maxSubSitemaps) break;
      if (vistos.has(sub)) continue;
      vistos.add(sub);
      subsVisitados += 1;
      try {
        const parsed = parseSitemapString(await fetcher(sub));
        pushItems(parsed.items);
        if (parsed.subSitemaps.length > 0) siguiente.push(...parsed.subSitemaps);
      } catch {
        subsFallidos += 1;
      }
    }
    nivel = siguiente;
    depth += 1;
  }

  return { items: ordenarPorFechaDesc(acumulado).slice(0, limit), esIndice: esIndiceRaiz, subsVisitados, subsFallidos };
}

/**
 * Descarga y parsea un sitemap, resolviendo índices (sub-sitemaps) con
 * recursión controlada (profundidad y presupuesto de descargas) y dedupe.
 * Los items se ordenan por fecha descendente antes de aplicar `limit`.
 */
export async function fetchSitemap(
  url: string,
  opts: { limit?: number; maxSubSitemaps?: number; maxDepth?: number } = {},
): Promise<RawItem[]> {
  const { items } = await resolverSitemap(url, fetchText, opts);
  return items;
}
