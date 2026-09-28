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
  $('article p, main p').each((_, el) => {
    const t = $(el).text();
    if (t.length < 600 && re.test(t)) $(el).remove();
  });
  $('article div, main div').each((_, el) => {
    const $el = $(el);
    if ($el.find('p').length >= 3) return;
    if (re.test($el.text())) $el.remove();
  });
}
