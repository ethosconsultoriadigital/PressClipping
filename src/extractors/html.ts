/**
 * Extractor HTML genérico y reutilizable.
 *
 * Parsea HTML estático (sin JS ni navegador headless) y extrae los campos
 * útiles de una nota con una cascada de prioridades robusta entre medios:
 *   - Título:  og:title -> twitter:title -> <title> -> <h1> -> fallback slug URL
 *   - Resumen: meta[description] -> og:description -> primeros párrafos limpios
 *   - Texto:   <article> -> <main> -> contenedores comunes -> párrafos <p>
 *   - Imagen:  og:image -> twitter:image
 *   - Autor/sección: metadatos si existen (no rompe si faltan)
 *
 * `extractFromHtml` es PURO (recibe el HTML como string): ideal para tests con
 * fixtures sin red. `fetchAndExtract` añade la descarga HTTP con timeout y
 * manejo de error por URL (nunca lanza: encapsula el fallo en el resultado).
 */
import * as cheerio from 'cheerio';
import { fetchText } from '../utils/http.js';
import { tituloDesdeUrl } from './titleFromUrl.js';

/** Método con el que se obtuvo el título. */
export type MetodoTitulo =
  | 'html_og'
  | 'html_twitter'
  | 'html_title'
  | 'html_h1'
  | 'fallback_url_slug'
  | null;

/** Método con el que se obtuvo el cuerpo de texto. */
export type MetodoTexto =
  | 'html_article'
  | 'html_main'
  | 'html_container'
  | 'html_paragraphs'
  | null;

export interface HtmlExtract {
  titulo: string | null;
  resumen: string | null;
  texto_extraido: string | null;
  imagen: string | null;
  autor: string | null;
  seccion: string | null;
  metodo_titulo: MetodoTitulo;
  metodo_texto: MetodoTexto;
}

export interface ExtractOpts {
  /** Tope de caracteres para `texto_extraido` (default 20000). */
  maxChars?: number;
}

/** Límite por defecto de caracteres para el texto completo. */
export const DEFAULT_MAX_CHARS = 20000;

/** Selectores de contenedores de artículo frecuentes entre CMS de medios. */
const CONTENEDORES_ARTICULO = [
  '[itemprop="articleBody"]',
  '.article-body',
  '.articleBody',
  '.entry-content',
  '.post-content',
  '.post-body',
  '.nota-cuerpo',
  '.cuerpo-nota',
  '.cuerpo',
  '.contenido-nota',
  '#article-body',
  '.story-body',
  '.content-body',
];

/** Elementos de "ruido" que nunca aportan al cuerpo de la nota. */
const RUIDO = 'script, style, noscript, nav, header, footer, aside, form, iframe, .ad, .ads, .advertisement, .publicidad, .related, .relacionadas, .newsletter, .social, .share, .comments, figure figcaption';

function limpiarTexto(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function recortar(s: string, max: number): string {
  if (s.length <= max) return s;
  // Corta en el último espacio antes del tope para no partir una palabra.
  return s.slice(0, max).replace(/\s+\S*$/, '');
}

function primerMeta($: cheerio.CheerioAPI, selectores: string[]): string | null {
  for (const sel of selectores) {
    const v = $(sel).attr('content');
    const limpio = v ? limpiarTexto(v) : '';
    if (limpio) return limpio;
  }
  return null;
}

function extraerTitulo(
  $: cheerio.CheerioAPI,
  url: string,
): { titulo: string | null; metodo: MetodoTitulo } {
  const og = primerMeta($, ['meta[property="og:title"]', 'meta[name="og:title"]']);
  if (og) return { titulo: og, metodo: 'html_og' };

  const tw = primerMeta($, ['meta[name="twitter:title"]', 'meta[property="twitter:title"]']);
  if (tw) return { titulo: tw, metodo: 'html_twitter' };

  const titleTag = limpiarTexto($('title').first().text());
  if (titleTag) return { titulo: titleTag, metodo: 'html_title' };

  const h1 = limpiarTexto($('h1').first().text());
  if (h1) return { titulo: h1, metodo: 'html_h1' };

  const slug = tituloDesdeUrl(url);
  if (slug) return { titulo: slug, metodo: 'fallback_url_slug' };

  return { titulo: null, metodo: null };
}

function extraerImagen($: cheerio.CheerioAPI): string | null {
  return primerMeta($, [
    'meta[property="og:image"]',
    'meta[name="og:image"]',
    'meta[name="twitter:image"]',
    'meta[property="twitter:image"]',
    'meta[name="twitter:image:src"]',
  ]);
}

function extraerAutor($: cheerio.CheerioAPI): string | null {
  const meta = primerMeta($, [
    'meta[name="author"]',
    'meta[property="article:author"]',
    'meta[name="article:author"]',
  ]);
  if (meta) return meta;

  const rel = limpiarTexto($('[rel="author"]').first().text());
  if (rel) return rel;

  const itemprop = limpiarTexto($('[itemprop="author"]').first().text());
  if (itemprop) return itemprop;

  return null;
}

function extraerSeccion($: cheerio.CheerioAPI): string | null {
  return primerMeta($, [
    'meta[property="article:section"]',
    'meta[name="article:section"]',
    'meta[name="section"]',
  ]);
}

/** Junta el texto de los <p> de un contenedor, filtrando ruido y vacíos. */
function textoDeContenedor($: cheerio.CheerioAPI, $cont: cheerio.Cheerio<any>): string {
  $cont.find(RUIDO).remove();
  const parrafos: string[] = [];
  $cont.find('p').each((_i, el) => {
    const t = limpiarTexto($(el).text());
    if (t.length > 0) parrafos.push(t);
  });
  // Si no hay <p>, usa el texto plano del contenedor como último recurso.
  if (parrafos.length === 0) {
    const plano = limpiarTexto($cont.text());
    return plano;
  }
  return parrafos.join('\n\n');
}

function extraerTexto(
  $: cheerio.CheerioAPI,
  maxChars: number,
): { texto: string | null; metodo: MetodoTexto } {
  const intentos: { sel: string; metodo: MetodoTexto }[] = [
    { sel: 'article', metodo: 'html_article' },
    { sel: 'main', metodo: 'html_main' },
    ...CONTENEDORES_ARTICULO.map((sel) => ({ sel, metodo: 'html_container' as MetodoTexto })),
  ];

  for (const { sel, metodo } of intentos) {
    const $cont = $(sel).first();
    if ($cont.length === 0) continue;
    const texto = textoDeContenedor($, $cont.clone() as cheerio.Cheerio<any>);
    if (texto.length >= 200) {
      return { texto: recortar(texto, maxChars), metodo };
    }
  }

  // Último recurso: todos los <p> del body, filtrando ruido.
  const $body = $('body').clone();
  $body.find(RUIDO).remove();
  const parrafos: string[] = [];
  $body.find('p').each((_i, el) => {
    const t = limpiarTexto($(el).text());
    if (t.length > 0) parrafos.push(t);
  });
  if (parrafos.length > 0) {
    const texto = recortar(parrafos.join('\n\n'), maxChars);
    return { texto, metodo: 'html_paragraphs' };
  }

  return { texto: null, metodo: null };
}

function extraerResumen($: cheerio.CheerioAPI, texto: string | null): string | null {
  const meta = primerMeta($, [
    'meta[name="description"]',
    'meta[property="og:description"]',
    'meta[name="og:description"]',
    'meta[name="twitter:description"]',
  ]);
  if (meta) return meta;

  // Sin metadato: primeros ~600 caracteres del texto principal.
  if (texto) {
    const recortado = recortar(texto.replace(/\n+/g, ' '), 600);
    return recortado.length > 0 ? recortado : null;
  }
  return null;
}

/**
 * Extrae los campos de una nota a partir de su HTML (función PURA, sin red).
 * `url` se usa solo para el fallback de título desde el slug.
 */
export function extractFromHtml(
  html: string,
  url: string,
  opts: ExtractOpts = {},
): HtmlExtract {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const $ = cheerio.load(html);

  const { titulo, metodo: metodo_titulo } = extraerTitulo($, url);
  const { texto, metodo: metodo_texto } = extraerTexto($, maxChars);
  const resumen = extraerResumen($, texto);
  const imagen = extraerImagen($);
  const autor = extraerAutor($);
  const seccion = extraerSeccion($);

  return {
    titulo,
    resumen,
    texto_extraido: texto,
    imagen,
    autor,
    seccion,
    metodo_titulo,
    metodo_texto,
  };
}

export interface FetchExtractOpts extends ExtractOpts {
  /** Timeout por URL en ms (default 10000). */
  timeoutMs?: number;
}

export interface FetchExtractResult extends HtmlExtract {
  ok: boolean;
  error: string | null;
}

/** Timeout por defecto de la descarga de una URL para enriquecer. */
export const DEFAULT_TIMEOUT_MS = 10000;

/**
 * Descarga una URL y extrae sus campos. NUNCA lanza: si la descarga falla o
 * agota el timeout, devuelve `ok: false` con el mensaje de error y todos los
 * campos en null. Así una nota rota no detiene la corrida completa.
 */
export async function fetchAndExtract(
  url: string,
  opts: FetchExtractOpts = {},
): Promise<FetchExtractResult> {
  const vacio: HtmlExtract = {
    titulo: null,
    resumen: null,
    texto_extraido: null,
    imagen: null,
    autor: null,
    seccion: null,
    metodo_titulo: null,
    metodo_texto: null,
  };

  try {
    const html = await fetchText(url, {
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    const extracto = extractFromHtml(html, url, opts);
    return { ...extracto, ok: true, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Aun en fallo de red intentamos un título mínimo desde el slug.
    const fallback = tituloDesdeUrl(url);
    return {
      ...vacio,
      titulo: fallback,
      metodo_titulo: fallback ? 'fallback_url_slug' : null,
      ok: false,
      error: msg,
    };
  }
}
