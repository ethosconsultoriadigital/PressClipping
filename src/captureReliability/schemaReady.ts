import type { SupabaseClient } from '@supabase/supabase-js';

export type SchemaReadiness = 'NONE_PRESENT' | 'FULLY_READY' | 'PARTIAL_SCHEMA';

const TABLES = [
  'capture_recovery_queue',
  'capture_reconcile_runs',
  'capture_source_reconcile_state',
  'capture_gap_candidates',
  'capture_recovery_observations',
] as const;

export function classifySchemaPresence(present: boolean[], rpcOk: boolean): SchemaReadiness {
  const any = present.some(Boolean) || rpcOk;
  const all = present.length > 0 && present.every(Boolean) && rpcOk;
  if (all) return 'FULLY_READY';
  if (!any) return 'NONE_PRESENT';
  return 'PARTIAL_SCHEMA';
}

export async function captureReliabilitySchemaReady(sb: SupabaseClient): Promise<SchemaReadiness> {
  const present: boolean[] = [];
  for (const table of TABLES) {
    const { error } = await sb.from(table).select('*').limit(1);
    present.push(!error);
  }
  const { error: rpcErr } = await sb.rpc('claim_capture_recovery_batch', {
    p_worker_id: 'schema-probe',
    p_limit: 0,
    p_now: new Date().toISOString(),
  });
  return classifySchemaPresence(present, !rpcErr);
}
