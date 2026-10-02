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
