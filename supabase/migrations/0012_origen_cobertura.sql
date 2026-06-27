-- Migration 0012: distinguir cobertura orgánica de diagnóstico desde PressClipping.
--
-- origen_cobertura:
--   'ethos_organico'           → nota descubierta por crawl propio (RSS/sitemap). Cuenta como cobertura real.
--   'pressclipping_diagnostico'→ nota traída usando la URL de PressClipping solo para diagnóstico. NO cuenta como cobertura orgánica.
--   'manual'                   → carga manual.
--
-- fuente_comparativo_url: si la nota se trajo para diagnóstico, guarda la URL original de PressClipping.

alter table noticias
  add column if not exists origen_cobertura       text not null default 'ethos_organico',
  add column if not exists fuente_comparativo_url text;

-- Índice para filtrar rápido por origen al comparar cobertura.
create index if not exists idx_noticias_origen_cobertura
  on noticias (origen_cobertura);
