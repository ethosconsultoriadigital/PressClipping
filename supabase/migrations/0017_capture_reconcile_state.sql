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
