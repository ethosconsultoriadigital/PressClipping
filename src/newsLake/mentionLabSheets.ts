/**
 * Mention Lab V1 — plan y escritura append-only en tabs LAB.
 * Nunca toca tabs operativas ni tabla `menciones`.
 */
import {
  LAB_TABS,
  LAB_FORBIDDEN_TABS,
  TODAS_HEADERS,
  REVISION_HEADERS,
  LOG_HEADERS,
  KEYWORDS_HEADERS,
  freezeWindow,
  rowTodas,
  rowLog,
  rowKeywordSnapshot,
  filterNewRows,
  assertWriteAllowed,
  assertLabTabAllowed,
  type ConsolidatedMention,
  type ClientCompleteness,
  type LabKeywordRow,
} from './mentionLabCore.js';

export type LabCell = string | number | boolean | null;
export type LabOutRow = Record<string, LabCell>;

export interface LabSheetPort {
  ensure(title: string, headers: readonly string[]): Promise<void>;
  readKeys(title: string): Promise<Set<string>>;
  append(title: string, rows: LabOutRow[]): Promise<number>;
}

export interface LabClientBundle {
  mentions: ConsolidatedMention[];
  metrics: ClientCompleteness;
  keywords: LabKeywordRow[];
}

export interface LabWriteReport {
  dry_run: boolean;
  write_attempted: boolean;
  write_blocked_reason: string | null;
  tabs: string[];
  written_todas: number;
  written_revision: number;
  written_logs: number;
  written_keywords: number;
  skipped_dedupe: number;
  expected_todas: number;
  mismatch: boolean;
}

export interface WriteOpts {
  labRunId: string;
  fechaExport: string;
  cutoff: string;
  windowDays: number;
  dryRun: boolean;
  durationMs: number;
  port?: LabSheetPort;
}

export function allowedLabTabs(): string[] {
  return Object.values(LAB_TABS);
}

export function isForbiddenTab(title: string): boolean {
  return (LAB_FORBIDDEN_TABS as readonly string[]).includes(title);
}

export async function writeMentionLabSheets(
  bundles: LabClientBundle[],
  opts: WriteOpts,
): Promise<LabWriteReport> {
  const empty: LabWriteReport = {
    dry_run: opts.dryRun,
    write_attempted: false,
    write_blocked_reason: null,
    tabs: allowedLabTabs(),
    written_todas: 0,
    written_revision: 0,
    written_logs: 0,
    written_keywords: 0,
    skipped_dedupe: 0,
    expected_todas: 0,
    mismatch: false,
  };

  const window = freezeWindow(opts.cutoff, opts.windowDays);
  const todasRows: LabOutRow[] = [];
  const revisionRows: LabOutRow[] = [];
  const logRows: LabOutRow[] = [];
  const keywordRows: LabOutRow[] = [];

  for (const b of bundles) {
    for (const m of b.mentions) {
      const row = rowTodas(m, opts.labRunId, opts.fechaExport);
      todasRows.push(row);
      if (m.review_status === 'review') revisionRows.push(row);
    }
    logRows.push(
      rowLog(
        b.metrics,
        opts.labRunId,
        opts.fechaExport,
        opts.windowDays,
        window.cutoff,
        window.windowStart,
        opts.dryRun,
        opts.durationMs,
      ),
    );
    for (const kw of b.keywords.filter((k) => k.activa)) {
      keywordRows.push(rowKeywordSnapshot(opts.labRunId, b.metrics.client_id, b.metrics.client_name, kw));
    }
  }

  empty.expected_todas = todasRows.length;

  if (opts.dryRun) {
    return empty;
  }

  const gate = assertWriteAllowed(bundles.map((b) => b.metrics));
  if (!gate.ok) {
    return { ...empty, write_blocked_reason: gate.reason };
  }
  if (!opts.port) {
    return { ...empty, write_blocked_reason: 'sin port de Sheets' };
  }

  for (const tab of allowedLabTabs()) assertLabTabAllowed(tab);

  await opts.port.ensure(LAB_TABS.todas, TODAS_HEADERS);
  await opts.port.ensure(LAB_TABS.revision, REVISION_HEADERS);
  await opts.port.ensure(LAB_TABS.logs, LOG_HEADERS);
  await opts.port.ensure(LAB_TABS.keywords, KEYWORDS_HEADERS);

  const existing = await opts.port.readKeys(LAB_TABS.todas);
  const filtered = filterNewRows(
    todasRows.map((r) => ({ ...r, dedupe_key: String(r.dedupe_key ?? '') })),
    existing,
  );
  const newKeys = new Set(filtered.toWrite.map((r) => r.dedupe_key));
  const revisionNew = revisionRows.filter((r) => newKeys.has(String(r.dedupe_key ?? '')));

  const writtenTodas = await opts.port.append(LAB_TABS.todas, filtered.toWrite);
  const writtenRevision = await opts.port.append(LAB_TABS.revision, revisionNew);
  const writtenLogs = await opts.port.append(LAB_TABS.logs, logRows);
  const writtenKeywords = await opts.port.append(LAB_TABS.keywords, keywordRows);

  return {
    dry_run: false,
    write_attempted: true,
    write_blocked_reason: null,
    tabs: allowedLabTabs(),
    written_todas: writtenTodas,
    written_revision: writtenRevision,
    written_logs: writtenLogs,
    written_keywords: writtenKeywords,
    skipped_dedupe: filtered.skipped,
    expected_todas: filtered.toWrite.length,
    mismatch: writtenTodas !== filtered.toWrite.length,
  };
}
