/**
 * Lógica PURA de aprobación editorial GPT para el preview Patrón (tab 13).
 *
 * La auditoría externa (GPT) revisó las 9 filas de `13_Patron_Final_Preview` y
 * dictaminó, por TÍTULO exacto, cuáles 6 están aprobadas para la hoja final
 * `NoticiasPatron` y cuáles 3 quedan en revisión humana (ninguna exclusión
 * definitiva). Esta lista es fija y explícita — no se infiere por reglas.
 *
 * Sin red, sin IA: solo normaliza y compara contra el dictamen dado.
 */

export type EstadoAprobacion = 'APROBADO' | 'REVISION_HUMANA';

/** Dictamen editorial GPT (2026-07-13) — 6 aprobadas para NoticiasPatron. */
export const TITULOS_APROBADOS: string[] = [
  'Alerta por tequila falso: el truco infalible para no caer en trampas de WhatsApp',
  'Morelos avanza en certificación del mezcal',
  'Detectan tequila presuntamente adulterado en Rincón de Tamayo',
  '"Hay agave pirata", acusa Miguel Márquez y exige frenar deforestación en Guanajuato',
  'Muertes por alcohol adulterado bajan un 30% la clientela en bares y cantinas de Salamanca',
  'Caen ventas de tequila Centenario tras intoxicaciones en Guanajuato',
];

/** 3 retenidas para revisión humana — NUNCA deben escribirse en NoticiasPatron. */
export const TITULOS_REVISION_HUMANA: string[] = [
  'Arriban a Topolobampo equipos de alta tecnología para la Planta de Fertilizantes',
  'Jardín Corona más de 55 años de tradición única en Irapuato; conoce uno de los pocos espacios solo para hombres en la ciudad',
  'Gamesa, Sabritas y Turín: las 10 empresas mexicanas que ahora pertenecen a gigantes extranjeros',
];

/** Comillas curvas dobles: U+201C “ / U+201D ” (construidas por codepoint, sin depender del encoding del archivo). */
const COMILLAS_DOBLES_CURVAS = new RegExp(`[${String.fromCharCode(0x201c)}${String.fromCharCode(0x201d)}]`, 'g');
/** Comillas curvas simples: U+2018 ‘ / U+2019 ’. */
const COMILLAS_SIMPLES_CURVAS = new RegExp(`[${String.fromCharCode(0x2018)}${String.fromCharCode(0x2019)}]`, 'g');

/** Normaliza un título para comparación (trim, comillas curvas→rectas, espacios). */
export function normalizarTitulo(titulo: string): string {
  return titulo
    .trim()
    .replace(COMILLAS_DOBLES_CURVAS, '"')
    .replace(COMILLAS_SIMPLES_CURVAS, "'")
    .replace(/\s+/g, ' ');
}

const APROBADOS_NORM = new Set(TITULOS_APROBADOS.map(normalizarTitulo));
const REVISION_NORM = new Set(TITULOS_REVISION_HUMANA.map(normalizarTitulo));

/**
 * Clasifica un título según el dictamen editorial GPT fijo. Un título que no
 * está en NINGUNA de las dos listas se trata como REVISION_HUMANA por defecto
 * (nunca se asume aprobado sin estar explícitamente en la lista aprobada).
 */
export function clasificarAprobacion(titulo: string): EstadoAprobacion {
  const t = normalizarTitulo(titulo);
  if (APROBADOS_NORM.has(t)) return 'APROBADO';
  return 'REVISION_HUMANA';
}

/** ¿El título está explícitamente en la lista de revisión humana conocida? */
export function esRevisionHumanaConocida(titulo: string): boolean {
  return REVISION_NORM.has(normalizarTitulo(titulo));
}
