-- =============================================================================
-- Ethos PR Intelligence - Campos de clasificación con IA
-- Migración: 0004_ia_menciones
-- -----------------------------------------------------------------------------
-- Soporta la Fase 7 (IA controlada). Aditiva: no toca columnas existentes.
--   - riesgo_reputacional / relevancia_ia : salidas cualitativas de la IA
--   - ia_procesado / ia_procesado_at / ia_modelo : auditoría y control de costos
--     (evita reprocesar y, por tanto, re-facturar la misma mención)
-- =============================================================================

alter table menciones
  add column if not exists riesgo_reputacional text,
  add column if not exists relevancia_ia       text,
  add column if not exists ia_procesado         boolean not null default false,
  add column if not exists ia_procesado_at      timestamptz,
  add column if not exists ia_modelo            text;

-- Índice parcial: la clasificación consulta solo las menciones sin procesar.
create index if not exists idx_menciones_ia_pendientes
  on menciones (created_at)
  where ia_procesado = false;
