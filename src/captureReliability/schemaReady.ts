import type { SupabaseClient } from '@supabase/supabase-js';

export type SchemaReadiness = 'NONE_PRESENT' | 'FULLY_READY' | 'PARTIAL_SCHEMA';

const TABLES = [
  'capture_recovery_queue',
  'capture_reconcile_runs',
  'capture_source_reconcile_state',
  'capture_gap_candidates',
  'capture_recovery_observations',
] as const;

const REQUIRED_QUEUE_COLUMNS = [
  'hash_url',
  'canonical_url',
  'discovered_url',
  'published_at',
  'discovered_title',
  'last_dry_run_result',
];

const REQUIRED_GAP_COLUMNS = [
  'candidate_id',
  'publisher_final_url',
  'canonical_hash',
  'candidate_medio_ids',
  'claimed_at',
  'consumed_at',
];

export function classifySchemaPresence(present: boolean[], rpcOk: boolean, columnsOk = true): SchemaReadiness {
  const any = present.some(Boolean) || rpcOk;
  const all = present.length > 0 && present.every(Boolean) && rpcOk && columnsOk;
  if (all) return 'FULLY_READY';
  if (!any) return 'NONE_PRESENT';
  return 'PARTIAL_SCHEMA';
}

async function probeTable(sb: SupabaseClient, table: string, columns?: string[]): Promise<boolean> {
  const sel = columns?.length ? columns.join(',') : '*';
  const { error } = await sb.from(table).select(sel).limit(1);
  return !error;
}

async function probeRpc(sb: SupabaseClient, name: string, args: Record<string, unknown>): Promise<boolean> {
  const { error } = await sb.rpc(name, args);
  return !error;
}

export async function captureReliabilitySchemaReady(sb: SupabaseClient): Promise<SchemaReadiness> {
  const present: boolean[] = [];
  present.push(await probeTable(sb, 'capture_recovery_queue', REQUIRED_QUEUE_COLUMNS));
  present.push(await probeTable(sb, 'capture_reconcile_runs'));
  present.push(await probeTable(sb, 'capture_source_reconcile_state'));
  present.push(await probeTable(sb, 'capture_gap_candidates', REQUIRED_GAP_COLUMNS));
  present.push(await probeTable(sb, 'capture_recovery_observations'));
  const now = new Date().toISOString();
  const rpcRecovery = await probeRpc(sb, 'claim_capture_recovery_batch', {
    p_worker_id: 'schema-probe',
    p_limit: 0,
    p_now: now,
  });
  const rpcSource = await probeRpc(sb, 'claim_capture_source_batch', {
    p_worker_id: 'schema-probe',
    p_window_start: now,
    p_window_end: now,
    p_medio_ids: [],
    p_limit: 0,
    p_now: now,
  });
  const rpcGap = await probeRpc(sb, 'claim_capture_gap_batch', {
    p_worker_id: 'schema-probe',
    p_limit: 0,
    p_now: now,
  });
  const rpcOk = rpcRecovery && rpcSource && rpcGap;
  const columnsOk = present[0] === true && present[3] === true;
  return classifySchemaPresence(present, rpcOk, columnsOk);
}

export async function googleRadarCursorSchemaReady(sb: SupabaseClient): Promise<boolean> {
  return probeTable(sb, 'b_google_radar_cursor', ['id', 'plan_hash', 'offset', 'cycle_started_at', 'updated_at']);
}
