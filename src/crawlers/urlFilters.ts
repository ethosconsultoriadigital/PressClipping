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
    case 'MED-0072': // San Luis Hoy — portada de versión impresa, no nota
      return /^\/version-impresa\//i.test(path);
    case 'MED-0316': // Meridiano — PDF/galería de edición impresa
      return /\/edicion-impresa-/i.test(path);
    case 'MED-0101': // Independiente BCS — RSS reinyecta archivo 2018; sitemap es homepage
      {
        const p = path.replace(/\/+$/, '') || '/';
        return p === '/' || /\/2018\//i.test(path);
      }
    case 'MED-0012': // Paralelo 19 — Yoast mezcla listados (/blog, /tag, secciones) con notas
      {
        const p = path.replace(/\/+$/, '') || '/';
        if (p === '/' || p === '/blog') return true;
        if (/^\/(tag|category)\//i.test(path)) return true;
        // Las notas reales llevan fecha /YYYY/MM/DD/ en el path.
        return !/\/20\d{2}\/\d{2}\/\d{2}\//.test(path);
      }
    default:
      return false;
  }
}
