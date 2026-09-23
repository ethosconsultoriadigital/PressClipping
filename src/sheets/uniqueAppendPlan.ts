/**
 * Plan PURA de append idempotente por clave (p.ej. mencion_id en 02_Menciones).
 *
 * Sin red, sin Sheets: el writer real lee IDs existentes, llama esto, append
 * SOLO `to_append` y verifica el readback con `evaluarReadbackUnique`.
 *
 * Filas existentes SIN clave (blank) se ignoran para el dedupe: no se borran
 * ni se reescriben. El anti-duplicado aplica solo a IDs reales.
 */
export interface UniqueAppendPlan<T extends Record<string, unknown>> {
  to_append: T[];
  already_present_ids: string[];
  duplicates_in_batch: string[];
  selected_ids: string[];
  preexisting_duplicate_ids: string[];
}

export interface UniqueReadbackResult {
  missing_ids: string[];
  duplicate_ids: string[];
  all_present: boolean;
  mismatch: boolean;
}

function nonBlank(id: unknown): string | null {
  const s = String(id ?? '').trim();
  return s.length > 0 ? s : null;
}

function countIds(ids: readonly string[]): Map<string, number> {
  const c = new Map<string, number>();
  for (const raw of ids) {
    const id = nonBlank(raw);
    if (!id) continue;
    c.set(id, (c.get(id) ?? 0) + 1);
  }
  return c;
}

/**
 * Planifica el append: dedupe el lote, salta IDs ya presentes, reporta
 * duplicados preexistentes en hoja (sin borrar).
 */
export function planUniqueAppendByKey<T extends Record<string, unknown>>(
  existingIds: readonly string[],
  incoming: readonly T[],
  key: string,
): UniqueAppendPlan<T> {
  const existingCounts = countIds(existingIds);
  const preexisting_duplicate_ids = [...existingCounts.entries()]
    .filter(([, n]) => n > 1)
    .map(([id]) => id)
    .sort();
  const existingSet = new Set(existingCounts.keys());

  const seenBatch = new Set<string>();
  const to_append: T[] = [];
  const already_present_ids: string[] = [];
  const duplicates_in_batch: string[] = [];
  const selected_ids: string[] = [];

  for (const row of incoming) {
    const id = nonBlank(row[key]);
    if (!id) continue;
    if (seenBatch.has(id)) {
      duplicates_in_batch.push(id);
      continue;
    }
    seenBatch.add(id);
    selected_ids.push(id);
    if (existingSet.has(id)) {
      already_present_ids.push(id);
    } else {
      to_append.push(row);
    }
  }

  return {
    to_append,
    already_present_ids,
    duplicates_in_batch,
    selected_ids,
    preexisting_duplicate_ids,
  };
}

/** Verifica que todos los IDs seleccionados estén al menos una vez en la hoja. */
export function evaluarReadbackUnique(
  selectedIds: readonly string[],
  sheetIdsAfter: readonly string[],
): UniqueReadbackResult {
  const afterCounts = countIds(sheetIdsAfter);
  const missing_ids = selectedIds.filter((id) => !afterCounts.has(id)).sort();
  const duplicate_ids = [...afterCounts.entries()]
    .filter(([, n]) => n > 1)
    .map(([id]) => id)
    .sort();
  const all_present = missing_ids.length === 0;
  return {
    missing_ids,
    duplicate_ids,
    all_present,
    mismatch: !all_present,
  };
}
