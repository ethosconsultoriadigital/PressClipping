-- 0013_noticias_notas_cobertura.sql
--
-- notas_cobertura: rastro de auditoría sobre el origen/cobertura de una nota.
-- Se usa, por ejemplo, cuando una nota diagnóstica de PressClipping se PROMUEVE
-- a cobertura orgánica (ethos_organico) porque el crawler orgánico volvió a
-- descubrir la misma URL vía RSS/SITEMAP.
--
-- La promoción funciona aunque esta columna no exista (el código degrada de
-- forma segura), pero aplicarla deja el rastro legible en la tabla.

alter table noticias
  add column if not exists notas_cobertura text;
