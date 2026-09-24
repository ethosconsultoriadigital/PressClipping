/**
 * Cola justa de detección: lane fresca + backlog histórico.
 *
 * Puro: sin DB, sin Date.now(), sin I/O. El caller congela RUN_ANCHOR y
 * entrega dos pools ya filtrados (menciones_procesado=false, onlyWithText,
 * excludeDiagnostic, medioIds).
 *
 * Fresh: created_at >= cutoff, orden DESC.
 * Backlog: created_at < cutoff, orden ASC.
 * Las particiones son disjuntas; el planner aún dedupea por noticia_id.
 */
export const MENTION_QUEUE_SCHEMA_VERSION = 1 as const;

export const MENTION_QUEUE_DEFAULTS = {
  freshHours: 48,
  freshShare: 0.7,
} as const;

export class MentionQueueError extends Error {
  readonly code = 'MENTION_QUEUE_INVALID' as const;
  constructor(message: string) {
    super(message);
    this.name = 'MentionQueueError';
  }
}

export interface MentionQueueRow {
  noticia_id: string;
  created_at?: string | null;
}

export interface MentionQueueParams {
  limit: number;
  freshHours: number;
  freshShare: number;
}

export interface MentionQueuePlanInput<T extends MentionQueueRow = MentionQueueRow> {
  fresh: readonly T[];
  backlog: readonly T[];
  limit: number;
  freshShare: number;
}

export interface MentionQueuePlan<T extends MentionQueueRow = MentionQueueRow> {
  selected: T[];
  fresh_selected: number;
  backlog_selected: number;
  fresh_target: number;
  backlog_target: number;
  unused_slots: number;
  duplicate_filtered: number;
}

export interface MentionQueueTelemetry {
  event: 'mention_queue_selection';
  schema_version: typeof MENTION_QUEUE_SCHEMA_VERSION;
  fresh_lane: boolean;
  anchor: string | null;
  cutoff: string | null;
  limit: number;
  fresh_hours: number | null;
  fresh_share: number | null;
  fresh_target: number;
  backlog_target: number;
  fresh_pool: number;
  backlog_pool: number;
  selected_total: number;
  fresh_selected: number;
  backlog_selected: number;
  duplicate_filtered: number;
  oldest_selected: string | null;
  newest_selected: string | null;
}

export function extremaCreatedAt(rows: readonly MentionQueueRow[]): {
  oldest_selected: string | null;
  newest_selected: string | null;
} {
  const stamps = rows.map((r) => r.created_at).filter((v): v is string => typeof v === 'string' && v.length > 0);
  if (stamps.length === 0) return { oldest_selected: null, newest_selected: null };
  stamps.sort();
  return { oldest_selected: stamps[0] ?? null, newest_selected: stamps[stamps.length - 1] ?? null };
}

/** Fresh incluye el cutoff; backlog es estrictamente anterior. */
export function laneForCreatedAt(
  createdAtIso: string,
  cutoffIso: string,
): 'fresh' | 'backlog' {
  return createdAtIso >= cutoffIso ? 'fresh' : 'backlog';
}

export function cutoffFromAnchor(anchor: Date, freshHours: number): Date {
  return new Date(anchor.getTime() - freshHours * 3600 * 1000);
}

/**
 * Fail-fast. No clamp silencioso de valores absurdos.
 * freshHours > 0, 0 < freshShare < 1, limit > 0, todos finitos.
 */
export function validateMentionQueueParams(params: MentionQueueParams): void {
  const { limit, freshHours, freshShare } = params;
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new MentionQueueError(`limit inválido: ${String(limit)} (debe ser > 0)`);
  }
  if (!Number.isFinite(freshHours) || freshHours <= 0) {
    throw new MentionQueueError(`freshHours inválido: ${String(freshHours)} (debe ser > 0)`);
  }
  if (!Number.isFinite(freshShare) || freshShare <= 0 || freshShare >= 1) {
    throw new MentionQueueError(
      `freshShare inválido: ${String(freshShare)} (debe ser > 0 y < 1)`,
    );
  }
}

function uniqueById<T extends MentionQueueRow>(
  rows: readonly T[],
  seen: Set<string>,
): { unique: T[]; duplicates: number } {
  const unique: T[] = [];
  let duplicates = 0;
  for (const row of rows) {
    const id = row.noticia_id;
    if (!id || seen.has(id)) {
      duplicates += 1;
      continue;
    }
    seen.add(id);
    unique.push(row);
  }
  return { unique, duplicates };
}

/**
 * Planifica hasta `limit` filas. Si una lane no llena su cuota, el cupo
 * sobrante pasa a la otra. Fresh gana si el mismo id aparece en ambos pools.
 */
export function planMentionQueue<T extends MentionQueueRow>(
  input: MentionQueuePlanInput<T>,
): MentionQueuePlan<T> {
  validateMentionQueueParams({
    limit: input.limit,
    freshHours: 1,
    freshShare: input.freshShare,
  });

  const seen = new Set<string>();
  const freshUniq = uniqueById(input.fresh, seen);
  const backlogUniq = uniqueById(input.backlog, seen);
  const duplicate_filtered = freshUniq.duplicates + backlogUniq.duplicates;

  const fresh_target = Math.round(input.limit * input.freshShare);
  const backlog_target = input.limit - fresh_target;

  let takeFresh = freshUniq.unique.slice(0, Math.max(0, fresh_target));
  let takeBacklog = backlogUniq.unique.slice(0, Math.max(0, backlog_target));

  let leftover = input.limit - takeFresh.length - takeBacklog.length;
  if (leftover > 0) {
    const extra = backlogUniq.unique.slice(takeBacklog.length, takeBacklog.length + leftover);
    takeBacklog = takeBacklog.concat(extra);
    leftover = input.limit - takeFresh.length - takeBacklog.length;
  }
  if (leftover > 0) {
    const extra = freshUniq.unique.slice(takeFresh.length, takeFresh.length + leftover);
    takeFresh = takeFresh.concat(extra);
  }

  const selected = takeFresh.concat(takeBacklog);
  return {
    selected,
    fresh_selected: takeFresh.length,
    backlog_selected: takeBacklog.length,
    fresh_target,
    backlog_target,
    unused_slots: input.limit - selected.length,
    duplicate_filtered,
  };
}
