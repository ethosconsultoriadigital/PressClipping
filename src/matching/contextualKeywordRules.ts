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

// ---------------------------------------------------------------------------
// CLI-0002 Tequila — puerta contextual de tres niveles
// ---------------------------------------------------------------------------
//
// La keyword amplia `tequila` (KEY-0003) captura mucho ruido turístico/cultural
// /entretenimiento/homónimo del municipio de Tequila, y a la vez su config rígida
// (contexto_incluir industrial) hace que se PIERDA la crisis real de salud
// (tequila adulterado / metanol / intoxicación / decomiso). Esta puerta resuelve
// ambos problemas con una política determinística de proximidad:
//
//   Nivel A (crisis/salud)  → PASA (posible P1 vía keywords de alerta dedicadas)
//   Nivel B (industria/comercio/regulación) → PASA (mención/P2)
//   Nivel C (turismo/evento/gastronomía/cultura/homónimo) → BLOQUEA
//   Sin contexto suficiente → BLOQUEA
//
// Solo aplica a CLI-0002 + keyword amplia de tequila; el resto no se toca.

/** Términos que anclan el tema "tequila/agave" para las reglas de proximidad. */
export const TERMINOS_TEQUILA: string[] = [
  'tequila', 'tequilas', 'agave', 'agave azul', 'industria tequilera',
  'tequilera', 'tequilero',
];

/** Nivel A — contexto de crisis/salud/seguridad sanitaria de la bebida. */
export const CONTEXTO_CRISIS_TEQUILA: string[] = [
  'adulterado', 'adulterada', 'adulterados', 'adulteradas', 'adulteracion',
  'falsificado', 'falsificada', 'falsificacion', 'apocrifo', 'apocrifa', 'pirata',
  'contaminado', 'contaminada', 'metanol', 'alcohol metilico', 'metilico',
  'intoxicacion', 'intoxicaciones', 'intoxicado', 'intoxicados', 'intoxicada',
  'envenenamiento', 'envenenado', 'envenenados',
  'muere', 'muerte', 'muertes', 'muertos', 'fallece', 'fallecen', 'fallecido',
  'fallecidos', 'hospitalizado', 'hospitalizados', 'hospital', 'coma',
  'alerta sanitaria', 'riesgo sanitario', 'sanitaria', 'cofepris',
  'decomiso', 'decomisan', 'cateo', 'catean', 'aseguramiento', 'aseguran',
  'clandestino', 'clandestina', 'clandestinas', 'vinateria', 'vinaterias',
  'ilicito', 'ilicita', 'ilegal', 'bebida adulterada', 'alcohol adulterado',
  'tequila adulterado',
];

/**
 * Nivel B — industria/comercio/regulación real de la bebida. Exige proximidad
 * ESTRECHA con un término de tequila (VENTANA_B) para no colar notas genéricas
 * de exportación/producción donde el tequila aparece de pasada.
 */
export const CONTEXTO_INDUSTRIA_TEQUILA: string[] = [
  'exportacion', 'exportaciones', 'arancel', 'aranceles', 't-mec', 'tmec',
  'comercio exterior', 'crt', 'consejo regulador del tequila',
  'consejo regulador del mezcal', 'industria tequilera', 'tequilera',
  'denominacion de origen', 'ieps', 'produccion de tequila', 'agave azul',
  'nom-006', 'nom-070', 'comercam',
];

/** Nivel C — contexto turístico/entretenimiento/gastronómico/cultural/homónimo. */
export const CONTEXTO_TEQUILA_BAJO_VALOR: string[] = [
  'pueblo magico', 'turismo', 'turistico', 'turistica', 'turisticos', 'turista',
  'turistas', 'destino', 'destinos', 'viaje', 'viajes', 'hotel', 'hospedaje',
  'ruta del tequila', 'festival', 'feria', 'concierto', 'conciertos', 'evento',
  'eventos', 'fan zone', 'fanzone', 'gastronomia', 'gastronomico', 'culinaria',
  'receta', 'recetas', 'coctel', 'cocteles', 'cocteleria', 'maridaje', 'cata',
  'catas', 'degustacion', 'promocion', 'promociones', 'oferta', 'ofertas',
  'descuento', 'descuentos', 'amazon', 'ranking', 'cultura', 'cultural',
  'culturales', 'deporte', 'deportivo', 'deportes', 'futbol', 'seleccion',
  'mundial', 'orgullo', 'cantina', 'antro', 'bar', 'bares', 'restaurante',
  'restaurantes', 'show', 'espectaculo', 'espectaculos', 'musica', 'concurso',
  'celebra', 'celebrar', 'celebracion', 'fiesta', 'fiestas',
  'dia nacional del tequila', 'dia del tequila', 'famoso', 'famosos',
  'celebridad', 'influencer', 'pelicula', 'serie', 'robo', 'robos', 'detenido',
  'detenidos', 'captura', 'capturado', 'homicidio', 'asesinato', 'droga',
  'drogas', 'marihuana', 'reclusorio', 'armado', 'abuso',
];

/** Ventana amplia para crisis (prioriza recall de salud). */
export const VENTANA_CRISIS_TEQUILA = VENTANA_PROXIMIDAD_BEBIDAS; // 250
/** Ventana estrecha para industria (prioriza precisión: mismo párrafo/frase). */
export const VENTANA_INDUSTRIA_TEQUILA = 120;

/** ¿La keyword es la amplia de tequila (para la regla CLI-0002)? */
export function esKeywordTequilaAmpliaCli0002(keyword: string): boolean {
  const k = foldText(keyword).trim();
  return k === 'tequila' || k === 'industria tequilera' || k === 'agave';
}

/**
 * ¿Alguno de los `ctx` aparece semánticamente CERCA de un término de tequila?
 * - `tituloAncla=true` (crisis): si tequila está en el título, basta que el ctx
 *   aparezca en el cuerpo (el título fija el tema → alta recall de crisis).
 * - `tituloAncla=false` (industria): exige coocurrencia en el título o
 *   proximidad ≤ ventana; evita colar exportaciones/producción genéricas.
 */
function contextoTequilaCercano(
  titulo: string,
  cuerpo: string,
  ctx: string[],
  ventana: number,
  tituloAncla: boolean,
): boolean {
  const fTit = foldText(titulo);
  const fCue = foldText(cuerpo);
  const teqEnTitulo = anyWordPresent(TERMINOS_TEQUILA, fTit);
  const ctxEnTitulo = anyWordPresent(ctx, fTit);
  if (teqEnTitulo && ctxEnTitulo) return true;
  if (tituloAncla && teqEnTitulo && anyWordPresent(ctx, fCue)) return true;
  if (hayProximidad(fTit, TERMINOS_TEQUILA, ctx, ventana)) return true;
  if (hayProximidad(fCue, TERMINOS_TEQUILA, ctx, ventana)) return true;
  return false;
}

/** Nivel A: crisis/salud de la bebida cercana a tequila (recall alto). */
export function tieneContextoCrisisTequila(titulo: string, cuerpo: string): boolean {
  return contextoTequilaCercano(titulo, cuerpo, CONTEXTO_CRISIS_TEQUILA, VENTANA_CRISIS_TEQUILA, true);
}

/** Nivel B: industria/comercio/regulación cercana a tequila (precisión alta). */
export function tieneContextoIndustriaTequila(titulo: string, cuerpo: string): boolean {
  return contextoTequilaCercano(titulo, cuerpo, CONTEXTO_INDUSTRIA_TEQUILA, VENTANA_INDUSTRIA_TEQUILA, false);
}

/**
 * Marcadores FUERTES de bajo valor que, si aparecen en el TÍTULO, dominan la
 * nota (evento/turismo/gastronomía/homónimo). Si el título es de este tipo y no
 * hay crisis, se bloquea aunque el cuerpo tenga proximidad industrial suelta
 * (p.ej. "Fiesta de la Cerveza" que menciona agave, o "Fonatur en Michoacán").
 */
export const MARCADORES_BAJO_VALOR_TITULO: string[] = [
  'festival', 'feria', 'fiesta', 'concierto', 'conciertos', 'evento', 'eventos',
  'pueblo magico', 'turismo', 'turistico', 'turistica', 'turisticos', 'turistas',
  'fonatur', 'gastronomia', 'gastronomico', 'receta', 'recetas', 'coctel',
  'cocteles', 'maridaje', 'cata', 'degustacion', 'ranking', 'cartelera',
  'fan zone', 'concurso', 'show', 'espectaculo', 'espectaculos',
  'dia nacional del tequila', 'dia del tequila',
];

/** Nivel C: contexto turístico/entretenimiento/homónimo de bajo valor. */
export function esContextoTequilaBajoValor(texto: string): boolean {
  return anyWordPresent(CONTEXTO_TEQUILA_BAJO_VALOR, foldText(texto));
}

/** ¿El TÍTULO está dominado por un marcador fuerte de bajo valor? */
export function esTituloTequilaBajoValor(titulo: string): boolean {
  return anyWordPresent(MARCADORES_BAJO_VALOR_TITULO, foldText(titulo));
}

export interface TequilaGateResultado {
  pasa: boolean;
  /** Nivel de la política que abrió la puerta (A crisis / B industria). */
  nivel?: 'A' | 'B';
  razon?: string;
}

/**
 * Puerta contextual de tres niveles para `tequila` (CLI-0002). Evalúa título +
 * cuerpo (resumen + texto limpio) y decide por proximidad, no por mera presencia.
 */
export function pasaPuertaContextualTequilaCli0002(
  input: PuertaContextualInput,
): TequilaGateResultado {
  const titulo = input.titulo ?? input.texto;
  const cuerpo = input.cuerpo ?? input.texto;
  // Nivel A — crisis/salud (prioridad sobre bajo valor: "muertes por tequila
  // adulterado en festival" es crisis, no evento).
  if (tieneContextoCrisisTequila(titulo, cuerpo)) {
    return { pasa: true, nivel: 'A', razon: 'tequila_contexto_crisis' };
  }
  // Override: título de evento/turismo domina (no es crisis) → bloquea.
  if (esTituloTequilaBajoValor(titulo)) {
    return { pasa: false, razon: 'tequila_contexto_bajo_valor' };
  }
  // Nivel B — industria/comercio/regulación real.
  if (tieneContextoIndustriaTequila(titulo, cuerpo)) {
    return { pasa: true, nivel: 'B', razon: 'tequila_contexto_industria' };
  }
  // Nivel C — bajo valor explícito.
  const full = `${titulo}\n${cuerpo}`;
  if (esContextoTequilaBajoValor(full)) {
    return { pasa: false, razon: 'tequila_contexto_bajo_valor' };
  }
  // Sin señal suficiente.
  return { pasa: false, razon: 'tequila_contexto_insuficiente' };
}

// ---------------------------------------------------------------------------
// CLI-0001 Jumex — puerta contextual de tres niveles
// ---------------------------------------------------------------------------
//
// Las keywords amplias de CLI-0001 (`Jumex`, `bebidas azucaradas`, y —de existir—
// `jugos`/`néctares`/`IEPS bebidas azucaradas`) capturan mucho ruido de PROMOCIÓN
// RETAIL (Soriana, Julio Regalado, folletos 3x2, Temporada Naranja), gastronomía
// (recetas/loncheras/cócteles) y contenido genérico donde Jumex aparece como
// producto en oferta o patrocinador, sin valor reputacional/regulatorio. A la vez
// se debe conservar la señal REAL: crisis/regulatorio (COFEPRIS, Profeco, retiro
// de producto, IEPS/etiquetado con categoría) y corporativo/sectorial (Grupo
// Jumex, inversión, planta, exportación).
//
//   Nivel A (crisis/regulatorio con marca o categoría) → PASA (posible alerta)
//   Nivel B (corporativo/sectorial real)               → PASA (mención/P2)
//   Nivel C (promo retail/supermercado/receta/genérico) → BLOQUEA
//   Sin contexto suficiente → BLOQUEA
//
// Solo aplica a CLI-0001 + keyword amplia; el resto de clientes no se toca.
// La keyword `Museo Jumex` (marca específica del museo de arte) NO se gatea.

/** Keywords amplias de CLI-0001 que exigen puerta contextual. */
export const KEYWORDS_JUMEX_AMPLIAS: string[] = [
  'jumex', 'bebidas azucaradas', 'bebida azucarada', 'jugos', 'jugo',
  'nectares', 'nectar', 'ieps bebidas azucaradas', 'ieps jugos', 'ieps refrescos',
];

const KEYWORDS_JUMEX_AMPLIAS_SET = new Set(KEYWORDS_JUMEX_AMPLIAS);

/** Términos que anclan la marca/categoría del cliente para la proximidad. */
export const TERMINOS_JUMEX: string[] = [
  'jumex', 'grupo jumex', 'bebidas azucaradas', 'bebida azucarada',
  'jugos', 'jugo', 'nectares', 'nectar', 'refresco', 'refrescos',
];

/** Nivel A — crisis reputacional / regulatorio-fiscal / salud con marca o categoría. */
export const CONTEXTO_CRISIS_JUMEX: string[] = [
  'contaminado', 'contaminada', 'contaminacion', 'adulterado', 'adulterada',
  'retiro de producto', 'retiro de lote', 'retira lote', 'recall', 'retirado del mercado',
  'cofepris', 'profeco', 'alerta sanitaria', 'riesgo sanitario', 'sanitaria',
  'sancion', 'sancionado', 'sanciona', 'multa', 'multado', 'demanda', 'demandado',
  'amparo', 'litigio', 'boicot', 'denuncia', 'clausura', 'clausurado',
  'huelga', 'paro', 'paro de labores', 'emplazamiento', 'sindicato',
  'accidente', 'incendio', 'explosion', 'derrame', 'intoxicacion', 'brote',
  'crisis', 'reputacion', 'etiquetado frontal', 'etiquetado', 'sello', 'octagono',
  'octagonos', 'exceso de azucar', 'exceso de calorias', 'comida chatarra',
  'ieps', 'impuesto', 'impuestos', 'reforma fiscal', 'obesidad', 'diabetes', 'salud publica',
];

/** Nivel B — corporativo / sectorial / comercio-industria real. */
export const CONTEXTO_CORPORATIVO_JUMEX: string[] = [
  'grupo jumex', 'planta', 'fabrica', 'inversion', 'invertira', 'inaugura',
  'exportacion', 'exportaciones', 'exporta', 'ventas', 'facturacion', 'ingresos',
  'adquisicion', 'adquiere', 'expansion', 'nuevo producto', 'lanzamiento', 'lanza',
  'campana', 'patrocinio', 'patrocinador', 'alianza', 'acuerdo comercial',
  'camara empresarial', 'anpec', 'concamin', 'canacintra', 'coparmex',
  'industria de jugos', 'industria de bebidas', 'bebidas no alcoholicas',
  'participacion de mercado', 'directivo', 'director general', 'ceo',
  'presidente de jumex', 'empleos', 'planta de produccion', 'produccion',
];

/** Nivel C — promoción retail / supermercado / gastronomía / genérico de bajo valor. */
export const CONTEXTO_JUMEX_BAJO_VALOR: string[] = [
  'soriana', 'julio regalado', 'temporada naranja', 'walmart', 'chedraui', 'oxxo',
  'la comer', 'bodega aurrera', 'aurrera', 'sams club', 'sam s club', 'costco',
  'heb', 'supermercado', 'supermercados', 'autoservicio', 'tienda', 'tiendas',
  'folleto', 'folletos', 'catalogo', 'catalogos', 'volante', '2x1', '3x2', '4x3',
  'oferta', 'ofertas', 'descuento', 'descuentos', 'promocion', 'promociones',
  'promo', 'cupon', 'cupones', 'buen fin', 'hot sale', 'rebaja', 'rebajas',
  'precio', 'precios', 'ahorra', 'ahorro', 'ahorrar', 'barato', 'baratos',
  'receta', 'recetas', 'lonchera', 'loncheras', 'coctel', 'cocteles', 'smoothie',
  'licuado', 'licuados', 'gastronomia', 'menu', 'desayuno', 'merienda', 'postre',
];

/** Marcadores FUERTES de promo retail que, si están en el TÍTULO, dominan la nota. */
export const MARCADORES_JUMEX_BAJO_VALOR_TITULO: string[] = [
  'soriana', 'julio regalado', 'temporada naranja', 'walmart', 'chedraui',
  'bodega aurrera', 'folleto', 'catalogo', 'oferta', 'ofertas', 'descuento',
  'descuentos', 'promocion', 'promociones', '2x1', '3x2', '4x3', 'buen fin',
  'hot sale', 'rebaja', 'receta', 'recetas', 'lonchera',
];

/** Ventana amplia para crisis/regulatorio (prioriza recall). */
export const VENTANA_CRISIS_JUMEX = VENTANA_PROXIMIDAD_BEBIDAS; // 250
/** Ventana estrecha para corporativo (prioriza precisión). */
export const VENTANA_CORPORATIVO_JUMEX = 150;

/** ¿La keyword es una amplia de CLI-0001 (para la regla Jumex)? */
export function esKeywordJumexAmpliaCli0001(keyword: string): boolean {
  return KEYWORDS_JUMEX_AMPLIAS_SET.has(foldText(keyword).trim());
}

/**
 * ¿Alguno de los `ctx` aparece CERCA de un término de marca/categoría Jumex?
 * Mismo patrón que tequila: coocurrencia en título ancla, o proximidad ≤ ventana.
 */
function contextoJumexCercano(
  titulo: string,
  cuerpo: string,
  ctx: string[],
  ventana: number,
  terminos: string[],
  tituloAncla: boolean,
): boolean {
  const anclas = terminos.length > 0 ? terminos : TERMINOS_JUMEX;
  const fTit = foldText(titulo);
  const fCue = foldText(cuerpo);
  const marcaEnTitulo = anyWordPresent(anclas, fTit);
  const ctxEnTitulo = anyWordPresent(ctx, fTit);
  if (marcaEnTitulo && ctxEnTitulo) return true;
  if (tituloAncla && marcaEnTitulo && anyWordPresent(ctx, fCue)) return true;
  if (hayProximidad(fTit, anclas, ctx, ventana)) return true;
  if (hayProximidad(fCue, anclas, ctx, ventana)) return true;
  return false;
}

/** Nivel A: crisis/regulatorio/salud cercano a marca o categoría (recall alto). */
export function tieneContextoCrisisJumex(
  titulo: string, cuerpo: string, terminos: string[] = TERMINOS_JUMEX,
): boolean {
  return contextoJumexCercano(titulo, cuerpo, CONTEXTO_CRISIS_JUMEX, VENTANA_CRISIS_JUMEX, terminos, true);
}

/** Nivel A (regulatorio explícito): IEPS/impuesto/etiquetado cerca de categoría/marca. */
export function tieneContextoRegulatorioJumex(
  titulo: string, cuerpo: string, terminos: string[] = TERMINOS_JUMEX,
): boolean {
  const reg = ['ieps', 'impuesto', 'impuestos', 'reforma fiscal', 'etiquetado frontal',
    'etiquetado', 'sello', 'octagono', 'octagonos', 'cofepris', 'profeco', 'exceso de azucar'];
  return contextoJumexCercano(titulo, cuerpo, reg, VENTANA_CRISIS_JUMEX, terminos, true);
}

/** Nivel B: corporativo/sectorial cercano a marca o categoría (precisión alta). */
export function tieneContextoCorporativoJumex(
  titulo: string, cuerpo: string, terminos: string[] = TERMINOS_JUMEX,
): boolean {
  return contextoJumexCercano(titulo, cuerpo, CONTEXTO_CORPORATIVO_JUMEX, VENTANA_CORPORATIVO_JUMEX, terminos, false);
}

/** Nivel C: contexto de promo retail/supermercado/gastronomía/genérico. */
export function esContextoJumexBajoValor(texto: string): boolean {
  return anyWordPresent(CONTEXTO_JUMEX_BAJO_VALOR, foldText(texto));
}

/** ¿El TÍTULO está dominado por un marcador fuerte de promo retail? */
export function esTituloJumexBajoValor(titulo: string): boolean {
  return anyWordPresent(MARCADORES_JUMEX_BAJO_VALOR_TITULO, foldText(titulo));
}

export interface JumexGateResultado {
  pasa: boolean;
  nivel?: 'A' | 'B';
  razon?: string;
}

/**
 * Puerta contextual de tres niveles para keywords amplias de CLI-0001 (Jumex).
 * Evalúa título + cuerpo por proximidad, no por mera presencia.
 */
export function pasaPuertaContextualJumexCli0001(
  input: PuertaContextualInput,
): JumexGateResultado {
  const titulo = input.titulo ?? input.texto;
  const cuerpo = input.cuerpo ?? input.texto;
  const terminos = input.terminos && input.terminos.length > 0 ? input.terminos : TERMINOS_JUMEX;

  // Nivel A — crisis/regulatorio (prioridad sobre bajo valor: "Profeco sanciona a
  // Jumex por promoción engañosa" es crisis, no promo).
  if (tieneContextoCrisisJumex(titulo, cuerpo, terminos) ||
      tieneContextoRegulatorioJumex(titulo, cuerpo, terminos)) {
    return { pasa: true, nivel: 'A', razon: 'jumex_contexto_crisis' };
  }
  // Override: título de promo retail domina (no es crisis) → bloquea.
  if (esTituloJumexBajoValor(titulo)) {
    return { pasa: false, razon: 'jumex_contexto_promocion_retail' };
  }
  // Nivel B — corporativo/sectorial real.
  if (tieneContextoCorporativoJumex(titulo, cuerpo, terminos)) {
    return { pasa: true, nivel: 'B', razon: 'jumex_contexto_corporativo' };
  }
  // Nivel C — bajo valor explícito (promo/supermercado/gastronomía).
  const full = `${titulo}\n${cuerpo}`;
  if (esContextoJumexBajoValor(full)) {
    return { pasa: false, razon: 'jumex_contexto_promocion_retail' };
  }
  // Sin señal suficiente.
  return { pasa: false, razon: 'jumex_contexto_insuficiente' };
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
  if (input.cliente_id === 'CLI-0002' && esKeywordTequilaAmpliaCli0002(input.keyword)) {
    const { pasa, razon } = pasaPuertaContextualTequilaCli0002(input);
    return { pasa, razon };
  }
  if (input.cliente_id === 'CLI-0001' && esKeywordJumexAmpliaCli0001(input.keyword)) {
    const { pasa, razon } = pasaPuertaContextualJumexCli0001(input);
    return { pasa, razon };
  }
  if (input.cliente_id === 'CLI-0003' && esKeywordLaboralAmpliaCli0003(input.keyword)) {
    return pasaPuertaContextualLaboralCli0003(input);
  }
  return { pasa: true };
}
