-- Additive RC1. Atomic INCOMPLETE / stale IN_PROGRESS reclaim for coverage debt.
-- Version 0022 to avoid colliding with 0021_source_registry_security_hardening.
-- Does not replace claim_capture_source_batch (PENDING). No noticias/medios writes.

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
