/**
 * Lógica editorial para CLI-MERY-TEST (Mery Pozos / Merilyn Gómez Pozos).
 *
 * Clasificación en 5 categorías, sin dependencias de Supabase ni de Sheets.
 * KEY-0040..0047: frase_exacta, alerta=true (Tier 1 + Tier 2 — nombre/cargo).
 * KEY-0048..0051: exacta_contextual, alerta=false (Tier 3 — variantes amplias).
 */

export type CategoriaEditorialMery =
  | 'MENCION_DIRECTA'
  | 'CONTEXTO_POLITICO'
  | 'TEMA_RELACIONADO'
  | 'POSIBLE_FP'
  | 'EXCLUIR';

/** IDs de keywords Tier 1 + Tier 2 (frase_exacta, alerta=true). */
export const TIER_ALTA_IDS = new Set([
  'KEY-0040', 'KEY-0041', 'KEY-0042', 'KEY-0043',
  'KEY-0044', 'KEY-0045', 'KEY-0046', 'KEY-0047',
]);

/** IDs de keywords Tier 3 (exacta_contextual, alerta=false). */
export const TIER_BAJA_IDS = new Set([
  'KEY-0048', 'KEY-0049', 'KEY-0050', 'KEY-0051',
]);

/** Prioridad de categoría para fusión por noticia_id (mayor = más importante). */
export const PRIORIDAD_CAT: Record<CategoriaEditorialMery, number> = {
  POSIBLE_FP: 5,
  MENCION_DIRECTA: 4,
  CONTEXTO_POLITICO: 3,
  TEMA_RELACIONADO: 2,
  EXCLUIR: 1,
};

/** Secciones fijas / programas que no son noticias directas sobre la diputada. */
const FP_TITULO_RE = /\bla tremenda corte\b/i;

/** Patrones que detectan el nombre/cargo en el título. */
const NOMBRE_EN_TITULO_RE =
  /mery pozos|merilyn g[oó]mez\b|mery g[oó]mez pozos|diputada mery/i;

/** Patrones que validan la presencia del nombre en el cuerpo del artículo. */
const NOMBRE_EN_CUERPO_RE =
  /mery pozos|merilyn g[oó]mez pozos|diputada mery|diputada merilyn/i;

/**
 * Clasifica una mención individual a partir del título del artículo, el
 * keyword_id que disparó la detección y, opcionalmente, el cuerpo del artículo.
 *
 * Si el título es "La Tremenda Corte" pero el cuerpo menciona explícitamente
 * a Mery Pozos, se reclasifica como CONTEXTO_POLITICO en lugar de POSIBLE_FP.
 */
export function clasificarMery(
  titulo: string,
  keywordId: string,
  textoBody?: string,
): CategoriaEditorialMery {
  if (FP_TITULO_RE.test(titulo)) {
    if (textoBody && NOMBRE_EN_CUERPO_RE.test(textoBody)) return 'CONTEXTO_POLITICO';
    return 'POSIBLE_FP';
  }
  if (TIER_ALTA_IDS.has(keywordId)) {
    return NOMBRE_EN_TITULO_RE.test(titulo) ? 'MENCION_DIRECTA' : 'CONTEXTO_POLITICO';
  }
  if (TIER_BAJA_IDS.has(keywordId)) return 'TEMA_RELACIONADO';
  return 'TEMA_RELACIONADO';
}

/** Exportado para tests — detecta nombre en cuerpo del artículo. */
export { NOMBRE_EN_CUERPO_RE };

/** Estado editorial derivado de la categoría. */
export function estadoEditorialMery(cat: CategoriaEditorialMery): string {
  if (cat === 'MENCION_DIRECTA') return 'GO_DIRECTA';
  if (cat === 'CONTEXTO_POLITICO') return 'GO_CONTEXTO';
  if (cat === 'EXCLUIR') return 'EXCLUIDA';
  return 'REVISION_HUMANA';
}

/** Tab de destino para cada categoría. */
export function tabDestinoMery(
  cat: CategoriaEditorialMery,
): '16_Mery_Final_Preview' | '17_Mery_Revision_Humana' | '18_Mery_Excluidas' {
  if (cat === 'MENCION_DIRECTA' || cat === 'CONTEXTO_POLITICO') return '16_Mery_Final_Preview';
  if (cat === 'EXCLUIR') return '18_Mery_Excluidas';
  return '17_Mery_Revision_Humana';
}

/** Razón de clasificación legible. */
export function razonClasificacionMery(
  cat: CategoriaEditorialMery,
  titulo: string,
  keywordId: string,
): string {
  if (cat === 'POSIBLE_FP')
    return `Título fijo/sección detectada: "${titulo.slice(0, 60)}" — verificar manualmente`;
  if (cat === 'MENCION_DIRECTA') return `Nombre en título (${keywordId})`;
  if (cat === 'CONTEXTO_POLITICO' && FP_TITULO_RE.test(titulo))
    return 'Mención validada en cuerpo aunque el título es columna genérica';
  if (cat === 'CONTEXTO_POLITICO') return `Keyword Tier 1/2 en cuerpo sin nombre en título (${keywordId})`;
  if (cat === 'TEMA_RELACIONADO') return `Keyword Tier 3 variante amplia (${keywordId})`;
  return 'Excluido';
}

/** Detecta grupo temático desde el título cuando no hay clasificación IA disponible. */
export function detectGrupoTemaMery(titulo: string): string {
  const t = titulo.toLowerCase();
  if (/agua|siapa|jalisco|guadalajara|privatiz|plomo|mercurio|ac[uú]ífero/.test(t))
    return 'JALISCO_AGUA';
  if (/c[aá]mara|san l[aá]zaro|diputad|legislati|reforma|iniciativa|congreso/.test(t))
    return 'LEGISLATIVO';
  if (/candidat|elecci[oó]n|encuesta/.test(t)) return 'ELECTORAL';
  return 'POLITICO_GENERAL';
}
