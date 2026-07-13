/**
 * Lógica PURA de consolidación editorial (operación sin PressClipping).
 *
 * Sin red, sin IA, sin efectos: reglas determinísticas para transformar el
 * staging técnico crudo (tab 11: una fila por mención = por keyword) en una
 * capa editorial consolidada (tab 12: una fila por noticia = por url_norm),
 * con relevancia_editorial, grupo_tema, sentimiento y valoración derivados de
 * reglas, NO de classify-ia. Totalmente testeable.
 *
 * Diseño (mismo patrón que mergePlan.ts / tabPlan.ts): esta capa no toca
 * Supabase ni Sheets; el script `export-operational-news-consolidated-no-pc.ts`
 * la usa para producir las filas que escribe (con readback) en la tab 12.
 */
import { foldText, escapeRegex } from '../matchers/text.js';

// ── Decodificación de HTML entities (solo para la salida, no toca Supabase) ──

const ENTIDADES_NOMBRADAS: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&nbsp;': ' ',
  '&laquo;': '«',
  '&raquo;': '»',
  '&hellip;': '…',
  '&mdash;': '—',
  '&ndash;': '–',
};

/**
 * Decodifica HTML entities comunes (nombradas + numéricas decimales/hex) en un
 * título para la salida consolidada. NO modifica la noticia original en Supabase.
 */
export function decodeHtmlEntities(input: string): string {
  if (!input) return '';
  let out = input;
  // Numéricas decimales: &#8220; → “
  out = out.replace(/&#(\d+);/g, (_, dec) => {
    const code = Number.parseInt(dec, 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : _;
  });
  // Numéricas hex: &#x201C; → “
  out = out.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
    const code = Number.parseInt(hex, 16);
    return Number.isFinite(code) ? String.fromCodePoint(code) : _;
  });
  // Nombradas (&amp; al final para no re-decodificar).
  for (const [ent, ch] of Object.entries(ENTIDADES_NOMBRADAS)) {
    if (ent === '&amp;') continue;
    out = out.split(ent).join(ch);
  }
  out = out.split('&amp;').join('&');
  return out;
}

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type RelevanciaEditorial =
  | 'ALTA_RELEVANCIA'
  | 'MEDIA_RELEVANCIA'
  | 'BAJA_RELEVANCIA'
  | 'POSIBLE_FP';

export type Sentimiento = 'negativo' | 'neutral' | 'positivo';
export type Valoracion = 'ALTA' | 'MEDIA' | 'BAJA';

export type EstadoEditorial =
  | 'GO_ALTA'
  | 'GO_MEDIA'
  | 'REVISAR'
  | 'EXCLUIR'
  | 'MUSEO_JUMEX_EXCLUIR';

export interface ClasificacionEditorial {
  relevancia_editorial: RelevanciaEditorial;
  grupo_tema: string;
  sentimiento: Sentimiento;
  valoracion: Valoracion;
  fp_flags: string[];
  estado_editorial: EstadoEditorial;
  razon_clasificacion: string;
}

// ── Vocabularios (folded, sin acentos) ──────────────────────────────────────

const CLI0002 = {
  crisisAlta: [
    'alcohol adulterado', 'tequila adulterado', 'tequila adulterada', 'bebidas adulteradas',
    'bebida adulterada', 'bebidas clandestinas', 'bebida clandestina', 'intoxicacion por alcohol',
    'intoxicacion alcoholica', 'intoxicacion etilica', 'muertes por alcohol', 'decomiso de alcohol',
    'botellas reutilizadas', 'metanol', 'alcohol metilico', 'licor adulterado', 'destilados adulterados',
    'destilado adulterado', 'mezcal adulterado', 'alcohol clandestino',
  ],
  marca: ['tequila patron', 'casa patron', 'bacardi'],
  sectorial: [
    'exportacion de tequila', 'exportaciones de tequila', 'denominacion de origen', 'agave',
    'consumo responsable', 'industria tequilera', 'consejo regulador del tequila', 'crt',
    'nom-006', 'nom-070', 'comercam',
  ],
  turismoBajo: [
    'paisaje agavero', 'pueblo magico', 'gastronomia', 'chef', 'receta', 'recetas', 'coctel',
    'cocteles', 'festival', 'destino turistico', 'ruta del tequila', 'maridaje', 'lifestyle',
    'patrimonio mundial', 'turismo',
  ],
  contextoBebida: [
    'bebida', 'bebidas', 'alcohol', 'tequila', 'mezcal', 'licor', 'destilado', 'agave', 'vino', 'cerveza',
  ],
  seguridad: [
    'ataque', 'ataques', 'drone', 'drones', 'dron', 'violencia', 'homicidio', 'homicidios',
    'asesinato', 'asesinatos', 'balacera', 'balaceras', 'narco', 'narcotrafico', 'crimen',
    'secuestro', 'secuestros', 'ejecutado', 'ejecutados',
  ],
} as const;

const CLI0001 = {
  museo: ['museo jumex', 'fundacion jumex', 'museo', 'arte contemporaneo', 'exposicion', 'galeria', 'cultura', 'artista'],
  regulatorioAlta: [
    'ieps', 'etiquetado frontal', 'profeco', 'cofepris', 'retiro de producto', 'recall',
    'contaminacion', 'sancion', 'multa', 'salud publica', 'impuesto a bebidas', 'impuesto bebidas',
    'bebidas azucaradas',
  ],
  corporativo: ['grupo jumex', 'planta jumex', 'exportacion jumex'],
  sectorial: ['jugos', 'nectares', 'nectar', 'jugo'],
  bebidaContexto: ['jumex', 'jugo', 'jugos', 'nectar', 'nectares', 'bebida', 'bebidas', 'ieps', 'refresco', 'azucarada'],
} as const;

/**
 * ¿Aparece `termino` como palabra/frase completa en `blob` (ya folded)?
 * Usa límites de palabra para evitar falsos substrings (p.ej. "agave" NO debe
 * matchear dentro de "agavero" — turismo vs. sectorial).
 */
function contienePalabra(blob: string, termino: string): boolean {
  const re = new RegExp(`(?<![a-z0-9])${escapeRegex(termino)}(?![a-z0-9])`, 'i');
  return re.test(blob);
}

function algunPresente(blob: string, terminos: readonly string[]): string | null {
  for (const t of terminos) {
    if (contienePalabra(blob, t)) return t;
  }
  return null;
}

// ── Clasificación CLI-0002 (Patrón / Bebidas alcohólicas) ───────────────────

function clasificarCli0002(keywordsFold: string[], tituloFold: string): ClasificacionEditorial {
  const blob = `${keywordsFold.join(' ')} ${tituloFold}`;
  const flags: string[] = [];

  // 1. Crisis directa: gana sobre todo (aunque haya ruido turístico en el mismo blob).
  const crisis = algunPresente(blob, CLI0002.crisisAlta);
  if (crisis) {
    return {
      relevancia_editorial: 'ALTA_RELEVANCIA',
      grupo_tema: 'CRISIS_ALCOHOL_ADULTERADO',
      sentimiento: 'negativo',
      valoracion: 'ALTA',
      fp_flags: flags,
      estado_editorial: 'GO_ALTA',
      razon_clasificacion: `crisis directa: "${crisis}"`,
    };
  }

  // 2. Marca directa (Tequila Patrón / Casa Patrón / Bacardí).
  const marca = algunPresente(keywordsFold.join(' '), CLI0002.marca);
  if (marca) {
    return {
      relevancia_editorial: 'ALTA_RELEVANCIA',
      grupo_tema: 'REPUTACION_MARCA',
      sentimiento: 'neutral',
      valoracion: 'ALTA',
      fp_flags: flags,
      estado_editorial: 'GO_ALTA',
      razon_clasificacion: `marca directa: "${marca}"`,
    };
  }

  // 3. COFEPRIS: relevante SOLO con contexto de bebida/alcohol/tequila.
  if (contienePalabra(blob, 'cofepris')) {
    if (algunPresente(blob, CLI0002.contextoBebida)) {
      return {
        relevancia_editorial: 'ALTA_RELEVANCIA',
        grupo_tema: 'REGULATORIO_COFEPRIS',
        sentimiento: 'negativo',
        valoracion: 'ALTA',
        fp_flags: flags,
        estado_editorial: 'GO_ALTA',
        razon_clasificacion: 'COFEPRIS con contexto de bebida/alcohol',
      };
    }
    flags.push('cofepris_sin_contexto_bebida');
    return {
      relevancia_editorial: 'POSIBLE_FP',
      grupo_tema: 'NO_RELEVANTE',
      sentimiento: 'neutral',
      valoracion: 'BAJA',
      fp_flags: flags,
      estado_editorial: 'EXCLUIR',
      razon_clasificacion: 'COFEPRIS sin contexto de bebida/alcohol/tequila',
    };
  }

  // 4. T-MEC / aranceles: relevante SOLO con contexto de tequila/alcohol/exportación bebida.
  if (contienePalabra(blob, 't-mec') || contienePalabra(blob, 'tmec') || contienePalabra(blob, 'arancel') || contienePalabra(blob, 'aranceles')) {
    const contextoComercioBebida =
      algunPresente(blob, ['tequila', 'mezcal', 'alcohol', 'agave']) &&
      algunPresente(blob, ['exportacion', 'arancel', 'comercio', 'exportaciones']);
    if (contextoComercioBebida) {
      return {
        relevancia_editorial: 'MEDIA_RELEVANCIA',
        grupo_tema: 'EXPORTACION_COMERCIO',
        sentimiento: 'neutral',
        valoracion: 'MEDIA',
        fp_flags: flags,
        estado_editorial: 'GO_MEDIA',
        razon_clasificacion: 'T-MEC/aranceles con contexto tequila/exportación',
      };
    }
    flags.push('tmec_sin_contexto_bebida');
    return {
      relevancia_editorial: 'POSIBLE_FP',
      grupo_tema: 'NO_RELEVANTE',
      sentimiento: 'neutral',
      valoracion: 'BAJA',
      fp_flags: flags,
      estado_editorial: 'EXCLUIR',
      razon_clasificacion: 'T-MEC/aranceles sin contexto tequila/alcohol/exportación bebida',
    };
  }

  // 5. Seguridad incidental: keyword amplia (tequila/mezcal) en nota de violencia/narco.
  const seguridad = algunPresente(tituloFold, CLI0002.seguridad);
  const soloAmplia = keywordsFold.every((k) => ['tequila', 'mezcal', 'agave'].includes(k.trim()));
  if (seguridad && soloAmplia) {
    flags.push('seguridad_incidental');
    return {
      relevancia_editorial: 'POSIBLE_FP',
      grupo_tema: 'SEGURIDAD_INCIDENTAL',
      sentimiento: 'neutral',
      valoracion: 'BAJA',
      fp_flags: flags,
      estado_editorial: 'EXCLUIR',
      razon_clasificacion: `mezcal/tequila incidental en nota de seguridad: "${seguridad}"`,
    };
  }

  // 6. Turismo / lifestyle sin señal sectorial fuerte → bajo valor.
  const turismo = algunPresente(blob, CLI0002.turismoBajo);
  const sectorial = algunPresente(blob, CLI0002.sectorial);
  if (turismo && !sectorial) {
    flags.push('turismo_lifestyle');
    return {
      relevancia_editorial: 'BAJA_RELEVANCIA',
      grupo_tema: 'TURISMO_LIFESTYLE_BAJO_VALOR',
      sentimiento: 'neutral',
      valoracion: 'BAJA',
      fp_flags: flags,
      estado_editorial: 'EXCLUIR',
      razon_clasificacion: `turismo/lifestyle sin contexto sectorial: "${turismo}"`,
    };
  }

  // 7. Sectorial relevante (exportación, denominación, industria) → media.
  if (sectorial) {
    const esComercio = algunPresente(blob, ['exportacion', 'comercio', 'arancel']);
    return {
      relevancia_editorial: 'MEDIA_RELEVANCIA',
      grupo_tema: esComercio ? 'EXPORTACION_COMERCIO' : 'INDUSTRIA_TEQUILA',
      sentimiento: 'neutral',
      valoracion: 'MEDIA',
      fp_flags: flags,
      estado_editorial: 'GO_MEDIA',
      razon_clasificacion: `sectorial: "${sectorial}"`,
    };
  }

  // 8. Fallback: keyword amplia sin señal → baja relevancia, revisar.
  flags.push('sin_senal_fuerte');
  return {
    relevancia_editorial: 'BAJA_RELEVANCIA',
    grupo_tema: 'INDUSTRIA_TEQUILA',
    sentimiento: 'neutral',
    valoracion: 'BAJA',
    fp_flags: flags,
    estado_editorial: 'REVISAR',
    razon_clasificacion: 'keyword amplia sin señal editorial fuerte',
  };
}

// ── Clasificación CLI-0001 (Jumex) ──────────────────────────────────────────

function clasificarCli0001(keywordsFold: string[], tituloFold: string): ClasificacionEditorial {
  const blob = `${keywordsFold.join(' ')} ${tituloFold}`;
  const flags: string[] = [];

  const contextoBebida = algunPresente(blob, CLI0001.bebidaContexto.filter((t) => t !== 'jumex'));
  const regulatorio = algunPresente(blob, CLI0001.regulatorioAlta);

  // 1. Museo Jumex: EXCLUIR salvo autorización — y salvo que haya contexto regulatorio/bebida claro.
  const museo = algunPresente(blob, CLI0001.museo);
  if (museo && !regulatorio && !contextoBebida) {
    flags.push('museo_jumex');
    return {
      relevancia_editorial: 'POSIBLE_FP',
      grupo_tema: 'MUSEO_JUMEX_EXCLUIR',
      sentimiento: 'neutral',
      valoracion: 'BAJA',
      fp_flags: flags,
      estado_editorial: 'MUSEO_JUMEX_EXCLUIR',
      razon_clasificacion: `Museo/Fundación Jumex sin contexto bebidas: "${museo}" (excluir salvo autorización)`,
    };
  }

  // 2. Regulatorio / crisis de bebidas → ALTA.
  if (regulatorio) {
    const esCrisis = algunPresente(blob, ['retiro de producto', 'recall', 'contaminacion', 'sancion', 'multa']);
    const grupo = algunPresente(blob, ['ieps', 'impuesto'])
      ? 'REGULATORIO_IEPS'
      : algunPresente(blob, ['profeco', 'cofepris'])
        ? 'PROFECO_COFEPRIS'
        : 'SALUD_PUBLICA_BEBIDAS';
    return {
      relevancia_editorial: 'ALTA_RELEVANCIA',
      grupo_tema: grupo,
      sentimiento: esCrisis ? 'negativo' : 'neutral',
      valoracion: 'ALTA',
      fp_flags: flags,
      estado_editorial: 'GO_ALTA',
      razon_clasificacion: `regulatorio/salud: "${regulatorio}"`,
    };
  }

  // 3. Corporativo directo (Grupo Jumex / planta) → ALTA reputacional.
  const corporativo = algunPresente(blob, CLI0001.corporativo);
  if (corporativo) {
    return {
      relevancia_editorial: 'ALTA_RELEVANCIA',
      grupo_tema: 'CORPORATIVO_JUMEX',
      sentimiento: 'neutral',
      valoracion: 'ALTA',
      fp_flags: flags,
      estado_editorial: 'GO_ALTA',
      razon_clasificacion: `corporativo directo: "${corporativo}"`,
    };
  }

  // 4. Sectorial bebidas (jugos/néctares) → MEDIA.
  const sectorial = algunPresente(blob, CLI0001.sectorial);
  if (sectorial) {
    return {
      relevancia_editorial: 'MEDIA_RELEVANCIA',
      grupo_tema: 'SALUD_PUBLICA_BEBIDAS',
      sentimiento: 'neutral',
      valoracion: 'MEDIA',
      fp_flags: flags,
      estado_editorial: 'GO_MEDIA',
      razon_clasificacion: `sectorial bebidas: "${sectorial}"`,
    };
  }

  // 5. Solo "Jumex" a secas sin contexto bebida/regulatorio → revisar (posible FP corporativo).
  flags.push('jumex_sin_contexto');
  return {
    relevancia_editorial: 'BAJA_RELEVANCIA',
    grupo_tema: 'REPUTACION_JUMEX',
    sentimiento: 'neutral',
    valoracion: 'BAJA',
    fp_flags: flags,
    estado_editorial: 'REVISAR',
    razon_clasificacion: 'mención de Jumex sin contexto de bebidas/regulatorio (revisar)',
  };
}

/**
 * Clasifica editorialmente una noticia consolidada de forma DETERMINÍSTICA.
 * `keywords` es la lista única de keywords detectadas en la noticia; `titulo`
 * es el título ya decodificado. No usa IA.
 */
export function clasificarConsolidado(
  clienteId: string,
  keywords: string[],
  titulo: string,
): ClasificacionEditorial {
  const keywordsFold = keywords.map((k) => foldText(k));
  const tituloFold = foldText(titulo);
  if (clienteId === 'CLI-0001') return clasificarCli0001(keywordsFold, tituloFold);
  if (clienteId === 'CLI-0002') return clasificarCli0002(keywordsFold, tituloFold);
  // Cliente no cubierto por reglas editoriales: neutral, revisar.
  return {
    relevancia_editorial: 'BAJA_RELEVANCIA',
    grupo_tema: 'NO_RELEVANTE',
    sentimiento: 'neutral',
    valoracion: 'BAJA',
    fp_flags: ['cliente_sin_reglas_editoriales'],
    estado_editorial: 'REVISAR',
    razon_clasificacion: `cliente ${clienteId} sin reglas editoriales definidas`,
  };
}

// ── Consolidación por (cliente_id + url_norm) ────────────────────────────────

/** Fila cruda de entrada (equivalente a una fila de la tab 11 / una mención). */
export interface FilaCruda {
  cliente_id: string;
  cliente_nombre: string;
  medio: string;
  medio_id: string;
  fecha_noticia: string;
  titulo: string;
  url: string;
  url_norm: string;
  keyword: string;
  requiere_alerta: boolean;
  prioridad: string;
  texto_limpio_chars: number;
  texto_limpio_ok: boolean;
  fuente: string;
}

/** Fila consolidada de salida (una por noticia = por cliente_id+url_norm). */
export interface FilaConsolidada {
  cliente_id: string;
  cliente_nombre: string;
  medio: string;
  medio_id: string;
  fecha_noticia: string;
  titulo: string;
  titulo_original: string;
  url: string;
  url_norm: string;
  keywords_detectadas: string[];
  keywords_count: number;
  requiere_alerta: boolean;
  prioridad: string;
  texto_limpio_chars: number;
  texto_limpio_ok: boolean;
  fuente: string;
  dedupe_key_consolidado: string;
  clasificacion: ClasificacionEditorial;
}

/** dedupe_key consolidado: cliente_id + url_norm (una fila por noticia). */
export function dedupeKeyConsolidado(clienteId: string, urlNorm: string): string {
  return `${clienteId}::${urlNorm}`;
}

/**
 * Agrupa filas crudas por (cliente_id + url_norm), fusiona las keywords en una
 * lista única, decodifica el título y aplica la clasificación editorial. El
 * orden de salida es estable (por primera aparición). NO toca red.
 */
export function consolidar(filas: FilaCruda[]): FilaConsolidada[] {
  const grupos = new Map<string, FilaCruda[]>();
  const orden: string[] = [];
  for (const f of filas) {
    const key = dedupeKeyConsolidado(f.cliente_id, f.url_norm);
    if (!grupos.has(key)) { grupos.set(key, []); orden.push(key); }
    grupos.get(key)!.push(f);
  }

  const salida: FilaConsolidada[] = [];
  for (const key of orden) {
    const grupo = grupos.get(key)!;
    const primera = grupo[0]!;
    // Keywords únicas (preservando orden de aparición).
    const vistas = new Set<string>();
    const keywords: string[] = [];
    for (const f of grupo) {
      const kw = f.keyword.trim();
      if (kw && !vistas.has(kw.toLowerCase())) { vistas.add(kw.toLowerCase()); keywords.push(kw); }
    }
    const requiereAlerta = grupo.some((f) => f.requiere_alerta === true);
    // Prioridad más alta del grupo (Alta > Media > Baja).
    const ordenPrio: Record<string, number> = { alta: 3, media: 2, baja: 1 };
    const prioridad = grupo
      .map((f) => f.prioridad)
      .filter(Boolean)
      .sort((a, b) => (ordenPrio[b.toLowerCase()] ?? 0) - (ordenPrio[a.toLowerCase()] ?? 0))[0] ?? '';

    const tituloDecodificado = decodeHtmlEntities(primera.titulo);
    const clasificacion = clasificarConsolidado(primera.cliente_id, keywords, tituloDecodificado);

    salida.push({
      cliente_id: primera.cliente_id,
      cliente_nombre: primera.cliente_nombre,
      medio: primera.medio,
      medio_id: primera.medio_id,
      fecha_noticia: primera.fecha_noticia,
      titulo: tituloDecodificado,
      titulo_original: primera.titulo,
      url: primera.url,
      url_norm: primera.url_norm,
      keywords_detectadas: keywords,
      keywords_count: keywords.length,
      requiere_alerta: requiereAlerta,
      prioridad,
      texto_limpio_chars: primera.texto_limpio_chars,
      texto_limpio_ok: primera.texto_limpio_ok,
      fuente: primera.fuente,
      dedupe_key_consolidado: key,
      clasificacion,
    });
  }
  return salida;
}
