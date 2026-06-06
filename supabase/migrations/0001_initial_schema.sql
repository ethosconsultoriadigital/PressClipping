-- =============================================================================
-- Ethos PR Intelligence - Esquema inicial
-- Migración: 0001_initial_schema
-- -----------------------------------------------------------------------------
-- Base histórica real del universo de noticias y menciones.
-- Principio: Google Sheets controla, PostgreSQL almacena, el código procesa.
--
-- Tablas:
--   configuracion  - parámetros globales (espejo de 04_Configuracion)
--   medios         - catálogo maestro de fuentes (espejo de 01_Medios)
--   clientes       - clientes para clasificación (espejo de 03_Clientes)
--   keywords       - palabras/marcas/reglas (espejo de 02_Keywords)
--   noticias       - histórico real de noticias capturadas
--   clusters       - agrupa republicaciones / notas sindicadas
--   menciones      - relaciona noticias x clientes x keywords
--   logs_ingesta   - logs estructurados de cada corrida
-- =============================================================================

-- Extensiones --------------------------------------------------------------
create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "pg_trgm";     -- búsqueda por similitud (futuro)
create extension if not exists "unaccent";    -- normalización de acentos en FTS

-- Función utilitaria: mantener updated_at -----------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =============================================================================
-- configuracion  (espejo de 04_Configuracion) -- almacén llave/valor
-- =============================================================================
create table if not exists configuracion (
  clave        text primary key,
  valor        text,
  descripcion  text,
  updated_at   timestamptz not null default now()
);

create trigger trg_configuracion_updated
  before update on configuracion
  for each row execute function set_updated_at();

-- =============================================================================
-- medios  (espejo de 01_Medios)
-- =============================================================================
create table if not exists medios (
  medio_id            text primary key,
  nombre_medio        text not null,
  grupo_medio         text,
  url_base            text,
  pais                text default 'MX',
  estado              text,
  municipio           text,
  region              text,
  categoria           text,
  prioridad           text,
  activo              boolean not null default true,
  metodo_extraccion   text,
  rss_url             text,
  sitemap_url         text,
  secciones_urls      text,            -- lista separada por '|'
  buscador_url        text,
  requiere_javascript boolean not null default false,
  requiere_proxy      boolean not null default false,
  frecuencia_minutos  integer,
  ultimo_scrapeo      timestamptz,
  ultimo_estado       text,
  ultimo_error        text,
  notas_tecnicas      text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_medios_activo on medios (activo);
create index if not exists idx_medios_metodo on medios (metodo_extraccion);

create trigger trg_medios_updated
  before update on medios
  for each row execute function set_updated_at();

-- =============================================================================
-- clientes  (espejo de 03_Clientes)
-- =============================================================================
create table if not exists clientes (
  cliente_id       text primary key,
  nombre_cliente   text not null,
  industria        text,
  marcas           text,             -- lista separada por '|'
  competidores     text,             -- lista separada por '|'
  voceros          text,             -- lista separada por '|'
  temas_sensibles  text,             -- lista separada por '|'
  activo           boolean not null default true,
  prioridad_ia     text,
  alertas_activas  boolean not null default false,
  notas            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_clientes_activo on clientes (activo);

create trigger trg_clientes_updated
  before update on clientes
  for each row execute function set_updated_at();

-- =============================================================================
-- keywords  (espejo de 02_Keywords)
-- =============================================================================
create table if not exists keywords (
  keyword_id        text primary key,
  cliente_id        text references clientes(cliente_id) on delete set null,
  cliente           text,
  keyword           text not null,
  alias_o_variantes text,            -- lista separada por '|'
  tipo_keyword      text not null default 'contiene'
                      check (tipo_keyword in
                        ('exacta','frase_exacta','contiene','booleana','exacta_contextual')),
  regla             text,
  activa            boolean not null default true,
  prioridad         text,
  alerta            boolean not null default false,
  contexto_incluir  text,            -- lista separada por '|'
  contexto_excluir  text,            -- lista separada por '|'
  notas             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_keywords_activa on keywords (activa);
create index if not exists idx_keywords_cliente on keywords (cliente_id);

create trigger trg_keywords_updated
  before update on keywords
  for each row execute function set_updated_at();

-- =============================================================================
-- clusters  (agrupa republicaciones / notas sindicadas)
-- IMPORTANTE: agrupar NO elimina impactos. Cada noticia conserva su fila.
-- =============================================================================
create table if not exists clusters (
  cluster_id             uuid primary key default gen_random_uuid(),
  hash_contenido         text,
  representante_noticia  uuid,          -- FK lógica a noticias (se setea luego)
  titulo_representante   text,
  total_impactos         integer not null default 0,
  medios_involucrados    text,          -- lista separada por '|'
  primera_aparicion      timestamptz,
  ultima_aparicion       timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists idx_clusters_hash on clusters (hash_contenido);

create trigger trg_clusters_updated
  before update on clusters
  for each row execute function set_updated_at();

-- =============================================================================
-- noticias  (BASE HISTÓRICA REAL)
-- =============================================================================
create table if not exists noticias (
  noticia_id        uuid primary key default gen_random_uuid(),
  medio_id          text references medios(medio_id) on delete set null,
  url_original      text not null,
  url_canonica      text,
  titulo            text,
  subtitulo         text,
  autor             text,
  fecha_publicacion timestamptz,
  fecha_captura     timestamptz not null default now(),
  seccion           text,
  texto_extraido    text,
  resumen           text,
  imagen_principal  text,
  idioma            text default 'es',
  pais              text default 'MX',
  estado            text,
  municipio         text,
  hash_url          text not null unique,   -- barrera anti-duplicado exacto
  hash_contenido    text,                   -- detección de republicaciones
  cluster_id        uuid references clusters(cluster_id) on delete set null,
  fuente_extraccion text,                   -- rss | sitemap | seccion | html | api
  estado_extraccion text,                   -- ok | parcial | error
  error_extraccion  text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_noticias_medio on noticias (medio_id);
create index if not exists idx_noticias_fecha on noticias (fecha_publicacion desc);
create index if not exists idx_noticias_captura on noticias (fecha_captura desc);
create index if not exists idx_noticias_hash_contenido on noticias (hash_contenido);
create index if not exists idx_noticias_cluster on noticias (cluster_id);

-- Búsqueda full-text en español (título + subtítulo + resumen + texto).
-- Columna generada: se mantiene sola en cada insert/update.
alter table noticias
  add column if not exists fts tsvector
  generated always as (
    to_tsvector('spanish',
      coalesce(titulo,'')    || ' ' ||
      coalesce(subtitulo,'') || ' ' ||
      coalesce(resumen,'')   || ' ' ||
      coalesce(texto_extraido,'')
    )
  ) stored;

create index if not exists idx_noticias_fts on noticias using gin (fts);

create trigger trg_noticias_updated
  before update on noticias
  for each row execute function set_updated_at();

-- Cierre del FK lógico clusters.representante_noticia -> noticias
alter table clusters
  add constraint fk_clusters_representante
  foreign key (representante_noticia) references noticias(noticia_id)
  on delete set null;

-- =============================================================================
-- menciones  (relaciona noticias x clientes x keywords)
-- =============================================================================
create table if not exists menciones (
  mencion_id        uuid primary key default gen_random_uuid(),
  noticia_id        uuid not null references noticias(noticia_id) on delete cascade,
  cliente_id        text references clientes(cliente_id) on delete set null,
  keyword_id        text references keywords(keyword_id) on delete set null,
  keyword           text,
  texto_match       text,
  tipo_match        text,            -- exacta | frase_exacta | contiene | booleana | exacta_contextual
  score_relevancia  numeric,
  -- Campos de IA (Fase 7): permanecen NULL en el MVP
  sentimiento       text,
  tema              text,
  subtema           text,
  resumen_ia        text,
  recomendacion_pr  text,
  requiere_alerta   boolean not null default false,
  estado_revision   text default 'pendiente',
  exportado_xml     boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- Evita menciones duplicadas de la misma keyword sobre la misma noticia
  unique (noticia_id, keyword_id)
);

create index if not exists idx_menciones_noticia on menciones (noticia_id);
create index if not exists idx_menciones_cliente on menciones (cliente_id);
create index if not exists idx_menciones_keyword on menciones (keyword_id);
create index if not exists idx_menciones_revision on menciones (estado_revision);
create index if not exists idx_menciones_exportado on menciones (exportado_xml);

create trigger trg_menciones_updated
  before update on menciones
  for each row execute function set_updated_at();

-- =============================================================================
-- logs_ingesta  (espejo estructurado de 05_Logs)
-- =============================================================================
create table if not exists logs_ingesta (
  log_id          uuid primary key default gen_random_uuid(),
  fecha_hora      timestamptz not null default now(),
  fuente_id       text,
  medio_id        text,
  accion          text,
  nivel           text,            -- info | warn | error
  mensaje         text,
  urls_detectadas integer default 0,
  notas_nuevas    integer default 0,
  duplicados      integer default 0,
  errores         integer default 0,
  duracion_ms     integer,
  ejecutado_por   text
);

create index if not exists idx_logs_fecha on logs_ingesta (fecha_hora desc);
create index if not exists idx_logs_medio on logs_ingesta (medio_id);
create index if not exists idx_logs_nivel on logs_ingesta (nivel);
