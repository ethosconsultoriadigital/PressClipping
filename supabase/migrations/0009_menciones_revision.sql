-- Migración 0009: campos de revisión editorial en menciones.
-- estado_revision ya existe (default 'pendiente').
-- Se agregan motivo_revision, revisado_por y fecha_revision para
-- permitir marcar menciones como descartadas/validadas sin borrarlas.

alter table menciones
  add column if not exists motivo_revision text,
  add column if not exists revisado_por    text,
  add column if not exists fecha_revision  timestamptz;

-- Índice para filtrar rápidamente por estado de revisión.
create index if not exists idx_menciones_estado_revision
  on menciones (estado_revision);
