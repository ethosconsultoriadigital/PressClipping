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
