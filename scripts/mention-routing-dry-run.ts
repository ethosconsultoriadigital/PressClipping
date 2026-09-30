/**
 * Dry-run de routing de presentación contra MENCIONES_MASTER (solo lectura).
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { SHEET_TABS, getSpreadsheetById, getTab, withSheetsRetry } from '../src/sheets/client.js';
import { ensureTab } from '../src/sheets/ensureTab.js';
import { loadMentionRoutesV1 } from '../src/routing/loadMentionRoutesV1.js';
import {
  PENDING_TAB,
  computeRoutingHash,
  routeMasterRows,
  routedActiveKeywords,
  validateMentionRoutes,
  type MasterMentionRow,
} from '../src/routing/mentionPresentation.js';
import { normalizeHeader } from '../src/utils/parse.js';

const MASTER_ID = '1T4-RLnBrK0lp3p-r23hRjrJAmI03QLzBavWM3ZpcmOA';
const MASTER_TAB = 'MENCIONES_MASTER';
const writePending = process.argv.includes('--write-pending');

async function main() {
  const routes = loadMentionRoutesV1();
  const validation = validateMentionRoutes(routes);

  const kwSheet = await getTab(SHEET_TABS.KEYWORDS);
  await withSheetsRetry(() => kwSheet.loadHeaderRow(), 'kw headers');
  const kwRows = await withSheetsRetry(() => kwSheet.getRows(), 'kw rows');
  const keywords = kwRows.map((r) => {
    const rec: Record<string, string> = {};
    for (const h of kwSheet.headerValues) rec[normalizeHeader(h)] = String(r.get(h) ?? '');
    return rec;
  });
  const activeKw = keywords.filter((k) => {
    const act = String(k.activa ?? '').toLowerCase();
    return act === 'true' || act === '1' || act === 'si' || act === 'sí';
  });
  const coverage = routedActiveKeywords(
    routes,
    activeKw.map((k) => k.keyword_id).filter((id): id is string => Boolean(id)),
    { includeInternal: true },
  );
  const coveragePublic = routedActiveKeywords(
    routes,
    activeKw
      .filter((k) => k.cliente_id !== 'CLI-PRUEBA')
      .map((k) => k.keyword_id)
      .filter((id): id is string => Boolean(id)),
    { includeInternal: false },
  );

  const masterDoc = await getSpreadsheetById(MASTER_ID);
  const master = masterDoc.sheetsByTitle[MASTER_TAB];
  if (!master) throw new Error('MENCIONES_MASTER ausente');
  await withSheetsRetry(() => master.loadHeaderRow(), 'master headers');
  const headers = [...master.headerValues];
  const data = await withSheetsRetry(() => master.getRows(), 'master rows');
  const rows: MasterMentionRow[] = data.map((r, i) => {
    const values: Record<string, string> = {};
    for (const h of headers) values[h] = String(r.get(h) ?? '');
    return { values, sheetRow: i + 2 };
  });

  const plan = routeMasterRows(rows, routes, { includeInternal: false });
  const pendingAgg = new Map<string, { keyword_id: string; keyword: string; cliente_id: string; count_master: number; reason: string }>();
  for (const u of plan.unrouted) {
    const kid = u.keyword_ids[0] ?? String(u.source.values.keyword_id ?? '');
    const clienteId = String(u.source.values.cliente_id ?? '');
    const excluded = clienteId === 'CLI-PRUEBA' || kid.startsWith('KEY-PRUEBA');
    const prev = pendingAgg.get(kid) ?? {
      keyword_id: kid,
      keyword: String(u.source.values.palabra ?? u.source.values.keywords_matched ?? ''),
      cliente_id: clienteId,
      count_master: 0,
      reason: excluded ? 'EXCLUDED_FROM_PRESENTATION' : u.reason,
    };
    prev.count_master += 1;
    pendingAgg.set(kid, prev);
  }
  for (const id of coveragePublic.without_route) {
    if (!pendingAgg.has(id)) {
      const k = keywords.find((x) => x.keyword_id === id);
      pendingAgg.set(id, {
        keyword_id: id,
        keyword: k?.keyword ?? '',
        cliente_id: k?.cliente_id ?? '',
        count_master: 0,
        reason: 'ACTIVE_KEYWORD_WITHOUT_ROUTE',
      });
    }
  }

  const report = {
    ok: validation.ok && coveragePublic.without_route.length === 0,
    routing_hash: computeRoutingHash(routes),
    routes: routes.length,
    invalid_routes: validation.issues.length,
    duplicate_routes: validation.duplicate_route_ids.length + validation.duplicate_route_keys.length,
    master_rows: rows.length,
    routed_rows: plan.routed.length,
    unrouted_rows: plan.unrouted.length,
    multi_view_rows: plan.multi_view_master_keys.length,
    duplicate_suppressed: plan.duplicate_suppressed,
    rows_per_view: plan.rows_per_view,
    routed_active_keywords: coverage.routed.length,
    active_keywords_without_route_public: coveragePublic.without_route,
    active_keywords_without_route_all: coverage.without_route,
    pending: [...pendingAgg.values()],
  };
  writeFileSync('artifacts/mention-routing-dry-run-live.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  if (writePending) {
    const sheet = await ensureTab(PENDING_TAB, [
      'keyword_id',
      'keyword',
      'cliente_id',
      'count_master',
      'reason',
    ]);
    const existing = await withSheetsRetry(() => sheet.getRows(), 'pending rows');
    if (existing.length > 0) {
      await withSheetsRetry(() => sheet.clear('A2:E'), 'clear 09');
    }
    if (pendingAgg.size > 0) {
      await withSheetsRetry(
        () => sheet.addRows([...pendingAgg.values()]),
        'addRows 09_Ruteo_Pendiente',
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
