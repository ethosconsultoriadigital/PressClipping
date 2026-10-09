BEGIN;

create temporary table _debt_preflight_cols as
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'capture_source_reconcile_state';

create temporary table _debt_preflight_counts as
select 'capture_source_reconcile_state'::text as t, count(*)::bigint as n from public.capture_source_reconcile_state
union all select 'capture_recovery_queue', count(*) from public.capture_recovery_queue
union all select 'noticias', count(*) from public.noticias;

create temporary table _debt_preflight_claimed as
select medio_id, window_start, window_end, status, worker_id, started_at
from public.capture_source_reconcile_state
where status = 'IN_PROGRESS';

create or replace function public.claim_capture_source_incomplete_batch(
  p_worker_id text,
  p_window_start timestamptz,
  p_window_end timestamptz,
  p_medio_ids text[],
  p_limit integer,
  p_now timestamptz,
  p_stale_before timestamptz
) returns setof public.capture_source_reconcile_state
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_limit is null or p_limit <= 0 then
    return;
  end if;
  if p_medio_ids is null or coalesce(cardinality(p_medio_ids), 0) = 0 then
    return;
  end if;
  return query
  with picked as (
    select s.medio_id, s.window_start, s.window_end
    from public.capture_source_reconcile_state as s
    where s.window_start = p_window_start
      and s.window_end = p_window_end
      and (
        s.status = 'INCOMPLETE'
        or (
          s.status = 'IN_PROGRESS'
          and p_stale_before is not null
          and s.started_at is not null
          and s.started_at < p_stale_before
        )
      )
      and s.medio_id = any(p_medio_ids)
    order by s.medio_id
    for update skip locked
    limit p_limit
  )
  update public.capture_source_reconcile_state as s
  set status = 'IN_PROGRESS',
      worker_id = p_worker_id,
      started_at = p_now,
      updated_at = p_now
  from picked
  where s.medio_id = picked.medio_id
    and s.window_start = picked.window_start
    and s.window_end = picked.window_end
  returning s.*;
end;
$$;

revoke all on function public.claim_capture_source_incomplete_batch(text, timestamptz, timestamptz, text[], integer, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_capture_source_incomplete_batch(text, timestamptz, timestamptz, text[], integer, timestamptz, timestamptz) to service_role;

do $$
declare
  fn oid;
  def text;
  cfg text[];
  n_before bigint;
  n_after bigint;
  claimed_delta bigint;
begin
  fn := to_regprocedure('public.claim_capture_source_incomplete_batch(text, timestamp with time zone, timestamp with time zone, text[], integer, timestamp with time zone, timestamp with time zone)');
  if fn is null then
    raise exception 'missing claim_capture_source_incomplete_batch exact signature';
  end if;
  if not has_function_privilege('service_role', fn, 'execute') then
    raise exception 'service_role must EXECUTE claim_capture_source_incomplete_batch';
  end if;
  if has_function_privilege('public', fn, 'execute') then
    raise exception 'PUBLIC must not EXECUTE claim_capture_source_incomplete_batch';
  end if;
  if has_function_privilege('anon', fn, 'execute') then
    raise exception 'anon must not EXECUTE claim_capture_source_incomplete_batch';
  end if;
  if has_function_privilege('authenticated', fn, 'execute') then
    raise exception 'authenticated must not EXECUTE claim_capture_source_incomplete_batch';
  end if;
  def := pg_get_functiondef(fn);
  if def is null or position('FOR UPDATE SKIP LOCKED' in upper(def)) = 0 then
    raise exception 'function must contain FOR UPDATE SKIP LOCKED';
  end if;
  select proconfig into cfg from pg_proc where oid = fn;
  if cfg is null or not exists (
    select 1 from unnest(cfg) c where c ilike 'search_path=pg_catalog, public'
  ) then
    raise exception 'function search_path must be pg_catalog, public';
  end if;
  if (
    select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'capture_source_reconcile_state'
  ) is distinct from (select count(*) from _debt_preflight_cols) then
    raise exception 'table contract changed';
  end if;
  select n into n_before from _debt_preflight_counts where t = 'capture_source_reconcile_state';
  select count(*) into n_after from public.capture_source_reconcile_state;
  if n_before is distinct from n_after then
    raise exception 'productive counts changed';
  end if;
  select n into n_before from _debt_preflight_counts where t = 'noticias';
  select count(*) into n_after from public.noticias;
  if n_before is distinct from n_after then
    raise exception 'noticias productive counts changed';
  end if;
  perform * from public.claim_capture_source_incomplete_batch(
    'preflight-empty',
    now(),
    now(),
    array[]::text[],
    10,
    now(),
    now()
  );
  select count(*) into claimed_delta
  from public.capture_source_reconcile_state s
  where s.status = 'IN_PROGRESS'
    and not exists (
      select 1 from _debt_preflight_claimed c
      where c.medio_id = s.medio_id
        and c.window_start = s.window_start
        and c.window_end = s.window_end
        and c.worker_id is not distinct from s.worker_id
        and c.started_at is not distinct from s.started_at
    );
  if claimed_delta <> 0 then
    raise exception 'productive rows were claimed';
  end if;
end $$;

ROLLBACK;
