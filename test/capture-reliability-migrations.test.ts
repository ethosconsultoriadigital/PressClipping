import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');

function sql(name: string): string {
  return readFileSync(resolve(root, 'supabase/migrations', name), 'utf8');
}

describe('Capture reliability migrations package', () => {
  it('T65 0016-0019 exist and 0018/0019 grant service_role', () => {
    const a = sql('0016_capture_recovery_queue.sql');
    const b = sql('0017_capture_reconcile_state.sql');
    const c = sql('0018_capture_reliability_v4.sql');
    const d = sql('0019_capture_gap_contract.sql');
    expect(a).toContain('capture_recovery_queue');
    expect(b).toContain('capture_gap_candidates');
    expect(c).toContain('claim_capture_recovery_batch');
    expect(c).toContain('claim_capture_source_batch');
    expect(c).toContain('claim_capture_gap_batch');
    expect(c).toContain('grant execute on function public.claim_capture_recovery_batch');
    expect(c).toContain('to service_role');
    expect(c).toContain('revoke all on table public.capture_recovery_queue from anon, authenticated');
    expect(d).toContain('candidate_medio_ids text[]');
    expect(d).toContain('google_item_urls text[]');
    expect(d).toContain('grant select, insert, update, delete on table public.capture_gap_candidates to service_role');
    expect(sql('0019b_capture_reliability_preflight.sql')).toContain('claim_capture_gap_batch');
  });

  it('T66 fresh schema package is ordered 0016→0019', () => {
    const names = ['0016_capture_recovery_queue.sql', '0017_capture_reconcile_state.sql', '0018_capture_reliability_v4.sql', '0019_capture_gap_contract.sql'];
    expect(names.join('|')).toBe('0016_capture_recovery_queue.sql|0017_capture_reconcile_state.sql|0018_capture_reliability_v4.sql|0019_capture_gap_contract.sql');
    const combined = names.map(sql).join('\n');
    expect(combined.indexOf('create table if not exists public.capture_recovery_queue')).toBeLessThan(
      combined.indexOf('create table if not exists public.capture_gap_candidates'),
    );
    expect(combined.indexOf('create or replace function public.claim_capture_recovery_batch')).toBeLessThan(
      combined.indexOf('candidate_medio_ids text[]'),
    );
  });
});
