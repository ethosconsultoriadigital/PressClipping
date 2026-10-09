-- Read-only / transactional-safe preflight. Do not apply as LIVE mutation plan beyond this file's checks.
-- Expected order: 0016, 0017, 0018, 0019, 0020, 0021 security, 0022 coverage debt.

do $$
begin
  if to_regclass('public.capture_recovery_queue') is null then
    raise notice 'PREFLIGHT missing capture_recovery_queue (apply 0016)';
  end if;
  if to_regclass('public.capture_reconcile_runs') is null then
    raise notice 'PREFLIGHT missing capture_reconcile_runs (apply 0017)';
  end if;
  if to_regclass('public.capture_source_reconcile_state') is null then
    raise notice 'PREFLIGHT missing capture_source_reconcile_state (apply 0017)';
  end if;
  if to_regclass('public.capture_gap_candidates') is null then
    raise notice 'PREFLIGHT missing capture_gap_candidates (apply 0017)';
  end if;
  if to_regclass('public.capture_recovery_observations') is null then
    raise notice 'PREFLIGHT missing capture_recovery_observations (apply 0018)';
  end if;
  if to_regprocedure('public.claim_capture_recovery_batch(text, integer, timestamp with time zone)') is null
     and to_regprocedure('public.claim_capture_recovery_batch(text, integer, timestamp with time zone, text[])') is null then
    raise notice 'PREFLIGHT missing claim_capture_recovery_batch (apply 0018/0020)';
  end if;
  if to_regprocedure('public.claim_capture_source_batch(text, timestamp with time zone, timestamp with time zone, text[], integer, timestamp with time zone)') is null then
    raise notice 'PREFLIGHT missing claim_capture_source_batch (apply 0018)';
  end if;
  if to_regprocedure('public.claim_capture_gap_batch(text, integer, timestamp with time zone)') is null then
    raise notice 'PREFLIGHT missing claim_capture_gap_batch (apply 0018)';
  end if;
  if to_regclass('public.b_google_radar_cursor') is null then
    raise notice 'PREFLIGHT missing b_google_radar_cursor (apply 0020)';
  end if;
end $$;
