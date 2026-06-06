/**
 * Tipos y mapeo de menciones para exportación (XML / Sheets).
 *
 * Módulo NEUTRAL: sin dependencias de Node ni de Supabase, para poder
 * reutilizarlo tanto en el motor (scripts/Node) como en el Cloudflare Worker
 * de /read-xml. La consulta concreta a Supabase vive donde se ejecuta; aquí
 * solo está el SELECT compartido y la transformación de fila → MencionExportRow.
 */

/** Fila de mención enriquecida con datos de noticia/cliente/medio, para export. */
export interface MencionExportRow {
  mencion_id: string;
  noticia_id: string;
  fecha_publicacion: string | null;
  fecha_captura: string | null;
  cliente: string | null;
  keyword: string | null;
  medio: string | null;
  estado: string | null;
  region: string | null;
  titulo: string | null;
  url_original: string | null;
  resumen: string | null;
  texto_match: string | null;
  sentimiento: string | null;
  relevancia: number | null;
  tema: string | null;
  subtema: string | null;
  requiere_alerta: boolean;
  estado_revision: string | null;
  exportado_xml: boolean;
}

/** SELECT (PostgREST) con los joins necesarios para construir MencionExportRow. */
export const SELECT_MENCION_EXPORT = `mencion_id, noticia_id, keyword, texto_match, sentimiento, score_relevancia, tema, subtema,
   requiere_alerta, estado_revision, exportado_xml,
   clientes(nombre_cliente),
   noticias!inner(titulo, url_original, resumen, fecha_publicacion, fecha_captura, estado,
                  medios(nombre_medio, region))`;

/** Transforma una fila cruda de Supabase (con joins anidados) a MencionExportRow. */
export function mapMencionExport(m: any): MencionExportRow {
  return {
    mencion_id: m.mencion_id,
    noticia_id: m.noticia_id,
    fecha_publicacion: m.noticias?.fecha_publicacion ?? null,
    fecha_captura: m.noticias?.fecha_captura ?? null,
    cliente: m.clientes?.nombre_cliente ?? null,
    keyword: m.keyword ?? null,
    medio: m.noticias?.medios?.nombre_medio ?? null,
    estado: m.noticias?.estado ?? null,
    region: m.noticias?.medios?.region ?? null,
    titulo: m.noticias?.titulo ?? null,
    url_original: m.noticias?.url_original ?? null,
    resumen: m.noticias?.resumen ?? null,
    texto_match: m.texto_match ?? null,
    sentimiento: m.sentimiento ?? null,
    relevancia: m.score_relevancia ?? null,
    tema: m.tema ?? null,
    subtema: m.subtema ?? null,
    requiere_alerta: m.requiere_alerta ?? false,
    estado_revision: m.estado_revision ?? null,
    exportado_xml: m.exportado_xml ?? false,
  };
}
