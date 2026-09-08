/**
 * Temporal Window — Media Validation & Certification, FASE 1C HARDENING
 * FINAL (blocker B1C — "TEMPORAL WINDOW NO ANCLADA").
 *
 * Problema corregido: antes, cada snapshot (BEFORE/AFTER) calculaba su
 * propio cutoff con `new Date(Date.now() - windowDays * 86400000)` en el
 * momento de ejecutar la query. Como BEFORE y AFTER se capturan en
 * instantes distintos (por diseño — hay un run real entre medio), eso
 * producía ventanas de tiempo DISTINTAS aunque `window_days` fuera
 * idéntico (p.ej. BEFORE a las 10:00 y AFTER a las 10:20 con
 * `window_days=30` generan cutoffs 20 minutos distintos).
 *
 * Corrección: se introduce `window_anchor` (ISO timestamp), una identidad
 * temporal EXPLÍCITA que se genera UNA sola vez para el contexto de
 * validación (fuera de este módulo — lo provee el operador/CLI) y se
 * reutiliza sin cambios tanto en BEFORE como en AFTER. El cutoff se deriva
 * SIEMPRE de `window_anchor`, nunca de `Date.now()`.
 */

/**
 * Valida que `value` sea un timestamp ISO interpretable (rechaza `""`,
 * `"foo"`, cualquier string que produzca `Invalid Date`). Deliberadamente
 * no exige un formato ISO-8601 estricto byte a byte (serían falsos
 * negativos innecesarios) — solo que sea una fecha real y no ambigua.
 */
export function isValidIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim().length === 0) return false;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms);
}

/**
 * Deriva el cutoff temporal (`fecha_publicacion >= cutoff`) de forma
 * puramente determinista a partir de `windowAnchor` — NUNCA de
 * `Date.now()`. Mismo `windowAnchor` + mismo `windowDays` → EXACTAMENTE el
 * mismo cutoff, sin importar cuándo se ejecute esta función.
 */
export function computeWindowStart(windowAnchorIso: string, windowDays: number): string {
  if (!isValidIsoTimestamp(windowAnchorIso)) {
    throw new Error(`computeWindowStart: window_anchor inválido: ${JSON.stringify(windowAnchorIso)}`);
  }
  const anchorMs = new Date(windowAnchorIso).getTime();
  return new Date(anchorMs - windowDays * 24 * 60 * 60 * 1000).toISOString();
}
