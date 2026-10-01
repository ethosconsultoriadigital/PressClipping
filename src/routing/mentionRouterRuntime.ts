/**
 * Runtime del router de vistas derivadas (lógica pura, testeable).
 * Apps Script porta estas funciones; MASTER permanece read-only.
 */
import {
  compareViewRowsDesc,
  viewTabName,
  type MentionRoute,
  type MasterMentionRow,
  type RoutePlan,
  type RouteValidationIssue,
  type RoutedViewRow,
} from './mentionPresentation.js';

export interface CatalogKeyword {
  keyword_id: string;
  cliente_id: string;
  activa: boolean;
  keyword?: string;
}

export interface CatalogCliente {
  cliente_id: string;
}

export interface CatalogValidation {
  ok: boolean;
  issues: RouteValidationIssue[];
  route_for_inactive_keyword: string[];
}

export function validateRoutesAgainstCatalog(
  routes: MentionRoute[],
  keywords: CatalogKeyword[],
  clientes: CatalogCliente[],
): CatalogValidation {
  const kwById = new Map(keywords.map((k) => [k.keyword_id.toUpperCase(), k]));
  const clientIds = new Set(clientes.map((c) => c.cliente_id));
  const issues: RouteValidationIssue[] = [];
  const route_for_inactive_keyword: string[] = [];

  for (const r of routes) {
    const kw = kwById.get(r.keyword_id.toUpperCase());
    if (!kw) {
      issues.push({ code: 'UNKNOWN_KEYWORD_ID', detail: `${r.route_id}:${r.keyword_id}` });
      continue;
    }
    if (!clientIds.has(r.detection_scope_id)) {
      issues.push({
        code: 'UNKNOWN_DETECTION_SCOPE_ID',
        detail: `${r.route_id}:${r.detection_scope_id}`,
      });
    }
    if (kw.cliente_id && r.detection_scope_id && kw.cliente_id !== r.detection_scope_id) {
      issues.push({
        code: 'KEYWORD_SCOPE_MISMATCH',
        detail: `${r.route_id}:${kw.cliente_id}!=${r.detection_scope_id}`,
      });
    }
    if (r.activo && !kw.activa) {
      route_for_inactive_keyword.push(r.route_id);
    }
  }

  return { ok: issues.length === 0, issues, route_for_inactive_keyword };
}

export function activeViewNames(
  routes: MentionRoute[],
  opts: { includeInternal?: boolean } = {},
): string[] {
  const includeInternal = opts.includeInternal === true;
  const names = new Set<string>();
  for (const r of routes) {
    if (!r.activo) continue;
    if (!includeInternal && r.vista_tipo === 'INTERNO') continue;
    names.add(viewTabName(r.vista_tipo, r.vista_nombre));
  }
  return [...names].sort();
}

export function isManagedViewName(name: string): boolean {
  return name.startsWith('CLIENTE · ') || name.startsWith('PERSONA · ') || name.startsWith('TEMA · ');
}

export function staleViewNames(existingTabs: string[], activeNames: string[]): string[] {
  const active = new Set(activeNames);
  return existingTabs.filter((t) => isManagedViewName(t) && !active.has(t));
}

export interface DerivedViewRow {
  dedupe_key: string;
  values: Record<string, string>;
}

export function lineFromValues(headers: string[], values: Record<string, string>): string[] {
  return headers.map((h) => String(values[h] ?? ''));
}

export function upsertAndSortView(opts: {
  existing: DerivedViewRow[];
  incoming: RoutedViewRow[];
  headers: string[];
}): {
  rows: DerivedViewRow[];
  lines: string[][];
  inserted: number;
  updated: number;
  unchanged: number;
  filterLastRow: number;
  duplicatesAvoided: number;
} {
  const byKey = new Map<string, DerivedViewRow>();
  for (const row of opts.existing) {
    if (row.dedupe_key) byKey.set(row.dedupe_key, { ...row, values: { ...row.values } });
  }
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  let duplicatesAvoided = 0;
  const seenIncoming = new Set<string>();

  for (const inc of opts.incoming) {
    if (seenIncoming.has(inc.dedupe_key)) {
      duplicatesAvoided += 1;
      continue;
    }
    seenIncoming.add(inc.dedupe_key);
    const nextValues = { ...inc.source.values };
    const prev = byKey.get(inc.dedupe_key);
    if (!prev) {
      byKey.set(inc.dedupe_key, { dedupe_key: inc.dedupe_key, values: nextValues });
      inserted += 1;
      continue;
    }
    const same = opts.headers.every(
      (h) => String(prev.values[h] ?? '') === String(nextValues[h] ?? ''),
    );
    if (same) {
      unchanged += 1;
    } else {
      prev.values = nextValues;
      updated += 1;
    }
  }

  const rows = [...byKey.values()].sort((a, b) => compareViewRowsDesc(a.values, b.values));
  return {
    rows,
    lines: rows.map((r) => lineFromValues(opts.headers, r.values)),
    inserted,
    updated,
    unchanged,
    filterLastRow: 1 + rows.length,
    duplicatesAvoided,
  };
}

export function fullRebuildViewLines(
  routed: RoutedViewRow[],
  viewName: string,
  headers: string[],
): string[][] {
  const rows = routed
    .filter((r) => r.view_name === viewName)
    .map((r) => ({ dedupe_key: r.dedupe_key, values: r.source.values }));
  const seen = new Set<string>();
  const unique: DerivedViewRow[] = [];
  for (const row of rows) {
    if (seen.has(row.dedupe_key)) continue;
    seen.add(row.dedupe_key);
    unique.push(row);
  }
  unique.sort((a, b) => compareViewRowsDesc(a.values, b.values));
  return unique.map((r) => lineFromValues(headers, r.values));
}

export interface FullRebuildProgress {
  completed: boolean;
  processed_views: string[];
  remaining_views: string[];
  next_view_index: number;
}

export function planFullRebuildSlice(
  activeNames: string[],
  startIndex: number,
  maxViewsThisRun: number,
): FullRebuildProgress {
  const processed = activeNames.slice(startIndex, startIndex + maxViewsThisRun);
  const next = startIndex + processed.length;
  const remaining = activeNames.slice(next);
  return {
    completed: remaining.length === 0,
    processed_views: processed,
    remaining_views: remaining,
    next_view_index: next,
  };
}

export function finishFullRebuildProperties(input: {
  completed: boolean;
  routingHash: string;
  snapshotMasterLastRow: number;
}): Record<string, string> {
  if (!input.completed) {
    return {
      FULL_REBUILD_IN_PROGRESS: 'true',
    };
  }
  return {
    FULL_REBUILD_IN_PROGRESS: 'false',
    ROUTING_HASH: input.routingHash,
    LAST_PROCESSED_MASTER_ROW: String(input.snapshotMasterLastRow),
    LAST_RUN_MODE: 'full',
    LAST_RUN_VERDICT: 'FULL_REBUILD_DONE',
  };
}

export function incrementalWindowRows(
  rows: MasterMentionRow[],
  lastProcessedMasterRow: number,
  overlap = 150,
): MasterMentionRow[] {
  const start = Math.max(2, lastProcessedMasterRow - overlap + 1);
  return rows.filter((r) => (r.sheetRow ?? 0) >= start);
}

export interface PendingDiagnostic {
  keyword_id: string;
  keyword: string;
  cliente_id: string;
  count_master: number;
  reason:
    | 'EXCLUDED_INTERNAL'
    | 'UNKNOWN_KEYWORD_ROUTE'
    | 'ACTIVE_KEYWORD_WITHOUT_ROUTE'
    | 'INVALID_ROUTE'
    | 'NO_KEYWORD_ID';
}

export function buildPendingDiagnostics(opts: {
  plan: RoutePlan;
  keywords: CatalogKeyword[];
  routes: MentionRoute[];
  includeInternal?: boolean;
}): PendingDiagnostic[] {
  const agg = new Map<string, PendingDiagnostic>();
  for (const u of opts.plan.unrouted) {
    const kid = u.keyword_ids[0] ?? String(u.source.values.keyword_id ?? '');
    const reason =
      u.reason === 'EXCLUDED_INTERNAL'
        ? 'EXCLUDED_INTERNAL'
        : u.reason === 'NO_KEYWORD_ID'
          ? 'NO_KEYWORD_ID'
          : 'UNKNOWN_KEYWORD_ROUTE';
    const prev = agg.get(kid) ?? {
      keyword_id: kid,
      keyword: String(u.source.values.palabra ?? u.source.values.keywords_matched ?? ''),
      cliente_id: String(u.source.values.cliente_id ?? ''),
      count_master: 0,
      reason,
    };
    prev.count_master += 1;
    agg.set(kid, prev);
  }

  const includeInternal = opts.includeInternal === true;
  const covered = new Set(
    opts.routes
      .filter((r) => r.activo && (includeInternal || r.vista_tipo !== 'INTERNO'))
      .map((r) => r.keyword_id.toUpperCase()),
  );
  for (const k of opts.keywords) {
    if (!k.activa) continue;
    if (k.cliente_id === 'CLI-PRUEBA') continue;
    if (covered.has(k.keyword_id.toUpperCase())) continue;
    if (!agg.has(k.keyword_id)) {
      agg.set(k.keyword_id, {
        keyword_id: k.keyword_id,
        keyword: k.keyword ?? '',
        cliente_id: k.cliente_id,
        count_master: 0,
        reason: 'ACTIVE_KEYWORD_WITHOUT_ROUTE',
      });
    }
  }
  return [...agg.values()].sort((a, b) => a.keyword_id.localeCompare(b.keyword_id));
}

export function dryRunReport(opts: {
  masterRows: MasterMentionRow[];
  plan: RoutePlan;
  routes: MentionRoute[];
  includeInternal?: boolean;
  pending: PendingDiagnostic[];
  run: { needFull: boolean; reason: string | null; mode: string };
}): Record<string, unknown> {
  const includeInternal = opts.includeInternal === true;
  const activeRoutes = opts.routes.filter(
    (r) => r.activo && (includeInternal || r.vista_tipo !== 'INTERNO'),
  );
  const views = activeViewNames(opts.routes, { includeInternal });
  const uniqueMaster = new Set(opts.plan.routed.map((r) => r.dedupe_key));
  return {
    master_rows: opts.masterRows.length,
    active_route_count: activeRoutes.length,
    active_view_count: views.length,
    routed_unique_master_rows: uniqueMaster.size,
    routed_output_rows: opts.plan.routed.length,
    excluded_internal_rows: opts.plan.unrouted.filter((u) => u.reason === 'EXCLUDED_INTERNAL').length,
    unknown_route_rows: opts.plan.unrouted.filter((u) => u.reason === 'UNKNOWN_KEYWORD_ROUTE').length,
    active_keywords_without_route: opts.pending
      .filter((p) => p.reason === 'ACTIVE_KEYWORD_WITHOUT_ROUTE')
      .map((p) => p.keyword_id),
    multi_view_master_rows: opts.plan.multi_view_master_keys.length,
    duplicate_suppressed: opts.plan.duplicate_suppressed,
    full_rebuild_required: opts.run.needFull,
    full_rebuild_reason: opts.run.reason,
    rows_per_view: opts.plan.rows_per_view,
    active_views: views,
  };
}
