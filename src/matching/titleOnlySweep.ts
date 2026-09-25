/**
 * Barrido idempotente de toda la ventana title-only.
 * No marca procesado. El tope es de seguridad, no una cola de 500.
 */

export const TITLE_ONLY_PAGE_SIZE = 500;
export const TITLE_ONLY_MAX_SCAN = 10000;

export interface FilaTitleOnly {
  noticia_id: string;
  fecha_publicacion?: string | null;
  fecha_captura?: string | null;
}

export interface BarridoTitleOnly<T extends FilaTitleOnly> {
  rows: T[];
  scanned: number;
  eligible: number;
  truncated: boolean;
  eligibleOverCap: boolean;
}

export function paginaRange(desde: number, pageSize: number): { from: number; to: number } {
  return { from: desde, to: desde + pageSize - 1 };
}

/** Une las dos consultas editoriales, deduplica y ordena reciente primero. */
export function fusionarTitleOnly<T extends FilaTitleOnly>(publicadas: T[], sinPublicacion: T[]): T[] {
  const vistas = new Set<string>();
  const filas: T[] = [];
  for (const fila of [...publicadas, ...sinPublicacion]) {
    if (!fila.noticia_id || vistas.has(fila.noticia_id)) continue;
    vistas.add(fila.noticia_id);
    filas.push(fila);
  }
  filas.sort((a, b) => {
    const ia = a.fecha_publicacion ?? a.fecha_captura ?? '';
    const ib = b.fecha_publicacion ?? b.fecha_captura ?? '';
    if (ia !== ib) return ia < ib ? 1 : -1;
    return a.noticia_id < b.noticia_id ? 1 : a.noticia_id > b.noticia_id ? -1 : 0;
  });
  return filas;
}

export function aplicarTopeTitleOnly<T extends FilaTitleOnly>(
  filas: T[],
  maxScanRows: number,
): BarridoTitleOnly<T> {
  const eligible = filas.length;
  const truncated = eligible > maxScanRows;
  return {
    rows: truncated ? filas.slice(0, maxScanRows) : filas,
    scanned: Math.min(eligible, maxScanRows),
    eligible,
    truncated,
    eligibleOverCap: truncated,
  };
}

/** En real, un barrido truncado no inserta. En dry-run tampoco hay writes. */
export function puedeInsertarTitleOnly(input: { dryRun: boolean; truncated: boolean }): boolean {
  return !input.dryRun && !input.truncated;
}
