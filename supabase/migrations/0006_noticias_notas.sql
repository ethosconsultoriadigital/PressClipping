-- =============================================================================
-- Ethos PR Intelligence - Columna de notas/trazabilidad en noticias
-- Migración: 0006_noticias_notas
-- -----------------------------------------------------------------------------
-- Soporta el enriquecimiento de noticias (npm run enrich-news): registra los
-- marcadores de procedencia de cada campo, p.ej. `titulo_generado_desde_url`,
-- `texto:html_article`, `enrich_error:...`. Aditiva: no toca columnas
-- existentes ni datos previos.
-- =============================================================================

alter table noticias
  add column if not exists notas text;
