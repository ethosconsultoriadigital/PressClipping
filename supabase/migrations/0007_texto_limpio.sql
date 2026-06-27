-- =============================================================================
-- Ethos PR Intelligence - Texto limpio y calidad de extracción
-- Migración: 0007_texto_limpio
-- -----------------------------------------------------------------------------
-- Separa el texto raw (auditoría) del texto limpio (usado en menciones e IA).
-- Aditiva: no toca columnas existentes ni datos previos.
--
--   - texto_nota_limpia  : cuerpo principal sin ruido de nav/promo/relacionados
--   - extracto_nota_1300 : primeros ~1300 chars de texto_nota_limpia (Sheets)
--   - calidad_extraccion : alta | media | baja | fallida
--   - texto_limpio_chars : longitud de texto_nota_limpia (auditoria rápida)
-- =============================================================================

alter table noticias
  add column if not exists texto_nota_limpia  text,
  add column if not exists extracto_nota_1300 text,
  add column if not exists calidad_extraccion text,
  add column if not exists texto_limpio_chars integer;
