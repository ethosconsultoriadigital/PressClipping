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
  /** Texto completo extraído, incluyendo posible ruido. Sirve para auditoría. */
  texto_extraido: string | null;
  /** Cuerpo principal sin menú, nav, relacionados ni promo. Para menciones e IA. */
  texto_nota_limpia: string | null;
  /** Primeros ~1300 chars de texto_nota_limpia. Para lectura rápida en Sheets. */
  extracto_nota_1300: string | null;
  /** Calidad estimada de la extracción limpia: alta | media | baja | fallida. */
  calidad_extraccion: 'alta' | 'media' | 'baja' | 'fallida' | null;
  /** Longitud de texto_nota_limpia. */
  texto_limpio_chars: number | null;
  /** Cuerpo real sin encabezado editorial (tipo, autor, fecha). Para IA fina. */
  texto_cuerpo_nota: string | null;
  /** Primeros ~1300 chars de texto_cuerpo_nota. */
  extracto_cuerpo_1300: string | null;
  /** Longitud de texto_cuerpo_nota. */
  cuerpo_nota_chars: number | null;
  /** Vertical/clasificación editorial detectada (Política, Economía, etc.). */
  tipo_nota: string | null;
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

/** Longitud del extracto para revisión rápida en Sheets. */
export const EXTRACTO_CHARS = 1300;

// ---------------------------------------------------------------------------
// Heurística de limpieza de texto extraído
// ---------------------------------------------------------------------------

/**
 * Marcadores que indican el inicio de un bloque de ruido "de corte": cuando
 * una línea COMIENZA con alguno de estos tokens (normalizado a minúsculas y sin
 * tildes), se descarta esa línea y todo lo que sigue.
 */
const MARCADORES_CORTE = [
  'minuto a minuto',
  'lo mas reciente',
  'lo más reciente',
  'tambien te puede interesar',
  'también te puede interesar',
  'notas relacionadas',
  'mas noticias',
  'más noticias',
  'ultimas noticias',
  'últimas noticias',
  'noticias relacionadas',
  'relacionadas',
  'lo mas visto',
  'lo + visto',
  'lo+visto',
  'lo mas leido',
  'mas leidas',
  'lo mas reciente',
  'lo + reciente',
  'lo+reciente',
  'te recomendamos',
  'te puede interesar',
  'no te pierdas',
  'sigue leyendo',
  'lee tambien',
  'lee también',
  'tambien lee',
  'también lee',
  'tambien puedes leer',
  'también puedes leer',
  'columnas',
  'cartones',
  'newsletter',
  'derechos reservados',
  'aviso de privacidad',
  'aviso legal',
  'terminos y condiciones',
  'términos y condiciones',
  'politica de privacidad',
  'política de privacidad',
];

/**
 * Líneas que se eliminan siempre, sin importar su posición en el texto.
 * Se aplican como regexp de línea completa (normalizada, sin tildes).
 */
const LINEAS_RUIDO_EXACTAS = new Set([
  'vinculo copiado',
  'vínculo copiado',
  'siguenos',
  'síguenos',
  'menu',
  'menú',
  'estaciones locales',
  'estaciones regionales',
  'noticieros locales',
  'noticieros regionales',
  'facebook',
  'twitter',
  'instagram',
  'youtube',
  'tiktok',
  'whatsapp',
  'telegram',
  '#esnoticia',
  'hablamos de:',
  'hablamos de',
  'compartir',
  'compartir nota',
  'los 40',
]);

/** Patrones de líneas promocionales/spam a eliminar siempre. */
const PATRONES_PROMO = [
  /únete a nuestro canal/i,
  /unete a nuestro canal/i,
  /suscr[ií]bete/i,
  /https?:\/\/[^\s]{0,30}\.vip/i,   // URLs cortas *.vip promocionales
  /https?:\/\/[^\s]{0,30}\.ly\b/i,  // bit.ly, etc.
  /t\.me\//i,
  /wa\.me\//i,
  // CTA de seguir en redes ("Sigue nuestras/también las noticias ... en TikTok")
  /^sigue\s+(nuestras|tambi[eé]n|nuestro|las)\b.*\b(tiktok|facebook|instagram|whatsapp|telegram|x|twitter|google\s*news)\b/i,
  // CTA de newsletter OEM ("¿Te quedas fuera de la conversación? Mandamos a tu correo…")
  /te quedas fuera de la conversaci[oó]n/i,
  /mandamos a tu correo el mejor resumen/i,
];

/**
 * Normaliza una línea para comparación: minúsculas, sin tildes, sin puntuación
 * extra. Se usa solo para la comparación, no modifica el texto guardado.
 */
function normLinea(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quitar diacríticos
    .replace(/[^a-z0-9\s:/#.]/g, '')
    .trim();
}

/**
 * Calcula la calidad del texto limpio en función de su longitud y la proporción
 * de líneas conservadas respecto al texto original.
 */
function calcularCalidad(
  textoLimpio: string,
  lineasOriginales: number,
  lineasConservadas: number,
): 'alta' | 'media' | 'baja' | 'fallida' {
  if (textoLimpio.length === 0) return 'fallida';
  const ratio = lineasConservadas / Math.max(lineasOriginales, 1);
  if (textoLimpio.length >= 600 && ratio >= 0.3) return 'alta';
  if (textoLimpio.length >= 200) return 'media';
  if (textoLimpio.length > 0) return 'baja';
  return 'fallida';
}

export interface TextoLimpio {
  texto_nota_limpia: string;
  extracto_nota_1300: string;
  calidad_extraccion: 'alta' | 'media' | 'baja' | 'fallida';
  texto_limpio_chars: number;
}

/**
 * Recibe el texto extraído raw (puede tener ruido de menú, nav, promo, etc.)
 * y devuelve el cuerpo principal limpio con sus derivados.
 *
 * Estrategia determinística:
 * 1. Partir en líneas.
 * 2. Eliminar siempre las líneas exactas de ruido conocido.
 * 3. Eliminar siempre las líneas que coincidan con patrones promocionales.
 * 4. Al encontrar un marcador de corte, descartar esa línea y todo lo que sigue.
 * 5. Descartar líneas en blanco repetidas.
 * 6. Conservar todo lo demás (entradilla, autor, fecha, cuerpo, fuente).
 */
export function limpiarTextoExtraido(textoRaw: string): TextoLimpio {
  const lineasOriginales = textoRaw.split('\n');
  const conservadas: string[] = [];
  let cortado = false;

  for (const linea of lineasOriginales) {
    if (cortado) break;

    const norm = normLinea(linea);

    // Corte: si la línea empieza con un marcador de sección de ruido
    if (MARCADORES_CORTE.some((m) => norm.startsWith(m) || norm === m)) {
      cortado = true;
      break;
    }

    // Eliminar líneas exactas de ruido
    if (LINEAS_RUIDO_EXACTAS.has(norm)) continue;

    // Eliminar patrones promocionales
    if (PATRONES_PROMO.some((re) => re.test(linea))) continue;

    conservadas.push(linea);
  }

  // Colapsar múltiples líneas vacías consecutivas en una sola
  const sinVaciosRepetidos: string[] = [];
  let ultimaVacia = false;
  for (const l of conservadas) {
    const esVacia = l.trim().length === 0;
    if (esVacia && ultimaVacia) continue;
    sinVaciosRepetidos.push(l);
    ultimaVacia = esVacia;
  }

  const textoLimpio = sinVaciosRepetidos.join('\n').trim();
  const extracto = recortar(textoLimpio, EXTRACTO_CHARS);
  const calidad = calcularCalidad(textoLimpio, lineasOriginales.length, conservadas.length);

  return {
    texto_nota_limpia: textoLimpio,
    extracto_nota_1300: extracto,
    calidad_extraccion: calidad,
    texto_limpio_chars: textoLimpio.length,
  };
}

// ---------------------------------------------------------------------------
// Extracción de cuerpo de nota y tipo editorial
// ---------------------------------------------------------------------------

/** Patrones de fecha/hora típicos en cabeceras de noticias mexicanas. */
const PATRON_HORA_DIA = /^\d{1,2}:\d{2}\s+(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)/i;
const PATRON_FECHA_DIA = /^\d{1,2}\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)/i;
const PATRON_FECHA_SLASH = /^\d{1,2}\/\d{1,2}\/\d{2,4}\b/;
const PATRON_FECHA_DIA2 = /^(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo),?\s+\d{1,2}/i;

/** Etiquetas editoriales que anteceden al cuerpo pero no son tipo_nota. */
const ETIQUETAS_EDITORIALES_NORM = new Set([
  'exclusiva', 'exclusivo', 'opinion', 'analisis', 'analisis especial',
  '#esnoticia', 'breaking', 'urgente', 'ultima hora', 'especial',
  'reportaje', 'entrevista', 'editorial', 'columna', 'hablamos de',
  'hablamos de:', 'de ultima hora',
]);

function esLineaFecha(l: string): boolean {
  const t = l.trim();
  return (
    PATRON_HORA_DIA.test(t) ||
    PATRON_FECHA_DIA.test(t) ||
    PATRON_FECHA_SLASH.test(t) ||
    PATRON_FECHA_DIA2.test(t)
  );
}

function esLineaAutor(l: string): boolean {
  return /^por\s+/i.test(l.trim());
}

function esEtiquetaEditorial(l: string): boolean {
  const norm = normLinea(l);
  return ETIQUETAS_EDITORIALES_NORM.has(norm);
}

/**
 * Intenta detectar el tipo/vertical editorial desde las primeras líneas
 * de `texto_nota_limpia`. Condiciones para ser tipo_nota:
 *   - Primera línea no vacía del texto
 *   - Corta: < 60 chars y ≤ 6 palabras
 *   - No es autor ("Por ...")
 *   - No es fecha
 *   - No es etiqueta editorial genérica (Exclusiva, etc.)
 *   - No termina en punto (evita frases)
 *   - No parece un título largo
 */
function detectarTipoNota(lineas: string[]): string | null {
  for (const linea of lineas) {
    const l = linea.trim();
    if (!l) continue; // saltar vacías

    const palabras = l.split(/\s+/).length;
    const norm = normLinea(l);

    if (
      l.length < 60 &&
      palabras <= 6 &&
      !esLineaAutor(l) &&
      !esLineaFecha(l) &&
      !esEtiquetaEditorial(l) &&
      !l.endsWith('.') &&
      !l.endsWith(':') &&
      !l.endsWith(',') &&
      // No parece título con verbo (heurística: contiene letra mayúscula inicial
      // pero no empieza con minúscula seguida de más texto — categorías suelen ser PascalCase)
      !/^[a-záéíóúü]/i.test(norm) === false // siempre true, la usamos solo como guarda
    ) {
      return l;
    }
    break; // Solo revisamos la primera línea no vacía
  }
  return null;
}

export interface CuerpoNota {
  texto_cuerpo_nota: string;
  extracto_cuerpo_1300: string;
  cuerpo_nota_chars: number;
  tipo_nota: string | null;
}

/**
 * A partir de `texto_nota_limpia`, extrae el cuerpo puro de la nota
 * eliminando el encabezado editorial (tipo/sección, etiqueta, autor, fecha).
 *
 * Algoritmo:
 * 1. Detectar `tipo_nota` desde la primera línea no vacía.
 * 2. Buscar en las primeras ~25 líneas el ÚLTIMO indicador de cabecera
 *    (línea de autor "Por ..." o línea de fecha). Todo lo anterior a ese
 *    indicador es cabecera editorial.
 * 3. El cuerpo comienza en la primera línea no vacía posterior al último
 *    indicador de cabecera encontrado.
 * 4. Fallback conservador: si no se detecta autor ni fecha, solo se
 *    eliminan tipo_nota y etiquetas editoriales del inicio; el resto es
 *    cuerpo. Esto preserva la bajada y otros elementos reales.
 */
export function extraerCuerpoNota(textoLimpio: string): CuerpoNota {
  const lineas = textoLimpio.split('\n');

  // 1. Tipo de nota
  const tipo = detectarTipoNota(lineas);

  // 2. Buscar último indicador de cabecera en las primeras 25 líneas
  const ZONA_HEADER = Math.min(lineas.length, 25);
  let ultimoHeaderIdx = -1;

  for (let i = 0; i < ZONA_HEADER; i++) {
    const l = (lineas[i] ?? '').trim();
    if (!l) continue;
    if (esLineaAutor(l) || esLineaFecha(l)) {
      ultimoHeaderIdx = i;
    }
    // Si ya encontramos un header y ahora vemos una línea larga de cuerpo, paramos
    if (ultimoHeaderIdx >= 0 && l.length > 80 && !esLineaAutor(l) && !esLineaFecha(l)) {
      break;
    }
  }

  let cuerpoLineas: string[];

  if (ultimoHeaderIdx >= 0) {
    // Encontramos fecha o autor: el cuerpo empieza después
    cuerpoLineas = lineas.slice(ultimoHeaderIdx + 1);
  } else {
    // Fallback: eliminar solo tipo_nota y etiquetas editoriales del inicio
    let startIdx = 0;
    for (let i = 0; i < Math.min(lineas.length, 10); i++) {
      const l = (lineas[i] ?? '').trim();
      if (!l) {
        // Línea vacía entre header elements, continuar
        if (startIdx === i) startIdx = i + 1;
        continue;
      }
      const esTipo = tipo !== null && l === tipo;
      if (esTipo || esEtiquetaEditorial(l)) {
        startIdx = i + 1;
      } else {
        break; // Primera línea de contenido real
      }
    }
    cuerpoLineas = lineas.slice(startIdx);
  }

  // Trim de líneas vacías al inicio del cuerpo
  while (cuerpoLineas.length > 0 && !(cuerpoLineas[0] ?? '').trim()) {
    cuerpoLineas.shift();
  }

  const cuerpo = cuerpoLineas.join('\n').trim();

  return {
    texto_cuerpo_nota: cuerpo,
    extracto_cuerpo_1300: recortar(cuerpo, EXTRACTO_CHARS),
    cuerpo_nota_chars: cuerpo.length,
    tipo_nota: tipo,
  };
}

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

/**
 * Elementos de "ruido" que nunca aportan al cuerpo de la nota.
 *
 * Incluye selectores por SUBcadena de clase (`[class*="..."]`) para atrapar
 * módulos de recirculación de CMS modernos (Next.js/CSS-modules con clases
 * con hash, p. ej. OEM/El Sol: `Teaser_wrapper__x`, `widget-newsletter-...`).
 * Estos bloques insertan teasers/resúmenes de OTRAS notas dentro del contenedor
 * del artículo y contaminan el cuerpo.
 *
 * IMPORTANTE: los selectores por subcadena deben ser ESPECÍFICos de módulos de
 * recirculación (teaser/newsletter/recirculation), nunca del sistema de grid
 * (p. ej. `group-grid-*` envuelve TAMBIÉN el cuerpo real y no debe removerse).
 */
const RUIDO = [
  'script', 'style', 'noscript', 'nav', 'header', 'footer', 'aside', 'form', 'iframe',
  '.ad', '.ads', '.advertisement', '.publicidad',
  '.related', '.relacionadas', '.newsletter', '.social', '.share', '.comments',
  'figure figcaption',
  // Módulos de recirculación por subcadena de clase (mayúsc./minúsc.).
  '[class*="teaser"]', '[class*="Teaser"]',
  '[class*="recircul"]', '[class*="Recircul"]',
  '[class*="widget-newsletter"]', '[class*="newsletter-widget"]',
].join(', ');

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

/**
 * Normaliza URLs de imagen:
 * - `//cdn.ejemplo.com/img.jpg`  → `https://cdn.ejemplo.com/img.jpg`
 * - `/ruta/img.jpg` + pageUrl    → `https://origen/ruta/img.jpg` (si pageUrl)
 * - URLs absolutas con http/https se devuelven sin cambios.
 */
export function normalizarUrlImagen(url: string, pageUrl?: string): string {
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('/') && pageUrl) {
    try {
      const { origin } = new URL(pageUrl);
      return `${origin}${url}`;
    } catch {
      // pageUrl inválida — devolver tal cual
    }
  }
  return url;
}

function extraerImagen($: cheerio.CheerioAPI, pageUrl?: string): string | null {
  const raw = primerMeta($, [
    'meta[property="og:image"]',
    'meta[name="og:image"]',
    'meta[name="twitter:image"]',
    'meta[property="twitter:image"]',
    'meta[name="twitter:image:src"]',
  ]);
  return raw ? normalizarUrlImagen(raw, pageUrl) : null;
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

/**
 * ¿El <p> es únicamente uno o varios enlaces, sin prosa propia? Es el patrón de
 * los teasers de "contenido relacionado" que algunos temas (p. ej. WordPress de
 * El Otro Enfoque) inyectan a media nota como `<p><strong><a>¿…?</a></strong></p>`.
 * Un párrafo que es solo enlace nunca es cuerpo real: se descarta con seguridad.
 */
function esParrafoSoloEnlace($: cheerio.CheerioAPI, el: any): boolean {
  const $p = $(el);
  const pText = limpiarTexto($p.text());
  if (!pText) return false;
  const $links = $p.find('a');
  if ($links.length === 0) return false;
  const linkText = limpiarTexto(
    $links
      .map((_j, a) => $(a).text())
      .get()
      .join(' '),
  );
  // El texto del párrafo es (casi) exclusivamente el de sus enlaces.
  return linkText.length >= pText.length - 3;
}

/** Junta el texto de los <p> de un contenedor, filtrando ruido y vacíos. */
function textoDeContenedor($: cheerio.CheerioAPI, $cont: cheerio.Cheerio<any>): string {
  $cont.find(RUIDO).remove();
  const parrafos: string[] = [];
  $cont.find('p').each((_i, el) => {
    if (esParrafoSoloEnlace($, el)) return; // teaser de relacionados / navegación
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
    if (esParrafoSoloEnlace($, el)) return; // teaser de relacionados / navegación
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
  const imagen = extraerImagen($, url);
  const autor = extraerAutor($);
  const seccion = extraerSeccion($);

  // Generar texto limpio y cuerpo a partir del texto raw
  const limpio = texto ? limpiarTextoExtraido(texto) : null;
  const cuerpo = limpio ? extraerCuerpoNota(limpio.texto_nota_limpia) : null;

  return {
    titulo,
    resumen,
    texto_extraido: texto,
    texto_nota_limpia: limpio?.texto_nota_limpia ?? null,
    extracto_nota_1300: limpio?.extracto_nota_1300 ?? null,
    calidad_extraccion: limpio?.calidad_extraccion ?? null,
    texto_limpio_chars: limpio?.texto_limpio_chars ?? null,
    texto_cuerpo_nota: cuerpo?.texto_cuerpo_nota ?? null,
    extracto_cuerpo_1300: cuerpo?.extracto_cuerpo_1300 ?? null,
    cuerpo_nota_chars: cuerpo?.cuerpo_nota_chars ?? null,
    tipo_nota: cuerpo?.tipo_nota ?? null,
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
    texto_nota_limpia: null,
    extracto_nota_1300: null,
    calidad_extraccion: null,
    texto_limpio_chars: null,
    texto_cuerpo_nota: null,
    extracto_cuerpo_1300: null,
    cuerpo_nota_chars: null,
    tipo_nota: null,
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
