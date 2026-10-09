-- ETHOS reliability integration RC1 combined package
-- APPLY ORDER: 0016, 0017, 0018, 0019, 0020, 0021
-- Then run 0019b notices (read-only) and 0021b transactional preflight.
-- Transactional preflight: wrap in BEGIN; ... ROLLBACK; before persistent apply.


-- ============================================================
-- FILE: supabase/migrations/0016_capture_recovery_queue.sql
-- ============================================================
-- 0016 enhanced (not LIVE yet). Queue is source of truth for URL recovery.
create table if not exists public.capture_recovery_queue (
  hash_url text primary key,
  canonical_url text not null,
  discovered_url text not null,
  medio_id text,
  fuente_id text,
  hostname text,
  discovered_via text,
  first_discovered_at timestamptz not null default now(),
  last_discovered_at timestamptz not null default now(),
  attempt_count integer not null default 0,
  status text not null,
  root_cause text,
  last_error text,
  claimed_at timestamptz,
  claimed_by text,
  next_retry_at timestamptz,
  noticia_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_capture_recovery_status on public.capture_recovery_queue (status);
create index if not exists idx_capture_recovery_claim on public.capture_recovery_queue (status, next_retry_at);
comment on table public.capture_recovery_queue is
  'URL-first recovery source of truth. Writes gated by dry-run + ALLOW_CAPTURE_RECOVERY_WRITES.';


-- ============================================================
-- FILE: supabase/migrations/0017_capture_reconcile_state.sql
-- ============================================================
-- Additive capture reliability V3: runs, per-source state, gap candidates.
-- No toca public.noticias / public.medios.

create table if not exists public.capture_reconcile_runs (
  run_id text primary key,
  mode text not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  shard_index integer not null default 0,
  shard_count integer not null default 1,
  status text not null default 'PENDING',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.capture_source_reconcile_state (
  medio_id text not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  status text not null default 'PENDING',
  cursor text,
  started_at timestamptz,
  completed_at timestamptz,
  last_error text,
  discovery_surfaces text,
  rss_span_covered text,
  sitemap_span_covered text,
  listing_span_covered text,
  sitemap_runtime_completeness_invoked boolean not null default false,
  urls_discovered integer not null default 0,
  urls_known integer not null default 0,
  urls_queued integer not null default 0,
  urls_persisted integer not null default 0,
  urls_rejected integer not null default 0,
  urls_blocked integer not null default 0,
  urls_failed integer not null default 0,
  unexplained_missing integer not null default 0,
  cap_hit boolean not null default false,
  time_budget_hit boolean not null default false,
  complete boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (medio_id, window_start, window_end)
);
create index if not exists idx_capture_source_status
  on public.capture_source_reconcile_state (status);

create table if not exists public.capture_gap_candidates (
  candidate_id text primary key,
  discovered_url text not null,
  publisher_final_url text,
  hostname text,
  discovered_via text not null,
  discovered_at timestamptz not null default now(),
  cliente_ids text,
  keyword_ids text,
  consumed_at timestamptz
);
comment on table public.capture_gap_candidates is
  'Neutral gap input (Google/Agent B). Agent A consumes URLs; no matching.';


-- ============================================================
-- FILE: supabase/migrations/0018_capture_reliability_v4.sql
-- ============================================================
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

grant select, insert, update, delete on table public.capture_recovery_queue to service_role;
grant select, insert, update, delete on table public.capture_reconcile_runs to service_role;
grant select, insert, update, delete on table public.capture_source_reconcile_state to service_role;
grant select, insert, update, delete on table public.capture_gap_candidates to service_role;
grant select, insert, update, delete on table public.capture_recovery_observations to service_role;
grant execute on function public.claim_capture_recovery_batch(text, integer, timestamptz) to service_role;
grant execute on function public.claim_capture_source_batch(text, timestamptz, timestamptz, text[], integer, timestamptz) to service_role;
grant execute on function public.claim_capture_gap_batch(text, integer, timestamptz) to service_role;


-- ============================================================
-- FILE: supabase/migrations/0019_capture_gap_contract.sql
-- ============================================================
-- Additive V5 gap contract. Not applied LIVE.
-- Native array types for Agent B V7. Safe if 0018 already added text columns.

alter table public.capture_gap_candidates
  add column if not exists canonical_hash text,
  add column if not exists candidate_medio_ids text[] not null default '{}',
  add column if not exists candidate_fuente_ids text[] not null default '{}',
  add column if not exists queries text[] not null default '{}',
  add column if not exists google_item_urls text[] not null default '{}',
  add column if not exists first_discovered_at timestamptz,
  add column if not exists last_discovered_at timestamptz,
  add column if not exists discovery_status text,
  add column if not exists discovered_urls text[];

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'capture_gap_candidates' and column_name = 'cliente_ids' and data_type = 'text'
  ) then
    alter table public.capture_gap_candidates add column if not exists cliente_ids_arr text[] not null default '{}';
    update public.capture_gap_candidates set cliente_ids_arr = string_to_array(coalesce(cliente_ids, ''), ',') where cliente_ids is not null;
    alter table public.capture_gap_candidates drop column cliente_ids;
    alter table public.capture_gap_candidates rename column cliente_ids_arr to cliente_ids;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'capture_gap_candidates' and column_name = 'keyword_ids' and data_type = 'text'
  ) then
    alter table public.capture_gap_candidates add column if not exists keyword_ids_arr text[] not null default '{}';
    update public.capture_gap_candidates set keyword_ids_arr = string_to_array(coalesce(keyword_ids, ''), ',') where keyword_ids is not null;
    alter table public.capture_gap_candidates drop column keyword_ids;
    alter table public.capture_gap_candidates rename column keyword_ids_arr to keyword_ids;
  end if;
end $$;

alter table public.capture_gap_candidates
  add column if not exists cliente_ids text[] not null default '{}',
  add column if not exists keyword_ids text[] not null default '{}';

update public.capture_gap_candidates
  set canonical_hash = coalesce(nullif(canonical_hash, ''), candidate_id)
  where canonical_hash is null or canonical_hash = '';

alter table public.capture_gap_candidates
  alter column canonical_hash set not null;

alter table public.capture_gap_candidates
  alter column publisher_final_url set not null;

alter table public.capture_reconcile_runs
  add column if not exists cycle_id text;

alter table public.capture_recovery_queue
  add column if not exists window_membership text;

comment on table public.capture_gap_candidates is
  'Agent B V7 gap contract. Recovery target is publisher_final_url; Google URLs stay in google_item_urls.';

revoke all on table public.capture_gap_candidates from anon, authenticated;
grant select, insert, update, delete on table public.capture_gap_candidates to service_role;
grant select, insert, update, delete on table public.capture_reconcile_runs to service_role;
grant select, insert, update, delete on table public.capture_recovery_queue to service_role;


-- ============================================================
-- FILE: supabase/migrations/0020_reliability_integration_rc1.sql
-- ============================================================
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


-- ============================================================
-- FILE: supabase/migrations/0019b_capture_reliability_preflight.sql
-- ============================================================
-- Read-only / transactional-safe preflight. Do not apply as LIVE mutation plan beyond this file's checks.
-- Expected order: 0016, 0017, 0018, 0019, 0020.

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
  if to_regprocedure('public.claim_capture_source_incomplete_batch(text, timestamp with time zone, timestamp with time zone, text[], integer, timestamp with time zone, timestamp with time zone)') is null then
    raise notice 'PREFLIGHT missing claim_capture_source_incomplete_batch (apply 0021)';
  end if;
end $$;


-- ============================================================
-- FILE: supabase/migrations/0021_coverage_debt_claim.sql
-- DO NOT APPLY LIVE in the executor task. Transactional preflight first.
-- ============================================================
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
set search_path = public
as $$
begin
  if p_limit is null or p_limit <= 0 then
    return;
  end if;
  return query
  with picked as (
    select s.medio_id, s.window_start, s.window_end
    from public.capture_source_reconcile_state s
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
      and (p_medio_ids is null or s.medio_id = any(p_medio_ids))
    order by s.medio_id
    for update skip locked
    limit p_limit
  )
  update public.capture_source_reconcile_state s
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

