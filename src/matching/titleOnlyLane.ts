/**
 * Lane de solo título. No usa cuerpo ni marca menciones_procesado.
 * Keywords: solo exacta y frase_exacta de los tres clientes prioritarios.
 */
import {
  matchKeyword,
  PESOS_CAMPO,
  type CampoBuscable,
  type KeywordRule,
  type TipoKeyword,
} from '../matchers/keyword.js';
import { noticiaEnVentanaEditorial } from '../exporters/liveNewsWindow.js';

export const TITLE_ONLY_CLIENTES = ['CLI-MERY-TEST', 'CLI-0001', 'CLI-0002'] as const;
export const TITLE_ONLY_TIPOS: TipoKeyword[] = ['exacta', 'frase_exacta'];
export const TITLE_ONLY_TIPOS_EXCLUIDOS: TipoKeyword[] = ['contiene', 'exacta_contextual', 'booleana'];

export interface NoticiaTitleOnly {
  noticia_id: string;
  medio_id?: string | null;
  titulo?: string | null;
  subtitulo?: string | null;
  resumen?: string | null;
  fecha_publicacion?: string | null;
  fecha_captura?: string | null;
}

export interface TitleOnlyMatch {
  noticia_id: string;
  cliente_id: string | null;
  keyword_id: string;
  keyword: string;
  tipo_match: TipoKeyword;
  texto_match: string;
  score: number;
  field_match: 'titulo' | 'subtitulo' | 'resumen';
  source_lane: 'TITLE_ONLY';
  mark_processed: false;
}

export function reglaAptaTitleOnly(regla: KeywordRule, clientes: readonly string[] = TITLE_ONLY_CLIENTES): boolean {
  if (!regla.cliente_id || !clientes.includes(regla.cliente_id)) return false;
  return TITLE_ONLY_TIPOS.includes(regla.tipo);
}

export function camposTitleOnly(n: NoticiaTitleOnly): CampoBuscable[] {
  return [
    { nombre: 'titulo', texto: n.titulo ?? '', peso: PESOS_CAMPO.titulo! },
    { nombre: 'subtitulo', texto: n.subtitulo ?? '', peso: PESOS_CAMPO.subtitulo! },
    { nombre: 'resumen', texto: n.resumen ?? '', peso: PESOS_CAMPO.resumen! },
  ];
}

export function enVentanaTitleOnly(
  n: Pick<NoticiaTitleOnly, 'fecha_publicacion' | 'fecha_captura'>,
  cutoffIso: string,
): boolean {
  return noticiaEnVentanaEditorial(n.fecha_publicacion, n.fecha_captura, cutoffIso);
}

export function evaluarTitleOnly(n: NoticiaTitleOnly, reglas: KeywordRule[]): TitleOnlyMatch[] {
  const campos = camposTitleOnly(n);
  const vistos = new Set<string>();
  const out: TitleOnlyMatch[] = [];
  for (const regla of reglas) {
    if (!reglaAptaTitleOnly(regla)) continue;
    const res = matchKeyword(regla, campos);
    if (!res) continue;
    if (res.campo !== 'titulo' && res.campo !== 'subtitulo' && res.campo !== 'resumen') continue;
    const clave = `${n.noticia_id}|${regla.keyword_id}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    out.push({
      noticia_id: n.noticia_id,
      cliente_id: regla.cliente_id,
      keyword_id: regla.keyword_id,
      keyword: regla.keyword,
      tipo_match: res.tipo_match,
      texto_match: res.texto_match,
      score: res.score,
      field_match: res.campo,
      source_lane: 'TITLE_ONLY',
      mark_processed: false,
    });
  }
  return out;
}

/** Campos de la body lane: el texto efectivo incluye el cuerpo aunque el título sea genérico. */
export function camposBodyLane(n: {
  titulo?: string | null;
  subtitulo?: string | null;
  resumen?: string | null;
  seccion?: string | null;
  texto_cuerpo_nota?: string | null;
  texto_nota_limpia?: string | null;
  texto_extraido?: string | null;
  medio_nombre?: string | null;
}): CampoBuscable[] {
  const texto = n.texto_cuerpo_nota ?? n.texto_nota_limpia ?? n.texto_extraido ?? '';
  return [
    { nombre: 'titulo', texto: n.titulo ?? '', peso: PESOS_CAMPO.titulo! },
    { nombre: 'subtitulo', texto: n.subtitulo ?? '', peso: PESOS_CAMPO.subtitulo! },
    { nombre: 'resumen', texto: n.resumen ?? '', peso: PESOS_CAMPO.resumen! },
    { nombre: 'seccion', texto: n.seccion ?? '', peso: PESOS_CAMPO.seccion! },
    { nombre: 'texto_extraido', texto, peso: PESOS_CAMPO.texto_extraido! },
    { nombre: 'medio', texto: n.medio_nombre ?? '', peso: PESOS_CAMPO.medio! },
  ];
}
