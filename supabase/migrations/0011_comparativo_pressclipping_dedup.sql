-- Migration 0011: deduplicación en comparativo_pressclipping
-- Agrega id_externo (ID nativo del sistema fuente) y hash_registro (hash SHA-256
-- de los campos canónicos), con índices únicos parciales para idempotencia.

alter table comparativo_pressclipping
  add column if not exists id_externo    text,
  add column if not exists hash_registro text;

-- Índice único por id externo (por sistema fuente)
create unique index if not exists uq_comparativo_pressclipping_id_externo
  on comparativo_pressclipping (fuente, id_externo)
  where id_externo is not null;

-- Índice único por hash de campos canónicos (fallback cuando no hay id_externo)
create unique index if not exists uq_comparativo_pressclipping_hash_registro
  on comparativo_pressclipping (fuente, hash_registro)
  where hash_registro is not null;
