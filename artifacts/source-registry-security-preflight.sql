BEGIN;

create temporary table src_sec_baseline_counts as
select 'fuentes'::text as relname, count(*)::bigint as n from public.fuentes
union all
select 'fuente_canales', count(*)::bigint from public.fuente_canales
union all
select 'fuente_aliases', count(*)::bigint from public.fuente_aliases;

create temporary table src_sec_baseline_view_cols as
select column_name, data_type, udt_name, ordinal_position
from information_schema.columns
where table_schema = 'public'
  and table_name = 'v_fuentes_master';

create temporary table src_sec_baseline_viewdef as
select pg_get_viewdef('public.v_fuentes_master'::regclass, true) as def;

create temporary table src_sec_baseline_policies as
select count(*)::bigint as n
from pg_policy pol
join pg_class c on c.oid = pol.polrelid
join pg_namespace ns on ns.oid = c.relnamespace
where ns.nspname = 'public'
  and c.relname in ('fuentes', 'fuente_canales', 'fuente_aliases');

alter table public.fuentes enable row level security;
alter table public.fuente_canales enable row level security;
alter table public.fuente_aliases enable row level security;

revoke all on table public.fuentes from public, anon, authenticated;
revoke all on table public.fuente_canales from public, anon, authenticated;
revoke all on table public.fuente_aliases from public, anon, authenticated;
revoke all on table public.v_fuentes_master from public, anon, authenticated;

revoke all on table public.fuentes from service_role;
revoke all on table public.fuente_canales from service_role;
revoke all on table public.fuente_aliases from service_role;
revoke all on table public.v_fuentes_master from service_role;

grant select, insert, update, delete on table public.fuentes to service_role;
grant select, insert, update, delete on table public.fuente_canales to service_role;
grant select, insert, update, delete on table public.fuente_aliases to service_role;
grant select on table public.v_fuentes_master to service_role;

alter view public.v_fuentes_master set (security_invoker = true);

alter function public.set_updated_at() set search_path = public, pg_temp;

do $checks$
declare
  rls_missing integer;
  anon_priv integer;
  auth_priv integer;
  service_missing integer;
  service_extra integer;
  view_missing integer;
  view_extra integer;
  view_invoker boolean;
  path_ok boolean;
  counts_changed integer;
  cols_changed integer;
  def_before text;
  def_after text;
  policies_before bigint;
  policies_after bigint;
  view_rows bigint;
  expected_rows bigint;
begin
  select count(*) into rls_missing
  from pg_class c
  join pg_namespace ns on ns.oid = c.relnamespace
  where ns.nspname = 'public'
    and c.relname in ('fuentes', 'fuente_canales', 'fuente_aliases')
    and c.relrowsecurity is distinct from true;
  if rls_missing <> 0 then
    raise exception 'PREFLIGHT relrowsecurity is not true for all three tables';
  end if;

  if exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('fuentes', 'fuente_canales', 'fuente_aliases', 'v_fuentes_master')
      and grantee in ('anon', 'authenticated', 'PUBLIC', 'public')
  ) then
    raise exception 'PREFLIGHT anon, authenticated or public still listed in role_table_grants';
  end if;

  select count(*) into anon_priv
  from (values
    ('public.fuentes'),
    ('public.fuente_canales'),
    ('public.fuente_aliases'),
    ('public.v_fuentes_master')
  ) as t(rel)
  cross join (values
    ('SELECT'),
    ('INSERT'),
    ('UPDATE'),
    ('DELETE'),
    ('TRUNCATE'),
    ('REFERENCES'),
    ('TRIGGER')
  ) as p(priv)
  where has_table_privilege('anon', t.rel, p.priv);
  if anon_priv <> 0 then
    raise exception 'PREFLIGHT anon still has privileges';
  end if;

  select count(*) into auth_priv
  from (values
    ('public.fuentes'),
    ('public.fuente_canales'),
    ('public.fuente_aliases'),
    ('public.v_fuentes_master')
  ) as t(rel)
  cross join (values
    ('SELECT'),
    ('INSERT'),
    ('UPDATE'),
    ('DELETE'),
    ('TRUNCATE'),
    ('REFERENCES'),
    ('TRIGGER')
  ) as p(priv)
  where has_table_privilege('authenticated', t.rel, p.priv);
  if auth_priv <> 0 then
    raise exception 'PREFLIGHT authenticated still has privileges';
  end if;

  select count(*) into service_missing
  from (values
    ('public.fuentes'),
    ('public.fuente_canales'),
    ('public.fuente_aliases')
  ) as t(rel)
  cross join (values
    ('SELECT'),
    ('INSERT'),
    ('UPDATE'),
    ('DELETE')
  ) as p(priv)
  where not has_table_privilege('service_role', t.rel, p.priv);
  if service_missing <> 0 then
    raise exception 'PREFLIGHT service_role missing required table privileges';
  end if;

  select count(*) into service_extra
  from (values
    ('public.fuentes'),
    ('public.fuente_canales'),
    ('public.fuente_aliases')
  ) as t(rel)
  cross join (values
    ('TRUNCATE'),
    ('REFERENCES'),
    ('TRIGGER')
  ) as p(priv)
  where has_table_privilege('service_role', t.rel, p.priv);
  if service_extra <> 0 then
    raise exception 'PREFLIGHT service_role has extra table privileges';
  end if;

  select count(*) into view_missing
  from (values
    ('SELECT')
  ) as p(priv)
  where not has_table_privilege('service_role', 'public.v_fuentes_master', p.priv);
  if view_missing <> 0 then
    raise exception 'PREFLIGHT service_role missing SELECT on v_fuentes_master';
  end if;

  select count(*) into view_extra
  from (values
    ('INSERT'),
    ('UPDATE'),
    ('DELETE'),
    ('TRUNCATE'),
    ('REFERENCES'),
    ('TRIGGER')
  ) as p(priv)
  where has_table_privilege('service_role', 'public.v_fuentes_master', p.priv);
  if view_extra <> 0 then
    raise exception 'PREFLIGHT service_role has extra privileges on v_fuentes_master';
  end if;

  select exists (
    select 1
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public'
      and c.relname = 'v_fuentes_master'
      and (
        coalesce(c.reloptions, array[]::text[]) @> array['security_invoker=true']
        or coalesce(c.reloptions, array[]::text[]) @> array['security_invoker=on']
      )
  ) into view_invoker;
  if not view_invoker then
    raise exception 'PREFLIGHT v_fuentes_master security_invoker is not true';
  end if;

  select exists (
    select 1
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public'
      and p.proname = 'set_updated_at'
      and pg_get_function_identity_arguments(p.oid) = ''
      and exists (
        select 1
        from unnest(coalesce(p.proconfig, array[]::text[])) cfg
        where cfg = 'search_path=public, pg_temp'
           or replace(cfg, ' ', '') = 'search_path=public,pg_temp'
      )
  ) into path_ok;
  if not path_ok then
    raise exception 'PREFLIGHT set_updated_at search_path is not public, pg_temp';
  end if;

  select count(*) into counts_changed
  from src_sec_baseline_counts b
  join (
    select 'fuentes'::text as relname, count(*)::bigint as n from public.fuentes
    union all
    select 'fuente_canales', count(*)::bigint from public.fuente_canales
    union all
    select 'fuente_aliases', count(*)::bigint from public.fuente_aliases
  ) now_counts using (relname)
  where now_counts.n is distinct from b.n;
  if counts_changed <> 0 then
    raise exception 'PREFLIGHT row counts changed';
  end if;

  select count(*) into cols_changed
  from (
    select column_name, data_type, udt_name, ordinal_position from src_sec_baseline_view_cols
    except
    select column_name, data_type, udt_name, ordinal_position
    from information_schema.columns
    where table_schema = 'public' and table_name = 'v_fuentes_master'
    union all
    select column_name, data_type, udt_name, ordinal_position
    from information_schema.columns
    where table_schema = 'public' and table_name = 'v_fuentes_master'
    except
    select column_name, data_type, udt_name, ordinal_position from src_sec_baseline_view_cols
  ) diff;
  if cols_changed <> 0 then
    raise exception 'PREFLIGHT view structure changed';
  end if;

  select def into def_before from src_sec_baseline_viewdef;
  def_after := pg_get_viewdef('public.v_fuentes_master'::regclass, true);
  if def_before is distinct from def_after then
    raise exception 'PREFLIGHT view definition changed';
  end if;

  select n into policies_before from src_sec_baseline_policies;
  select count(*) into policies_after
  from pg_policy pol
  join pg_class c on c.oid = pol.polrelid
  join pg_namespace ns on ns.oid = c.relnamespace
  where ns.nspname = 'public'
    and c.relname in ('fuentes', 'fuente_canales', 'fuente_aliases');
  if policies_after is distinct from policies_before then
    raise exception 'PREFLIGHT policy count changed';
  end if;

  select b.n into expected_rows
  from src_sec_baseline_counts b
  where b.relname = 'fuentes';

  execute 'set local role service_role';
  select count(*) into view_rows from public.v_fuentes_master;
  execute 'reset role';
  if view_rows is distinct from expected_rows then
    raise exception 'PREFLIGHT service_role cannot read v_fuentes_master (% vs %)', view_rows, expected_rows;
  end if;
end;
$checks$;

select
  c.relname,
  c.relrowsecurity,
  c.reloptions
from pg_class c
join pg_namespace ns on ns.oid = c.relnamespace
where ns.nspname = 'public'
  and c.relname in ('fuentes', 'fuente_canales', 'fuente_aliases', 'v_fuentes_master')
order by c.relname;

ROLLBACK;
