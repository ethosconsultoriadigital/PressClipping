-- Companion notices for 0022. The LIVE transactional preflight is:
-- artifacts/reliability-live-coverage-debt-claim-preflight.sql
-- That file begins with BEGIN; includes the exact 0022 DDL; ends with ROLLBACK;

do $$
begin
  if to_regclass('public.capture_source_reconcile_state') is null then
    raise exception 'PREFLIGHT missing capture_source_reconcile_state (apply 0017)';
  end if;
  if to_regprocedure('public.claim_capture_source_incomplete_batch(text, timestamp with time zone, timestamp with time zone, text[], integer, timestamp with time zone, timestamp with time zone)') is null then
    raise exception 'PREFLIGHT missing claim_capture_source_incomplete_batch (apply 0022)';
  end if;
end $$;
