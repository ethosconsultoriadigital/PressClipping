/**
 * Overrides de extracción acotados por hostname.
 *
 * El extractor genérico sigue igual; estos ajustes se aplican DESPUÉS de
 * cargar el DOM y ANTES de la cascada article/main/contenedores.
 */
import type * as cheerio from 'cheerio';

export interface HostExtractionOverride {
  extraRemoveSelectors: string[];
  /** Quita nodos cuyo texto coincide, si no envuelven el artículo (≥3 <p>). */
  removeIfTextMatches?: RegExp;
  /**
   * Selectores de cuerpo preferidos para este host, evaluados ANTES de la
   * cascada article/main/contenedores. Evita que un <article> envolvente
   * (ads, related) gane sobre el contenedor real.
   */
  preferSelectors?: string[];
  /**
   * Si true, el contenedor preferido se lee como texto plano (tras quitar
   * ruido), no concatenando <p>. Necesario cuando el CMS no usa párrafos.
   */
  preferPlainText?: boolean;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

export function hostOverrideFromUrl(url: string): HostExtractionOverride | null {
  const host = hostnameOf(url);
  if (host === 'posta.com.mx') {
    return {
      extraRemoveSelectors: [
        '.resumen_nota',
        '.disclaimer-texto',
        '.ia-after-typing',
        '.nota-relacionada',
      ],
      removeIfTextMatches:
        /Resumen y análisis automáticos realizados con Inteligencia Artificial/i,
    };
  }
  if (host === 'eldiariodechihuahua.mx') {
    return {
      extraRemoveSelectors: [
        'ins.adsbygoogle',
        '.publicidad',
        '[class*="publicidad"]',
        '.article-snippet',
      ],
      preferSelectors: ['.article-body'],
      removeIfTextMatches: /^\s*Publicidad\s*$/i,
    };
  }
  if (host === 'contrareplica.mx') {
    return {
      extraRemoveSelectors: ['ins.adsbygoogle', '.twitter-follow-button', 'style'],
      preferSelectors: ['.inicionota .contrareplica-9', '.inicionota', '.topContent'],
      preferPlainText: true,
    };
  }
  if (host === 'xataka.com.mx') {
    return {
      extraRemoveSelectors: [
        '.p-a-card',
        '.js-author-info',
        '.js-authors-container',
        '.author-avatar',
      ],
      preferSelectors: ['.article-content'],
      removeIfTextMatches:
        /En Xataka Selección publicamos ofertas y descuentos/i,
    };
  }
  if (host === 'rompeviento.tv') {
    return {
      extraRemoveSelectors: ['.single-post-share', '.share-holder', '.post-share'],
      removeIfTextMatches:
        /síguenos en nuestras redes sociales|facebook\.com\/rompeviento|instagram\.com\/rompevientotv|tiktok\.com\/@rompevientotv|t\.me\/rompevientotv|threads\.net\/@rompevientotv|posts by rompeviento/i,
    };
  }
  if (host === 'diariodelyaqui.mx') {
    return {
      extraRemoveSelectors: [
        '.ia-content',
        '.acordeon-content',
        '.related-posts',
        '.single_related_post',
        '.espacio-publicidad',
        'div.font-asap.select-none',
      ],
      preferSelectors: ['.post_content', '.single_post_entry_content', '.jl_content'],
      removeIfTextMatches:
        /Resumen y análisis automáticos realizados con Inteligencia Artificial|¿Fue útil este resumen\?|Desarrollado por SACS IA|Este resumen y su análisis fueron generados con apoyo de Inteligencia Artificial/i,
    };
  }
  return null;
}

export function applyHostOverride(
  $: cheerio.CheerioAPI,
  override: HostExtractionOverride | null,
): void {
  if (!override) return;
  if (override.extraRemoveSelectors.length > 0) {
    $(override.extraRemoveSelectors.join(', ')).remove();
  }
  const re = override.removeIfTextMatches;
  if (!re) return;
  $('article p, main p, body p').each((_, el) => {
    const t = $(el).text();
    if (t.length < 600 && re.test(t)) $(el).remove();
  });
  $('article div, main div, body div').each((_, el) => {
    const $el = $(el);
    if ($el.find('p').length >= 3) return;
    if (re.test($el.text())) $el.remove();
  });
}
