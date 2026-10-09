import { describe, expect, it } from 'vitest';
import { MemoryCaptureReliabilityStore } from '../src/captureReliability/captureRecoveryRepository.js';
import { emptySourceState, markSourceTerminal } from '../src/captureReliability/checkpoint.js';
import {
  loadLastSafeWindowEnd,
  markWindowSafeComplete,
  seedCatchUpCursor,
} from '../src/captureReliability/catchUpCursor.js';
import { computeFixedCycle } from '../src/captureReliability/cycle.js';
import {
  classifyCoverageDebt,
  getCoverageDebt,
  incrementCoverageDebtAttempt,
  isResumableDebt,
  listCoverageDebt,
  MAX_COVERAGE_DEBT_ATTEMPTS,
  registerCoverageDebt,
} from '../src/captureReliability/coverageDebt.js';
import type { SourceReconcileState } from '../src/captureReliability/types.js';

const NOW_ISO = '2026-10-05T18:05:00.000Z';
const LAST = '2026-10-01T18:00:00.000Z';
const CYCLE = computeFixedCycle({
  mode: '24h',
  windowStart: '2026-10-01T18:00:00.000Z',
  windowEnd: '2026-10-02T18:00:00.000Z',
});
const EXPECTED_569 = Array.from({ length: 569 }, (_, i) => `MED-${String(i + 1).padStart(4, '0')}`);

function incompleteState(
  medioId: string,
  patch: Partial<SourceReconcileState> = {},
): SourceReconcileState {
  return markSourceTerminal(
    {
      ...emptySourceState({
        medioId,
        windowStart: CYCLE.window_start,
        windowEnd: CYCLE.window_end,
      }),
      ...patch,
    },
    'INCOMPLETE',
    NOW_ISO,
  );
}

async function seedComplete(store: MemoryCaptureReliabilityStore, ids: string[]) {
  for (const medioId of ids) {
    const st = emptySourceState({
      medioId,
      windowStart: CYCLE.window_start,
      windowEnd: CYCLE.window_end,
    });
    await store.upsertSourceState(markSourceTerminal(st, 'COMPLETE', NOW_ISO));
  }
}

describe('coverage debt policy', () => {
  it('schedule with 569 medios and many INCOMPLETE does not advance without registered debt', async () => {
    const store = new MemoryCaptureReliabilityStore();
    await seedCatchUpCursor(store, { mode: '24h', lastSafeWindowEnd: LAST, nowIso: NOW_ISO });
    await seedComplete(store, EXPECTED_569.slice(0, 400));
    for (const id of EXPECTED_569.slice(400)) {
      await store.upsertSourceState(incompleteState(id, { cap_hit: true, last_error: 'CAP_HIT' }));
    }
    const safety = await markWindowSafeComplete(store, CYCLE, NOW_ISO, {
      allowCursorAdvance: true,
      coverageComplete: true,
      expectedMedioIds: EXPECTED_569,
    });
    expect(safety.reason).toBe('CATALOG_INCOMPLETE');
    expect(await loadLastSafeWindowEnd(store, '24h')).toBe(LAST);
    expect((await store.listSourceStates(CYCLE.window_start, CYCLE.window_end)).filter((s) => s.status === 'INCOMPLETE')).toHaveLength(169);
  });

  it('advances the main window only after INCOMPLETE debt is registered, without flipping COMPLETE', async () => {
    const store = new MemoryCaptureReliabilityStore();
    await seedCatchUpCursor(store, { mode: '24h', lastSafeWindowEnd: LAST, nowIso: NOW_ISO });
    await seedComplete(store, EXPECTED_569.slice(0, 400));
    for (const id of EXPECTED_569.slice(400)) {
      const st = incompleteState(id, { cap_hit: true, sitemap_span_covered: 'NO', cursor: 'page-2' });
      await store.upsertSourceState(st);
      await registerCoverageDebt(store, st, NOW_ISO);
    }
    const safety = await markWindowSafeComplete(store, CYCLE, NOW_ISO, {
      allowCursorAdvance: true,
      coverageComplete: true,
      expectedMedioIds: EXPECTED_569,
    });
    expect(safety.reason).toBe('SAFE_COMPLETE');
    expect(await loadLastSafeWindowEnd(store, '24h')).toBe(CYCLE.window_end);
    const still = (await store.listSourceStates(CYCLE.window_start, CYCLE.window_end)).filter((s) => s.status === 'INCOMPLETE');
    expect(still).toHaveLength(169);
    expect(still.every((s) => s.window_start === CYCLE.window_start && s.window_end === CYCLE.window_end)).toBe(true);
  });

  it('classifies timeout, pagination, no-surface and registers a single durable row', async () => {
    expect(classifyCoverageDebt(incompleteState('MED-SLOW', { last_error: 'SOURCE_TIMEOUT' })).follow_up).toBe(
      'RESUME_SAME_WINDOW',
    );
    expect(classifyCoverageDebt(incompleteState('MED-PAGE', { cap_hit: true, cursor: 's2' })).follow_up).toBe(
      'PAGINATE_FROM_CURSOR',
    );
    expect(
      classifyCoverageDebt(incompleteState('MED-NONE', { discovery_surfaces: ['NO_DISCOVERY_SURFACE'] })).follow_up,
    ).toBe('SURFACE_PROBE');
    expect(classifyCoverageDebt(incompleteState('MED-RSS', { discovery_surfaces: ['rss'] })).follow_up).toBe(
      'SECOND_SURFACE',
    );
    const store = new MemoryCaptureReliabilityStore();
    const st = incompleteState('MED-NONE', { discovery_surfaces: ['NO_DISCOVERY_SURFACE'], last_error: 'NO_DISCOVERY_SURFACE' });
    await store.upsertSourceState(st);
    const first = await registerCoverageDebt(store, st, NOW_ISO);
    const second = await registerCoverageDebt(store, st, '2026-10-05T18:10:00.000Z');
    expect(second.created_at).toBe(first.created_at);
    expect(second.attempt_count).toBe(first.attempt_count);
    expect(await listCoverageDebt(store, CYCLE.window_start, CYCLE.window_end)).toHaveLength(1);
  });

  it('resumes a slow source after crash without losing the historical window or duplicating debt', async () => {
    const store = new MemoryCaptureReliabilityStore();
    const st = incompleteState('MED-SLOW', { last_error: 'SOURCE_TIMEOUT' });
    await store.upsertSourceState(st);
    await registerCoverageDebt(store, st, NOW_ISO);
    expect(isResumableDebt(await getCoverageDebt(store, 'MED-SLOW', CYCLE.window_start, CYCLE.window_end))).toBe(true);
    const claimed = await store.claimSourceBatch({
      workerId: 'w1',
      windowStart: CYCLE.window_start,
      windowEnd: CYCLE.window_end,
      medioIds: ['MED-SLOW'],
      limit: 8,
      nowIso: NOW_ISO,
      staleBeforeIso: '2026-10-05T17:00:00.000Z',
      resumeIncomplete: true,
    });
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.status).toBe('IN_PROGRESS');
    expect(claimed[0]?.window_end).toBe(CYCLE.window_end);
    await incrementCoverageDebtAttempt(store, claimed[0]!, NOW_ISO);
    const afterCrash = await store.claimSourceBatch({
      workerId: 'w2',
      windowStart: CYCLE.window_start,
      windowEnd: CYCLE.window_end,
      medioIds: ['MED-SLOW'],
      limit: 8,
      nowIso: '2026-10-05T18:20:00.000Z',
      staleBeforeIso: NOW_ISO,
      resumeIncomplete: true,
    });
    expect(afterCrash).toHaveLength(1);
    expect(afterCrash[0]?.window_start).toBe(CYCLE.window_start);
    expect(await listCoverageDebt(store, CYCLE.window_start, CYCLE.window_end)).toHaveLength(1);
    const exhausted = incompleteState('MED-SLOW', { last_error: 'SOURCE_TIMEOUT' });
    await store.upsertSourceState(exhausted);
    for (let i = 0; i < MAX_COVERAGE_DEBT_ATTEMPTS; i += 1) {
      await incrementCoverageDebtAttempt(store, exhausted, NOW_ISO);
    }
    expect(isResumableDebt(await getCoverageDebt(store, 'MED-SLOW', CYCLE.window_start, CYCLE.window_end))).toBe(false);
  });

  it('limited canary still does not move the global cursor after debt registration', async () => {
    const store = new MemoryCaptureReliabilityStore();
    await seedCatchUpCursor(store, { mode: '24h', lastSafeWindowEnd: LAST, nowIso: NOW_ISO });
    const st = incompleteState('MED-0001', { last_error: 'SOURCE_TIMEOUT' });
    await store.upsertSourceState(st);
    await registerCoverageDebt(store, st, NOW_ISO);
    const safety = await markWindowSafeComplete(store, CYCLE, NOW_ISO, {
      allowCursorAdvance: false,
      expectedMedioIds: ['MED-0001'],
    });
    expect(safety.reason).toBe('LIMITED_DISPATCH_NO_CURSOR');
    expect(await loadLastSafeWindowEnd(store, '24h')).toBe(LAST);
  });
});
