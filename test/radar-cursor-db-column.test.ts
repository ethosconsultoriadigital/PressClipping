import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { googleRadarCursorSchemaReady } from '../src/captureReliability/schemaReady.js';
import { SupabaseRadarCursorStore, type DurableRadarCursor } from '../src/matching/radarCursorStore.js';

const root = resolve(import.meta.dirname, '..');

function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8');
}

function cursorTableBodies(sql: string): string[] {
  return [...sql.matchAll(/create table if not exists public\.b_google_radar_cursor\s*\(([\s\S]*?)\);/gi)].map((m) => m[1] ?? '');
}

const RESERVED_OFFSET_COLUMN = /\boffset\s+integer\b|"offset"\s+integer\b/i;

describe('Radar cursor DB column contract', () => {
  it('0020 stores cursor_offset and does not declare offset integer', () => {
    const bodies = cursorTableBodies(read('supabase/migrations/0020_reliability_integration_rc1.sql'));
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain('cursor_offset integer not null');
    expect(bodies[0]).not.toMatch(RESERVED_OFFSET_COLUMN);
  });

  it('static guard rejects b_google_radar_cursor offset integer in migrations and live artifacts', () => {
    const files = [
      ...readdirSync(join(root, 'supabase/migrations')).filter((name) => name.endsWith('.sql')).map((name) => `supabase/migrations/${name}`),
      'artifacts/reliability-live-migrations.sql',
      'artifacts/reliability-live-preflight.sql',
    ];
    const offenders: string[] = [];
    for (const rel of files) {
      const bodies = cursorTableBodies(read(rel));
      for (const body of bodies) {
        if (RESERVED_OFFSET_COLUMN.test(body) || !body.includes('cursor_offset integer not null')) {
          offenders.push(rel);
        }
      }
    }
    expect(offenders).toEqual([]);
    const combined = read('artifacts/reliability-live-migrations.sql');
    const preflight = read('artifacts/reliability-live-preflight.sql');
    expect(cursorTableBodies(combined)).toHaveLength(1);
    expect(cursorTableBodies(preflight)).toHaveLength(1);
    expect(preflight.startsWith('BEGIN;')).toBe(true);
    expect(preflight.trimEnd().endsWith('ROLLBACK;')).toBe(true);
    expect(preflight).toContain('cursor_offset');
    expect(preflight).toContain("column_name = 'offset'");
  });

  it('LOAD maps cursor_offset=24 to DurableRadarCursor.offset=24', async () => {
    const store = new SupabaseRadarCursorStore({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                plan_hash: 'plan-24',
                cursor_offset: 24,
                cycle_started_at: 't0',
                last_query_normalized: 'mery',
                updated_at: 't1',
              },
              error: null,
            }),
          }),
        }),
      }),
    });
    const loaded = await store.load();
    const cursor: DurableRadarCursor = {
      plan_hash: 'plan-24',
      offset: 24,
      cycle_started_at: 't0',
      last_query_normalized: 'mery',
      updated_at: 't1',
    };
    expect(loaded).toEqual(cursor);
    expect(loaded?.offset).toBe(24);
  });

  it('SAVE maps DurableRadarCursor.offset=36 to cursor_offset and omits offset', async () => {
    const upserts: unknown[] = [];
    const store = new SupabaseRadarCursorStore({
      from: () => ({
        upsert: async (payload: unknown) => {
          upserts.push(payload);
          return { error: null };
        },
      }),
    });
    const cursor: DurableRadarCursor = {
      plan_hash: 'plan-36',
      offset: 36,
      cycle_started_at: 'c0',
      last_query_normalized: null,
      updated_at: 'u0',
    };
    await store.save(cursor);
    expect(upserts).toEqual([
      {
        id: 'google-news-gap-radar',
        plan_hash: 'plan-36',
        cursor_offset: 36,
        cycle_started_at: 'c0',
        last_query_normalized: null,
        updated_at: 'u0',
      },
    ]);
    expect(upserts[0]).not.toHaveProperty('offset');
  });

  it('googleRadarCursorSchemaReady selects cursor_offset', async () => {
    const selected: string[] = [];
    const sb = {
      from: (table: string) => ({
        select: (cols: string) => ({
          limit: async () => {
            selected.push(`${table}:${cols}`);
            return { error: null };
          },
        }),
      }),
    };
    const ready = await googleRadarCursorSchemaReady(sb as never);
    expect(ready).toBe(true);
    expect(selected).toEqual([
      'b_google_radar_cursor:id,plan_hash,cursor_offset,cycle_started_at,updated_at',
    ]);
    expect(selected[0]?.split(':')[1]?.split(',')).not.toContain('offset');
  });
});
