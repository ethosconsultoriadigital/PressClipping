/**
 * Plan de páginas para el query LEGACY de enrich (`getNoticiasParaEnriquecer`).
 *
 * PostgREST/Supabase no garantiza más de ~1000 filas por request. Un `.limit(N)`
 * con N>1000 (o un SELECT sin limit) se truncaba en silencio: Heraldo/Chihuahua
 * perdían candidatos de la ventana 7d. El drain V1 ya pagina por keyset; este
 * módulo pagina el camino legacy con `.range()` determinista.
 *
 * `limit` del caller es el TOPE TOTAL, no el tamaño de página.
 */
export const ENRICH_CANDIDATE_PAGE_SIZE = 1000;

export interface EnrichPageRange {
  from: number;
  to: number;
  /** Filas pedidas en esta página (to - from + 1). */
  take: number;
}

/**
 * Siguiente página. `remaining === null` = sin tope (recorrer hasta página corta).
 * `offset` es el número de filas YA acumuladas (no un cursor keyset).
 */
export function nextEnrichCandidatePage(
  offset: number,
  remaining: number | null,
  pageSize: number = ENRICH_CANDIDATE_PAGE_SIZE,
): EnrichPageRange | null {
  if (pageSize < 1) return null;
  if (remaining !== null && remaining <= 0) return null;
  if (offset < 0) return null;
  const take = remaining === null ? pageSize : Math.min(pageSize, remaining);
  if (take < 1) return null;
  return { from: offset, to: offset + take - 1, take };
}

/**
 * Todas las páginas teóricas para un `limit` conocido (tests 999/1000/1001/2500).
 * Si `limit` es null, no se materializa un plan infinito: el loop de fetch corta
 * cuando una página vuelve corta.
 */
export function enrichCandidatePagePlan(
  limit: number,
  pageSize: number = ENRICH_CANDIDATE_PAGE_SIZE,
): EnrichPageRange[] {
  if (!Number.isFinite(limit) || limit <= 0) return [];
  const pages: EnrichPageRange[] = [];
  let offset = 0;
  let remaining = limit;
  while (remaining > 0) {
    const page = nextEnrichCandidatePage(offset, remaining, pageSize);
    if (!page) break;
    pages.push(page);
    offset += page.take;
    remaining -= page.take;
  }
  return pages;
}
