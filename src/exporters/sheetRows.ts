/**
 * Mapeo PURO de datos de exportación a filas de la base operativa de captura
 * (Sheet de salida). Sin dependencias de red ni DB: solo transforma estructuras.
 *
 * Cada builder produce un objeto cuyas CLAVES coinciden con las cabeceras
 * oficiales de la pestaña correspondiente. `appendOutputRows` alinea por nombre
 * de cabecera (normalizado), así que las columnas que falten quedan en blanco
 * y las claves desconocidas se ignoran sin romper.
 */
import type { OutRow } from '../sheets/write.js';
import type { MencionExportRow } from '../types/mencion.js';
import type { NoticiaRawRow } from '../types/noticia.js';

/** Cabeceras oficiales de `01_Noticias_Raw`. */
export const NOTICIAS_RAW_HEADERS = [
  'noticia_id',
  'fecha_publicacion',
  'fecha_captura',
  'medio',
  'grupo_medio',
  'pais',
  'estado',
  'region',
  'categoria',
  'titulo',
  'url_original',
  'url_canonica',
  'resumen',
  'texto_extraido',
  'autor',
  'seccion',
  'imagen_url',
  'fuente_metodo',
  'hash',
  'duplicado',
  'estado_procesamiento',
  'menciones_procesado',
  'notas',
  'created_at',
  // Columnas de texto limpio (0007) — al final para no romper estructura existente
  'texto_nota_limpia',
  'extracto_nota_1300',
  'calidad_extraccion',
  'texto_limpio_chars',
  // Columnas de cuerpo y tipo editorial (0008)
  'texto_cuerpo_nota',
  'extracto_cuerpo_1300',
  'cuerpo_nota_chars',
  'tipo_nota',
] as const;

/** Cabeceras oficiales de `02_Menciones`. */
export const MENCIONES_HEADERS = [
  'mencion_id',
  'noticia_id',
  'fecha_publicacion',
  'fecha_captura',
  'cliente_id',
  'cliente',
  'grupo_monitoreo',
  'keyword_id',
  'keyword',
  'alias_detectado',
  'tipo_keyword',
  'prioridad',
  'medio',
  'estado',
  'region',
  'titulo',
  'url_original',
  'texto_match',
  'score_match',
  'sentimiento',
  'relevancia',
  'tema',
  'exportado_xml',
  'notas',
] as const;

/** Cabeceras oficiales de `04_Logs`. */
export const LOGS_HEADERS = [
  'fecha_hora',
  'run_by',
  'accion',
  'nivel',
  'mensaje',
  'medio_id',
  'medio',
  'urls_detectadas',
  'noticias_nuevas',
  'menciones_nuevas',
  'duplicados',
  'errores',
  'duracion_ms',
  'notas',
] as const;

/** Cabeceras oficiales de `03_XML_Export`. */
export const XML_EXPORT_HEADERS = [
  'xml_id',
  'fecha_generacion',
  'archivo_xml',
  'ruta_o_url',
  'total_menciones',
  'clientes_incluidos',
  'keywords_incluidas',
  'desde_fecha',
  'hasta_fecha',
  'marcado_exportado_xml',
  'estatus',
  'errores',
  'notas',
] as const;

/** Datos mínimos de un log para exportar a `04_Logs`. */
export interface LogExportLike {
  fecha_hora: string;
  ejecutado_por: string | null;
  accion: string | null;
  nivel: string | null;
  mensaje: string | null;
  medio_id: string | null;
  urls_detectadas: number | null;
  notas_nuevas: number | null;
  duplicados: number | null;
  errores: number | null;
  duracion_ms: number | null;
}

/** Mapea una noticia enriquecida a una fila de `01_Noticias_Raw`. */
export function noticiaToOutputRow(n: NoticiaRawRow): OutRow {
  return {
    noticia_id: n.noticia_id,
    fecha_publicacion: n.fecha_publicacion,
    fecha_captura: n.fecha_captura,
    medio: n.medio,
    grupo_medio: n.grupo_medio,
    pais: n.pais,
    estado: n.estado,
    region: n.region,
    categoria: n.categoria,
    titulo: n.titulo,
    url_original: n.url_original,
    url_canonica: n.url_canonica,
    resumen: n.resumen,
    texto_extraido: n.texto_extraido,
    autor: n.autor,
    seccion: n.seccion,
    imagen_url: n.imagen_url,
    fuente_metodo: n.fuente_metodo,
    hash: n.hash,
    duplicado: null, // la tabla noticias no marca duplicado a nivel fila
    estado_procesamiento: n.estado_procesamiento,
    menciones_procesado: n.menciones_procesado,
    notas: n.notas,
    created_at: n.created_at,
    texto_nota_limpia: n.texto_nota_limpia,
    extracto_nota_1300: n.extracto_nota_1300,
    calidad_extraccion: n.calidad_extraccion,
    texto_limpio_chars: n.texto_limpio_chars,
    texto_cuerpo_nota: n.texto_cuerpo_nota,
    extracto_cuerpo_1300: n.extracto_cuerpo_1300,
    cuerpo_nota_chars: n.cuerpo_nota_chars,
    tipo_nota: n.tipo_nota,
  };
}

/** Mapea una mención enriquecida a una fila de `02_Menciones`. */
export function mencionToOutputRow(m: MencionExportRow): OutRow {
  return {
    mencion_id: m.mencion_id,
    noticia_id: m.noticia_id,
    fecha_publicacion: m.fecha_publicacion,
    fecha_captura: m.fecha_captura,
    cliente_id: null, // pendiente: requiere ampliar el SELECT de menciones
    cliente: m.cliente,
    grupo_monitoreo: null,
    keyword_id: null, // pendiente: requiere ampliar el SELECT de menciones
    keyword: m.keyword,
    alias_detectado: null,
    tipo_keyword: null,
    prioridad: null,
    medio: m.medio,
    estado: m.estado,
    region: m.region,
    titulo: m.titulo,
    url_original: m.url_original,
    texto_match: m.texto_match,
    score_match: m.relevancia,
    sentimiento: m.sentimiento,
    relevancia: null, // reservado para relevancia de IA (1-5), aún sin poblar
    tema: m.tema,
    exportado_xml: m.exportado_xml,
    notas: null,
  };
}

/** Mapea un log de ingesta a una fila de `04_Logs`. */
export function logToOutputRow(l: LogExportLike): OutRow {
  return {
    fecha_hora: l.fecha_hora,
    run_by: l.ejecutado_por,
    accion: l.accion,
    nivel: l.nivel,
    mensaje: l.mensaje,
    medio_id: l.medio_id,
    medio: null, // los logs guardan medio_id, no el nombre del medio
    urls_detectadas: l.urls_detectadas,
    noticias_nuevas: l.notas_nuevas,
    menciones_nuevas: null,
    duplicados: l.duplicados,
    errores: l.errores,
    duracion_ms: l.duracion_ms,
    notas: null,
  };
}

export interface XmlExportInfo {
  xmlId: string;
  fechaGeneracion: string;
  archivoXml: string;
  rutaOUrl: string;
  totalMenciones: number;
  clientesIncluidos: string[];
  keywordsIncluidas: string[];
  desdeFecha?: string | null;
  hastaFecha?: string | null;
  marcadoExportadoXml: boolean;
  estatus: string;
  errores?: string | null;
  notas?: string | null;
}

/** Construye la fila de registro para `03_XML_Export`. */
export function xmlExportToOutputRow(info: XmlExportInfo): OutRow {
  return {
    xml_id: info.xmlId,
    fecha_generacion: info.fechaGeneracion,
    archivo_xml: info.archivoXml,
    ruta_o_url: info.rutaOUrl,
    total_menciones: info.totalMenciones,
    clientes_incluidos: info.clientesIncluidos.join(', '),
    keywords_incluidas: info.keywordsIncluidas.join(', '),
    desde_fecha: info.desdeFecha ?? null,
    hasta_fecha: info.hastaFecha ?? null,
    marcado_exportado_xml: info.marcadoExportadoXml,
    estatus: info.estatus,
    errores: info.errores ?? null,
    notas: info.notas ?? null,
  };
}

/** Distintos clientes y keywords presentes en un conjunto de menciones. */
export function resumenInclusion(rows: MencionExportRow[]): {
  clientes: string[];
  keywords: string[];
} {
  const clientes = new Set<string>();
  const keywords = new Set<string>();
  for (const r of rows) {
    if (r.cliente) clientes.add(r.cliente);
    if (r.keyword) keywords.add(r.keyword);
  }
  return { clientes: [...clientes], keywords: [...keywords] };
}
