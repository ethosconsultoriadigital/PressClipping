-- =============================================================================
-- Ethos PR Intelligence - Cuerpo de nota y tipo editorial
-- Migración: 0008_cuerpo_nota_y_tipo
-- -----------------------------------------------------------------------------
-- Separa el cuerpo real de la nota del contexto editorial inicial
-- (tipo/sección, etiqueta, autor, fecha).
--
--   texto_cuerpo_nota   : cuerpo principal sin header editorial (autor, fecha, etc.)
--   extracto_cuerpo_1300: primeros ~1300 chars de texto_cuerpo_nota (Sheets / IA)
--   cuerpo_nota_chars   : longitud de texto_cuerpo_nota
--   tipo_nota           : vertical editorial detectado (Política, Economía, etc.)
-- =============================================================================

alter table noticias
  add column if not exists texto_cuerpo_nota   text,
  add column if not exists extracto_cuerpo_1300 text,
  add column if not exists cuerpo_nota_chars    integer,
  add column if not exists tipo_nota            text;
