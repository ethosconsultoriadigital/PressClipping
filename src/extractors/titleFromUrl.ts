/**
 * Fallback de título a partir del slug de una URL.
 *
 * Cuando una noticia se ingesta desde un sitemap que solo trae `loc`/`lastmod`
 * (sin <news:title>), la fila queda sin `titulo`. Como último recurso —y SOLO
 * cuando no hay título real— generamos un título legible desde la última parte
 * de la ruta de la URL.
 *
 * Módulo PURO y testeable: sin red ni dependencias de Node más allá de la API
 * estándar de URL. NO inventa resumen ni texto; solo deriva un título humano
 * del slug existente.
 */

/** Marcador que se registra en `notas` cuando el título se generó del slug. */
export const MARCADOR_TITULO_DESDE_URL = 'titulo_generado_desde_url';

export interface TituloResuelto {
  /** Título final (real o generado), o null si no hubo forma de obtener uno. */
  titulo: string | null;
  /** true si el título se derivó del slug de la URL (no es un título real). */
  generadoDesdeUrl: boolean;
}

/** Extensiones de archivo comunes que se quitan del slug antes de formatear. */
const EXTENSIONES = new Set(['html', 'htm', 'php', 'asp', 'aspx', 'jsp', 'shtml']);

/**
 * Toma la última parte significativa de la ruta de una URL. Tolerante a barras
 * finales, query string y fragmentos. Devuelve null si no hay slug usable.
 */
function slugDesdeUrl(url: string): string | null {
  const raw = url?.trim();
  if (!raw) return null;

  let pathname: string;
  try {
    pathname = new URL(raw).pathname;
  } catch {
    // No es una URL absoluta válida: trabajamos con la cadena cruda, quitando
    // query string y fragmento manualmente.
    pathname = raw.split('#')[0]!.split('?')[0]!;
  }

  // Segmentos no vacíos de la ruta; nos quedamos con el último.
  const segmentos = pathname.split('/').filter((s) => s.trim().length > 0);
  const ultimo = segmentos[segmentos.length - 1];
  if (!ultimo) return null;
  return ultimo;
}

/** Quita la extensión de archivo (.html, .php, …) del final del slug. */
function quitarExtension(slug: string): string {
  const punto = slug.lastIndexOf('.');
  if (punto <= 0) return slug;
  const ext = slug.slice(punto + 1).toLowerCase();
  if (EXTENSIONES.has(ext)) return slug.slice(0, punto);
  return slug;
}

/**
 * Genera un título legible desde una URL usando su slug:
 *   - decodifica (%20, etc.)
 *   - quita extensión de archivo conocida
 *   - reemplaza '_' y '-' por espacios
 *   - colapsa espacios y recorta
 *   - capitaliza la primera letra
 *
 * Ej: `.../messi_se_integro-a-la_seleccion.html`
 *   -> `Messi se integro a la seleccion`
 *
 * Devuelve null si no hay slug aprovechable (p.ej. URL sin ruta).
 */
export function tituloDesdeUrl(url: string): string | null {
  const slug = slugDesdeUrl(url);
  if (!slug) return null;

  let texto = slug;
  try {
    texto = decodeURIComponent(slug);
  } catch {
    // Slug mal codificado: seguimos con el valor crudo.
  }

  texto = quitarExtension(texto)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!texto) return null;

  // Capitaliza solo la primera letra; respeta el resto tal cual.
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * Resuelve el título de una noticia: si ya hay un título real (no vacío) lo
 * conserva; si no, intenta generarlo desde la URL.
 *
 * Nunca lanza. `generadoDesdeUrl` indica si se usó el fallback (para registrar
 * el marcador correspondiente en `notas`).
 */
export function resolverTitulo(
  tituloActual: string | null | undefined,
  url: string,
): TituloResuelto {
  const limpio = tituloActual?.trim();
  if (limpio) {
    return { titulo: limpio, generadoDesdeUrl: false };
  }
  const generado = tituloDesdeUrl(url);
  return {
    titulo: generado,
    generadoDesdeUrl: generado !== null,
  };
}
