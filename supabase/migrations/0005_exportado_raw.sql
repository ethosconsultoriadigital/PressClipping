-- =============================================================================
-- Ethos PR Intelligence - Bandera de exportación RAW de noticias
-- Migración: 0005_exportado_raw
-- -----------------------------------------------------------------------------
-- Soporta la exportación de TODAS las noticias a 01_Noticias_Raw (base amplia
-- de captura), tengan o no mención. Aditiva: no toca columnas existentes.
--   - exportado_sheet_raw        : evita volver a exportar la misma noticia.
--   - fecha_exportado_sheet_raw  : cuándo se exportó (auditoría).
-- =============================================================================

alter table noticias
  add column if not exists exportado_sheet_raw       boolean not null default false,
  add column if not exists fecha_exportado_sheet_raw timestamptz;

-- Índice parcial: el export raw consulta solo las noticias aún no exportadas.
create index if not exists idx_noticias_export_raw
  on noticias (created_at)
  where exportado_sheet_raw = false;
