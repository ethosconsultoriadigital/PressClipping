/**
 * Reglas DETERMINÍSTICAS de "alertas sombra" (shadow alerts) — SIN IA, SIN red.
 *
 * Simula qué alertas se HABRÍAN enviado a partir de menciones ya detectadas,
 * clasificándolas por prioridad (P1/P2/P3) o descartándolas (BLOQUEADA/DUPLICADA),
 * y registrando motivo, canal hipotético y la regla de disparo. NUNCA envía nada.
 *
 * Calibración anti-sobre-alertamiento:
 *   - Una misma NOTA para un mismo CLIENTE genera UNA sola alerta (las keywords
 *     se agrupan en `keywords_detectadas`); el resto se marca DUPLICADA.
 *   - P1 (inmediata) exige una señal FUERTE (no basta medio/keyword "importante").
 *
 * Módulo PURO y testeable. No usa OpenAI ni clasificadores: 100% reglas.
 */
import { normalizeUrl } from '../comparators/mentionMatcher.js';

/** Cabeceras canónicas de la pestaña de salida `10_Alertas_Sombra` (solo-append). */
export const ALERTAS_SOMBRA_HEADERS = [
  'run_id', 'fecha_ejecucion', 'modo', 'cliente_id', 'cliente', 'mencion_id',
  'noticia_id', 'fecha_publicacion', 'medio', 'titulo', 'url', 'keyword',
  'grupo_tema', 'sentimiento', 'valoracion', 'prioridad_medio',
  'tipo_alerta_simulada', 'canal_simulado', 'habria_alerta', 'motivo_alerta',
  'motivo_bloqueo', 'regla_disparo', 'dedupe_key', 'estado_shadow', 'notas',
] as const;

export type TipoAlertaSimulada = 'inmediata' | 'resumen' | 'monitoreo' | 'bloqueada';
export type CanalSimulado = 'whatsapp' | 'email' | 'dashboard' | 'ninguno';
export type EstadoShadow =
  | 'P1_INMEDIATA'
  | 'P2_RESUMEN'
  | 'P3_DASHBOARD'
  | 'BLOQUEADA'
  | 'DUPLICADA';
export type HabriaAlerta = 'SÍ' | 'NO';

/** Mención ya detectada, normalizada para evaluación de alertas sombra. */
export interface MencionAlertaInput {
  mencion_id?: string | null;
  noticia_id?: string | null;
  cliente_id?: string | null;
  cliente?: string | null;
  fecha_publicacion?: string | null;
  medio?: string | null;
  titulo?: string | null;
  url?: string | null;
  keyword?: string | null;
  grupo_tema?: string | null;
  sentimiento?: string | null;
  /** Relevancia 0–1 (o 0–100; se normaliza). */
  valoracion?: number | null;
  /** Prioridad del medio: alta / media / baja. */
  prioridad_medio?: string | null;
  cliente_activo?: boolean;
  cliente_alertas_activas?: boolean;
  keyword_activa?: boolean;
  /** La keyword está marcada explícitamente para alertar (keywords.alerta). */
  keyword_alerta?: boolean;
  keyword_prioridad?: string | null;
  /** Tema reputacional/regulatorio/crisis fuerte (derivado de temas sensibles). */
  tema_reputacional?: boolean;
  es_falso_positivo?: boolean;
  /** Flag de detect (menciones.requiere_alerta). */
  requiere_alerta?: boolean;
  /**
   * Override SOLO-SOMBRA: permite evaluar un cliente con `alertas_activas=false`
   * (bloqueo `alertas_cliente_desactivadas`) cuando está en el allowlist de
   * shadow-alerts. NUNCA habilita envío real (lo garantizan las guardas del
   * runner). No afecta `cliente_inactivo` ni `keyword_inactiva`.
   */
  permitir_shadow_cliente_inactivo?: boolean;
}

/** Decisión de la regla para una mención (sin metadatos de corrida). */
export interface DecisionAlertaSombra {
  habria_alerta: HabriaAlerta;
  tipo_alerta_simulada: TipoAlertaSimulada;
  canal_simulado: CanalSimulado;
  motivo_alerta: string;
  motivo_bloqueo: string;
  regla_disparo: string;
  dedupe_key: string;
  estado_shadow: EstadoShadow;
  /** Keywords agrupadas de la misma nota/cliente (separadas por '|'). */
  keywords_detectadas: string;
}

export type CandidatoAlertaSombra = MencionAlertaInput & DecisionAlertaSombra;

export interface ResumenAlertasSombra {
  evaluadas: number;
  /** Filas que detonarían alerta (P1+P2). */
  candidatas: number;
  p1_inmediata: number;
  p2_resumen: number;
  p3_dashboard: number;
  bloqueada: number;
  duplicada: number;
}

/** Relevancia (0–1) mínima para "valoración alta" (señal fuerte P1). */
export const VALORACION_ALTA_MIN = 0.7;
/** Relevancia (0–1) por encima de la cual P1 aplica aunque falte otra señal. */
export const VALORACION_CRITICA_MIN = 0.85;
/** Relevancia (0–1) mínima para considerar una mención "relevante" (P2). */
export const VALORACION_RELEVANTE_MIN = 0.4;
/** Relevancia (0–1) por debajo de la cual es "baja relevancia extrema". */
export const VALORACION_EXTREMA_MAX = 0.05;

const PRIORIDAD_ALTA = new Set(['alta', 'critica', 'crítica', 'high', 'urgente']);
const PRIORIDAD_MEDIA = new Set(['media', 'medium', 'normal']);
const PRIORIDAD_BAJA = new Set(['baja', 'low', 'monitoreo']);

/**
 * Calibración P1 (anti-falsos-positivos por keywords amplias).
 *
 * Keywords amplias laborales: por sí solas NO justifican P1. Una nota que solo
 * las contiene (sin contexto crítico) baja a P2/P3, aunque sea `tema_reputacional`.
 */
const KEYWORDS_AMPLIAS_LABORALES = ['trabajador', 'sindicat', 'derecho laboral', 'derechos laboral', 'gremio'];

/**
 * Contexto crítico laboral: patrones (título/keyword) que SÍ justifican elevar
 * una nota laboral a P1 cuando además hay gravedad (negativo o valoración crítica).
 */
const PATRONES_CRITICOS_LABORALES: RegExp[] = [
  /\bhuelga\b/i,
  /paro (de labores|laboral|nacional|sindical|patronal)/i,
  /emplazamiento a huelga/i,
  /estall\w*.{0,12}huelga/i,
  /contratos? colectivos?/i,
  /conflicto laboral/i,
  /litigios? laboral/i,
  /despidos? masivos?/i,
  /bloqueo sindical/i,
  /(sindicat|trabajador|obrer|miner)\w*.{0,40}narco|narco.{0,40}(sindicat|trabajador|obrer|miner)/i,
  /(trabajador|obrer|miner)\w*.{0,30}desaparecid/i,
  /accidente (mortal|laboral|fatal)/i,
  /violencia laboral/i,
];

/**
 * Crisis de bebidas/alcohol adulterado: patrones de crisis REAL en el título.
 * Justifican P1 directa (independiente de valoración/sentimiento).
 */
const PATRONES_CRISIS_BEBIDAS: RegExp[] = [
  /adulterad/i,
  /\bmetanol\b/i,
  /(alcohol|bebida|licor|destilad|mezcal|tequila)\w*.{0,30}(clandestin|ilegal|apócrif|apocrif|pirata)/i,
  /intoxicaci[oó]n.{0,25}(alcohol|bebida|licor|metanol|tequila|mezcal)/i,
  /(muert|fallecid|deces|ciega|ceguera|convulsi|envenena).{0,40}(alcohol|bebida|licor|metanol|tequila|mezcal|vinater)/i,
  /(alcohol|bebida|licor|metanol|tequila|mezcal|vinater)\w*.{0,40}(muert|fallecid|deces|intoxica|envenena|ceguera|convulsi)/i,
  /decomiso.{0,25}(alcohol|bebida|licor|tequila|mezcal)/i,
  /(alcohol|bebida|licor|tequila|mezcal)\w*.{0,25}decomiso/i,
  /cofepris.{0,40}(alcohol|bebida|licor|tequila|mezcal|adulter)/i,
  /catea\w*.{0,20}vinater|vinater\w*.{0,20}catea/i,
];

/** Keywords de crisis de bebidas (corroboran P1 junto con requiere_alerta). */
const KEYWORDS_CRISIS_BEBIDAS = [
  'tequila adulterado', 'alcohol adulterado', 'bebidas adulteradas', 'bebida adulterada',
  'licor adulterado', 'destilados adulterados', 'destilado adulterado', 'mezcal adulterado',
  'bebidas clandestinas', 'metanol', 'intoxicación por alcohol', 'intoxicacion por alcohol',
];

/**
 * El título referencia una bebida/alcohol. Requisito para la rama "keyword de
 * crisis + requiere_alerta", que evita falsos positivos por contaminación de
 * keyword a nivel detect (p.ej. una nota de fútbol/tala con keyword
 * 'alcohol adulterado' pegada desde el cuerpo).
 */
const TITULO_MENCIONA_BEBIDA = /alcohol|bebida|licor|tequila|mezcal|metanol|destilad|vinater|cerveza|aguardiente|etílico|etilico|adulter/i;

const txt = (v: unknown): string => String(v ?? '').trim();
const esVacio = (v: unknown): boolean => txt(v) === '';

function esUrlValida(url: unknown): boolean {
  const u = txt(url).toLowerCase();
  return u.startsWith('http://') || u.startsWith('https://');
}

function esSentimientoNegativo(s: unknown): boolean {
  return txt(s).toLowerCase().startsWith('negativ');
}

/** Normaliza la relevancia a escala 0–1 (acepta 0–100). */
export function normalizarValoracion(v: number | null | undefined): number {
  if (v == null || Number.isNaN(v)) return 0;
  return v > 1 ? v / 100 : v;
}

function esPrioridadAlta(p: unknown): boolean {
  return PRIORIDAD_ALTA.has(txt(p).toLowerCase());
}
function esPrioridadMediaOAlta(p: unknown): boolean {
  const k = txt(p).toLowerCase();
  return PRIORIDAD_ALTA.has(k) || PRIORIDAD_MEDIA.has(k);
}
function esPrioridadBaja(p: unknown): boolean {
  return PRIORIDAD_BAJA.has(txt(p).toLowerCase());
}

function tituloNorm(t: unknown): string {
  return txt(t).toLowerCase();
}

/**
 * dedupe_key FUERTE (una nota = una alerta por cliente):
 *   1) cliente_id + noticia_id
 *   2) cliente_id + url_normalizada
 *   3) cliente_id + titulo_norm + medio + fecha_publicacion
 *
 * NO se usa mencion_id: una misma nota puede tener varias keywords/menciones y
 * no debe generar varias alertas.
 */
export function dedupeKey(m: MencionAlertaInput): string {
  const cli = txt(m.cliente_id) || txt(m.cliente) || 'sin_cliente';
  if (!esVacio(m.noticia_id)) return `${cli}::${txt(m.noticia_id)}`;
  if (esUrlValida(m.url)) return `${cli}::${normalizeUrl(txt(m.url))}`;
  return `${cli}::${tituloNorm(m.titulo)}::${txt(m.medio).toLowerCase()}::${txt(m.fecha_publicacion)}`;
}

/** Primer motivo de bloqueo aplicable (o '' si no hay). */
function motivoBloqueo(m: MencionAlertaInput): string {
  if (m.cliente_activo === false) return 'cliente_inactivo';
  // `alertas_activas=false` bloquea, salvo override SOLO-SOMBRA (allowlist dry-run).
  if (m.cliente_alertas_activas === false && m.permitir_shadow_cliente_inactivo !== true) {
    return 'alertas_cliente_desactivadas';
  }
  if (m.keyword_activa === false) return 'keyword_inactiva';
  if (m.es_falso_positivo === true) return 'posible_falso_positivo';
  if (!esUrlValida(m.url)) return 'sin_url';
  if (esVacio(m.titulo)) return 'sin_titulo';
  if (esVacio(m.medio)) return 'sin_medio';
  // Baja relevancia extrema: relevancia ~0 + medio de baja prioridad + sin señales.
  const val = normalizarValoracion(m.valoracion);
  if (
    m.valoracion != null &&
    val <= VALORACION_EXTREMA_MAX &&
    esPrioridadBaja(m.prioridad_medio) &&
    m.keyword_alerta !== true &&
    m.requiere_alerta !== true &&
    m.tema_reputacional !== true
  ) {
    return 'baja_relevancia_extrema';
  }
  return '';
}

/** Texto combinado (título + keyword) en minúsculas, para búsqueda de patrones. */
function textoBusqueda(m: MencionAlertaInput): string {
  return `${txt(m.titulo)} ${txt(m.keyword)}`.toLowerCase();
}

/** ¿La keyword es una "amplia laboral" (trabajador/sindicato/derechos laborales)? */
export function esKeywordAmpliaLaboral(m: MencionAlertaInput): boolean {
  const k = txt(m.keyword).toLowerCase();
  if (k === '') return false;
  return KEYWORDS_AMPLIAS_LABORALES.some((stem) => k.includes(stem));
}

/** ¿Hay contexto crítico laboral fuerte (huelga, narco, desaparecidos, etc.)? */
export function tieneContextoCriticoLaboral(m: MencionAlertaInput): boolean {
  const t = `${txt(m.titulo)} ${txt(m.keyword)}`;
  return PATRONES_CRITICOS_LABORALES.some((re) => re.test(t));
}

/**
 * ¿Es crisis de bebidas/alcohol adulterado que justifica P1?
 *   - Título con patrón de crisis explícito (muertes/adulterado/metanol/…), o
 *   - Keyword de crisis de bebidas CORROBORADA por requiere_alerta=true (detect).
 * Nota: una keyword de crisis SIN evidencia en el título ni requiere_alerta
 * (p. ej. contaminación por teaser ya descartada) NO cuenta como crisis P1.
 */
export function esCrisisBebidasP1(m: MencionAlertaInput): boolean {
  const titulo = txt(m.titulo);
  if (PATRONES_CRISIS_BEBIDAS.some((re) => re.test(titulo))) return true;
  const k = txt(m.keyword).toLowerCase();
  const keywordEsCrisis = KEYWORDS_CRISIS_BEBIDAS.some((kw) => k.includes(kw));
  // Rama por keyword: exige que el título referencie bebida/alcohol para no
  // elevar contaminación de keyword (fútbol, tala, etc.) a P1.
  return keywordEsCrisis && m.requiere_alerta === true && TITULO_MENCIONA_BEBIDA.test(titulo);
}

/**
 * Señales FUERTES que detonan P1 (inmediata). Al menos una requerida.
 *
 * Calibración P1 (anti-falsos-positivos por keywords amplias):
 *   - `tema_reputacional` y `valoracion_critica` YA NO disparan P1 por sí solos.
 *   - Una keyword amplia laboral (trabajador/sindicato/derechos laborales) SIN
 *     contexto crítico laboral NUNCA es P1 (baja a P2/P3), aunque venga marcada.
 *   - Crisis de bebidas/alcohol adulterado (patrón en título, o keyword de crisis
 *     + requiere_alerta) se conserva SIEMPRE como P1.
 *
 * Deliberadamente NO incluye "medio prioridad alta" ni "keyword prioridad alta"
 * por sí solas.
 */
function senalesFuertes(m: MencionAlertaInput): string[] {
  const s: string[] = [];
  const val = normalizarValoracion(m.valoracion);
  const neg = esSentimientoNegativo(m.sentimiento);
  const relevanciaAlta = val >= VALORACION_ALTA_MIN || neg;
  // Keyword amplia laboral sin contexto crítico: se veta de todo camino a P1.
  const vetoLaboral = esKeywordAmpliaLaboral(m) && !tieneContextoCriticoLaboral(m);

  // 1. Crisis de bebidas/alcohol adulterado → P1 directa (no depende de valoración).
  if (esCrisisBebidasP1(m)) s.push('crisis_bebidas');

  if (!vetoLaboral) {
    // 2. Contexto crítico laboral fuerte + gravedad (negativo o valoración crítica).
    if (tieneContextoCriticoLaboral(m) && (neg || val >= VALORACION_CRITICA_MIN)) {
      s.push('contexto_critico_laboral');
    }
    // 3. Sentimiento negativo + valoración alta (nota negativa de alto impacto).
    if (neg && val >= VALORACION_ALTA_MIN) s.push('sentimiento_negativo_valoracion_alta');
    // 4. requiere_alerta (detect) con relevancia alta.
    if (m.requiere_alerta === true && relevanciaAlta) s.push('requiere_alerta_relevante');
    // 5. keyword marcada alerta + prioridad alta + relevancia alta.
    if (m.keyword_alerta === true && esPrioridadAlta(m.keyword_prioridad) && relevanciaAlta) {
      s.push('keyword_alerta_prioritaria');
    }
  }
  return s;
}

/**
 * ¿La mención es "relevante" (candidata a P2) aunque no sea crítica?
 * Incluye señales que fueron "degradadas" de P1 (tema_reputacional, requiere_alerta,
 * keyword_alerta, contexto laboral) para que aterricen en P2, no en P3.
 */
function esRelevante(m: MencionAlertaInput): boolean {
  return (
    normalizarValoracion(m.valoracion) >= VALORACION_RELEVANTE_MIN ||
    esPrioridadMediaOAlta(m.prioridad_medio) ||
    esPrioridadMediaOAlta(m.keyword_prioridad) ||
    m.tema_reputacional === true ||
    m.requiere_alerta === true ||
    m.keyword_alerta === true ||
    tieneContextoCriticoLaboral(m)
  );
}

/**
 * Evalúa UNA mención (ya agregada por nota+cliente si viene de `evaluarLote`).
 * NO resuelve duplicados entre notas distintas; eso lo hace `evaluarLote`.
 */
export function evaluarMencion(m: MencionAlertaInput): DecisionAlertaSombra {
  const key = dedupeKey(m);
  const keywords = esVacio(m.keyword) ? '' : txt(m.keyword);

  const bloqueo = motivoBloqueo(m);
  if (bloqueo) {
    return {
      habria_alerta: 'NO',
      tipo_alerta_simulada: 'bloqueada',
      canal_simulado: 'ninguno',
      motivo_alerta: '',
      motivo_bloqueo: bloqueo,
      regla_disparo: 'bloqueada',
      dedupe_key: key,
      estado_shadow: 'BLOQUEADA',
      keywords_detectadas: keywords,
    };
  }

  const fuertes = senalesFuertes(m);
  if (fuertes.length > 0) {
    return {
      habria_alerta: 'SÍ',
      tipo_alerta_simulada: 'inmediata',
      canal_simulado: 'whatsapp',
      motivo_alerta: `P1 inmediata: ${fuertes.join(', ')}.`,
      motivo_bloqueo: '',
      regla_disparo: fuertes.join('|'),
      dedupe_key: key,
      estado_shadow: 'P1_INMEDIATA',
      keywords_detectadas: keywords,
    };
  }

  if (esRelevante(m)) {
    return {
      habria_alerta: 'SÍ',
      tipo_alerta_simulada: 'resumen',
      canal_simulado: 'email',
      motivo_alerta: 'P2 resumen: mención relevante no crítica (digest).',
      motivo_bloqueo: '',
      regla_disparo: 'mencion_relevante_no_critica',
      dedupe_key: key,
      estado_shadow: 'P2_RESUMEN',
      keywords_detectadas: keywords,
    };
  }

  return {
    habria_alerta: 'NO',
    tipo_alerta_simulada: 'monitoreo',
    canal_simulado: 'dashboard',
    motivo_alerta: 'P3 dashboard: monitoreo general, sin urgencia.',
    motivo_bloqueo: '',
    regla_disparo: 'monitoreo_general',
    dedupe_key: key,
    estado_shadow: 'P3_DASHBOARD',
    keywords_detectadas: keywords,
  };
}

/** Agrega un grupo de menciones de la MISMA nota+cliente en una sola señal. */
function agregarGrupo(grupo: MencionAlertaInput[]): {
  agg: MencionAlertaInput;
  keywords: string[];
} {
  const base = grupo[0]!;
  const keywords = [...new Set(grupo.map((g) => txt(g.keyword)).filter((k) => k !== ''))];
  const maxVal = Math.max(...grupo.map((g) => normalizarValoracion(g.valoracion)), 0);
  const anyNeg = grupo.some((g) => esSentimientoNegativo(g.sentimiento));
  const prioridadKw = grupo.some((g) => esPrioridadAlta(g.keyword_prioridad))
    ? 'alta'
    : grupo.some((g) => esPrioridadMediaOAlta(g.keyword_prioridad))
      ? 'media'
      : (base.keyword_prioridad ?? null);

  const agg: MencionAlertaInput = {
    ...base,
    sentimiento: anyNeg ? 'negativo' : base.sentimiento,
    valoracion: maxVal,
    requiere_alerta: grupo.some((g) => g.requiere_alerta === true),
    keyword_alerta: grupo.some((g) => g.keyword_alerta === true),
    tema_reputacional: grupo.some((g) => g.tema_reputacional === true),
    keyword_activa: grupo.some((g) => g.keyword_activa !== false),
    es_falso_positivo: grupo.every((g) => g.es_falso_positivo === true),
    permitir_shadow_cliente_inactivo: grupo.some((g) => g.permitir_shadow_cliente_inactivo === true),
    keyword_prioridad: prioridadKw,
  };
  return { agg, keywords };
}

/**
 * Evalúa un LOTE de menciones AGRUPANDO por nota+cliente (`dedupe_key`):
 * cada nota genera UNA alerta primaria (P1/P2/P3/BLOQUEADA) con las keywords
 * agrupadas; las menciones extra de la misma nota se marcan DUPLICADA.
 */
export function evaluarLote(menciones: MencionAlertaInput[]): {
  candidatos: CandidatoAlertaSombra[];
  resumen: ResumenAlertasSombra;
} {
  const grupos = new Map<string, MencionAlertaInput[]>();
  for (const m of menciones) {
    const key = dedupeKey(m);
    const arr = grupos.get(key);
    if (arr) arr.push(m);
    else grupos.set(key, [m]);
  }

  const candidatos: CandidatoAlertaSombra[] = [];
  for (const [key, grupo] of grupos) {
    const { agg, keywords } = agregarGrupo(grupo);
    const decision = evaluarMencion(agg);
    const keywordsStr = keywords.join('|');

    // Fila primaria (conserva identidad del primer miembro, keywords agrupadas).
    candidatos.push({
      ...grupo[0]!,
      ...decision,
      dedupe_key: key,
      keywords_detectadas: keywordsStr,
    });

    // Menciones extra de la misma nota → DUPLICADA (no se vuelven a alertar).
    for (let i = 1; i < grupo.length; i++) {
      candidatos.push({
        ...grupo[i]!,
        habria_alerta: 'NO',
        tipo_alerta_simulada: 'bloqueada',
        canal_simulado: 'ninguno',
        motivo_alerta: '',
        motivo_bloqueo: 'duplicada_en_ventana',
        regla_disparo: 'duplicada',
        dedupe_key: key,
        estado_shadow: 'DUPLICADA',
        keywords_detectadas: keywordsStr,
      });
    }
  }

  const cuenta = (e: EstadoShadow): number =>
    candidatos.filter((c) => c.estado_shadow === e).length;
  const resumen: ResumenAlertasSombra = {
    evaluadas: menciones.length,
    p1_inmediata: cuenta('P1_INMEDIATA'),
    p2_resumen: cuenta('P2_RESUMEN'),
    p3_dashboard: cuenta('P3_DASHBOARD'),
    bloqueada: cuenta('BLOQUEADA'),
    duplicada: cuenta('DUPLICADA'),
    candidatas: cuenta('P1_INMEDIATA') + cuenta('P2_RESUMEN'),
  };

  return { candidatos, resumen };
}
