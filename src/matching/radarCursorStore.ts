import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { GoogleQueryPlan, GoogleQueryCursor } from './googleQueryPlan.js';

export interface DurableRadarCursor {
  plan_hash: string;
  offset: number;
  cycle_started_at: string;
  last_query_normalized: string | null;
  updated_at: string;
}

export function googleQueryPlanHash(plan: GoogleQueryPlan): string {
  const payload = plan.queries.map((q) => q.normalized).join('\n');
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

export function reconcileCursor(plan: GoogleQueryPlan, stored: DurableRadarCursor | null): DurableRadarCursor {
  const hash = googleQueryPlanHash(plan);
  const now = new Date().toISOString();
  if (!stored || stored.plan_hash !== hash) {
    return {
      plan_hash: hash,
      offset: 0,
      cycle_started_at: now,
      last_query_normalized: null,
      updated_at: now,
    };
  }
  const offset = stored.offset >= plan.QUERY_TOTAL ? 0 : stored.offset;
  return { ...stored, offset, plan_hash: hash };
}

export interface RadarCursorStore {
  load(): Promise<DurableRadarCursor | null>;
  save(cursor: DurableRadarCursor): Promise<void>;
}

export class FileRadarCursorStore implements RadarCursorStore {
  constructor(private readonly path: string) {}
  async load(): Promise<DurableRadarCursor | null> {
    try {
      return JSON.parse(readFileSync(this.path, 'utf8')) as DurableRadarCursor;
    } catch {
      return null;
    }
  }
  async save(cursor: DurableRadarCursor): Promise<void> {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(cursor, null, 2));
  }
}

/** Prepared. Disabled until Agent A V4 schema exists. Does not create tables. */
export class SupabaseRadarCursorStore implements RadarCursorStore {
  constructor(
    private readonly client: { from: (t: string) => any },
    private readonly table = 'b_google_radar_cursor',
    private readonly rowId = 'google-news-gap-radar',
  ) {}
  async load(): Promise<DurableRadarCursor | null> {
    const { data, error } = await this.client.from(this.table).select('*').eq('id', this.rowId).maybeSingle();
    if (error) throw new Error(`GOOGLE_RADAR_CURSOR_DB: ${error.message}`);
    if (!data) return null;
    return {
      plan_hash: String(data.plan_hash ?? ''),
      offset: Number(data.offset ?? 0),
      cycle_started_at: String(data.cycle_started_at ?? ''),
      last_query_normalized: data.last_query_normalized ?? null,
      updated_at: String(data.updated_at ?? ''),
    };
  }
  async save(cursor: DurableRadarCursor): Promise<void> {
    const { error } = await this.client.from(this.table).upsert({
      id: this.rowId,
      ...cursor,
    });
    if (error) throw new Error(`GOOGLE_RADAR_CURSOR_DB: ${error.message}`);
  }
}

export function toSliceCursor(d: DurableRadarCursor): GoogleQueryCursor {
  return { offset: d.offset, updated_at: d.updated_at };
}

export function afterSlice(
  plan: GoogleQueryPlan,
  before: DurableRadarCursor,
  nextOffset: number,
  lastNormalized: string | null,
): DurableRadarCursor {
  const now = new Date().toISOString();
  const completedCycle = nextOffset === 0 && before.offset > 0;
  return {
    plan_hash: googleQueryPlanHash(plan),
    offset: nextOffset,
    cycle_started_at: completedCycle ? now : before.cycle_started_at,
    last_query_normalized: lastNormalized,
    updated_at: now,
  };
}
