import { describe, expect, it } from 'vitest';
import {
  decideRouterRun,
  incrementalStartRow,
  routeMasterRows,
  type MentionRoute,
  type MasterMentionRow,
} from '../src/routing/mentionPresentation.js';
import {
  activeViewNames,
  buildPendingDiagnostics,
  finishFullRebuildProperties,
  fullRebuildViewLines,
  incrementalWindowRows,
  planFullRebuildSlice,
  staleViewNames,
  upsertAndSortView,
  validateRoutesAgainstCatalog,
} from '../src/routing/mentionRouterRuntime.js';

function route(over: Partial<MentionRoute> & Pick<MentionRoute, 'route_id' | 'keyword_id' | 'vista_tipo' | 'vista_nombre'>): MentionRoute {
  return {
    detection_scope_id: 'CLI-0001',
    activo: true,
    prioridad: 'ALTA',
    notas: null,
    ...over,
  };
}

function row(over: Record<string, string>, sheetRow = 2): MasterMentionRow {
  return { values: over, sheetRow };
}

const jumex = route({
  route_id: 'R-J',
  keyword_id: 'KEY-0001',
  vista_tipo: 'CLIENTE',
  vista_nombre: 'JUMEX',
});

describe('router runtime hardening', () => {
  it('A. full rebuild then unchanged MASTER → second run NOT full', () => {
    const first = decideRouterRun({
      requestedMode: 'incremental',
      routingHashNow: 'h1',
      routingHashApplied: null,
      masterLastRow: 287,
      lastProcessedMasterRow: 1,
      fullRebuildInProgress: false,
      fullRebuildTargetHash: null,
      fullRebuildMasterLastRow: null,
    });
    expect(first.needFull).toBe(true);
    const applied = finishFullRebuildProperties({
      completed: true,
      routingHash: 'h1',
      snapshotMasterLastRow: 287,
    });
    expect(applied.LAST_PROCESSED_MASTER_ROW).toBe('287');
    const second = decideRouterRun({
      requestedMode: 'incremental',
      routingHashNow: 'h1',
      routingHashApplied: 'h1',
      masterLastRow: 287,
      lastProcessedMasterRow: 287,
      fullRebuildInProgress: false,
      fullRebuildTargetHash: null,
      fullRebuildMasterLastRow: null,
    });
    expect(second.needFull).toBe(false);
    expect(second.mode).toBe('incremental');
  });

  it('B. MASTER +1 row → incremental', () => {
    const d = decideRouterRun({
      requestedMode: 'incremental',
      routingHashNow: 'h1',
      routingHashApplied: 'h1',
      masterLastRow: 288,
      lastProcessedMasterRow: 287,
      fullRebuildInProgress: false,
      fullRebuildTargetHash: null,
      fullRebuildMasterLastRow: null,
    });
    expect(d.needFull).toBe(false);
    expect(d.mode).toBe('incremental');
    const rows = [row({ dedupe_key: 'a' }, 2), row({ dedupe_key: 'b' }, 287), row({ dedupe_key: 'c' }, 288)];
    const window = incrementalWindowRows(rows, 287, 150);
    expect(window.some((r) => r.sheetRow === 288)).toBe(true);
  });

  it('C. overlap correction → UPDATE existing derived row', () => {
    const headers = ['resumen', 'dedupe_key', 'fecha_publicacion'];
    const result = upsertAndSortView({
      headers,
      existing: [
        { dedupe_key: 'k1', values: { resumen: 'old', dedupe_key: 'k1', fecha_publicacion: '2026-01-01' } },
      ],
      incoming: [
        {
          view_name: 'CLIENTE · JUMEX',
          vista_tipo: 'CLIENTE',
          vista_nombre: 'JUMEX',
          dedupe_key: 'k1',
          source: row({ resumen: 'new', dedupe_key: 'k1', fecha_publicacion: '2026-01-01' }),
        },
      ],
    });
    expect(result.updated).toBe(1);
    expect(result.inserted).toBe(0);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]?.[0]).toBe('new');
  });

  it('D. same dedupe unchanged → no duplicate', () => {
    const headers = ['resumen', 'dedupe_key', 'fecha_publicacion'];
    const incoming = {
      view_name: 'CLIENTE · JUMEX',
      vista_tipo: 'CLIENTE' as const,
      vista_nombre: 'JUMEX',
      dedupe_key: 'k1',
      source: row({ resumen: 'same', dedupe_key: 'k1', fecha_publicacion: '2026-01-01' }),
    };
    const result = upsertAndSortView({
      headers,
      existing: [{ dedupe_key: 'k1', values: incoming.source.values }],
      incoming: [incoming, incoming],
    });
    expect(result.lines).toHaveLength(1);
    expect(result.inserted).toBe(0);
    expect(result.duplicatesAvoided).toBe(1);
  });

  it('E. incremental insert → newest-first', () => {
    const headers = ['fecha_publicacion', 'dedupe_key'];
    const result = upsertAndSortView({
      headers,
      existing: [
        { dedupe_key: 'old', values: { fecha_publicacion: '2026-01-01', dedupe_key: 'old' } },
      ],
      incoming: [
        {
          view_name: 'X',
          vista_tipo: 'TEMA',
          vista_nombre: 'Y',
          dedupe_key: 'new',
          source: row({ fecha_publicacion: '2026-09-30', dedupe_key: 'new' }),
        },
      ],
    });
    expect(result.inserted).toBe(1);
    expect(result.lines[0]?.[1]).toBe('new');
    expect(result.lines[1]?.[1]).toBe('old');
  });

  it('F. filter range expands', () => {
    const headers = ['dedupe_key', 'fecha_publicacion'];
    const result = upsertAndSortView({
      headers,
      existing: [{ dedupe_key: 'a', values: { dedupe_key: 'a', fecha_publicacion: '2026-01-01' } }],
      incoming: [
        {
          view_name: 'X',
          vista_tipo: 'TEMA',
          vista_nombre: 'Y',
          dedupe_key: 'b',
          source: row({ dedupe_key: 'b', fecha_publicacion: '2026-02-01' }),
        },
      ],
    });
    expect(result.filterLastRow).toBe(3);
  });

  it('G. active route + zero matches → empty view still active', () => {
    const names = activeViewNames([jumex]);
    expect(names).toEqual(['CLIENTE · JUMEX']);
    const lines = fullRebuildViewLines([], 'CLIENTE · JUMEX', ['dedupe_key']);
    expect(lines).toEqual([]);
  });

  it('H. previous content + now zero matches on full rebuild → cleared', () => {
    const lines = fullRebuildViewLines([], 'CLIENTE · JUMEX', ['resumen']);
    expect(lines).toHaveLength(0);
  });

  it('I. retired route → stale note, no auto-delete', () => {
    const stale = staleViewNames(
      ['CLIENTE · JUMEX', 'CLIENTE · CAZADORES', 'MENCIONES_MASTER'],
      ['CLIENTE · JUMEX'],
    );
    expect(stale).toEqual(['CLIENTE · CAZADORES']);
    expect(stale).not.toContain('MENCIONES_MASTER');
  });

  it('J. full rebuild timeout → NOT marked complete', () => {
    const slice = planFullRebuildSlice(['A', 'B', 'C'], 0, 1);
    expect(slice.completed).toBe(false);
    const props = finishFullRebuildProperties({
      completed: false,
      routingHash: 'h1',
      snapshotMasterLastRow: 287,
    });
    expect(props.FULL_REBUILD_IN_PROGRESS).toBe('true');
    expect(props.ROUTING_HASH).toBeUndefined();
    expect(props.LAST_PROCESSED_MASTER_ROW).toBeUndefined();
    expect(props.LAST_RUN_VERDICT).toBeUndefined();
  });

  it('K. next run resumes checkpoint', () => {
    const d = decideRouterRun({
      requestedMode: 'incremental',
      routingHashNow: 'h1',
      routingHashApplied: null,
      masterLastRow: 287,
      lastProcessedMasterRow: 1,
      fullRebuildInProgress: true,
      fullRebuildTargetHash: 'h1',
      fullRebuildMasterLastRow: 287,
    });
    expect(d.mode).toBe('resume_full');
    const slice = planFullRebuildSlice(['A', 'B', 'C'], 1, 10);
    expect(slice.completed).toBe(true);
    expect(slice.processed_views).toEqual(['B', 'C']);
  });

  it('L. unknown keyword_id route → validation FAIL', () => {
    const v = validateRoutesAgainstCatalog(
      [jumex],
      [],
      [{ cliente_id: 'CLI-0001' }],
    );
    expect(v.ok).toBe(false);
    expect(v.issues[0]?.code).toBe('UNKNOWN_KEYWORD_ID');
  });

  it('M. unknown detection_scope_id → validation FAIL', () => {
    const v = validateRoutesAgainstCatalog(
      [jumex],
      [{ keyword_id: 'KEY-0001', cliente_id: 'CLI-0001', activa: true }],
      [],
    );
    expect(v.ok).toBe(false);
    expect(v.issues.some((i) => i.code === 'UNKNOWN_DETECTION_SCOPE_ID')).toBe(true);
  });

  it('N. keyword/client mismatch → validation FAIL', () => {
    const v = validateRoutesAgainstCatalog(
      [jumex],
      [{ keyword_id: 'KEY-0001', cliente_id: 'CLI-0002', activa: true }],
      [{ cliente_id: 'CLI-0001' }, { cliente_id: 'CLI-0002' }],
    );
    expect(v.ok).toBe(false);
    expect(v.issues.some((i) => i.code === 'KEYWORD_SCOPE_MISMATCH')).toBe(true);
  });

  it('O. inactive route ignored in views', () => {
    const plan = routeMasterRows(
      [row({ keyword_ids_matched: 'KEY-0001', dedupe_key: 'x' })],
      [{ ...jumex, activo: false }],
    );
    expect(plan.routed).toHaveLength(0);
    expect(activeViewNames([{ ...jumex, activo: false }])).toEqual([]);
  });

  it('P. inactive keyword route informational, not error', () => {
    const v = validateRoutesAgainstCatalog(
      [jumex],
      [{ keyword_id: 'KEY-0001', cliente_id: 'CLI-0001', activa: false }],
      [{ cliente_id: 'CLI-0001' }],
    );
    expect(v.ok).toBe(true);
    expect(v.route_for_inactive_keyword).toEqual(['R-J']);
  });

  it('Q. new production keyword without route → pending, no data loss', () => {
    const plan = routeMasterRows(
      [row({ keyword_ids_matched: 'KEY-0001', dedupe_key: 'keep', keyword_id: 'KEY-0001' })],
      [jumex],
    );
    const pending = buildPendingDiagnostics({
      plan,
      routes: [jumex],
      keywords: [
        { keyword_id: 'KEY-0001', cliente_id: 'CLI-0001', activa: true, keyword: 'Jumex' },
        { keyword_id: 'KEY-NEW', cliente_id: 'CLI-0001', activa: true, keyword: 'Nueva' },
      ],
    });
    expect(plan.routed).toHaveLength(1);
    expect(pending.some((p) => p.keyword_id === 'KEY-NEW' && p.reason === 'ACTIVE_KEYWORD_WITHOUT_ROUTE')).toBe(true);
  });

  it('does not treat data-count as lastProcessed (286 vs 287)', () => {
    const wronglyComparedCount = decideRouterRun({
      requestedMode: 'incremental',
      routingHashNow: 'h1',
      routingHashApplied: 'h1',
      masterLastRow: 287,
      lastProcessedMasterRow: 287,
      fullRebuildInProgress: false,
      fullRebuildTargetHash: null,
      fullRebuildMasterLastRow: null,
    });
    expect(wronglyComparedCount.needFull).toBe(false);
    expect(incrementalStartRow(287, 150)).toBe(138);
  });

  it('hash change during rebuild restarts', () => {
    const d = decideRouterRun({
      requestedMode: 'incremental',
      routingHashNow: 'h2',
      routingHashApplied: null,
      masterLastRow: 287,
      lastProcessedMasterRow: 1,
      fullRebuildInProgress: true,
      fullRebuildTargetHash: 'h1',
      fullRebuildMasterLastRow: 287,
    });
    expect(d.reason).toBe('HASH_CHANGED_DURING_REBUILD');
    expect(d.mode).toBe('full');
  });
});
