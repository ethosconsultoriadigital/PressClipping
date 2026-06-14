/**
 * Tipos y mapeo de noticias para exportación RAW a la base operativa de captura.
 *
 * Módulo NEUTRAL: sin dependencias de Node ni Supabase. Define el SELECT
 * compartido (con join a medios) y la transformación fila → NoticiaRawRow.
 * `01_Noticias_Raw` captura TODAS las noticias recolectadas, tengan o no mención.
 */

/** Fila de noticia enriquecida con datos del medio, para export raw. */
export interface NoticiaRawRow {
  noticia_id: string;
  fecha_publicacion: string | null;
  fecha_captura: string | null;
  medio: string | null;
  grupo_medio: string | null;
  pais: string | null;
  estado: string | null;
  region: string | null;
  categoria: string | null;
  titulo: string | null;
  url_original: string | null;
  url_canonica: string | null;
  resumen: string | null;
  texto_extraido: string | null;
  autor: string | null;
  seccion: string | null;
  imagen_url: string | null;
  fuente_metodo: string | null;
  hash: string | null;
  estado_procesamiento: string | null;
  menciones_procesado: boolean;
  created_at: string | null;
}

/** SELECT (PostgREST) con el join a medios para construir NoticiaRawRow. */
export const SELECT_NOTICIA_RAW = `noticia_id, fecha_publicacion, fecha_captura, pais, estado, titulo,
   url_original, url_canonica, resumen, texto_extraido, autor, seccion, imagen_principal,
   fuente_extraccion, hash_url, estado_extraccion, menciones_procesado, created_at,
   medios(nombre_medio, grupo_medio, region, categoria)`;

/** Transforma una fila cruda de Supabase (con join a medios) a NoticiaRawRow. */
export function mapNoticiaRaw(n: any): NoticiaRawRow {
  return {
    noticia_id: n.noticia_id,
    fecha_publicacion: n.fecha_publicacion ?? null,
    fecha_captura: n.fecha_captura ?? null,
    medio: n.medios?.nombre_medio ?? null,
    grupo_medio: n.medios?.grupo_medio ?? null,
    pais: n.pais ?? null,
    estado: n.estado ?? null,
    region: n.medios?.region ?? null,
    categoria: n.medios?.categoria ?? null,
    titulo: n.titulo ?? null,
    url_original: n.url_original ?? null,
    url_canonica: n.url_canonica ?? null,
    resumen: n.resumen ?? null,
    texto_extraido: n.texto_extraido ?? null,
    autor: n.autor ?? null,
    seccion: n.seccion ?? null,
    imagen_url: n.imagen_principal ?? null,
    fuente_metodo: n.fuente_extraccion ?? null,
    hash: n.hash_url ?? null,
    estado_procesamiento: n.estado_extraccion ?? null,
    menciones_procesado: n.menciones_procesado ?? false,
    created_at: n.created_at ?? null,
  };
}
