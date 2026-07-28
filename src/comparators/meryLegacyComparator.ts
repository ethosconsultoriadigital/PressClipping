/**
 * Comparador puro: concentrado legacy (alerta Google RSS de Mery Pozos) vs
 * menciones Ethos (CLI-MERY-TEST). Sin IA, sin dependencias de Supabase/Sheets
 * — testeable de forma aislada.
 *
 * Fase "MERY LEGACY GOOGLE RSS COMPARISON + MEDIA GAP AUDIT".
 */
import { normalizeUrl, normalizeTitulo, normalizeMedio, calcSimilarity } from './mentionMatcher.js';
import { normalizeSourceLegacy, esAgregador, esLinkGoogleNews, esPagoConvenio, esFuentePropia } from '../normalizers/meryLegacySource.js';
import { NOMBRE_EN_CUERPO_RE } from '../editorial/meryCriteria.js';

// ─────────────────────────────────────────────────────────────────────────────
// Umbrales
// ─────────────────────────────────────────────────────────────────────────────

const UMBRAL_TITULO_MIN = 0.60;
const VENTANA_DIAS_MATCH = 3;

// ─────────────────────────────────────────────────────────────────────────────
// Parseo de fecha legacy (soporta ISO "YYYY-MM-DD" y "M/D/YY" o "M/D/YYYY")
// ─────────────────────────────────────────────────────────────────────────────

export function parseFechaLegacy(raw: string | null | undefined): Date | null {
  const s = (raw ?? '').trim();
  if (!s) return null;

  // ISO "YYYY-MM-DD": se construye explícitamente en UTC (no delegar en
  // `new Date(string)`, cuyo comportamiento de huso horario varía por motor).
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const d = new Date(Date.UTC(parseInt(isoMatch[1]!, 10), parseInt(isoMatch[2]!, 10) - 1, parseInt(isoMatch[3]!, 10)));
    return isNaN(d.getTime()) ? null : d;
  }

  // "M/D/YY" o "M/D/YYYY": también se construye en UTC para que ambos formatos
  // legacy produzcan fechas consistentes independientemente del huso horario
  // del servidor que ejecuta el script.
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const mo = parseInt(m[1]!, 10);
    const da = parseInt(m[2]!, 10);
    let yr = parseInt(m[3]!, 10);
    if (m[3]!.length === 2) yr += 2000;
    const d = new Date(Date.UTC(yr, mo - 1, da));
    return isNaN(d.getTime()) ? null : d;
  }

  const fallback = new Date(s);
  return isNaN(fallback.getTime()) ? null : fallback;
}

function toIsoDate(d: Date | null): string {
  if (!d) return '';
  return d.toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────────
// Detección de nombre fuerte (reduce ruido de Google RSS)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * True si el texto contiene una mención fuerte inequívoca de Mery Pozos:
 * "Mery Pozos", "Merilyn Gómez Pozos", "diputada Mery" o "diputada Merilyn".
 * NUNCA acepta "Pozos", "Mery" o "Gómez" solos, ni "pozos de agua/petroleros".
 */
export function contieneNombreFuerte(texto: string | null | undefined): boolean {
  if (!texto) return false;
  return NOMBRE_EN_CUERPO_RE.test(texto);
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalización de filas legacy
// ─────────────────────────────────────────────────────────────────────────────

export interface LegacyRowRaw {
  title: string;
  description: string;
  link: string;
  pubDate: string;
  source: string;
  guid: string;
  status: string;
  sentimiento: string;
  tema: string;
}

export interface LegacyRowNorm {
  title: string;
  description: string;
  link: string;
  link_norm: string;
  fecha: Date | null;
  fecha_iso: string;
  source_legacy: string;
  source_canonico: string;
  guid: string;
  es_google_news: boolean;
  es_agregador: boolean;
  es_pago_convenio: boolean;
  es_fuente_propia: boolean;
  nombre_fuerte: boolean;
  es_ruido: boolean;
}

export function normalizeLegacyRow(raw: LegacyRowRaw): LegacyRowNorm {
  const title = (raw.title ?? '').trim();
  const description = (raw.description ?? '').trim();
  const link = (raw.link ?? '').trim();
  const sourceLegacy = (raw.source ?? '').trim();
  const sourceCanonico = normalizeSourceLegacy(sourceLegacy);
  const esGoogleNews = esLinkGoogleNews(link);
  const fecha = parseFechaLegacy(raw.pubDate);
  const nombreFuerte = contieneNombreFuerte(`${title} ${description}`);

  return {
    title,
    description,
    link,
    link_norm: esGoogleNews ? '' : normalizeUrl(link),
    fecha,
    fecha_iso: toIsoDate(fecha),
    source_legacy: sourceLegacy,
    source_canonico: sourceCanonico,
    guid: (raw.guid ?? '').trim(),
    es_google_news: esGoogleNews,
    es_agregador: esAgregador(sourceCanonico),
    es_pago_convenio: esPagoConvenio(sourceCanonico),
    es_fuente_propia: esFuentePropia(sourceCanonico),
    nombre_fuerte: nombreFuerte,
    es_ruido: !nombreFuerte,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalización de filas Ethos (menciones CLI-MERY-TEST)
// ─────────────────────────────────────────────────────────────────────────────

export interface EthosRowNorm {
  noticia_id: string;
  titulo: string;
  url: string;
  url_norm: string;
  medio: string;
  medio_id: string;
  fecha: Date | null;
  categoria_editorial: string;
  estado_editorial: string;
  nota_completa_limpia: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Estado del medio en el catálogo Ethos (para clasificar filas SIN match)
// ─────────────────────────────────────────────────────────────────────────────

export interface MedioEstadoCatalogo {
  esta_en_catalogo: boolean;
  medio_id: string | null;
  activo: boolean | null;
  en_cron: boolean | null;
  metodo_extraccion: string | null;
}

export const CATALOGO_DEFAULT_AUSENTE: MedioEstadoCatalogo = {
  esta_en_catalogo: false,
  medio_id: null,
  activo: null,
  en_cron: null,
  metodo_extraccion: null,
};

// ─────────────────────────────────────────────────────────────────────────────
// Estados comparativos y fila de salida
// ─────────────────────────────────────────────────────────────────────────────

export type EstadoComparativoLegacy =
  | 'AMBOS'
  | 'SOLO_GOOGLE_RSS'
  | 'SOLO_ETHOS'
  | 'DUPLICADO_PROBABLE'
  | 'RUIDO_GOOGLE_RSS'
  | 'MEDIO_FALTANTE_ETHOS'
  | 'MEDIO_EN_CATALOGO_SIN_CRON'
  | 'MEDIO_REQUIERE_DIRECT'
  | 'MEDIO_D_PAGO_CONVENIO'
  | 'AGREGADOR_NO_MEDIO';

export interface FilaComparativa {
  fecha_comparacion: string;
  ventana: string;
  fecha_legacy: string;
  source_legacy: string;
  source_canonico: string;
  medio_ethos: string;
  title_legacy: string;
  description_legacy: string;
  link_legacy: string;
  guid_legacy: string;
  titulo_ethos: string;
  url_ethos: string;
  categoria_ethos: string;
  estado_ethos: string;
  nota_completa_ethos: string;
  estado_comparativo: EstadoComparativoLegacy;
  razon_comparativo: string;
  medio_id: string;
  esta_en_catalogo: string;
  en_cron_daily_validated: string;
  accion_recomendada: string;
  /** Clave de deduplicación para escritura idempotente (no forma parte del reporte visible). */
  dedupe_key: string;
}

/** Construye la clave de deduplicación para una fila con origen legacy. */
function dedupeKeyLegacy(legacy: LegacyRowNorm): string {
  if (legacy.guid) return `MERY-LEGACY::${legacy.guid}`;
  if (legacy.link) return `MERY-LEGACY::${legacy.link}`;
  return `MERY-LEGACY::${legacy.source_canonico}::${legacy.title}::${legacy.fecha_iso}`;
}

/** Construye la clave de deduplicación para una fila SOLO_ETHOS (sin origen legacy). */
function dedupeKeySoloEthos(ethos: EthosRowNorm): string {
  return `MERY-LEGACY::ETHOS::${ethos.noticia_id}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Matching legacy ⇄ Ethos
// ─────────────────────────────────────────────────────────────────────────────

interface ScoreResultado {
  match: boolean;
  score: number;
}

/**
 * Compara una fila legacy contra una fila Ethos.
 * - Si el link legacy NO es de Google News y hay match exacto de url_norm → match total (score 1).
 * - En cualquier otro caso (Google News, o sin match exacto de URL): compara por
 *   medio normalizado + similitud de título (>=0.60) + fecha cercana (<=3 días,
 *   solo si ambas fechas están disponibles).
 */
export function scoreMatchLegacyEthos(legacy: LegacyRowNorm, ethos: EthosRowNorm): ScoreResultado {
  if (!legacy.es_google_news && legacy.link_norm && ethos.url_norm && legacy.link_norm === ethos.url_norm) {
    return { match: true, score: 1 };
  }

  const medioLegacy = normalizeMedio(legacy.source_canonico);
  const medioEthos = normalizeMedio(ethos.medio);
  if (!medioLegacy || medioLegacy !== medioEthos) return { match: false, score: 0 };

  const simTitulo = calcSimilarity(normalizeTitulo(legacy.title), normalizeTitulo(ethos.titulo));
  if (simTitulo < UMBRAL_TITULO_MIN) return { match: false, score: 0 };

  if (legacy.fecha && ethos.fecha) {
    const dias = Math.round(Math.abs(legacy.fecha.getTime() - ethos.fecha.getTime()) / 86_400_000);
    if (dias > VENTANA_DIAS_MATCH) return { match: false, score: 0 };
  }

  return { match: true, score: simTitulo };
}

/** Clasifica una fila legacy SIN match Ethos según su naturaleza y estado de catálogo. */
function clasificarSinMatch(legacy: LegacyRowNorm, catInfo: MedioEstadoCatalogo): EstadoComparativoLegacy {
  if (legacy.es_agregador) return 'AGREGADOR_NO_MEDIO';
  if (legacy.es_pago_convenio) return 'MEDIO_D_PAGO_CONVENIO';
  if (legacy.es_ruido) return 'RUIDO_GOOGLE_RSS';
  if (!catInfo.esta_en_catalogo) return 'MEDIO_FALTANTE_ETHOS';
  if (catInfo.activo && !catInfo.en_cron) return 'MEDIO_EN_CATALOGO_SIN_CRON';
  if (!catInfo.metodo_extraccion) return 'MEDIO_REQUIERE_DIRECT';
  return 'SOLO_GOOGLE_RSS';
}

function razonComparativo(estado: EstadoComparativoLegacy, legacy: LegacyRowNorm | null, catInfo: MedioEstadoCatalogo | null): string {
  switch (estado) {
    case 'AMBOS': return 'Match confirmado por URL/título/fecha — cobertura duplicada';
    case 'DUPLICADO_PROBABLE': return 'Más de un posible match Ethos — revisar manualmente';
    case 'SOLO_ETHOS': return 'Ethos capturó una nota no presente en el concentrado legacy';
    case 'RUIDO_GOOGLE_RSS': return 'Título/descripción sin mención fuerte de Mery Pozos — ruido de alerta';
    case 'AGREGADOR_NO_MEDIO': return `Fuente "${legacy?.source_canonico}" es agregador (Google News/MSN), no un medio principal`;
    case 'MEDIO_D_PAGO_CONVENIO': return `"${legacy?.source_canonico}" requiere suscripción/convenio — sin acceso público legítimo confirmado`;
    case 'MEDIO_FALTANTE_ETHOS': return `Medio "${legacy?.source_canonico}" no está en el catálogo de 200 medios`;
    case 'MEDIO_EN_CATALOGO_SIN_CRON': return `Medio en catálogo y activo, pero fuera de todos los tiers de cron shadow`;
    case 'MEDIO_REQUIERE_DIRECT': return `Método de extracción no confirmado — requiere extractor DIRECT`;
    case 'SOLO_GOOGLE_RSS': return `Medio activo y en cron, pero Ethos no capturó esta nota — posible gap de keyword/extracción`;
    default: return '';
  }
}

function accionRecomendada(estado: EstadoComparativoLegacy): string {
  switch (estado) {
    case 'AMBOS': return 'Ninguna — cobertura confirmada en ambos sistemas';
    case 'DUPLICADO_PROBABLE': return 'Revisar manualmente — múltiples posibles matches';
    case 'SOLO_ETHOS': return 'Ninguna — ventaja de Ethos sobre la alerta legacy';
    case 'RUIDO_GOOGLE_RSS': return 'Ignorar — ruido de alerta Google RSS sin mención fuerte';
    case 'AGREGADOR_NO_MEDIO': return 'NO_CATALOGAR_AGREGADOR';
    case 'MEDIO_D_PAGO_CONVENIO': return 'D_PAGO_CONVENIO_API — no intentar bypass';
    case 'MEDIO_FALTANTE_ETHOS': return 'AGREGAR_A_CATALOGO';
    case 'MEDIO_EN_CATALOGO_SIN_CRON': return 'ACTIVAR_EN_CRON';
    case 'MEDIO_REQUIERE_DIRECT': return 'NECESITA_DIRECT_EXTRACTOR';
    case 'SOLO_GOOGLE_RSS': return 'REVISAR — posible gap real de keyword/extracción';
    default: return '';
  }
}

function buildFilaLegacy(
  legacy: LegacyRowNorm,
  ethos: EthosRowNorm | null,
  estado: EstadoComparativoLegacy,
  catInfo: MedioEstadoCatalogo,
  fechaComparacion: string,
  ventana: string,
): FilaComparativa {
  return {
    fecha_comparacion: fechaComparacion,
    ventana,
    fecha_legacy: legacy.fecha_iso,
    source_legacy: legacy.source_legacy,
    source_canonico: legacy.source_canonico,
    medio_ethos: ethos?.medio ?? '',
    title_legacy: legacy.title,
    description_legacy: legacy.description,
    link_legacy: legacy.link,
    guid_legacy: legacy.guid,
    titulo_ethos: ethos?.titulo ?? '',
    url_ethos: ethos?.url ?? '',
    categoria_ethos: ethos?.categoria_editorial ?? '',
    estado_ethos: ethos?.estado_editorial ?? '',
    nota_completa_ethos: ethos?.nota_completa_limpia ?? '',
    estado_comparativo: estado,
    razon_comparativo: razonComparativo(estado, legacy, catInfo),
    medio_id: ethos?.medio_id ?? catInfo.medio_id ?? '',
    esta_en_catalogo: String(catInfo.esta_en_catalogo),
    en_cron_daily_validated: String(catInfo.en_cron ?? false),
    accion_recomendada: accionRecomendada(estado),
    dedupe_key: dedupeKeyLegacy(legacy),
  };
}

function buildFilaSoloEthos(ethos: EthosRowNorm, fechaComparacion: string, ventana: string): FilaComparativa {
  return {
    fecha_comparacion: fechaComparacion,
    ventana,
    fecha_legacy: '',
    source_legacy: '',
    source_canonico: '',
    medio_ethos: ethos.medio,
    title_legacy: '',
    description_legacy: '',
    link_legacy: '',
    guid_legacy: '',
    titulo_ethos: ethos.titulo,
    url_ethos: ethos.url,
    categoria_ethos: ethos.categoria_editorial,
    estado_ethos: ethos.estado_editorial,
    nota_completa_ethos: ethos.nota_completa_limpia,
    estado_comparativo: 'SOLO_ETHOS',
    razon_comparativo: razonComparativo('SOLO_ETHOS', null, null),
    medio_id: ethos.medio_id,
    esta_en_catalogo: 'true',
    en_cron_daily_validated: 'true',
    accion_recomendada: accionRecomendada('SOLO_ETHOS'),
    dedupe_key: dedupeKeySoloEthos(ethos),
  };
}

/**
 * Compara el set completo de filas legacy contra el set de menciones Ethos.
 * Cada fila Ethos se usa como match a lo sumo una vez (greedy por mejor score).
 * Las filas Ethos que no encuentran ninguna fila legacy quedan como SOLO_ETHOS.
 */
export function compararLegacyVsEthos(
  legacyRows: LegacyRowNorm[],
  ethosRows: EthosRowNorm[],
  catalogoPorSourceCanonico: Map<string, MedioEstadoCatalogo>,
  opts: { fechaComparacion: string; ventana: string },
): FilaComparativa[] {
  const usadosEthos = new Set<number>();
  const filas: FilaComparativa[] = [];

  for (const legacy of legacyRows) {
    const candidatos = ethosRows
      .map((e, idx) => ({ e, idx, ...scoreMatchLegacyEthos(legacy, e) }))
      .filter((c) => c.match && !usadosEthos.has(c.idx))
      .sort((a, b) => b.score - a.score);

    const catInfo = catalogoPorSourceCanonico.get(legacy.source_canonico) ?? CATALOGO_DEFAULT_AUSENTE;

    if (candidatos.length > 0) {
      const mejor = candidatos[0]!;
      usadosEthos.add(mejor.idx);
      const estado: EstadoComparativoLegacy = candidatos.length > 1 ? 'DUPLICADO_PROBABLE' : 'AMBOS';
      filas.push(buildFilaLegacy(legacy, mejor.e, estado, catInfo, opts.fechaComparacion, opts.ventana));
    } else {
      const estado = clasificarSinMatch(legacy, catInfo);
      filas.push(buildFilaLegacy(legacy, null, estado, catInfo, opts.fechaComparacion, opts.ventana));
    }
  }

  ethosRows.forEach((ethos, idx) => {
    if (usadosEthos.has(idx)) return;
    filas.push(buildFilaSoloEthos(ethos, opts.fechaComparacion, opts.ventana));
  });

  return filas;
}
