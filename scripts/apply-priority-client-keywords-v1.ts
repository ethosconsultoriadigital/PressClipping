/**
 * KEYWORD POLICY V1 — apply dirigido para CLI-MERY-TEST / CLI-0001 / CLI-0002.
 *
 * Default: dry-run.
 *
 *   npm run keywords:priority-v1
 *   npm run keywords:priority-v1 -- --dry-run
 *   npm run keywords:priority-v1 -- --apply
 *
 * Orden APPLY:
 *   1. upsert dirigido 02_Keywords
 *   2. upsert public.keywords
 *   3. readback ambos
 *   4. si mismatch → KEYWORD_CONFIG_MISMATCH (no rollback destructivo)
 *
 * NO sync-sheets completo. NO clientes.alertas_activas. NO alertas.
 * NO WhatsApp / email / Twilio. NO hojas finales. NO menciones.
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { getSupabase } from '../src/supabase/client.js';
import { upsertKeywords } from '../src/supabase/repositories.js';
import { getSpreadsheet } from '../src/sheets/client.js';
import { mapKeywordRow, type Keyword } from '../src/types/schemas.js';
import { googleKeywordSheetPort } from '../src/sheets/keywordDirectedUpsert.js';
import {
  KEYWORD_POLICY_FIELDS,
  POLICY_CLIENT_IDS,
  fieldEquals,
  planPriorityClientKeywordsV1,
  assertPlanSafe,
  summarizePlan,
  type PolicyOp,
  type PolicyPlan,
} from '../src/config/priorityClientKeywordsV1.js';
import { logger } from '../src/utils/logger.js';

export type ApplyMode = 'dry-run' | 'apply';

export function parsePolicyArgs(argv: string[]): { mode: ApplyMode } {
  const apply = argv.includes('--apply');
  const dry = argv.includes('--dry-run');
  if (apply && dry) {
    throw new Error('Usa --apply o --dry-run, no ambos.');
  }
  return { mode: apply ? 'apply' : 'dry-run' };
}

export async function loadLivePolicyKeywords(): Promise<Keyword[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('keywords')
    .select(
      'keyword_id, cliente_id, cliente, keyword, alias_o_variantes, tipo_keyword, regla, activa, prioridad, alerta, contexto_incluir, contexto_excluir, notas',
    )
    .in('cliente_id', [...POLICY_CLIENT_IDS])
    .order('keyword_id');
  if (error) throw new Error(`No se pudieron leer keywords LIVE: ${error.message}`);
  return (data ?? []) as unknown as Keyword[];
}

function cellsToKeyword(id: string, cells: Record<string, string>): Keyword {
  const parsed = mapKeywordRow({ ...cells, keyword_id: cells.keyword_id || id });
  if (!parsed.success) {
    throw new Error(`02_Keywords fila ${id} inválida: ${parsed.error.message}`);
  }
  return parsed.data;
}

export function compareKeywordSources(
  sb: Keyword,
  sheet: Keyword,
): string[] {
  const drift: string[] = [];
  for (const f of KEYWORD_POLICY_FIELDS) {
    if (!fieldEquals(f, sb[f], sheet[f])) {
      drift.push(`${f}: sb=${JSON.stringify(sb[f])} sheet=${JSON.stringify(sheet[f])}`);
    }
  }
  return drift;
}

export function printPlan(plan: PolicyPlan): void {
  const summary = summarizePlan(plan);
  for (const [cid, bucket] of Object.entries(summary)) {
    console.log(`\n=== ${cid} ===`);
    for (const action of ['CREATE', 'UPDATE', 'DEACTIVATE', 'UNCHANGED'] as const) {
      const rows = bucket[action];
      console.log(`${action} (${rows.length})`);
      for (const line of rows) console.log(`  ${line}`);
    }
  }
}

export async function applyPriorityClientKeywordsV1(
  mode: ApplyMode,
): Promise<{ plan: PolicyPlan; config_sync: 'PASS' | 'FAIL' | 'SKIPPED'; mismatches: string[] }> {
  const live = await loadLivePolicyKeywords();
  const plan = planPriorityClientKeywordsV1(live);
  assertPlanSafe(plan);
  printPlan(plan);

  if (mode === 'dry-run') {
    console.log('\nDRY-RUN: 0 writes (Supabase y 02_Keywords).');
    return { plan, config_sync: 'SKIPPED', mismatches: [] };
  }

  const writes = plan.ops.filter((o) => o.action !== 'UNCHANGED');
  const desired = plan.ops.map((o) => o.desired);

  logger.info(
    { writes: writes.length, ids: writes.map((w) => w.keyword_id) },
    'KEYWORD_POLICY_V1 apply: sheet primero, luego Supabase',
  );

  const doc = await getSpreadsheet();
  const port = googleKeywordSheetPort(doc);
  const sheetResult = await port.upsert(desired);
  console.log(`02_Keywords updated=${sheetResult.updated.length} appended=${sheetResult.appended.length}`);

  await upsertKeywords(desired);
  console.log(`Supabase upserted=${desired.length}`);

  const liveAfter = await loadLivePolicyKeywords();
  const afterById = new Map(liveAfter.map((k) => [k.keyword_id, k]));
  const sheetAfter = await port.readByIds(plan.policy_ids);

  const mismatches: string[] = [];
  for (const op of plan.ops) {
    const sbRow = afterById.get(op.keyword_id);
    if (!sbRow) {
      mismatches.push(`${op.keyword_id}: ausente en Supabase después de apply`);
      continue;
    }
    const desiredDrift = compareKeywordSources(op.desired, sbRow);
    if (desiredDrift.length) {
      mismatches.push(`${op.keyword_id} LIVE≠desired: ${desiredDrift.join(' | ')}`);
    }
    const sheetCells = sheetAfter.get(op.keyword_id);
    if (!sheetCells) {
      mismatches.push(`${op.keyword_id}: ausente en 02_Keywords después de apply`);
      continue;
    }
    const sheetRow = cellsToKeyword(op.keyword_id, sheetCells);
    const sheetDrift = compareKeywordSources(sbRow, sheetRow);
    if (sheetDrift.length) {
      mismatches.push(`${op.keyword_id} SB≠02_Keywords: ${sheetDrift.join(' | ')}`);
    }
  }

  if (mismatches.length > 0) {
    console.error('KEYWORD_CONFIG_MISMATCH');
    for (const m of mismatches) console.error(`  ${m}`);
    return { plan, config_sync: 'FAIL', mismatches };
  }

  console.log('CONFIG_SYNC=PASS');
  return { plan, config_sync: 'PASS', mismatches: [] };
}

export function opsForClient(plan: PolicyPlan, clienteId: string): PolicyOp[] {
  return plan.ops.filter((o) => o.cliente_id === clienteId);
}

async function main(argv = process.argv.slice(2)): Promise<number> {
  const { mode } = parsePolicyArgs(argv);
  console.log(`KEYWORD_POLICY_V1 mode=${mode}`);
  const result = await applyPriorityClientKeywordsV1(mode);
  if (result.config_sync === 'FAIL') return 2;
  return 0;
}

function esEntrypointCli(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (esEntrypointCli()) {
  main().then((code) => {
    if (code !== 0) process.exit(code);
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
