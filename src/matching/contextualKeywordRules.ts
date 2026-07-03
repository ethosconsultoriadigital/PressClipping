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
import { foldText, anyWordPresent, escapeRegex } from '../matchers/text.js';

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

/** Ventana (en caracteres) para exigir proximidad keyword-comercio ↔ bebidas. */
export const VENTANA_PROXIMIDAD_BEBIDAS = 250;

/**
 * Frases que unen explícitamente comercio + bebidas: si aparecen en cualquier
 * parte (título o cuerpo), la puerta se abre aunque no haya proximidad exacta.
 */
export const FRASES_COMERCIO_BEBIDAS: string[] = [
  'arancel al tequila', 'aranceles al tequila', 'arancel al mezcal', 'aranceles al mezcal',
  'arancel a bebidas alcoholicas', 'aranceles a bebidas alcoholicas',
  'arancel a las bebidas alcoholicas', 'aranceles a las bebidas alcoholicas',
  'exportacion de tequila', 'exportaciones de tequila', 'exportacion de mezcal', 'exportaciones de mezcal',
  'comercio exterior de bebidas alcoholicas', 'comercio exterior de tequila', 'comercio exterior de mezcal',
  'industria tequilera ante aranceles', 'industria tequilera ante el t-mec',
  'industria tequilera ante la revision del t-mec',
  't-mec y tequila', 'tmec y tequila', 't-mec y el tequila', 't-mec y el mezcal',
];

/** Posiciones (índices) de todas las apariciones (límite de palabra) de los términos. */
function posicionesTerminos(foldedTexto: string, terminos: string[]): number[] {
  const out: number[] = [];
  for (const raw of terminos) {
    const term = foldText(raw).trim();
    if (!term) continue;
    const pat = escapeRegex(term).replace(/\s+/g, '\\s+');
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${pat}(?![\\p{L}\\p{N}])`, 'giu');
    let m: RegExpExecArray | null;
    while ((m = re.exec(foldedTexto)) !== null) {
      out.push(m.index);
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  return out;
}

/** ¿Hay una aparición de `ctx` a ≤ ventana caracteres de alguna de `clave`? */
function hayProximidad(
  foldedTexto: string,
  clave: string[],
  ctx: string[],
  ventana: number,
): boolean {
  const posClave = posicionesTerminos(foldedTexto, clave);
  if (posClave.length === 0) return false;
  const posCtx = posicionesTerminos(foldedTexto, ctx);
  if (posCtx.length === 0) return false;
  for (const k of posClave) {
    for (const c of posCtx) {
      if (Math.abs(c - k) <= ventana) return true;
    }
  }
  return false;
}

/**
 * Puerta de proximidad CLI-0002 comercio↔bebidas. La keyword comercial amplia
 * solo pasa si el contexto de bebidas está semánticamente cerca, no en bloques
 * de relacionadas/trending/otras notas. Abre si:
 *   1. El título contiene keyword comercial Y contexto de bebidas.
 *   2. El título contiene contexto de bebidas Y el cuerpo contiene la keyword.
 *   3. Dentro del título o del cuerpo, la keyword y una bebida están a ≤ventana.
 *   4. Aparece una frase explícita que une comercio + bebidas.
 */
export function tieneContextoBebidasCercano(
  titulo: string,
  cuerpo: string,
  terminosKeyword: string[],
  ventana: number = VENTANA_PROXIMIDAD_BEBIDAS,
): boolean {
  const fTit = foldText(titulo);
  const fCue = foldText(cuerpo);
  const full = `${fTit}\n${fCue}`;

  // 4. Frase explícita comercio+bebidas en cualquier parte.
  for (const frase of FRASES_COMERCIO_BEBIDAS) {
    if (full.includes(foldText(frase))) return true;
  }

  const kwEnTitulo = anyWordPresent(terminosKeyword, fTit);
  const kwEnCuerpo = anyWordPresent(terminosKeyword, fCue);
  const bebEnTitulo = anyWordPresent(CONTEXTO_BEBIDAS, fTit);

  // 1. Keyword + bebida en el título.
  if (kwEnTitulo && bebEnTitulo) return true;
  // 2. Bebida en el título + keyword en el cuerpo (título ancla el tema).
  if (bebEnTitulo && kwEnCuerpo) return true;
  // 3. Proximidad dentro del título o del cuerpo.
  if (hayProximidad(fTit, terminosKeyword, CONTEXTO_BEBIDAS, ventana)) return true;
  if (hayProximidad(fCue, terminosKeyword, CONTEXTO_BEBIDAS, ventana)) return true;

  return false;
}

// ---------------------------------------------------------------------------
// CLI-0003 Reforma laboral — puerta laboral
// ---------------------------------------------------------------------------

/**
 * Keywords laborales AMPLIAS que, para CLI-0003, exigen contexto laboral real.
 * NO incluye keywords laborales fuertes (huelga, paro, contrato colectivo,
 * salario mínimo, STPS, tribunal/conciliación…), que ya son accionables por sí
 * mismas y no se gatean.
 */
export const KEYWORDS_LABORAL_AMPLIAS: string[] = [
  'trabajadores', 'trabajador', 'sindicato', 'sindicatos',
  'derechos laborales', 'derecho laboral', 'reforma laboral',
];

const KEYWORDS_LABORAL_AMPLIAS_SET = new Set(KEYWORDS_LABORAL_AMPLIAS);

/**
 * Familias de contexto laboral REAL y accionable. Si alguna aparece (límite de
 * palabra) en título + texto limpio, la puerta laboral se abre.
 */
export const CONTEXTO_LABORAL_ACCIONABLE: string[] = [
  'huelga', 'paro', 'paro de labores', 'paro laboral', 'emplazamiento',
  'contrato colectivo', 'negociacion colectiva', 'revision contractual',
  'salario', 'salarios', 'salario minimo', 'retencion de salario', 'retenciones de salario',
  'prestaciones', 'aguinaldo', 'reparto de utilidades', 'liquidacion', 'indemnizacion',
  'despido', 'despidos', 'reinstalacion', 'jornada laboral', 'reforma laboral',
  'stps', 'secretaria del trabajo', 'tribunal laboral', 'junta de conciliacion',
  'centro federal de conciliacion', 'centro de conciliacion', 'conciliacion laboral',
  'queja laboral', 'quejas laborales', 'conflicto laboral', 'demanda laboral',
  'sindicato minero', 'outsourcing', 'subcontratacion', 'nom-035',
  'riesgo laboral', 'accidente laboral', 'muerte laboral', 'accidente de trabajo',
  'violencia laboral', 'acoso laboral', 'trabajadores desaparecidos', 'pension', 'pensiones',
  'jubilacion', 'sindical', 'seccion sindical', 'lider sindical', 'toma de nota',
];

/**
 * Marcadores de temas off-topic donde una keyword laboral suele aparecer de
 * forma incidental. Solo se usa para diagnóstico/reporte, no decide la puerta
 * (la puerta se decide por AUSENCIA de contexto accionable).
 */
export const OFFTOPIC_LABORAL: string[] = [
  't-mec', 'tratado de libre comercio', 'aranceles', 'comercio exterior',
  'regreso a clases', 'vehicular', 'tramite', 'deporte', 'futbol', 'beisbol',
  'clima', 'pronostico', 'dolar', 'bolsa', 'peso mexicano', 'migracion', 'ciudadania',
];

/** ¿La keyword es una laboral amplia (para la regla CLI-0003)? */
export function esKeywordLaboralAmpliaCli0003(keyword: string): boolean {
  return KEYWORDS_LABORAL_AMPLIAS_SET.has(foldText(keyword).trim());
}

/** ¿El texto tiene contexto laboral real y accionable? */
export function tieneContextoLaboralAccionable(texto: string): boolean {
  const f = foldText(texto);
  if (anyWordPresent(CONTEXTO_LABORAL_ACCIONABLE, f)) return true;
  // Combos específicos accionables (crimen organizado + ámbito sindical).
  const hayNarco = anyWordPresent(['narco', 'narcotrafico', 'crimen organizado', 'delincuencia organizada'], f);
  const haySindical = anyWordPresent(['sindicato', 'sindicatos', 'sindical'], f);
  if (hayNarco && haySindical) return true;
  return false;
}

/** ¿El texto parece off-topic para lo laboral? (solo diagnóstico) */
export function esOffTopicLaboral(texto: string): boolean {
  return anyWordPresent(OFFTOPIC_LABORAL, foldText(texto)) && !tieneContextoLaboralAccionable(texto);
}

export interface PuertaContextualInput {
  cliente_id: string | null;
  keyword: string;
  /** Título + texto limpio (crudo, sin plegar). Compat: si no se dan titulo/cuerpo. */
  texto: string;
  /** Título de la nota (para reglas de proximidad/campo). */
  titulo?: string;
  /** Cuerpo útil (resumen + texto extraído) para reglas de proximidad. */
  cuerpo?: string;
  /** Términos de la keyword (keyword + alias) para localizar el match. */
  terminos?: string[];
}

export interface PuertaContextualResultado {
  pasa: boolean;
  razon?: string;
}

/**
 * Puerta laboral para CLI-0003: keywords amplias solo pasan con contexto
 * laboral accionable. En cualquier otro caso, pasa.
 */
export function pasaPuertaContextualLaboralCli0003(
  input: PuertaContextualInput,
): PuertaContextualResultado {
  if (input.cliente_id === 'CLI-0003' && esKeywordLaboralAmpliaCli0003(input.keyword)) {
    if (tieneContextoLaboralAccionable(input.texto)) return { pasa: true };
    return { pasa: false, razon: 'contexto_laboral_ausente' };
  }
  return { pasa: true };
}

/**
 * Aplica la puerta contextual cliente/keyword.
 *
 * - CLI-0002 con keyword comercial amplia: exige contexto de bebidas (o crisis
 *   directa de bebidas).
 * - CLI-0003 con keyword laboral amplia: exige contexto laboral accionable.
 * En cualquier otro caso, pasa.
 */
export function pasaPuertaContextualClienteKeyword(
  input: PuertaContextualInput,
): PuertaContextualResultado {
  if (input.cliente_id === 'CLI-0002' && esKeywordComercioAmpliaCli0002(input.keyword)) {
    const titulo = input.titulo ?? input.texto;
    const cuerpo = input.cuerpo ?? input.texto;
    const terminos = input.terminos ?? [input.keyword];
    const full = `${titulo}\n${cuerpo}`;
    // Crisis directa de bebidas (metanol, adulterado…) siempre pasa.
    if (esCrisisBebidasDirecta(full)) return { pasa: true };
    // Contexto de bebidas CERCANO (mismo campo/proximidad/frase explícita).
    if (tieneContextoBebidasCercano(titulo, cuerpo, terminos)) return { pasa: true };
    // Falla: distinguir si hay bebida lejana (boilerplate) o no hay bebida.
    if (tieneContextoBebidas(full)) return { pasa: false, razon: 'contexto_bebidas_no_cercano' };
    return { pasa: false, razon: 'contexto_bebidas_ausente' };
  }
  if (input.cliente_id === 'CLI-0003' && esKeywordLaboralAmpliaCli0003(input.keyword)) {
    return pasaPuertaContextualLaboralCli0003(input);
  }
  return { pasa: true };
}
