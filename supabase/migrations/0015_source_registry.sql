-- =============================================================================
-- Source Registry V1 — catálogo canónico ADDITIVE de fuentes
-- Migración: 0015_source_registry
-- -----------------------------------------------------------------------------
-- NO toca public.medios, noticias, menciones ni matching.
-- public.medios sigue siendo el contrato operacional legacy del crawler.
-- =============================================================================

create table if not exists public.fuentes (
  fuente_id              text primary key,
  canonical_name         text not null,
  display_name           text not null,
  source_kind            text not null,
  content_origin         text not null,
  pais                   text default 'MX',
  estado                 text,
  municipio              text,
  region                 text,
  categoria              text,
  lifecycle_status       text not null default 'DISCOVERED',
  health_status          text not null default 'UNKNOWN',
  capture_status         text not null default 'UNKNOWN',
  technical_class        text,
  priority               text,
  group_parent_fuente_id text references public.fuentes (fuente_id) on delete set null,
  legacy_medio_id        text unique,
  first_seen_at          timestamptz,
  last_seen_at           timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  notes                  text,
  expansion_score        numeric,
  astra_batch            text,
  evidence_tier          text,
  uniqueness_key         text
);

create index if not exists idx_fuentes_lifecycle on public.fuentes (lifecycle_status);
create index if not exists idx_fuentes_kind on public.fuentes (source_kind);
create index if not exists idx_fuentes_health on public.fuentes (health_status);
create index if not exists idx_fuentes_legacy on public.fuentes (legacy_medio_id);
create index if not exists idx_fuentes_uniqueness on public.fuentes (uniqueness_key);
create index if not exists idx_fuentes_parent on public.fuentes (group_parent_fuente_id);

drop trigger if exists trg_fuentes_updated on public.fuentes;
create trigger trg_fuentes_updated
  before update on public.fuentes
  for each row execute function set_updated_at();

create table if not exists public.fuente_canales (
  canal_id              text primary key,
  fuente_id             text not null references public.fuentes (fuente_id) on delete cascade,
  platform              text not null,
  canonical_url         text,
  canonical_domain      text,
  hostname              text,
  rss_url               text,
  sitemap_url           text,
  capture_method        text,
  capture_feasibility   text,
  activo                boolean not null default true,
  health_status         text not null default 'UNKNOWN',
  capture_status        text not null default 'UNKNOWN',
  technical_class       text,
  last_http_status      integer,
  last_light_probe_at   timestamptz,
  last_deep_probe_at    timestamptz,
  last_success_at       timestamptz,
  latest_content_at     timestamptz,
  consecutive_failures  integer not null default 0,
  redirect_final_url    text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_fuente_canales_fuente on public.fuente_canales (fuente_id);
create index if not exists idx_fuente_canales_host on public.fuente_canales (hostname);
create index if not exists idx_fuente_canales_platform on public.fuente_canales (platform);
create index if not exists idx_fuente_canales_activo on public.fuente_canales (activo);
create unique index if not exists uq_fuente_canales_fuente_platform
  on public.fuente_canales (fuente_id, platform);
create index if not exists idx_fuente_canales_canonical_url on public.fuente_canales (canonical_url);
create index if not exists idx_fuente_canales_canonical_domain on public.fuente_canales (canonical_domain);

drop trigger if exists trg_fuente_canales_updated on public.fuente_canales;
create trigger trg_fuente_canales_updated
  before update on public.fuente_canales
  for each row execute function set_updated_at();

create table if not exists public.fuente_aliases (
  alias_id   text primary key,
  fuente_id  text not null references public.fuentes (fuente_id) on delete cascade,
  alias_name text not null,
  alias_kind text,
  pending    boolean not null default false,
  notes      text,
  created_at timestamptz not null default now()
);

create index if not exists idx_fuente_aliases_fuente on public.fuente_aliases (fuente_id);
create index if not exists idx_fuente_aliases_pending on public.fuente_aliases (pending);

create or replace view public.v_fuentes_master as
select
  f.fuente_id,
  f.display_name as fuente,
  f.source_kind as tipo,
  f.content_origin,
  (
    select string_agg(distinct c.platform, ',' order by c.platform)
    from public.fuente_canales c
    where c.fuente_id = f.fuente_id
  ) as canales,
  (
    select c.canonical_domain
    from public.fuente_canales c
    where c.fuente_id = f.fuente_id and c.platform = 'WEB'
    order by c.created_at
    limit 1
  ) as web_domain,
  f.estado,
  f.municipio,
  f.region,
  f.pais,
  f.categoria,
  f.lifecycle_status as lifecycle,
  f.health_status as health,
  f.capture_status as capture,
  f.technical_class,
  f.legacy_medio_id,
  f.priority,
  f.expansion_score,
  f.evidence_tier,
  f.group_parent_fuente_id,
  (
    select max(c.latest_content_at)
    from public.fuente_canales c
    where c.fuente_id = f.fuente_id
  ) as ultimo_contenido,
  (
    select max(c.last_light_probe_at)
    from public.fuente_canales c
    where c.fuente_id = f.fuente_id
  ) as ultimo_probe,
  f.notes
from public.fuentes f;

comment on table public.fuentes is
  'Registro maestro de fuentes. Additive: no reemplaza public.medios.';
comment on table public.fuente_canales is
  'Canales (WEB/social/petition) de una fuente. Un canal social no bloquea la identidad.';
comment on view public.v_fuentes_master is
  'Vista humana única de FUENTES. No hay catálogos paralelos por plataforma.';
