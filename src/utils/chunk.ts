/**
 * Utilidades de procesamiento por lotes (batching).
 *
 * PostgREST traduce `.in('col', ids)` a un filtro en el query string; con
 * listas grandes (cientos de IDs) la URL supera el límite del servidor y la
 * petición falla con "Bad Request". Estas utilidades parten la lista en lotes
 * seguros y ejecutan una operación por lote, reportando con claridad cuál falló
 * (sin dejar actualizaciones parciales silenciosas).
 *
 * Módulo PURO (sin DB ni red): la operación por lote se inyecta como callback,
 * lo que lo hace fácilmente testeable.
 */

/** Parte `items` en sublistas de como máximo `size` elementos. */
export function chunkArray<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error(`chunkArray: size debe ser un entero > 0 (recibido: ${size}).`);
  }
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/** Resultado mínimo estilo PostgREST de una operación por lote. */
export interface ResultadoLote {
  error: { message: string } | null;
}

/**
 * Ejecuta `run` sobre cada lote de `items` (tamaño `batchSize`), en orden.
 *
 * - Lista vacía → no ejecuta `run` y devuelve 0.
 * - Lista <= batchSize → un solo lote (una sola llamada a `run`).
 * - Si un lote devuelve `error`, lanza con el índice del lote, su tamaño y
 *   cuántos elementos ya se habían procesado (no oculta updates parciales).
 *
 * Devuelve el total de elementos procesados con éxito.
 */
export async function ejecutarPorLotes<T>(
  items: readonly T[],
  batchSize: number,
  run: (lote: T[], index: number, total: number) => Promise<ResultadoLote>,
): Promise<number> {
  if (items.length === 0) return 0;
  const lotes = chunkArray(items, batchSize);
  let procesados = 0;
  for (let i = 0; i < lotes.length; i++) {
    const lote = lotes[i]!;
    const { error } = await run(lote, i, lotes.length);
    if (error) {
      throw new Error(
        `Operación por lotes falló en lote ${i + 1}/${lotes.length} ` +
          `(tamaño=${lote.length}, ya_procesados=${procesados}): ${error.message}`,
      );
    }
    procesados += lote.length;
  }
  return procesados;
}
