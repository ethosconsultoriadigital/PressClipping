/**
 * Paginación de recovery: agotar ventana o declarar CAP_HIT.
 */
export function paginationOutcome(input: {
  lastBatchLen: number;
  pageSize: number;
  nextFrom: number;
  cap: number;
}): { complete: boolean; capHit: boolean } {
  if (input.lastBatchLen < input.pageSize) return { complete: true, capHit: false };
  if (input.nextFrom >= input.cap) return { complete: false, capHit: true };
  return { complete: false, capHit: false };
}
