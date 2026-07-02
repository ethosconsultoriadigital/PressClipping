/**
 * Puertas de contexto por cliente/keyword — lógica PURA (sin DB ni red).
 *
 * Motivación: keywords comerciales amplias (T-MEC, aranceles, comercio exterior,
 * exportación/exportaciones) son útiles para CLI-0002 (Bebidas alcohólicas) SOLO
 * cuando la nota habla del sector bebidas/tequila/agave. Sin esa señal capturan
 * notas genéricas de comercio (Trump, aranceles a autos/acero, T-MEC político),
 * generando falsos positivos.
 *
 * Esta puerta se aplica DESPUÉS de que el matcher encontró coincidencia de la
 * keyword: si la keyword es comercial-amplia y el cliente es CLI-0002, exige al
 * menos una señal de contexto de bebidas; si no la hay, descarta la mención.
 *
 * NO afecta a keywords de crisis directa de bebidas (tequila adulterado, metanol,
 * etc.), que llevan su propio contexto de bebidas y por tanto pasan.
 */
import { foldText, anyWordPresent } from '../matchers/text.js';

/** Keywords comerciales amplias que, para CLI-0002, exigen contexto de bebidas. */
export const KEYWORDS_COMERCIO_AMPLIAS: string[] = [
  't-mec', 'tmec', 'aranceles', 'arancel', 'comercio exterior',
  'exportacion', 'exportaciones',
];

const KEYWORDS_COMERCIO_AMPLIAS_SET = new Set(KEYWORDS_COMERCIO_AMPLIAS);

/**
 * Familias de contexto POSITIVO de bebidas para CLI-0002. Si alguna aparece
 * (límite de palabra) en el título + texto limpio, la puerta se abre.
 */
export const CONTEXTO_BEBIDAS: string[] = [
  'tequila', 'mezcal', 'agave', 'destilado', 'destilados',
  'alcohol', 'alcoholica', 'alcoholicas', 'bebida alcoholica', 'bebidas alcoholicas',
  'bebida espirituosa', 'bebidas espirituosas', 'espirituosa', 'espirituosas',
  'licor', 'licores', 'vino', 'vinos', 'cerveza', 'cervezas', 'aguardiente',
  'ron', 'whisky', 'whiskey', 'vodka', 'ginebra', 'brandy', 'mezcalera',
  'industria tequilera', 'tequilera', 'consejo regulador del tequila', 'crt',
  'bacardi', 'patron', 'tequila patron', 'casa patron', 'jose cuervo', 'cuervo',
  'vinicola', 'vitivinicola', 'cerveceria', 'destileria',
];

/**
 * Crisis directa de bebidas que SIEMPRE pasa (aunque haya llegado por una
 * keyword comercial). Redundante con CONTEXTO_BEBIDAS en la mayoría de casos,
 * pero cubre "metanol" suelto que denota alcohol adulterado.
 */
export const CRISIS_BEBIDAS_DIRECTA: string[] = [
  'tequila adulterado', 'alcohol adulterado', 'bebidas adulteradas', 'bebida adulterada',
  'licor adulterado', 'destilado adulterado', 'destilados adulterados', 'mezcal adulterado',
  'bebidas clandestinas', 'metanol', 'intoxicacion por alcohol', 'decomiso de alcohol',
];

/** ¿La keyword es una de las comerciales amplias (para la regla CLI-0002)? */
export function esKeywordComercioAmpliaCli0002(keyword: string): boolean {
  return KEYWORDS_COMERCIO_AMPLIAS_SET.has(foldText(keyword).trim());
}

/** ¿El texto (título + cuerpo) tiene contexto de bebidas/alcohol/tequila? */
export function tieneContextoBebidas(texto: string): boolean {
  return anyWordPresent(CONTEXTO_BEBIDAS, foldText(texto));
}

/** ¿El texto denota una crisis directa de bebidas/alcohol adulterado? */
export function esCrisisBebidasDirecta(texto: string): boolean {
  return anyWordPresent(CRISIS_BEBIDAS_DIRECTA, foldText(texto));
}

export interface PuertaContextualInput {
  cliente_id: string | null;
  keyword: string;
  /** Título + texto limpio (crudo, sin plegar). */
  texto: string;
}

export interface PuertaContextualResultado {
  pasa: boolean;
  razon?: string;
}

/**
 * Aplica la puerta contextual cliente/keyword.
 *
 * Regla actual: para CLI-0002 con keyword comercial amplia, exige contexto de
 * bebidas (o crisis directa de bebidas). En cualquier otro caso, pasa.
 */
export function pasaPuertaContextualClienteKeyword(
  input: PuertaContextualInput,
): PuertaContextualResultado {
  if (input.cliente_id === 'CLI-0002' && esKeywordComercioAmpliaCli0002(input.keyword)) {
    if (esCrisisBebidasDirecta(input.texto) || tieneContextoBebidas(input.texto)) {
      return { pasa: true };
    }
    return { pasa: false, razon: 'contexto_bebidas_ausente' };
  }
  return { pasa: true };
}
