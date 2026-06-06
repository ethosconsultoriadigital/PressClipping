-- =============================================================================
-- Ethos PR Intelligence - Flags de procesamiento y exportación
-- Migración: 0003_flags_procesamiento
-- -----------------------------------------------------------------------------
-- Soporta las Fases 4 y 5:
--   - noticias.menciones_procesado : evita reescanear noticias ya analizadas.
--   - menciones.exportado_sheets   : evita duplicar filas en 06_Resultados.
--   - logs_ingesta.exportado_sheets: evita duplicar filas en 05_Logs.
-- =============================================================================

alter table noticias
  add column if not exists menciones_procesado boolean not null default false;

-- Índice parcial: la detección consulta solo las pendientes.
create index if not exists idx_noticias_pendientes
  on noticias (created_at)
  where menciones_procesado = false;

alter table menciones
  add column if not exists exportado_sheets boolean not null default false;

create index if not exists idx_menciones_export_sheets
  on menciones (exportado_sheets)
  where exportado_sheets = false;

alter table logs_ingesta
  add column if not exists exportado_sheets boolean not null default false;

create index if not exists idx_logs_export_sheets
  on logs_ingesta (exportado_sheets)
  where exportado_sheets = false;
