/**
 * Normalización de texto para matching de keywords.
 *
 * A diferencia de hash.ts (que usa NFD y altera longitudes), aquí el plegado
 * es 1:1 en longitud: minúsculas + sustitución de vocales acentuadas y ñ por
 * su base. Así los índices del texto plegado coinciden con el texto original,
 * lo que permite extraer fragmentos (snippets) sin desalinear posiciones.
 */
const FOLD_MAP: Record<string, string> = {
  á: 'a', à: 'a', ä: 'a', â: 'a', ã: 'a',
  é: 'e', è: 'e', ë: 'e', ê: 'e',
  í: 'i', ì: 'i', ï: 'i', î: 'i',
  ó: 'o', ò: 'o', ö: 'o', ô: 'o', õ: 'o',
  ú: 'u', ù: 'u', ü: 'u', û: 'u',
  ñ: 'n',
};

/** Pliega acentos y pasa a minúsculas conservando la longitud de la cadena. */
export function foldText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[áàäâãéèëêíìïîóòöôõúùüûñ]/g, (c) => FOLD_MAP[c] ?? c);
}

/** Escapa una cadena para usarla literal dentro de un RegExp. */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Construye un RegExp con límites de palabra Unicode alrededor de `term`.
 * Para frases, los espacios internos toleran múltiples espacios/saltos.
 * El término debe venir ya plegado (foldText) y en minúsculas.
 */
export function termRegex(term: string): RegExp {
  const folded = escapeRegex(term).replace(/\s+/g, '\\s+');
  return new RegExp(`(?<![\\p{L}\\p{N}])${folded}(?![\\p{L}\\p{N}])`, 'iu');
}

/** Índice de la primera aparición con límite de palabra, o -1. */
export function indexOfWord(term: string, foldedText: string): number {
  const m = termRegex(foldText(term)).exec(foldedText);
  return m ? m.index : -1;
}

/** Índice de la primera aparición como subcadena simple, o -1. */
export function indexOfSubstring(term: string, foldedText: string): number {
  return foldedText.indexOf(foldText(term));
}

/** ¿Aparece alguno de los términos (límite de palabra) en el texto plegado? */
export function anyWordPresent(terms: string[], foldedText: string): boolean {
  return terms.some((t) => t.trim() !== '' && indexOfWord(t, foldedText) >= 0);
}
