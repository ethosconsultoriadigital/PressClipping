-- Capture reliability V2 — recovery queue additive. No toca noticias/medios.
create table if not exists public.capture_recovery_queue (
  hash_url text primary key,
  canonical_url text not null,
  discovered_url text not null,
  medio_id text,
  fuente_id text,
  discovered_via text,
  first_discovered_at timestamptz not null default now(),
  last_discovered_at timestamptz not null default now(),
  attempt_count integer not null default 0,
  status text not null,
  root_cause text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_capture_recovery_status on public.capture_recovery_queue (status);
comment on table public.capture_recovery_queue is
  'URL-first recovery. No sustituye public.noticias. Writes de recovery off hasta autorización.';
