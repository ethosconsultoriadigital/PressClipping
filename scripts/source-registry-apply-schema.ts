import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { getSupabase } from '../src/supabase/client.js';
import { requireSupabaseEnv } from '../src/config/env.js';
import { logger } from '../src/utils/logger.js';

async function tableExists(): Promise<boolean> {
  const sb = getSupabase();
  const { error } = await sb.from('fuentes').select('fuente_id').limit(1);
  if (!error) return true;
  const msg = error.message ?? '';
  if (/schema cache|does not exist|Could not find/i.test(msg)) return false;
  logger.warn({ msg }, 'fuentes probe inconclusive');
  return false;
}

async function tryPgMeta(sql: string): Promise<{ ok: boolean; detail: string }> {
  const { url, serviceRoleKey } = requireSupabaseEnv();
  const endpoints = [`${url}/pg/query`, `${url}/pg-meta/query`];
  for (const ep of endpoints) {
    try {
      const res = await fetch(ep, {
        method: 'POST',
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: sql }),
      });
      const text = await res.text();
      if (res.ok) return { ok: true, detail: `${ep} ${res.status}` };
      logger.warn({ ep, status: res.status, body: text.slice(0, 180) }, 'pg-meta no aceptó DDL');
    } catch (e) {
      logger.warn({ ep, err: e instanceof Error ? e.message : String(e) }, 'pg-meta fetch fail');
    }
  }
  return { ok: false, detail: 'no_pg_meta' };
}

async function main() {
  if (await tableExists()) {
    logger.info('public.fuentes ya existe (schema cache).');
    return;
  }
  const sql = readFileSync('supabase/migrations/0015_source_registry.sql', 'utf8');
  const attempt = await tryPgMeta(sql);
  if (attempt.ok && (await tableExists())) {
    logger.info({ attempt }, 'DDL aplicado via pg-meta');
    return;
  }
  logger.error(
    { sqlChars: sql.length, attempt },
    'DDL no aplicable por REST. Pegar 0015_source_registry.sql en SQL Editor de Supabase.',
  );
  process.exit(2);
}

main().catch((e) => {
  logger.error(e, 'source-registry-apply-schema fatal');
  process.exit(1);
});
