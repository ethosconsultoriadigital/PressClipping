/**
 * Normalización de un ítem crudo (de RSS, sitemap, etc.) a una fila lista para
 * insertar en la tabla `noticias`.
 *
 * Política MVP (scraping responsable): guardamos metadata + resumen/extracto,
 * NO el texto íntegro de la nota. `texto_extraido` queda null salvo que la
 * propia fuente entregue contenido (algunos RSS lo hacen) y se decida guardarlo.
 */
import { DateTime } from 'luxon';
import { canonicalizeUrl } from './url.js';
import { sha256, hashContenido } from '../utils/hash.js';

/** Ítem crudo y agnóstico de la fuente, producido por los parsers. */
export interface RawItem {
  url: string;
  titulo?: string | null;
  resumen?: string | null;
  autor?: string | null;
  /** Fecha en cualquier formato razonable; se normaliza a UTC. */
  fecha?: string | null;
  seccion?: string | null;
  imagen?: string | null;
}

/** Fila lista para insertar en `noticias`. */
export interface NoticiaInsert {
  medio_id: string;
  url_original: string;
  url_canonica: string;
  titulo: string | null;
  subtitulo: string | null;
  autor: string | null;
  fecha_publicacion: string | null;
  seccion: string | null;
  texto_extraido: string | null;
  resumen: string | null;
  imagen_principal: string | null;
  idioma: string;
  pais: string | null;
  estado: string | null;
  municipio: string | null;
  hash_url: string;
  hash_contenido: string | null;
  cluster_id: string | null;
  fuente_extraccion: string;
  estado_extraccion: string;
  error_extraccion: string | null;
}

/** Recorta un texto a un máximo de caracteres, sin cortar a media palabra. */
function truncar(text: string, max = 600): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max).replace(/\s+\S*$/, '')}…`;
}

/** Limpia HTML básico de un fragmento (los RSS a veces traen markup). */
function stripHtml(text: string): string {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface NormalizeContext {
  medio_id: string;
  fuente: string; // rss | sitemap | seccion | ...
  pais?: string | null;
  estado?: string | null;
  municipio?: string | null;
}

/**
 * Convierte un RawItem en NoticiaInsert. Devuelve null si el ítem no tiene URL
 * (sin URL no hay forma de deduplicar ni de enlazar al original).
 */
export function normalizeNoticia(
  item: RawItem,
  ctx: NormalizeContext,
): NoticiaInsert | null {
  const url = item.url?.trim();
  if (!url) return null;

  const url_canonica = canonicalizeUrl(url);
  const titulo = item.titulo ? stripHtml(item.titulo) : null;
  const resumen = item.resumen ? truncar(stripHtml(item.resumen)) : null;

  let fecha_publicacion: string | null = null;
  if (item.fecha) {
    const dt = DateTime.fromISO(item.fecha, { zone: 'utc' });
    fecha_publicacion = dt.isValid
      ? dt.toUTC().toISO()
      : DateTime.fromJSDate(new Date(item.fecha)).toUTC().toISO();
  }

  return {
    medio_id: ctx.medio_id,
    url_original: url,
    url_canonica,
    titulo,
    subtitulo: null,
    autor: item.autor ? stripHtml(item.autor) : null,
    fecha_publicacion,
    seccion: item.seccion ?? null,
    texto_extraido: null, // política MVP: solo metadata + resumen
    resumen,
    imagen_principal: item.imagen ?? null,
    idioma: 'es',
    pais: ctx.pais ?? 'MX',
    estado: ctx.estado ?? null,
    municipio: ctx.municipio ?? null,
    hash_url: sha256(url_canonica),
    hash_contenido: hashContenido(titulo, resumen),
    cluster_id: null,
    fuente_extraccion: ctx.fuente,
    estado_extraccion: 'ok',
    error_extraccion: null,
  };
}
