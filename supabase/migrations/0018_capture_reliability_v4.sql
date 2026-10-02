-- Additive V4. Not applied LIVE.
-- Atomic claims, run-scoped observations, gap identity, dry-run annotation.
-- No changes to public.noticias / public.medios.

alter table public.capture_recovery_queue
  add column if not exists published_at timestamptz,
  add column if not exists discovered_title text,
  add column if not exists discovered_summary text,
  add column if not exists last_dry_run_result text;

alter table public.capture_source_reconcile_state
  add column if not exists coverage_verdict text,
  add column if not exists worker_id text;

alter table public.capture_gap_candidates
  add column if not exists canonical_hash text,
  add column if not exists discovered_urls text,
  add column if not exists medio_id text,
  add column if not exists fuente_id text,
  add column if not exists claimed_at timestamptz,
  add column if not exists claimed_by text;

create table if not exists public.capture_recovery_observations (
  run_id text not null,
  hash_url text not null,
  medio_id text,
  window_start timestamptz not null,
  window_end timestamptz not null,
  discovered_via text,
  observed_status text not null,
  observed_at timestamptz not null default now(),
  reject_reason text,
  primary key (run_id, hash_url, window_start)
);

create or replace function public.claim_capture_recovery_batch(
  p_worker_id text,
  p_limit integer,
  p_now timestamptz
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

create or replace function public.claim_capture_source_batch(
  p_worker_id text,
  p_window_start timestamptz,
  p_window_end timestamptz,
  p_medio_ids text[],
  p_limit integer,
  p_now timestamptz
) returns setof public.capture_source_reconcile_state
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with picked as (
    select s.medio_id, s.window_start, s.window_end
    from public.capture_source_reconcile_state s
    where s.window_start = p_window_start
      and s.window_end = p_window_end
      and s.status = 'PENDING'
      and (p_medio_ids is null or s.medio_id = any(p_medio_ids))
    order by s.medio_id
    for update skip locked
    limit p_limit
  )
  update public.capture_source_reconcile_state s
  set status = 'IN_PROGRESS',
      worker_id = p_worker_id,
      started_at = coalesce(s.started_at, p_now),
      updated_at = p_now
  from picked
  where s.medio_id = picked.medio_id
    and s.window_start = picked.window_start
    and s.window_end = picked.window_end
  returning s.*;
end;
$$;

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

revoke all on table public.capture_recovery_queue from anon, authenticated;
revoke all on table public.capture_reconcile_runs from anon, authenticated;
revoke all on table public.capture_source_reconcile_state from anon, authenticated;
revoke all on table public.capture_gap_candidates from anon, authenticated;
revoke all on table public.capture_recovery_observations from anon, authenticated;
revoke all on function public.claim_capture_recovery_batch(text, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_capture_source_batch(text, timestamptz, timestamptz, text[], integer, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_capture_gap_batch(text, integer, timestamptz) from public, anon, authenticated;
