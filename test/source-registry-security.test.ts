import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');

function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8');
}

function statements(sql: string): string[] {
  return sql
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function checksBody(sql: string): string {
  const matches = [...sql.matchAll(/do \$checks\$([\s\S]*?)\$checks\$;/gi)];
  expect(matches).toHaveLength(1);
  return matches[0]![1] ?? '';
}

function selectInto(body: string, name: string): string {
  const matches = [...body.matchAll(new RegExp(`select count\\(\\*\\) into ${name}\\b[\\s\\S]*?;`, 'gi'))];
  expect(matches, name).toHaveLength(1);
  return matches[0]![0] ?? '';
}

const migrationPath = 'supabase/migrations/0021_source_registry_security_hardening.sql';
const livePath = 'artifacts/source-registry-security-live.sql';
const preflightPath = 'artifacts/source-registry-security-preflight.sql';

const tables = ['fuentes', 'fuente_canales', 'fuente_aliases'] as const;

describe('0021 source registry security hardening', () => {
  const sql = read(migrationPath);
  const ops = statements(sql);

  it('A habilita RLS en las tres tablas', () => {
    for (const table of tables) {
      expect(ops).toContain(`alter table public.${table} enable row level security`);
    }
  });

  it('B revoca anon, authenticated y public', () => {
    for (const table of [...tables, 'v_fuentes_master']) {
      expect(ops).toContain(`revoke all on table public.${table} from public, anon, authenticated`);
    }
  });

  it('C revoca primero todos los permisos de service_role y reconcede el contrato exacto', () => {
    for (const rel of [...tables, 'v_fuentes_master']) {
      const revokeAt = ops.indexOf(`revoke all on table public.${rel} from service_role`);
      expect(revokeAt, rel).toBeGreaterThanOrEqual(0);
      const grantNeedle =
        rel === 'v_fuentes_master'
          ? 'grant select on table public.v_fuentes_master to service_role'
          : `grant select, insert, update, delete on table public.${rel} to service_role`;
      const grantAt = ops.indexOf(grantNeedle);
      expect(grantAt, rel).toBeGreaterThan(revokeAt);
    }
    const viewGrants = ops.filter((op) => op.startsWith('grant ') && op.includes('v_fuentes_master'));
    expect(viewGrants).toEqual(['grant select on table public.v_fuentes_master to service_role']);
    expect(viewGrants.some((op) => /\b(insert|update|delete)\b/.test(op))).toBe(false);
  });

  it('D deja la vista en security_invoker sin redefinirla', () => {
    expect(ops).toContain('alter view public.v_fuentes_master set (security_invoker = true)');
    expect(sql.toLowerCase()).not.toMatch(/create\s+(or\s+replace\s+)?view/);
  });

  it('E fija search_path explicito de set_updated_at', () => {
    expect(ops).toContain('alter function public.set_updated_at() set search_path = public, pg_temp');
    expect(sql.toLowerCase()).not.toMatch(/create\s+(or\s+replace\s+)?function\s+public\.set_updated_at/);
  });

  it('F no modifica tablas de News Lake ni menciones', () => {
    const forbidden = [
      'noticias',
      'menciones',
      'noticias_notas',
      'clusters',
      'medios',
      'logs_ingesta',
      'capture_recovery_queue',
      'capture_gap_candidates',
    ];
    const lower = sql.toLowerCase();
    for (const name of forbidden) expect(lower).not.toContain(name);
  });

  it('G no añade políticas', () => {
    expect(sql.toLowerCase()).not.toMatch(/create\s+policy/);
    expect(sql.toLowerCase()).not.toMatch(/alter\s+policy/);
    expect(sql.toLowerCase()).not.toMatch(/drop\s+policy/);
  });

  it('H solo usa sentencias reaplicables', () => {
    expect(ops.length).toBeGreaterThan(0);
    for (const op of ops) {
      expect(op).toMatch(
        /^(alter table public\.(fuentes|fuente_canales|fuente_aliases) enable row level security|revoke all on table public\.(fuentes|fuente_canales|fuente_aliases|v_fuentes_master) from (public, anon, authenticated|service_role)|grant select, insert, update, delete on table public\.(fuentes|fuente_canales|fuente_aliases) to service_role|grant select on table public\.v_fuentes_master to service_role|alter view public\.v_fuentes_master set \(security_invoker = true\)|alter function public\.set_updated_at\(\) set search_path = public, pg_temp)$/,
      );
    }
  });

  it('preserva el contrato de columnas de v_fuentes_master definido en 0015', () => {
    const view = read('supabase/migrations/0015_source_registry.sql');
    const expected = [
      'fuente_id',
      'fuente',
      'tipo',
      'content_origin',
      'canales',
      'web_domain',
      'estado',
      'municipio',
      'region',
      'pais',
      'categoria',
      'lifecycle',
      'health',
      'capture',
      'technical_class',
      'legacy_medio_id',
      'priority',
      'expansion_score',
      'evidence_tier',
      'group_parent_fuente_id',
      'ultimo_contenido',
      'ultimo_probe',
      'notes',
    ];
    for (const column of expected) {
      expect(view).toContain(column);
    }
    expect(sql.toLowerCase()).not.toContain('create or replace view');
  });
});

describe('artefactos source registry security', () => {
  const migrationOps = statements(read(migrationPath));

  it('el artefacto live contiene la migración fuente', () => {
    const liveOps = statements(read(livePath));
    expect(liveOps).toEqual(migrationOps);
  });

  it('el preflight abre con BEGIN y cierra con ROLLBACK', () => {
    const preflight = read(preflightPath).replace(/^\uFEFF/, '');
    const lines = preflight.split(/\r?\n/).filter((line) => line.trim().length > 0);
    expect(lines[0]).toBe('BEGIN;');
    expect(lines[lines.length - 1]).toBe('ROLLBACK;');
    expect(preflight.trimEnd().endsWith('ROLLBACK;')).toBe(true);
  });

  it('el bloque DO $checks$ es único y termina exactamente con END; $checks$;', () => {
    const preflight = read(preflightPath).replace(/^\uFEFF/, '');
    const body = checksBody(preflight);
    expect((preflight.match(/do \$checks\$/g) ?? []).length).toBe(1);
    expect((preflight.match(/\$checks\$;/g) ?? []).length).toBe(1);
    expect((body.match(/^[ \t]*end;/gim) ?? []).length).toBe(1);
    expect(body.trimEnd().endsWith('end;')).toBe(true);
    expect(preflight).toMatch(/^[ \t]*end;[ \t]*\r?\n[ \t]*\$checks\$;/m);
    expect(preflight).not.toMatch(/^[ \t]*end[ \t]*\r?\n[ \t]*end;/im);
    expect(preflight).not.toMatch(/^[ \t]*end[ \t]*\r?\n[ \t]*end;[ \t]*\r?\n[ \t]*\$checks\$;/im);
    expect(preflight).not.toMatch(/^[ \t]*end[ \t]*\r?\n[ \t]*\$checks\$;/im);
  });

  it('anon_priv y auth_priv usan un solo CROSS JOIN de siete privilegios', () => {
    const body = checksBody(read(preflightPath));
    for (const name of ['anon_priv', 'auth_priv'] as const) {
      const select = selectInto(body, name);
      expect((select.match(/cross join/gi) ?? []).length, name).toBe(1);
      expect((select.match(/as p\(priv\)/gi) ?? []).length, name).toBe(1);
      expect(select).toMatch(/\('SELECT'\),\s*\('INSERT'\),\s*\('UPDATE'\),\s*\('DELETE'\),\s*\('TRUNCATE'\),\s*\('REFERENCES'\),\s*\('TRIGGER'\)/);
      expect(select).not.toMatch(/cross join \(values\s*\('SELECT'\),\s*\('INSERT'\),\s*\('UPDATE'\),\s*\('DELETE'\)\s*\) as p\(priv\)\s*cross join/i);
    }
  });

  it('service_missing es un único IF cerrado y no se mezcla con la vista', () => {
    const body = checksBody(read(preflightPath));
    expect((body.match(/if service_missing <> 0 then/g) ?? []).length).toBe(1);
    expect((body.match(/select count\(\*\) into service_missing/g) ?? []).length).toBe(1);
    expect(body).not.toMatch(/if service_missing <> 0\s+or not has_table_privilege/i);
    expect(body).not.toMatch(/raise exception[^;]*;\s*if\b/i);
    const serviceIf = body.match(/if service_missing <> 0 then[\s\S]*?end if;/);
    expect(serviceIf?.[0]).toContain('PREFLIGHT service_role missing required table privileges');
    expect(serviceIf?.[0]).not.toContain('v_fuentes_master');
    expect(body).toContain("select count(*) into view_missing");
    expect(body).toContain('PREFLIGHT service_role missing SELECT on v_fuentes_master');
  });

  it('el preflight ejecuta el hardening y verifica el contrato', () => {
    const preflightOps = statements(read(preflightPath));
    for (const op of migrationOps) expect(preflightOps).toContain(op);
    const blob = read(preflightPath).toLowerCase();
    expect(blob).toContain('relrowsecurity');
    expect(blob).toContain('has_table_privilege');
    expect(blob).toContain('security_invoker=true');
    expect(blob).toContain('search_path=public, pg_temp');
    expect(blob).toContain('src_sec_baseline_counts');
    expect(blob).toContain('v_fuentes_master');
    expect(blob).toContain('set local role service_role');
    expect(blob).toContain('pg_get_viewdef');
  });

  it('el preflight exige grants exactos y ausencia de privilegios extra', () => {
    const body = checksBody(read(preflightPath));
    expect(body).toContain('PREFLIGHT service_role has extra table privileges');
    expect(body).toContain('PREFLIGHT service_role has extra privileges on v_fuentes_master');
    expect(body).toContain('PREFLIGHT service_role missing required table privileges');
    expect(body).toContain('PREFLIGHT anon still has privileges');
    expect(body).toContain('PREFLIGHT authenticated still has privileges');
    const extra = selectInto(body, 'service_extra');
    expect(extra).toMatch(/\('TRUNCATE'\),\s*\('REFERENCES'\),\s*\('TRIGGER'\)/);
    const viewExtra = selectInto(body, 'view_extra');
    expect(viewExtra).toMatch(/\('INSERT'\),\s*\('UPDATE'\),\s*\('DELETE'\),\s*\('TRUNCATE'\),\s*\('REFERENCES'\),\s*\('TRIGGER'\)/);
    expect(body).toMatch(/has_table_privilege\('service_role',\s*'public\.v_fuentes_master',\s*p\.priv\)/);
  });

  it('migración, live y preflight no recrean la vista ni mutan datos', () => {
    for (const rel of [migrationPath, livePath, preflightPath]) {
      const lower = read(rel).toLowerCase();
      expect(lower).not.toMatch(/create\s+(or\s+replace\s+)?view/);
      expect(lower).not.toMatch(/drop\s+view/);
      expect(lower).not.toMatch(/(^|\n)\s*(insert|update|delete|truncate)\s+/);
    }
  });
});

describe('consumidores backend del registro de fuentes', () => {
  const scripts = [
    'scripts/google-news-gap-radar.ts',
    'scripts/source-health-scan.ts',
    'scripts/source-registry-migrate-medios.ts',
    'scripts/source-registry-ingest-astra.ts',
    'scripts/source-registry-apply-schema.ts',
  ];

  it('usan el cliente de service role y no una anon key', () => {
    const client = read('src/supabase/client.ts');
    expect(client).toContain('serviceRoleKey');
    expect(client).toMatch(/Service Role Key/);
    for (const script of scripts) {
      const src = read(script);
      expect(src).toContain('getSupabase()');
      expect(src).not.toMatch(/SUPABASE_ANON|anonKey|createClient\([^)]*ANON/i);
    }
  });

  it('cubre lectura del radar, updates de health e upserts de ingest', () => {
    expect(read('scripts/google-news-gap-radar.ts')).toContain("from('fuente_canales')");
    const health = read('scripts/source-health-scan.ts');
    expect(health).toContain("from('fuente_canales').update");
    expect(health).toContain("from('fuentes')");
    const ingest = read('scripts/source-registry-ingest-astra.ts');
    expect(ingest).toContain("from('fuentes').upsert");
    expect(ingest).toContain("from('fuente_canales').upsert");
    expect(ingest).toContain("from('fuente_aliases').upsert");
    const migrate = read('scripts/source-registry-migrate-medios.ts');
    expect(migrate).toContain("from('fuentes').upsert");
    expect(migrate).toContain("from('fuente_canales').upsert");
    expect(read('scripts/source-registry-apply-schema.ts')).toContain("from('fuentes').select");
    expect(read('src/config/env.ts')).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });
});
