/**
 * Simulación read-only de keywords candidatas sobre noticias ya enriquecidas.
 *
 * Reutiliza el mismo matcher de producción (`matchKeyword`) y el mismo mapeo de
 * campos/pesos que `detect-mentions`, de modo que las métricas simuladas sean
 * comparables con la detección real. NO toca DB, red ni Sheets: solo funciones
 * puras sobre datos en memoria.
 */
import {
  matchKeyword,
  splitTerminos,
  PESOS_CAMPO,
  type KeywordRule,
  type CampoBuscable,
  type TipoKeyword,
} from '../matchers/keyword.js';
import { foldText } from '../matchers/text.js';

/** Fila de keyword candidata (mismo shape relevante que KeywordActivaRow). */
export interface CandidateRow {
  keyword_id: string;
  cliente_id: string | null;
  cliente?: string | null;
  keyword: string;
  alias_o_variantes?: string | null;
  tipo_keyword: string;
  regla?: string | null;
  contexto_incluir?: string | null;
  contexto_excluir?: string | null;
  alerta?: boolean;
}

/** Noticia mínima necesaria para simular (subset de NoticiaScanRow + metadatos). */
export interface SimNoticia {
  noticia_id: string;
  medio_id: string | null;
  medio_nombre: string | null;
  titulo: string | null;
  subtitulo: string | null;
  resumen: string | null;
  seccion: string | null;
  texto_extraido: string | null;
  texto_nota_limpia: string | null;
  texto_cuerpo_nota: string | null;
  url_original: string | null;
  fecha: string | null;
}

export interface SimMatch {
  noticia_id: string;
  medio_id: string | null;
  medio_nombre: string | null;
  titulo: string | null;
  url: string | null;
  fecha: string | null;
  cliente_id: string | null;
  cliente: string | null;
  keyword_id: string;
  keyword: string;
  tipo_match: TipoKeyword;
  campo: string;
  score: number;
  texto_match: string;
  posible_fp: boolean;
  razon_fp: string;
}

const TIPOS_VALIDOS: TipoKeyword[] = [
  'exacta', 'frase_exacta', 'contiene', 'booleana', 'exacta_contextual',
];

/** Convierte una fila candidata en la regla que entiende el matcher. */
export function toCandidateRule(row: CandidateRow): KeywordRule {
  const tipo = (TIPOS_VALIDOS as string[]).includes(row.tipo_keyword)
    ? (row.tipo_keyword as TipoKeyword)
    : 'contiene';
  return {
    keyword_id: row.keyword_id,
    cliente_id: row.cliente_id,
    keyword: row.keyword,
    terminos: splitTerminos(row.keyword, row.alias_o_variantes ?? null),
    tipo,
    regla: row.regla ?? null,
    contextoIncluir: splitTerminos(row.contexto_incluir ?? null),
    contextoExcluir: splitTerminos(row.contexto_excluir ?? null),
  };
}

/** Arma los campos buscables igual que detect-mentions (mismo orden y pesos). */
export function camposDe(n: SimNoticia): CampoBuscable[] {
  const textoEfectivo = n.texto_cuerpo_nota ?? n.texto_nota_limpia ?? n.texto_extraido ?? '';
  return [
    { nombre: 'titulo', texto: n.titulo ?? '', peso: PESOS_CAMPO['titulo']! },
    { nombre: 'subtitulo', texto: n.subtitulo ?? '', peso: PESOS_CAMPO['subtitulo']! },
    { nombre: 'resumen', texto: n.resumen ?? '', peso: PESOS_CAMPO['resumen']! },
    { nombre: 'seccion', texto: n.seccion ?? '', peso: PESOS_CAMPO['seccion']! },
    { nombre: 'texto_extraido', texto: textoEfectivo, peso: PESOS_CAMPO['texto_extraido']! },
    { nombre: 'medio', texto: n.medio_nombre ?? '', peso: PESOS_CAMPO['medio']! },
  ];
}

/** Secciones/URLs típicamente ruidosas para cobertura PR. */
const FP_SECCION_RE = /(deport|futbol|fútbol|espectacul|entreteni|viral|horoscop|horóscop|clima|cartelera|farandul|gossip|celebrid|recet|cocina|turismo)/i;
/** Títulos ruidosos típicos (Mundial 2026, transmisiones en vivo, etc.). */
const FP_TITULO_RE = /(mundial|en vivo|minuto a minuto|alineaciones|horóscopo|horoscopo|¿dónde ver|donde ver|a qué hora|a que hora|resultados|marcador)/i;

/**
 * Heurística determinística de posible falso positivo: marca el match si la
 * sección/URL o el título pertenecen a verticales típicamente irrelevantes para PR.
 * No descarta el match; solo lo etiqueta para revisión humana.
 */
export function flagFP(n: SimNoticia): { fp: boolean; razon: string } {
  const seccion = `${n.seccion ?? ''} ${n.url_original ?? ''}`;
  if (FP_SECCION_RE.test(foldText(seccion))) {
    return { fp: true, razon: 'sección/URL ruidosa (deportes/espectáculos/clima/etc.)' };
  }
  if (n.titulo && FP_TITULO_RE.test(foldText(n.titulo))) {
    return { fp: true, razon: 'título ruidoso (Mundial/en vivo/horóscopo/etc.)' };
  }
  return { fp: false, razon: '' };
}

/** Ejecuta la simulación: cada noticia × cada regla candidata. */
export function simulate(noticias: SimNoticia[], rows: CandidateRow[]): SimMatch[] {
  const rules = rows.map((r) => ({ rule: toCandidateRule(r), row: r }));
  const out: SimMatch[] = [];
  for (const n of noticias) {
    const campos = camposDe(n);
    for (const { rule, row } of rules) {
      const res = matchKeyword(rule, campos);
      if (!res) continue;
      const { fp, razon } = flagFP(n);
      out.push({
        noticia_id: n.noticia_id,
        medio_id: n.medio_id,
        medio_nombre: n.medio_nombre,
        titulo: n.titulo,
        url: n.url_original,
        fecha: n.fecha,
        cliente_id: rule.cliente_id,
        cliente: row.cliente ?? null,
        keyword_id: rule.keyword_id,
        keyword: rule.keyword,
        tipo_match: res.tipo_match,
        campo: res.campo,
        score: res.score,
        texto_match: res.texto_match,
        posible_fp: fp,
        razon_fp: razon,
      });
    }
  }
  return out;
}

/** Cuenta ocurrencias por una clave derivada de cada match. */
export function contarPor(matches: SimMatch[], key: (m: SimMatch) => string): Record<string, number> {
  const acc: Record<string, number> = {};
  for (const m of matches) {
    const k = key(m);
    acc[k] = (acc[k] ?? 0) + 1;
  }
  return acc;
}
