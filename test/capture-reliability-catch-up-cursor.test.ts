import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryCaptureReliabilityStore } from '../src/captureReliability/captureRecoveryRepository.js';
import { scheduleSourceJobs } from '../src/captureReliability/engine.js';
import { markSourceTerminal } from '../src/captureReliability/checkpoint.js';
import { baseRecoveryRecord } from '../src/captureReliability/reconcile.js';
import { primaryHash } from '../src/captureReliability/urlIndex.js';
import { processRecoveryRecord } from '../src/captureReliability/recoveryWorker.js';
import { okExtract } from './capture-reliability.test.js';
import {
  executeCatchUpWindows,
  evaluateWindowSafety,
  loadLastSafeWindowEnd,
  markWindowSafeComplete,
  resolveNextCatchUpWindow,
  seedCatchUpCursor,
} from '../src/captureReliability/catchUpCursor.js';
import { contiguousCatchUpWindows } from '../src/captureReliability/cycle.js';
import { isLimitedCanaryScope, recoveryWritesAllowed } from '../src/captureReliability/writesGuard.js';
import type { CaptureCycle } from '../src/captureReliability/cycle.js';
import type { ChannelCatalogRow } from '../src/captureReliability/types.js';

const LAST = '2026-10-01T18:00:00.000Z';
const NOW = new Date('2026-10-05T18:05:00.000Z');
const NOW_ISO = '2026-10-05T18:05:00.000Z';
const CATALOG: ChannelCatalogRow[] = [
  {
    medio_id: 'MED-1',
    url_base: 'https://medio.example',
    rss_url: 'https://medio.example/rss',
    sitemap_url: null,
    hostname: 'medio.example',
  },
];

function urlFor(end: string) {
  return `https://medio.example/nota-${end.replace(/[:.]/g, '')}/`;
}

async function finishWindow(
  store: MemoryCaptureReliabilityStore,
  cycle: CaptureCycle,
  persist: Map<string, string>,
) {
  const first = await scheduleSourceJobs(store, CATALOG, cycle.window_start, cycle.window_end);
  const second = await scheduleSourceJobs(store, CATALOG, cycle.window_start, cycle.window_end);
  expect(second).toBe(0);
  expect(first === 0 || first === 1).toBe(true);
  const st = await store.getSourceState('MED-1', cycle.window_start, cycle.window_end);
  expect(st).not.toBeNull();
  await store.upsertSourceState(markSourceTerminal(st!, 'COMPLETE', NOW_ISO));
  const url = urlFor(cycle.window_end);
  const rec0 = {
    ...baseRecoveryRecord(
      {
        url,
        canonicalUrl: url,
        hashUrl: primaryHash(url),
        medioId: 'MED-1',
        fuenteId: null,
        hostname: 'medio.example',
        discoveredVia: 'rss',
        publishedAt: cycle.window_start,
        titulo: `Nota ${cycle.window_end}`,
        resumen: null,
        body: null,
      },
      cycle.window_start,
    ),
    status: 'QUEUED' as const,
  };
  await store.upsertDiscovered(rec0);
  const out = await processRecoveryRecord({
    record: rec0,
    store,
    fetchExtract: async () => okExtract({ titulo: rec0.discovered_title }),
    writesAllowed: true,
    persistNews: async () => {
      const hash = rec0.hash_url;
      const existing = persist.get(hash);
      if (existing) return { noticiaId: existing, outcome: 'known' };
      const id = `nid-${hash.slice(0, 8)}`;
      persist.set(hash, id);
      return { noticiaId: id, outcome: 'inserted' };
    },
    nowIso: NOW_ISO,
    windowStart: cycle.window_start,
    windowEnd: cycle.window_end,
  });
  expect(out.status === 'PERSISTED' || out.status === 'KNOWN_IN_LAKE').toBe(true);
}

describe('RC1 durable catch-up', () => {
  it('>72h interruption generates four contiguous windows and executes all', async () => {
    const generated = contiguousCatchUpWindows({ lastCompletedWindowEnd: LAST, now: NOW, mode: '24h' });
    expect(generated).toHaveLength(4);
    const store = new MemoryCaptureReliabilityStore();
    const persist = new Map<string, string>();
    const report = await executeCatchUpWindows({
      store,
      mode: '24h',
      now: NOW,
      nowIso: NOW_ISO,
      lastSafeWindowEnd: LAST,
      runWindow: (cycle) => finishWindow(store, cycle, persist),
    });
    expect(report.executed).toEqual(generated.map((w) => w.window_end));
    expect(report.skipped).toEqual([]);
    expect(report.remaining).toBe(0);
    expect(report.duplicateSourceClaims).toBe(0);
    expect(persist.size).toBe(4);
    expect(await loadLastSafeWindowEnd(store, '24h')).toBe('2026-10-05T18:00:00.000Z');
  });

  it('crash after the first window resumes the rest without skipping', async () => {
    const store = new MemoryCaptureReliabilityStore();
    const persist = new Map<string, string>();
    await expect(
      executeCatchUpWindows({
        store,
        mode: '24h',
        now: NOW,
        nowIso: NOW_ISO,
        lastSafeWindowEnd: LAST,
        crashAfterFirst: true,
        runWindow: (cycle) => finishWindow(store, cycle, persist),
      }),
    ).rejects.toThrow(/CATCH_UP_CRASH_AFTER/);
    expect(await loadLastSafeWindowEnd(store, '24h')).toBe('2026-10-02T18:00:00.000Z');
    const resume = await executeCatchUpWindows({
      store,
      mode: '24h',
      now: NOW,
      nowIso: NOW_ISO,
      runWindow: (cycle) => finishWindow(store, cycle, persist),
    });
    expect(resume.executed).toEqual([
      '2026-10-03T18:00:00.000Z',
      '2026-10-04T18:00:00.000Z',
      '2026-10-05T18:00:00.000Z',
    ]);
    expect(resume.skipped).toEqual([]);
    expect(persist.size).toBe(4);
    expect(new Set(persist.values()).size).toBe(4);
  });

  it('rerun does not mint a second noticia_id', async () => {
    const store = new MemoryCaptureReliabilityStore();
    const persist = new Map<string, string>();
    await executeCatchUpWindows({
      store,
      mode: '24h',
      now: NOW,
      nowIso: NOW_ISO,
      lastSafeWindowEnd: LAST,
      runWindow: (cycle) => finishWindow(store, cycle, persist),
    });
    const ids = [...persist.values()];
    const again = await executeCatchUpWindows({
      store,
      mode: '24h',
      now: NOW,
      nowIso: NOW_ISO,
      runWindow: (cycle) => finishWindow(store, cycle, persist),
    });
    expect(again.executed).toEqual([]);
    expect(again.remaining).toBe(0);
    expect([...persist.values()]).toEqual(ids);
  });

  it('does not mark the next window complete when the current one has claimable pending', async () => {
    const store = new MemoryCaptureReliabilityStore();
    await seedCatchUpCursor(store, { mode: '24h', lastSafeWindowEnd: LAST, nowIso: NOW_ISO });
    const next = await resolveNextCatchUpWindow({ store, mode: '24h', now: NOW });
    expect(next.cycle?.window_end).toBe('2026-10-02T18:00:00.000Z');
    await scheduleSourceJobs(store, CATALOG, next.cycle!.window_start, next.cycle!.window_end);
    const st = await store.getSourceState('MED-1', next.cycle!.window_start, next.cycle!.window_end);
    await store.upsertSourceState(markSourceTerminal(st!, 'COMPLETE', NOW_ISO));
    const url = urlFor(next.cycle!.window_end);
    await store.upsertDiscovered({
      ...baseRecoveryRecord(
        {
          url,
          canonicalUrl: url,
          hashUrl: primaryHash(url),
          medioId: 'MED-1',
          fuenteId: null,
          hostname: 'medio.example',
          discoveredVia: 'rss',
          publishedAt: next.cycle!.window_start,
          titulo: 'Pendiente',
          resumen: null,
          body: null,
        },
        next.cycle!.window_start,
      ),
      status: 'QUEUED',
    });
    const safety = await markWindowSafeComplete(store, next.cycle!, NOW_ISO);
    expect(safety.safeComplete).toBe(false);
    expect(safety.reason).toBe('CLAIMABLE_PENDING');
    expect(await loadLastSafeWindowEnd(store, '24h')).toBe(LAST);
    const still = await resolveNextCatchUpWindow({ store, mode: '24h', now: NOW });
    expect(still.cycle?.window_end).toBe('2026-10-02T18:00:00.000Z');
  });

  it('preserves BLOCKED/RETRY/MANUAL_REVIEW when the cursor advances', async () => {
    const store = new MemoryCaptureReliabilityStore();
    await seedCatchUpCursor(store, { mode: '24h', lastSafeWindowEnd: LAST, nowIso: NOW_ISO });
    const next = await resolveNextCatchUpWindow({ store, mode: '24h', now: NOW });
    await scheduleSourceJobs(store, CATALOG, next.cycle!.window_start, next.cycle!.window_end);
    const st = await store.getSourceState('MED-1', next.cycle!.window_start, next.cycle!.window_end);
    await store.upsertSourceState(markSourceTerminal(st!, 'COMPLETE', NOW_ISO));
    for (const [i, status] of (['BLOCKED', 'RETRY', 'MANUAL_REVIEW'] as const).entries()) {
      const url = `https://medio.example/debt-${i}/`;
      await store.upsertDiscovered({
        ...baseRecoveryRecord(
          {
            url,
            canonicalUrl: url,
            hashUrl: primaryHash(url),
            medioId: 'MED-1',
            fuenteId: null,
            hostname: 'medio.example',
            discoveredVia: 'rss',
            publishedAt: next.cycle!.window_start,
            titulo: status,
            resumen: null,
            body: null,
          },
          next.cycle!.window_start,
        ),
        status,
      });
    }
    const safety = evaluateWindowSafety({
      sourceStates: await store.listSourceStates(next.cycle!.window_start, next.cycle!.window_end),
      recovery: (await store.snapshot()).filter((r) => r.published_at === next.cycle!.window_start),
    });
    expect(safety.safeComplete).toBe(true);
    expect(safety.debt).toEqual({ BLOCKED: 1, RETRY: 1, MANUAL_REVIEW: 1 });
    await markWindowSafeComplete(store, next.cycle!, NOW_ISO);
    expect(await loadLastSafeWindowEnd(store, '24h')).toBe(next.cycle!.window_end);
    const snap = await store.snapshot();
    expect(snap.filter((r) => r.status === 'BLOCKED')).toHaveLength(1);
    expect(snap.filter((r) => r.status === 'RETRY')).toHaveLength(1);
    expect(snap.filter((r) => r.status === 'MANUAL_REVIEW')).toHaveLength(1);
  });
});

describe('RC1 write gates', () => {
  it('keeps schedule and unlimited dispatch off the canary secret', () => {
    expect(recoveryWritesAllowed({ dryRun: false, allowEnv: 'true' })).toBe(true);
    expect(
      recoveryWritesAllowed({
        dryRun: false,
        allowEnv: null,
        canaryAllowEnv: 'true',
        eventName: 'schedule',
        limitedScope: true,
      }),
    ).toBe(false);
    expect(
      recoveryWritesAllowed({
        dryRun: false,
        allowEnv: null,
        canaryAllowEnv: 'true',
        eventName: 'dispatch',
        limitedScope: false,
      }),
    ).toBe(false);
    expect(
      recoveryWritesAllowed({
        dryRun: false,
        allowEnv: null,
        canaryAllowEnv: 'true',
        eventName: 'dispatch',
        limitedScope: true,
      }),
    ).toBe(true);
    expect(isLimitedCanaryScope({ medioIds: ['MED-0027'] })).toBe(true);
    expect(isLimitedCanaryScope({ medioIds: [], recoveryHashes: [] })).toBe(false);
  });
});

describe('RC1 capture-reliability workflow contract', () => {
  const wf = readFileSync(join(process.cwd(), '.github/workflows/capture-reliability.yml'), 'utf8');

  it('uses durable resolve-cycle and does not compute now-minus-24h', () => {
    expect(wf).toContain('--role=resolve-cycle');
    expect(wf).not.toContain('date -u');
    expect(wf).toContain('ALLOW_CAPTURE_RECOVERY_CANARY_WRITES');
    expect(wf).toContain('COVERAGE_COMPLETE');
    expect(wf).toContain("needs.scheduler.result == 'success'");
    expect(wf).toContain('needs.scheduler.outputs.window_end');
  });

  it('does not launch source workers on scheduler failure or empty cycle', () => {
    const sourceIf = wf.match(/source-worker:[\s\S]*?\n    if: \$\{ \{([^}]+)\} \}/);
    expect(wf).toMatch(/source-worker:[\s\S]*?needs\.scheduler\.result == 'success'/);
    expect(wf).toMatch(/source-worker:[\s\S]*?window_end != ''/);
    expect(wf).not.toMatch(/source-worker:[\s\S]*?if: \$\{ \{ always\(\)/);
    expect(sourceIf === null || !sourceIf[1]?.includes('always()')).toBe(true);
  });
});
