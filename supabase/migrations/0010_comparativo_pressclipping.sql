-- ============================================================
-- Migración 0010 — Tabla comparativo_pressclipping
-- ============================================================
-- Almacena registros del proveedor PressClipping importados
-- para cruzarlos con las menciones detectadas por Ethos.
-- NO aplicar directamente; ejecutar en Supabase SQL Editor
-- tras revisar y confirmar.
-- ============================================================

create table if not exists comparativo_pressclipping (
  id             uuid primary key default gen_random_uuid(),

  -- Fuente del registro (siempre 'PressClipping' en esta tabla)
  fuente         text not null default 'PressClipping',

  -- Campos semánticos
  fecha          date,
  cliente_id     text references clientes(cliente_id) on delete set null,
  cliente        text,
  grupo_tema     text,
  keyword        text,
  medio          text,
  titulo         text,
  url            text,
  -- URL normalizada (sin tracking, sin fragmentos, sin trailing slash)
  url_norm       text,
  autor          text,
  seccion        text,
  tipo_nota      text,

  -- Auditoría de importación
  importado_at   timestamptz not null default now(),
  importado_de   text,    -- 'csv' | 'sheet' | 'xml' | 'manual'
  raw_row        jsonb    -- fila original completa para trazabilidad

  -- Nota: updated_at no necesario; los registros de PressClipping
  -- son inmutables una vez importados. Reimportar crea nuevos registros.
);

-- Índices de consulta frecuente
create index if not exists idx_comp_pc_cliente_id
  on comparativo_pressclipping(cliente_id);

create index if not exists idx_comp_pc_fecha
  on comparativo_pressclipping(fecha);

create index if not exists idx_comp_pc_url_norm
  on comparativo_pressclipping(url_norm);

create index if not exists idx_comp_pc_medio
  on comparativo_pressclipping(medio);

create index if not exists idx_comp_pc_importado_de
  on comparativo_pressclipping(importado_de);
