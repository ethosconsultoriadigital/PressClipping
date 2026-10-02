import type { Checkpoint } from './types.js';

export function emptyCheckpoint(partial: Omit<Checkpoint, 'processed_medio_ids' | 'updated_at' | 'cap_hit' | 'time_budget_hit' | 'last_medio_id'> & {
  last_medio_id?: string | null;
}): Checkpoint {
  return {
    ...partial,
    last_medio_id: partial.last_medio_id ?? null,
    processed_medio_ids: [],
    cap_hit: false,
    time_budget_hit: false,
    updated_at: new Date().toISOString(),
  };
}

export function persistProgress(cp: Checkpoint, medioId: string, nowIso: string): Checkpoint {
  const ids = cp.processed_medio_ids.includes(medioId)
    ? cp.processed_medio_ids
    : [...cp.processed_medio_ids, medioId];
  return { ...cp, last_medio_id: medioId, processed_medio_ids: ids, updated_at: nowIso };
}

export function timeBudgetExceeded(startedMs: number, budgetMs: number, nowMs: number): boolean {
  return nowMs - startedMs >= budgetMs;
}

export function resumeFrom(cp: Checkpoint, catalog: string[]): string[] {
  const done = new Set(cp.processed_medio_ids);
  const last = cp.last_medio_id;
  const idx = last ? catalog.indexOf(last) : -1;
  const rest = catalog.filter((id) => !done.has(id));
  if (idx >= 0) {
    const after = catalog.slice(idx + 1).filter((id) => !done.has(id));
    const skipped = rest.filter((id) => !after.includes(id) && id !== last);
    return [...after, ...skipped];
  }
  return rest;
}
