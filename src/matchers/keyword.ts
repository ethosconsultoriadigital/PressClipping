/**
 * Matcher de keywords sobre una noticia.
 *
 * Aplica la regla de la keyword (exacta, frase_exacta, contiene,
 * exacta_contextual, booleana) considerando alias/variantes y las puertas de
 * contexto (incluir/excluir). Devuelve, si hay match, el tipo, un fragmento de
 * evidencia (texto_match) y un score de relevancia heurístico.
 *
 * Es un módulo puro y testeable: no toca DB ni red.
 */
import { foldText, indexOfWord, indexOfSubstring, anyWordPresent } from './text.js';
import { evalBoolean, operandsOf } from './boolean.js';
import { pasaPuertaContextualClienteKeyword } from '../matching/contextualKeywordRules.js';

export type TipoKeyword =
  | 'exacta'
  | 'frase_exacta'
  | 'contiene'
  | 'booleana'
  | 'exacta_contextual';

export interface KeywordRule {
  keyword_id: string;
  cliente_id: string | null;
  keyword: string;
  /** keyword + alias_o_variantes ya separados. */
  terminos: string[];
  tipo: TipoKeyword;
  regla: string | null;
  contextoIncluir: string[];
  contextoExcluir: string[];
}

/** Campo buscable de la noticia con su peso para el score. */
export interface CampoBuscable {
  nombre: string;
  texto: string;
  peso: number;
}

export interface MatchResultado {
  tipo_match: TipoKeyword;
  texto_match: string;
  campo: string;
  score: number;
}

/** Pesos por campo (mayor = más relevante para PR). */
export const PESOS_CAMPO: Record<string, number> = {
  titulo: 1.0,
  subtitulo: 0.8,
  resumen: 0.6,
  seccion: 0.5,
  texto_extraido: 0.4,
  medio: 0.3,
};

/** Construye un snippet de evidencia alrededor de `index` en el texto original. */
function snippet(original: string, index: number, len: number, ventana = 90): string {
  if (index < 0) return original.slice(0, 160).trim();
  const ini = Math.max(0, index - ventana);
  const fin = Math.min(original.length, index + len + ventana);
  const pre = ini > 0 ? '…' : '';
  const post = fin < original.length ? '…' : '';
  return `${pre}${original.slice(ini, fin).trim()}${post}`;
}

/** Busca un término según el tipo; devuelve {index, len} o null. */
function buscarTermino(
  termino: string,
  foldedCampo: string,
  tipo: TipoKeyword,
): { index: number; len: number } | null {
  const folded = foldText(termino);
  let index = -1;
  if (tipo === 'contiene') {
    index = indexOfSubstring(termino, foldedCampo);
  } else {
    // exacta, frase_exacta y exacta_contextual usan límite de palabra.
    index = indexOfWord(termino, foldedCampo);
  }
  return index >= 0 ? { index, len: folded.length } : null;
}

/**
 * Evalúa una keyword contra los campos de una noticia.
 * Devuelve el match de mayor peso de campo, o null si no hay match.
 */
export function matchKeyword(
  rule: KeywordRule,
  campos: CampoBuscable[],
): MatchResultado | null {
  const foldedFull = campos.map((c) => foldText(c.texto)).join('\n');

  // Puerta de exclusión: si aparece algún contexto a excluir, no hay match.
  if (rule.contextoExcluir.length > 0 && anyWordPresent(rule.contextoExcluir, foldedFull)) {
    return null;
  }
  // Puerta de inclusión: si se exige contexto, al menos uno debe aparecer.
  const exigeContexto = rule.contextoIncluir.length > 0;
  if (exigeContexto && !anyWordPresent(rule.contextoIncluir, foldedFull)) {
    return null;
  }
  // exacta_contextual sin contexto definido degrada a exacta (no bloquea).

  // Puerta contextual cliente/keyword (código): p.ej. keywords comerciales
  // amplias de CLI-0002 exigen contexto de bebidas. Se evalúa sobre el
  // título + cuerpo (se excluye el nombre del medio para no contaminar).
  const textoContexto = campos
    .filter((c) => c.nombre !== 'medio')
    .map((c) => c.texto)
    .join('\n');
  if (
    !pasaPuertaContextualClienteKeyword({
      cliente_id: rule.cliente_id,
      keyword: rule.keyword,
      texto: textoContexto,
    }).pasa
  ) {
    return null;
  }

  // --- Regla booleana: se evalúa sobre el documento completo ----------------
  if (rule.tipo === 'booleana') {
    if (!rule.regla || !evalBoolean(rule.regla, foldedFull)) return null;
    // Snippet: localiza el primer operando presente en el campo de más peso.
    const ops = operandsOf(rule.regla);
    const mejor = mejorCampoPara(ops, campos, 'contiene');
    return {
      tipo_match: 'booleana',
      texto_match: mejor.texto_match,
      campo: mejor.campo,
      score: round2(mejor.peso),
    };
  }

  // --- Reglas por término (exacta / frase_exacta / contiene / contextual) ---
  const mejor = mejorCampoPara(rule.terminos, campos, rule.tipo);
  if (mejor.peso < 0) return null;
  return {
    tipo_match: rule.tipo,
    texto_match: mejor.texto_match,
    campo: mejor.campo,
    score: round2(mejor.peso),
  };
}

/**
 * Encuentra el campo de mayor peso donde aparezca alguno de los términos.
 * Devuelve peso -1 si no hay match en ningún campo.
 */
function mejorCampoPara(
  terminos: string[],
  campos: CampoBuscable[],
  tipo: TipoKeyword,
): { peso: number; campo: string; texto_match: string } {
  let mejor = { peso: -1, campo: '', texto_match: '' };
  for (const campo of campos) {
    if (!campo.texto) continue;
    const folded = foldText(campo.texto);
    for (const termino of terminos) {
      if (!termino.trim()) continue;
      const hit = buscarTermino(termino, folded, tipo);
      if (hit && campo.peso > mejor.peso) {
        mejor = {
          peso: campo.peso,
          campo: campo.nombre,
          texto_match: snippet(campo.texto, hit.index, hit.len),
        };
      }
    }
  }
  return mejor;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Helper: parte una celda multivalor 'a|b|c' en términos limpios. */
export function splitTerminos(...fuentes: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const f of fuentes) {
    if (!f) continue;
    for (const part of f.split(/[|\n]/)) {
      const t = part.trim();
      if (t) out.push(t);
    }
  }
  return [...new Set(out)];
}
