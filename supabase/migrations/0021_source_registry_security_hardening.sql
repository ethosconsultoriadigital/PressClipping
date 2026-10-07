-- =============================================================================
-- Source Registry security hardening
-- Migración: 0021_source_registry_security_hardening
-- -----------------------------------------------------------------------------
-- Additive y compatible con los consumidores backend de service_role.
-- Habilita RLS sin políticas: anon/authenticated quedan sin acceso.
-- No reemplaza v_fuentes_master: solo fija security_invoker.
-- No cambia el cuerpo de set_updated_at(): solo fija search_path.
-- Idempotente: ENABLE RLS, REVOKE, GRANT y ALTER se pueden reaplicar.
-- =============================================================================

alter table public.fuentes enable row level security;
alter table public.fuente_canales enable row level security;
alter table public.fuente_aliases enable row level security;

revoke all on table public.fuentes from public, anon, authenticated;
revoke all on table public.fuente_canales from public, anon, authenticated;
revoke all on table public.fuente_aliases from public, anon, authenticated;
revoke all on table public.v_fuentes_master from public, anon, authenticated;

grant select, insert, update, delete on table public.fuentes to service_role;
grant select, insert, update, delete on table public.fuente_canales to service_role;
grant select, insert, update, delete on table public.fuente_aliases to service_role;
grant select on table public.v_fuentes_master to service_role;

alter view public.v_fuentes_master set (security_invoker = true);

alter function public.set_updated_at() set search_path = public, pg_temp;
