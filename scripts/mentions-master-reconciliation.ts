/**
 * Match-only reconciliation 24h/72h. No crawl. No Google. Fail-closed writes.
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { getAllClientes, getKeywordsActivas } from '../src/supabase/repositories.js';
import { getSpreadsheetById } from '../src/sheets/client.js';
import { emptyBodyMatchingCounters } from '../src/matching/bodyMatchingMetrics.js';
import { MERY_FRASE_EXACTA_BODY_KEYWORD_IDS } from '../src/matching/masterBodyCanary.js';
import { RECOVERY_WINDOW_HOURS, windowSinceHours } from '../src/matching/matchWindows.js';
import { effectiveRecoveryDryRun } from '../src/matching/recoveryWrites.js';
import { parseIntOrNull } from '../src/utils/parse.js';
import { logger } from '../src/utils/logger.js';
import {
  appendRows,
  buildRows,
  fetchEligibleNewsPaged,
  groupKeywordsByActiveClient,
  loadExistingKeys,
  RECOVERY_FETCH_CAP,
} from './mentions-master-fast-lane.js';

const DEFAULT_SHEET = '1T4-RLnBrK0lp3p-r23hRjrJAmI03QLzBavWM3ZpcmOA';
const DEFAULT_TAB = 'MENCIONES_MASTER';
const ALLOW = [...MERY_FRASE_EXACTA_BODY_KEYWORD_IDS];

export interface ReconciliationArgs {
  hours: number;
  dryRun: boolean;
  sheetId: string;
  tab: string;
}

export function parseReconciliationArgs(argv: string[]): ReconciliationArgs {
  const out: ReconciliationArgs = {
    hours: RECOVERY_WINDOW_HOURS,
    dryRun: true,
    sheetId: process.env['GOOGLE_MENTIONS_MASTER_SHEET_ID'] || DEFAULT_SHEET,
    tab: process.env['GOOGLE_MENTIONS_MASTER_TAB'] || DEFAULT_TAB,
  };
  for (const arg of argv) {
    if (arg === '--dry-run') { out.dryRun = true; continue; }
    if (arg === '--no-dry-run') { out.dryRun = false; continue; }
    if (!arg.startsWith('--')) continue;
    const [key, ...rest] = arg.slice(2).split('=');
    const val = rest.join('=');
    if (key === 'hours' || key === 'recovery-hours') out.hours = parseIntOrNull(val) ?? out.hours;
    if (key === 'sheet-id' && val) out.sheetId = val;
    if (key === 'tab' && val) out.tab = val;
    if (key === 'dry-run') out.dryRun = val === '' || val === 'true' || val === '1';
  }
  return out;
}

export async function runMatchReconciliation(args: ReconciliationArgs): Promise<{
  hours: number;
  dry_run: boolean;
  fail_closed: boolean;
  writes_enabled: boolean;
  news_scanned: number;
  pages_scanned: number;
  cap_hit: boolean;
  matches: number;
  would_append: number;
  appended: number;
  skipped_dedupe: number;
  body_policy: 'allowlist';
}> {
  const gate = effectiveRecoveryDryRun(args.dryRun);
  const sinceIso = windowSinceHours(args.hours);
  const [clients, keywords] = await Promise.all([getAllClientes(), getKeywordsActivas()]);
  const { clientNames, keywordsByClient } = groupKeywordsByActiveClient(clients, keywords);
  const paged = await fetchEligibleNewsPaged(sinceIso, undefined, RECOVERY_FETCH_CAP);
  const metrics = emptyBodyMatchingCounters();
  const rows = buildRows(paged.rows, keywordsByClient, clientNames, {
    masterBodyV2: true,
    bodyPolicy: 'allowlist',
    keywordAllowlist: ALLOW,
    mode: 'body_v4',
    metrics,
  });
  const doc = await getSpreadsheetById(args.sheetId);
  const sheet = doc.sheetsByTitle[args.tab];
  if (!sheet) throw new Error(`No existe pestaña ${args.tab}`);
  const existing = await loadExistingKeys(sheet);
  const write = await appendRows(sheet, rows, existing, gate.dryRun);
  const summary = {
    hours: args.hours,
    dry_run: gate.dryRun,
    fail_closed: gate.fail_closed,
    writes_enabled: gate.writes_enabled,
    news_scanned: paged.rows.length,
    pages_scanned: paged.pagesScanned,
    cap_hit: paged.capHit,
    matches: rows.length,
    would_append: write.would_append,
    appended: write.appended,
    skipped_dedupe: write.skipped,
    body_policy: 'allowlist' as const,
  };
  logger.info({
    ...summary,
    recovery_incomplete: paged.capHit,
    no_whatsapp: true,
    no_email: true,
    no_twilio: true,
    no_google_radar: true,
    no_crawl: true,
  }, '=== MENTIONS MATCH RECONCILIATION done ===');
  return summary;
}

async function main(): Promise<void> {
  const args = parseReconciliationArgs(process.argv.slice(2));
  await runMatchReconciliation(args);
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  main().catch((err) => {
    logger.error({ error: err instanceof Error ? err.message : String(err) }, 'reconciliation fatal');
    process.exit(1);
  });
}
