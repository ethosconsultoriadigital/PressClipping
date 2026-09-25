/**
 * Estados de contenido de una noticia pendiente.
 * No cambia el schema. Sirve para recovery, title-only y brechas.
 */

export type EstadoContenido = 'BODY_READY' | 'CLEAN_ONLY' | 'TITLE_ONLY' | 'CONTENT_EMPTY';

export interface CamposContenido {
  titulo?: string | null;
  subtitulo?: string | null;
  resumen?: string | null;
  texto_cuerpo_nota?: string | null;
  texto_nota_limpia?: string | null;
  texto_extraido?: string | null;
}

export function textoUtil(valor: string | null | undefined): boolean {
  return typeof valor === 'string' && valor.trim().length > 0;
}

export function clasificarContenido(n: CamposContenido): EstadoContenido {
  if (textoUtil(n.texto_cuerpo_nota)) return 'BODY_READY';
  if (textoUtil(n.texto_nota_limpia)) return 'CLEAN_ONLY';
  if (textoUtil(n.texto_extraido)) return 'CLEAN_ONLY';
  if (textoUtil(n.titulo) || textoUtil(n.subtitulo) || textoUtil(n.resumen)) return 'TITLE_ONLY';
  return 'CONTENT_EMPTY';
}

/**
 * Medio prioritario, sin cuerpo, y el título/subtítulo/resumen no alcanzan
 * para un match seguro. No se marca menciones_procesado.
 */
export function esBrechaContenidoPrioritario(input: {
  estado: EstadoContenido;
  medioId: string | null | undefined;
  priorityMediaIds: string[];
  tieneMatchTituloSeguro: boolean;
}): boolean {
  if (!input.medioId || !input.priorityMediaIds.includes(input.medioId)) return false;
  if (input.estado === 'BODY_READY' || input.estado === 'CLEAN_ONLY') return false;
  if (input.tieneMatchTituloSeguro) return false;
  return input.estado === 'TITLE_ONLY' || input.estado === 'CONTENT_EMPTY';
}
