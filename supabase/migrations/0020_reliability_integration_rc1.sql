-- Additive RC1. Google radar durable cursor + targeted recovery claim + gap routing.
-- No changes to public.noticias / public.medios.

create table if not exists public.b_google_radar_cursor (
  id text primary key,
  plan_hash text not null,
  cursor_offset integer not null,
  cycle_started_at timestamptz not null,
  last_query_normalized text,
  updated_at timestamptz not null
);

revoke all on table public.b_google_radar_cursor from public, anon, authenticated;
grant select, insert, update, delete on table public.b_google_radar_cursor to service_role;

-- Targeted recovery claim. 4th arg defaults null so unfiltered workers keep previous behavior.
drop function if exists public.claim_capture_recovery_batch(text, integer, timestamptz);

create or replace function public.claim_capture_recovery_batch(
  p_worker_id text,
  p_limit integer,
  p_now timestamptz,
  p_only_hashes text[] default null
) returns setof public.capture_recovery_queue
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with picked as (
    select q.hash_url
    from public.capture_recovery_queue q
    where q.status in ('QUEUED', 'RETRY', 'FETCH_TO_CLASSIFY')
      and q.claimed_at is null
      and (q.next_retry_at is null or q.next_retry_at <= p_now)
      and (p_only_hashes is null or q.hash_url = any(p_only_hashes))
    order by q.hash_url
    for update skip locked
    limit p_limit
  )
  update public.capture_recovery_queue q
  set status = 'FETCHING',
      claimed_at = p_now,
      claimed_by = p_worker_id,
      updated_at = p_now
  from picked
  where q.hash_url = picked.hash_url
  returning q.*;
end;
$$;

-- Only MISSING_KNOWN_SOURCE (or legacy null) is auto-recovery eligible.
create or replace function public.claim_capture_gap_batch(
  p_worker_id text,
  p_limit integer,
  p_now timestamptz
) returns table (candidate_id text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with picked as (
    select g.candidate_id
    from public.capture_gap_candidates g
    where g.consumed_at is null
      and g.claimed_at is null
      and coalesce(g.discovery_status, 'MISSING_KNOWN_SOURCE') = 'MISSING_KNOWN_SOURCE'
    order by g.discovered_at
    for update skip locked
    limit p_limit
  )
  update public.capture_gap_candidates g
  set claimed_at = p_now,
      claimed_by = p_worker_id
  from picked
  where g.candidate_id = picked.candidate_id
  returning g.candidate_id;
end;
$$;

revoke all on function public.claim_capture_recovery_batch(text, integer, timestamptz, text[]) from public, anon, authenticated;
revoke all on function public.claim_capture_gap_batch(text, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_capture_recovery_batch(text, integer, timestamptz, text[]) to service_role;
grant execute on function public.claim_capture_gap_batch(text, integer, timestamptz) to service_role;
grant execute on function public.claim_capture_source_batch(text, timestamptz, timestamptz, text[], integer, timestamptz) to service_role;
