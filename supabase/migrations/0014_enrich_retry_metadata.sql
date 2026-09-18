-- =============================================================================
-- Ethos PR Intelligence — metadata mínima de reintento de enrich (ENRICH DRAIN V1)
-- Migración: 0014_enrich_retry_metadata
-- -----------------------------------------------------------------------------
-- ADITIVA. No modifica migraciones históricas, no hace backfill y no toca
-- texto_nota_limpia / texto_cuerpo_nota / fecha_publicacion / menciones.
--
-- Contexto (run 35370007814): el enrich del tier diario seleccionaba 500 notas
-- con `texto_nota_limpia IS NULL` ordenadas por fecha y sin memoria entre
-- ciclos. Una nota que fallaba seguía NULL, así que podía reaparecer en la
    10| -- misma corrida, y 124 notas nuevas nunca entraron al cupo (starvation).
--
-- Estas tres columnas son la memoria mínima para que el drain sepa QUÉ volver a
-- intentar y CUÁNDO, sin convertir Supabase en un sistema de colas (no hay
-- tabla de historial de intentos, no hay leases, no hay workers).
--
--   enrich_last_attempt_at : último intento de article enrich (NULL = nunca).
--   enrich_next_attempt_at : primera fecha elegible para reintento.
--                            NULL + last_attempt != NULL = BLOCKED_REVIEW.
--   enrich_failure_class   : clase estructurada del último fallo (texto libre
    20| --                            en DB; unión TypeScript en
--                            src/enrichers/enrichRetryPolicy.ts). Sin enum de DB
--                            a propósito: V1 debe poder añadir clases sin
--                            migración.
--
-- Estados derivados (ver enrichRetryPolicy.ts):
--   SUCCESS          clean no vacío (la metadata de fallo se limpia al confirmar).
--   NEVER_ATTEMPTED  clean NULL, last NULL, next NULL, class NULL.
--   RETRY_SCHEDULED  clean NULL, last != NULL, next != NULL.
--   BLOCKED_REVIEW   clean NULL, last != NULL, next NULL, class != NULL.
    30| -- =============================================================================

alter table noticias
  add column if not exists enrich_last_attempt_at timestamptz,
  add column if not exists enrich_next_attempt_at timestamptz,
  add column if not exists enrich_failure_class   text;

-- Índices: SOLO los que sostienen el query aprobado del drain. No especulativos.
--
-- 1) Página keyset de candidatos. El drain filtra siempre por
--    `texto_nota_limpia is null` + ventana de `created_at` (cutoff W y frontera
--    fresh/backlog) y ordena por (created_at, noticia_id) en ambos sentidos.
--    El índice parcial mantiene el árbol acotado a la deuda real, no a todo el
--    lake.
create index if not exists noticias_enrich_pendiente_created_idx
  on noticias (created_at, noticia_id)
  where texto_nota_limpia is null;

-- 2) Rama de reintento de la condición de elegibilidad
--    (`enrich_next_attempt_at <= W`). Solo indexa filas pendientes que YA
--    tienen reintento programado: las never-attempted se resuelven por el
--    índice 1 y las BLOCKED_REVIEW quedan fuera por el WHERE.
create index if not exists noticias_enrich_next_attempt_idx
  on noticias (enrich_next_attempt_at, created_at, noticia_id)
  where texto_nota_limpia is null and enrich_next_attempt_at is not null;
