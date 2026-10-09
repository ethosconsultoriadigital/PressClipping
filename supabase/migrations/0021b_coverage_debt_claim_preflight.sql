-- Transactional preflight for 0021 coverage-debt claim. Do not apply as LIVE mutation.
-- Expected wrap: BEGIN; \i 0021b_coverage_debt_claim_preflight.sql ROLLBACK;

do $$
begin
  if to_regclass('public.capture_source_reconcile_state') is null then
    raise notice 'PREFLIGHT missing capture_source_reconcile_state (apply 0017)';
  end if;
  if to_regprocedure('public.claim_capture_source_batch(text, timestamp with time zone, timestamp with time zone, text[], integer, timestamp with time zone)') is null then
    raise notice 'PREFLIGHT missing claim_capture_source_batch (apply 0018)';
  end if;
  if to_regprocedure('public.claim_capture_source_incomplete_batch(text, timestamp with time zone, timestamp with time zone, text[], integer, timestamp with time zone, timestamp with time zone)') is null then
    raise notice 'PREFLIGHT missing claim_capture_source_incomplete_batch (apply 0021)';
  end if;
end $$;

select
  to_regprocedure('public.claim_capture_source_incomplete_batch(text,timestamp with time zone,timestamp with time zone,text[],integer,timestamp with time zone,timestamp with time zone)') as claim_incomplete;

select
  p.proname,
  pg_get_function_identity_arguments(p.oid) as args,
  has_function_privilege('anon', p.oid, 'execute') as anon_exec,
  has_function_privilege('authenticated', p.oid, 'execute') as authenticated_exec,
  has_function_privilege('service_role', p.oid, 'execute') as service_role_exec
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'claim_capture_source_incomplete_batch';
