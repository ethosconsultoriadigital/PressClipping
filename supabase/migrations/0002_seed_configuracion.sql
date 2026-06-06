-- =============================================================================
-- Ethos PR Intelligence - Semilla de configuración por defecto
-- Migración: 0002_seed_configuracion
-- -----------------------------------------------------------------------------
-- Valores iniciales de 04_Configuracion. La sincronización desde Google Sheets
-- (Fase 2) sobreescribe estos valores; aquí solo garantizamos un arranque sano.
-- =============================================================================

insert into configuracion (clave, valor, descripcion) values
  ('frecuencia_global_minutos',        '60',    'Frecuencia base de revisión cuando un medio no define la suya.'),
  ('max_notas_por_medio_por_corrida',  '25',    'Límite de noticias nuevas a procesar por medio en cada corrida.'),
  ('usar_ia',                          'false', 'Activa la clasificación con IA (Fase 7). En MVP debe ser false.'),
  ('generar_xml_propio',               'true',  'Habilita la generación de XML propio tipo PressClipping.'),
  ('base_historica',                   'supabase', 'Backend de la base histórica real.'),
  ('sheets_es_panel_control',          'true',  'Google Sheets se usa como panel, no como base de datos.'),
  ('retencion_logs_dias',              '90',    'Días de retención de logs antes de poder purgarse.'),
  ('modo_mvp',                         'true',  'Cuando es true, se omiten medios con JS/proxy y la IA masiva.')
on conflict (clave) do nothing;
