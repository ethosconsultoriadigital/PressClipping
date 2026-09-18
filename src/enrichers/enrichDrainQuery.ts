/**
 * Plan de query del drain (ENRICH DRAIN V1). Módulo PURO.
 *
 * Aquí vive la ELEGIBILIDAD y el KEYSET, separados del repositorio, para que se
 * puedan testear de forma determinista sin Supabase. El repositorio solo
 * traduce el plan a llamadas del query builder.
 *
 * Contrato de elegibilidad (S1.5):
 *
 *     texto_nota_limpia IS NULL
 *     AND created_at <= W                         (cutoff fijo de la sesión)
 *     AND ( enrich_last_attempt_at IS NULL        -- nunca intentada
 *           OR enrich_next_attempt_at <= W )      -- reintento vencido
 *
 * BLOCKED_REVIEW (last != NULL, next NULL) queda excluido por construcción: no
 * cumple ninguna de las dos ramas del OR.
 *
 * `menciones_procesado` NO participa: la deuda de enrich es la falta de texto,
 * no el estado de detección. Esa confusión era parte del bug original.
 *
 * Dos colas con orden total estable y SIN OFFSET:
 *
 *   FRESH   created_at en (freshSince, W]   →  created_at DESC, noticia_id DESC
 *   BACKLOG created_at <= freshSince        →  created_at ASC,  noticia_id ASC
 *
 * El cursor es siempre la clave LEÍDA (created_at, noticia_id) de la última
 * fila de la página, nunca un contador de filas. Por eso avanza aunque el
 * procesamiento falle y aunque los éxitos desaparezcan del conjunto pendiente:
 * la página siguiente se define por la clave, no por la posición.
 *
 * `noticia_id` (uuid) desempata timestamps idénticos, que en este pipeline son
 * habituales: un lote de ingesta escribe decenas de filas con el mismo
 * `created_at`.
 */

/** Las dos colas lógicas del drain. */
export type DrainQueue = 'fresh' | 'backlog';

/** Cursor keyset: la clave de la última fila servida. */
export interface DrainCursor {
  created_at: string;
  noticia_id: string;
}

export interface DrainPageRequest {
  queue: DrainQueue;
  /** Cutoff W de la sesión (ISO). No se procesa nada creado después. */
  cutoff: string;
  /** Frontera fresh/backlog (ISO). */
  freshSince: string;
  pageSize: number;
  /** Aísla el drain a estos medios. `null`/vacío = todos los del tier. */
  medioIds?: readonly string[] | null;
  cursor?: DrainCursor | null;
}

export type DrainFilter =
  | { kind: 'is'; column: string; value: null }
  | { kind: 'lte' | 'gte' | 'lt' | 'gt'; column: string; value: string }
  | { kind: 'in'; column: string; values: string[] }
  | { kind: 'or'; expression: string };

export interface DrainOrder {
  column: string;
  ascending: boolean;
}

export interface DrainPageQueryPlan {
  select: string;
  filters: DrainFilter[];
  order: DrainOrder[];
  limit: number;
}

/** Columnas que el drain necesita: contenido + metadata de reintento + cursor. */
export const DRAIN_SELECT =
  'noticia_id, medio_id, url_original, titulo, resumen, texto_extraido, autor, seccion,' +
  ' imagen_principal, texto_nota_limpia, extracto_nota_1300, calidad_extraccion,' +
  ' texto_limpio_chars, texto_cuerpo_nota, extracto_cuerpo_1300, cuerpo_nota_chars,' +
  ' tipo_nota, created_at, enrich_last_attempt_at, enrich_next_attempt_at, enrich_failure_class';

/** Rama de elegibilidad por reintento: nunca intentada o con reintento vencido. */
export function expresionElegibilidad(cutoff: string): string {
  return `enrich_last_attempt_at.is.null,enrich_next_attempt_at.lte.${cutoff}`;
}

/**
 * Expresión keyset para continuar DESPUÉS de `cursor`. Estricta (`lt`/`gt`) en
 * la clave compuesta, así que ninguna fila ya leída puede repetirse.
 */
export function expresionKeyset(cursor: DrainCursor, ascending: boolean): string {
  const cmp = ascending ? 'gt' : 'lt';
  return (
    `created_at.${cmp}.${cursor.created_at},` +
    `and(created_at.eq.${cursor.created_at},noticia_id.${cmp}.${cursor.noticia_id})`
  );
}

/** Construye el plan de una página. PURO y determinista. */
export function buildDrainPageQueryPlan(req: DrainPageRequest): DrainPageQueryPlan {
  if (!Number.isInteger(req.pageSize) || req.pageSize <= 0) {
    throw new Error(`buildDrainPageQueryPlan: pageSize debe ser entero > 0 (recibido: ${req.pageSize}).`);
  }
  const ascending = req.queue === 'backlog';
  const filters: DrainFilter[] = [
    { kind: 'is', column: 'texto_nota_limpia', value: null },
    { kind: 'lte', column: 'created_at', value: req.cutoff },
  ];

  if (req.queue === 'fresh') {
    filters.push({ kind: 'gt', column: 'created_at', value: req.freshSince });
  } else {
    filters.push({ kind: 'lte', column: 'created_at', value: req.freshSince });
  }

  const medioIds = req.medioIds ? [...new Set(req.medioIds)] : [];
  if (medioIds.length > 0) {
    filters.push({ kind: 'in', column: 'medio_id', values: medioIds });
  }

  filters.push({ kind: 'or', expression: expresionElegibilidad(req.cutoff) });

  if (req.cursor) {
    filters.push({ kind: 'or', expression: expresionKeyset(req.cursor, ascending) });
  }

  return {
    select: DRAIN_SELECT,
    filters,
    order: [
      { column: 'created_at', ascending },
      { column: 'noticia_id', ascending },
    ],
    limit: req.pageSize,
  };
}

/** Cursor a partir de la última fila LEÍDA (no de la última procesada con éxito). */
export function cursorDesdeFila(row: {
  created_at: string | null;
  noticia_id: string;
}): DrainCursor | null {
  if (!row.created_at) return null;
  return { created_at: row.created_at, noticia_id: row.noticia_id };
}

/** ¿El cursor avanzó? Detecta páginas repetidas → NO_PROGRESS. */
export function cursorAvanzo(previo: DrainCursor | null, nuevo: DrainCursor | null): boolean {
  if (nuevo == null) return false;
  if (previo == null) return true;
  return previo.created_at !== nuevo.created_at || previo.noticia_id !== nuevo.noticia_id;
}
