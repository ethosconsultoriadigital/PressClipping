/**
 * Núcleo del enriquecimiento de noticias.
 *
 * Visita la URL de cada noticia, extrae campos útiles (título, resumen, texto,
 * imagen, autor, sección) y construye la actualización para Supabase. Las
 * dependencias (lectura, extracción, escritura) se inyectan para poder probar
 * sin red ni DB, igual que `exportRawNews`.
 *
 * Garantías:
 *   - En modo dry-run NO escribe nada (solo arma el plan de cambios).
 *   - Nunca sobrescribe un valor real existente: solo rellena campos vacíos.
 *   - Una nota que falla (red/timeout) NO detiene la corrida (se reporta y se
 *     sigue con la siguiente).
 *   - NO exporta a Sheets, NO toca exportado_sheet_raw, NO corre detección/IA.
 */
import type { FetchExtractResult } from '../extractors/html.js';
import { resolverTitulo, MARCADOR_TITULO_DESDE_URL } from '../extractors/titleFromUrl.js';

/** Fila mínima de `noticias` necesaria para decidir el enriquecimiento. */
export interface NoticiaEnriquecibleRow {
  noticia_id: string;
  /**
   * Medio dueño de la noticia (FK `noticias.medio_id → medios.medio_id`,
   * `on delete set null`: puede venir `null` si el medio fue borrado del
   * catálogo). Se usa SOLO para atribución/observabilidad (Fase 1A — Media
   * Validation & Certification); nunca decide qué se enriquece ni se escribe
   * de vuelta en `NoticiaEnriquecidaUpdate`.
   */
  medio_id: string | null;
  url_original: string | null;
  titulo: string | null;
  resumen: string | null;
  texto_extraido: string | null;
  autor: string | null;
  seccion: string | null;
  imagen_principal: string | null;
  texto_nota_limpia: string | null;
  extracto_nota_1300: string | null;
  calidad_extraccion: string | null;
  texto_limpio_chars: number | null;
  texto_cuerpo_nota: string | null;
  extracto_cuerpo_1300: string | null;
  cuerpo_nota_chars: number | null;
  tipo_nota: string | null;
}

/** Campos que el enriquecimiento puede actualizar en `noticias`. */
export interface NoticiaEnriquecidaUpdate {
  titulo?: string | null;
  resumen?: string | null;
  texto_extraido?: string | null;
  autor?: string | null;
  seccion?: string | null;
  imagen_principal?: string | null;
  texto_nota_limpia?: string | null;
  extracto_nota_1300?: string | null;
  calidad_extraccion?: string | null;
  texto_limpio_chars?: number | null;
  texto_cuerpo_nota?: string | null;
  extracto_cuerpo_1300?: string | null;
  cuerpo_nota_chars?: number | null;
  tipo_nota?: string | null;
  estado_extraccion?: string;
  error_extraccion?: string | null;
  notas?: string;
}

export interface EnrichOpts {
  limit?: number;
  onlyMissingTitle?: boolean;
  onlyMissingText?: boolean;
  /** Filtra noticias donde texto_nota_limpia IS NULL. */
  onlyMissingCleanText?: boolean;
  /** Filtra noticias que ya tienen texto_nota_limpia pero no texto_cuerpo_nota. */
  onlyMissingBodyText?: boolean;
  /** Filtra noticias con menciones_procesado = false (pendientes de detección). */
  onlyPendingMentions?: boolean;
  /** Aísla el lote a estos medio_id (crawl/enrich dirigido, sin tocar backlog global). */
  medioIds?: string[];
  /**
   * Re-extrae y SOBRESCRIBE los campos de texto (texto_extraido, texto_nota_limpia
   * y derivados, texto_cuerpo_nota y derivados, tipo_nota) aunque ya existan.
   * Pensado para re-limpiar notas tras un fix del extractor. No toca menciones,
   * ni 01/02/04, ni exportado_sheet_raw. Úsese siempre acotado por --medio-ids.
   */
  forceRefreshCleanText?: boolean;
  /** Ordena por fecha_publicacion descendente (recientes primero). Default: oldest-first. */
  recentFirst?: boolean;
  /** Acota a noticias con fecha_publicacion dentro de los últimos N días. */
  windowDays?: number;
  dryRun: boolean;
  maxChars?: number;
}

export interface EnrichDeps {
  fetchNoticias: (opts: {
    limit?: number;
    onlyMissingTitle?: boolean;
    onlyMissingText?: boolean;
    onlyMissingCleanText?: boolean;
    onlyMissingBodyText?: boolean;
    onlyPendingMentions?: boolean;
    medioIds?: string[];
    forceRefreshCleanText?: boolean;
    recentFirst?: boolean;
    windowDays?: number;
  }) => Promise<NoticiaEnriquecibleRow[]>;
  extract: (url: string) => Promise<FetchExtractResult>;
  updateNoticia: (id: string, fields: NoticiaEnriquecidaUpdate) => Promise<void>;
}

export interface EnrichItemResult {
  noticia_id: string;
  url: string | null;
  ok: boolean;
  error: string | null;
  campos_actualizados: string[];
  marcadores: string[];
  fields: NoticiaEnriquecidaUpdate;
}

/**
 * Evidencia atribuible por medio_id (Fase 1A — Media Validation & Certification,
 * `docs/MEDIA_VALIDATION_AND_CERTIFICATION.md` §7). Mismo criterio de conteo
 * que las métricas globales de `EnrichResult`, solo particionado por medio —
 * ver `enrichNews()` para la semántica exacta de cada campo.
 */
export interface MedioEnrichCounts {
  /** Noticias leídas para este medio en el batch (porción de `leidas`). */
  processed: number;
  /** Se aplicó (o se habría aplicado, en dry-run) una escritura con campos de contenido nuevos. */
  updated: number;
  /** Sin campos de contenido para actualizar (incluye extracciones fallidas sin contenido nuevo — mismo criterio superpuesto que el `sinCambios` global, ver enrichNews()). */
  unchanged: number;
  /** Extracción falló (`extracto.ok === false`) o falló la escritura a Supabase. Puede solaparse con `unchanged`, igual que el `fallidas` global. */
  failed: number;
  /** De las `processed`, cuántas terminan con `texto_nota_limpia` no vacío. */
  clean_text_count: number;
  /** De las `processed`, cuántas terminan con `texto_cuerpo_nota` no vacío. */
  body_count: number;
}

export interface MedioEnrichSummary extends MedioEnrichCounts {
  medio_id: string;
  /**
   * `true` si este medio_id vino explícitamente en `opts.medioIds`. Permite
   * distinguir "medio solicitado con 0 noticias elegibles" (requested=true,
   * processed=0) de "no fue solicitado explícitamente" (corrida global sin
   * `--medio-ids`). Cuando `opts.medioIds` no se pasó, siempre es `false`
   * (no existe lista de solicitud contra la cual comparar).
   */
  requested: boolean;
}

export interface EnrichResult {
  leidas: number;
  actualizadas: number;
  sinCambios: number;
  fallidas: number;
  /** Cuántas de las noticias leídas tienen texto_nota_limpia no nulo tras el proceso. */
  conTextoLimpio: number;
  /** Cuántas de las noticias leídas tienen texto_cuerpo_nota no nulo tras el proceso. */
  conCuerpoNota: number;
  dryRun: boolean;
  detalle: EnrichItemResult[];
  /**
   * Evidencia adicional por medio_id (Fase 1A). ADITIVO: no sustituye a los
   * contadores globales de arriba, que siguen siendo la fuente de verdad
   * para consumidores existentes. Incluye entradas con `processed: 0` para
   * medios pedidos explícitamente en `opts.medioIds` que no tuvieron ninguna
   * noticia elegible (no desaparecen silenciosamente — ver §7 del documento
   * de arquitectura).
   */
  porMedio: MedioEnrichSummary[];
  /**
   * Noticias leídas cuyo `medio_id` vino `null` (medio borrado del catálogo,
   * FK `on delete set null`). NO se atribuyen a ningún medio ni se descartan
   * silenciosamente — se cuentan aparte para que "atribución desconocida"
   * nunca se confunda con "0 fallos". En la práctica se espera que quede en
   * cero salvo borrado de un medio con histórico.
   */
  sinMedioId: MedioEnrichCounts;
}

function contadoresVacios(): MedioEnrichCounts {
  return { processed: 0, updated: 0, unchanged: 0, failed: 0, clean_text_count: 0, body_count: 0 };
}

/** Nombre de evento estable para logging estructurado (Fase 1A). Ver enrich-news.ts. */
export const ENRICH_MEDIA_SUMMARY_EVENT = 'enrich_media_summary';
export const ENRICH_MEDIA_SUMMARY_SCHEMA_VERSION = 1;

/**
 * Payload de log estructurado para un medio_id. Función pura (no loguea):
 * separa el "shape" del evento de la llamada real a logger, para que sea
 * testeable sin mocks de logging y para que un futuro Shadow Validator no
 * dependa de parsear frases humanas — solo de estos campos.
 */
export function buildEnrichMediaSummaryLogPayload(
  summary: MedioEnrichSummary,
  meta: { dryRun: boolean },
): Record<string, unknown> {
  return {
    event: ENRICH_MEDIA_SUMMARY_EVENT,
    schema_version: ENRICH_MEDIA_SUMMARY_SCHEMA_VERSION,
    medio_id: summary.medio_id,
    requested: summary.requested,
    processed: summary.processed,
    updated: summary.updated,
    unchanged: summary.unchanged,
    failed: summary.failed,
    clean_text_count: summary.clean_text_count,
    body_count: summary.body_count,
    dry_run: meta.dryRun,
  };
}

/** Payload de log estructurado para la bolsa de noticias sin medio_id atribuible. */
export function buildEnrichUnattributedLogPayload(
  counts: MedioEnrichCounts,
  meta: { dryRun: boolean },
): Record<string, unknown> {
  return {
    event: ENRICH_MEDIA_SUMMARY_EVENT,
    schema_version: ENRICH_MEDIA_SUMMARY_SCHEMA_VERSION,
    medio_id: null,
    requested: false,
    ...counts,
    dry_run: meta.dryRun,
  };
}

function vacio(v: string | null | undefined): boolean {
  return v === null || v === undefined || v.trim().length === 0;
}

/**
 * Decide los cambios para una noticia dado el resultado de extracción.
 * PURA: no escribe nada. Solo rellena campos vacíos y arma los marcadores.
 */
export function construirActualizacion(
  noticia: NoticiaEnriquecibleRow,
  extracto: FetchExtractResult,
  opts: { forceRefreshCleanText?: boolean } = {},
): { fields: NoticiaEnriquecidaUpdate; campos: string[]; marcadores: string[] } {
  const fields: NoticiaEnriquecidaUpdate = {};
  const campos: string[] = [];
  const marcadores: string[] = [];
  // En force-refresh solo sobrescribimos si la extracción fue OK (no borrar
  // contenido bueno por un fallo de red puntual).
  const force = Boolean(opts.forceRefreshCleanText) && extracto.ok;

  // Título: respeta el real; si falta, usa extracción y, en su defecto, slug.
  if (vacio(noticia.titulo)) {
    const tituloHtml = extracto.titulo;
    const { titulo, generadoDesdeUrl } = resolverTitulo(
      tituloHtml,
      noticia.url_original ?? '',
    );
    if (titulo) {
      fields.titulo = titulo;
      campos.push('titulo');
      if (generadoDesdeUrl || extracto.metodo_titulo === 'fallback_url_slug') {
        marcadores.push(MARCADOR_TITULO_DESDE_URL);
      } else if (extracto.metodo_titulo) {
        marcadores.push(`titulo:${extracto.metodo_titulo}`);
      }
    }
  }

  if (vacio(noticia.resumen) && extracto.resumen) {
    fields.resumen = extracto.resumen;
    campos.push('resumen');
  }

  if ((force || vacio(noticia.texto_extraido)) && extracto.texto_extraido) {
    fields.texto_extraido = extracto.texto_extraido;
    campos.push('texto_extraido');
    if (extracto.metodo_texto) marcadores.push(`texto:${extracto.metodo_texto}`);
  }

  if (vacio(noticia.autor) && extracto.autor) {
    fields.autor = extracto.autor;
    campos.push('autor');
  }

  if (vacio(noticia.seccion) && extracto.seccion) {
    fields.seccion = extracto.seccion;
    campos.push('seccion');
  }

  if (vacio(noticia.imagen_principal) && extracto.imagen) {
    fields.imagen_principal = extracto.imagen;
    campos.push('imagen_principal');
  }

  // Texto limpio: rellenar si falta (o sobrescribir en force-refresh)
  if (extracto.texto_nota_limpia != null && (force || vacio(noticia.texto_nota_limpia))) {
    fields.texto_nota_limpia = extracto.texto_nota_limpia;
    fields.extracto_nota_1300 = extracto.extracto_nota_1300;
    fields.calidad_extraccion = extracto.calidad_extraccion;
    fields.texto_limpio_chars = extracto.texto_limpio_chars;
    campos.push('texto_nota_limpia', 'extracto_nota_1300', 'calidad_extraccion', 'texto_limpio_chars');
  }

  // Cuerpo de nota y tipo editorial: rellenar si faltan.
  // --only-missing-body-text puede llegar a noticias que YA tienen texto_nota_limpia
  // pero no tienen texto_cuerpo_nota: en ese caso el extractor recalculó cuerpo
  // a partir del texto_nota_limpia ya existente en el extracto.
  if (extracto.texto_cuerpo_nota != null && (force || vacio(noticia.texto_cuerpo_nota))) {
    fields.texto_cuerpo_nota = extracto.texto_cuerpo_nota;
    fields.extracto_cuerpo_1300 = extracto.extracto_cuerpo_1300;
    fields.cuerpo_nota_chars = extracto.cuerpo_nota_chars;
    campos.push('texto_cuerpo_nota', 'extracto_cuerpo_1300', 'cuerpo_nota_chars');
  }
  if (extracto.tipo_nota != null && (force || vacio(noticia.tipo_nota))) {
    fields.tipo_nota = extracto.tipo_nota;
    campos.push('tipo_nota');
  }

  // Trazabilidad del estado de extracción tras el enriquecimiento.
  if (!extracto.ok) {
    fields.estado_extraccion = 'error';
    fields.error_extraccion = extracto.error;
    marcadores.push(`enrich_error:${extracto.error ?? 'desconocido'}`);
  } else if (campos.length > 0) {
    fields.estado_extraccion = 'enriquecido';
  }

  if (marcadores.length > 0) {
    fields.notas = marcadores.join('; ');
  }

  return { fields, campos, marcadores };
}

/**
 * Orquesta el enriquecimiento de un lote de noticias. En dry-run arma el plan
 * sin escribir; en modo real actualiza Supabase nota por nota (errores de una
 * nota no detienen el resto).
 */
export async function enrichNews(
  deps: EnrichDeps,
  opts: EnrichOpts,
): Promise<EnrichResult> {
  const noticias = await deps.fetchNoticias({
    limit: opts.limit,
    onlyMissingTitle: opts.onlyMissingTitle,
    onlyMissingText: opts.onlyMissingText,
    onlyMissingCleanText: opts.onlyMissingCleanText,
    onlyMissingBodyText: opts.onlyMissingBodyText,
    onlyPendingMentions: opts.onlyPendingMentions,
    medioIds: opts.medioIds,
    forceRefreshCleanText: opts.forceRefreshCleanText,
    recentFirst: opts.recentFirst,
    windowDays: opts.windowDays,
  });

  const detalle: EnrichItemResult[] = [];
  let actualizadas = 0;
  let sinCambios = 0;
  let fallidas = 0;

  // ── Atribución per-medio (Fase 1A) ────────────────────────────────────────
  // Sembrado ANTES del loop con los medio_id pedidos explícitamente: así un
  // medio con 0 noticias elegibles queda representado (processed=0) en vez de
  // desaparecer silenciosamente — ver docs/MEDIA_VALIDATION_AND_CERTIFICATION.md §7.
  const porMedioMap = new Map<string, MedioEnrichSummary>();
  const medioIdsSolicitados = new Set((opts.medioIds ?? []).map((id) => id.trim()));
  for (const id of medioIdsSolicitados) {
    porMedioMap.set(id, { medio_id: id, requested: true, ...contadoresVacios() });
  }
  const sinMedioId = contadoresVacios();

  /** Bucket de conteo para este medio_id (o `sinMedioId` si viene null). Nunca inventa medio_id. */
  function bucketPara(medioId: string | null): MedioEnrichCounts {
    if (!medioId) return sinMedioId;
    let entry = porMedioMap.get(medioId);
    if (!entry) {
      // Medio presente en la noticia pero no en --medio-ids (corrida global
      // sin filtro, o filtro parcial): se registra igual, sin marcarlo como
      // "solicitado" (no había una lista explícita contra la cual comparar).
      entry = { medio_id: medioId, requested: medioIdsSolicitados.has(medioId), ...contadoresVacios() };
      porMedioMap.set(medioId, entry);
    }
    return entry;
  }

  for (const noticia of noticias) {
    const medioBucket = bucketPara(noticia.medio_id);
    medioBucket.processed += 1;

    const url = noticia.url_original;
    if (!url) {
      fallidas += 1;
      medioBucket.failed += 1;
      detalle.push({
        noticia_id: noticia.noticia_id,
        url: null,
        ok: false,
        error: 'sin url_original',
        campos_actualizados: [],
        marcadores: [],
        fields: {},
      });
      continue;
    }

    const extracto = await deps.extract(url);
    const { fields, campos, marcadores } = construirActualizacion(noticia, extracto, {
      forceRefreshCleanText: opts.forceRefreshCleanText,
    });

    const item: EnrichItemResult = {
      noticia_id: noticia.noticia_id,
      url,
      ok: extracto.ok,
      error: extracto.error,
      campos_actualizados: campos,
      marcadores,
      fields,
    };
    detalle.push(item);

    if (!extracto.ok) {
      fallidas += 1;
      medioBucket.failed += 1;
    }

    const hayCambios = Object.keys(fields).length > 0;
    if (!hayCambios) {
      sinCambios += 1;
      medioBucket.unchanged += 1;
      continue;
    }

    if (!opts.dryRun) {
      try {
        await deps.updateNoticia(noticia.noticia_id, fields);
      } catch (err) {
        // Un timeout/error puntual de escritura NO debe tirar todo el batch —
        // se cuenta como fallida y se sigue con la siguiente nota (confirmado
        // en vivo 2026-07-20: "statement timeout" en una sola nota mataba el
        // proceso completo, perdiendo el resto del cupo de enrich del ciclo).
        if (!item.error) item.error = err instanceof Error ? err.message : String(err);
        if (extracto.ok) {
          fallidas += 1;
          medioBucket.failed += 1;
        }
        continue;
      }
    }
    if (campos.length > 0) {
      actualizadas += 1;
      medioBucket.updated += 1;
    } else {
      sinCambios += 1;
      medioBucket.unchanged += 1;
    }
  }

  // Conteos post-proceso: refleja el estado efectivo incluyendo lo que ya tenían +
  // lo que se acaba de escribir (en dry-run, lo que se habría escrito).
  // Mismo predicado que las métricas globales, particionado por medio: cada
  // noticia cae en exactamente un bucket (su medio, o sinMedioId), por lo que
  // la suma per-media reconcilia exactamente con el global — ver
  // docs/MEDIA_VALIDATION_AND_CERTIFICATION.md §8.
  let conTextoLimpio = 0;
  let conCuerpoNota = 0;
  noticias.forEach((n, i) => {
    const d = detalle[i];
    const bucket = bucketPara(n.medio_id);

    const tieneTextoLimpio =
      !vacio(n.texto_nota_limpia) || (d !== undefined && 'texto_nota_limpia' in (d.fields ?? {}));
    if (tieneTextoLimpio) {
      conTextoLimpio += 1;
      bucket.clean_text_count += 1;
    }

    const tieneCuerpoNota =
      !vacio(n.texto_cuerpo_nota) || (d !== undefined && 'texto_cuerpo_nota' in (d.fields ?? {}));
    if (tieneCuerpoNota) {
      conCuerpoNota += 1;
      bucket.body_count += 1;
    }
  });

  return {
    leidas: noticias.length,
    actualizadas,
    sinCambios,
    fallidas,
    conTextoLimpio,
    conCuerpoNota,
    dryRun: opts.dryRun,
    detalle,
    porMedio: Array.from(porMedioMap.values()),
    sinMedioId,
  };
}
