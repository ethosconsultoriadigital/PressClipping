/**
 * Filtros de URL estrictamente acotados por medio_id.
 *
 * Rechazan páginas que no son notas periodísticas (hubs /temas/, archives de
 * tag/category, caricaturas Cartucho, homepage) para que no entren al crawl.
 * No aplican a otros medios aunque el path coincida.
 */

function parseUrl(url: string): { host: string; path: string } | null {
  try {
    const u = new URL(url);
    return {
      host: u.hostname.replace(/^www\./i, '').toLowerCase(),
      path: u.pathname,
    };
  } catch {
    return null;
  }
}

/**
 * true = no ingestizar esta URL para este medio.
 * false = dejar pasar (incluye URLs malformadas: el normalizador ya las descarta).
 */
export function shouldRejectCrawlUrl(medioId: string, url: string): boolean {
  const parsed = parseUrl(url);
  if (!parsed) return false;
  const path = parsed.path;

  switch (medioId) {
    case 'MED-0031': // Proceso — hubs de tema, no artículos
      return /^\/temas\//i.test(path);
    case 'MED-0181': // MVS Noticias — mismos hubs /temas/
      return /^\/temas\//i.test(path);
    case 'MED-0113': // Jalisco TV / Jalisco Noticias — archives WP
      return /^\/(tag|category)\//i.test(path);
    case 'MED-0017': // El Informador — tira cómica Cartucho, no artículo
      return /\/cartucho-h/i.test(path);
    case 'MED-0305': // Grupomarmor — homepage y landing de radio
      {
        const p = path.replace(/\/+$/, '') || '/';
        return p === '/' || p === '/radio-grupo-marmor';
      }
    default:
      return false;
  }
}
