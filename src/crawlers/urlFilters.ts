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
    case 'MED-0181': // MVS Noticias — hubs /temas/ y fichas de autor, no artículos
      return /^\/(temas|autor)\//i.test(path);
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
    case 'MED-0160': // El Diario de Chihuahua — /cartones/ es viñeta, no nota
      return /\/cartones\//i.test(path);
    case 'MED-0166': // Hidrocálido Digital — portadas de edición impresa / paywall login
      return /\/hidrocalido-\d/i.test(path);
    case 'MED-0182': // Diario de Yucatán — /juegos/ es pasatiempo/paywall, no nota
      return /^\/juegos\//i.test(path);
    case 'MED-0012': // Paralelo 19 — Yoast mezcla listados (/blog, /tag, secciones) con notas
      {
        const p = path.replace(/\/+$/, '') || '/';
        if (p === '/' || p === '/blog') return true;
        if (/^\/(tag|category)\//i.test(path)) return true;
        // Las notas reales llevan fecha /YYYY/MM/DD/ en el path.
        return !/\/20\d{2}\/\d{2}\/\d{2}\//.test(path);
      }
    case 'MED-0410': // El Valle — portada impresa y slugs emoji, no nota
      return (
        /edicion-numero-/i.test(path) ||
        /%f0%9f/i.test(url) ||
        /[\u{1F300}-\u{1FAFF}]/u.test(path)
      );
    case 'MED-0401': // Capital 21 — sitemap es chrome institucional, no notas
      {
        const p = path.replace(/\/+$/, '') || '/';
        if (p === '/') return true;
        return /^\/(transparencia|en-vivo|programacion|directorio|administracion|nosotros|avisosdeprivacidad|gobiernoc21|atencion)(\/|$)/i.test(
          p,
        );
      }
    case 'MED-0419': // El Piñero — sitemap_index mezcló granja SEO + chrome
      {
        const p = path.replace(/\/+$/, '') || '/';
        if (p === '/' || p === '/contact' || p === '/about' || p === '/cookie-policy') return true;
        return /badminton/i.test(path);
      }
    case 'MED-0420': // e-Veracruz — homepage y hubs de sección de 1 segmento
      {
        const segs = path.replace(/\/+$/, '').split('/').filter(Boolean);
        return segs.length < 2;
      }
    case 'MED-0425': // Al Diálogo — sitemap es hubs, no notas
      {
        const p = path.replace(/\/+$/, '') || '/';
        if (p === '/' || p === '/etiqueta' || p === '/impreso' || p === '/contacto.tsx') return true;
        return /^\/(categoria|etiqueta)(\/|$)/i.test(p);
      }
    case 'MED-0450': // Punto Medio — sitemap_index mezcló /blog y edición impresa
      {
        const p = path.replace(/\/+$/, '') || '/';
        if (p === '/' || p === '/blog') return true;
        return /\/edicion-impresa/i.test(path);
      }
    case 'MED-0462': // Sinaloa en Línea — columnas sin cuerpo editorial
      return /\/en-el-blanco-por-/i.test(path) || /mexico-no-solo-es-corrupto/i.test(path);
    default:
      return false;
  }
}
