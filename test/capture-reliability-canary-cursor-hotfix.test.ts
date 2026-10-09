import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryCaptureReliabilityStore } from '../src/captureReliability/captureRecoveryRepository.js';
import { emptySourceState, markSourceTerminal } from '../src/captureReliability/checkpoint.js';
import { baseRecoveryRecord } from '../src/captureReliability/reconcile.js';
import { drainRecoveryQueue } from '../src/captureReliability/recoveryDrain.js';
import { primaryHash } from '../src/captureReliability/urlIndex.js';
import {
  loadLastSafeWindowEnd,
  markWindowSafeComplete,
  RECOVERY_PAGE_SIZE,
  seedCatchUpCursor,
} from '../src/captureReliability/catchUpCursor.js';
import { computeFixedCycle } from '../src/captureReliability/cycle.js';
import {
  assertCanaryHashesForWrite,
  buildClaimBatchRpcArgs,
  recoveryWritesAllowed,
} from '../src/captureReliability/writesGuard.js';
import { okExtract } from './capture-reliability.test.js';
import type { RecoveryRecord, RecoveryStatus } from '../src/captureReliability/types.js';

const NOW_ISO = '2026-10-05T18:05:00.000Z';
const LAST = '2026-10-01T18:00:00.000Z';
const CYCLE = computeFixedCycle({
  mode: '24h',
  windowStart: '2026-10-01T18:00:00.000Z',
  windowEnd: '2026-10-02T18:00:00.000Z',
});
const EXPECTED_569 = Array.from({ length: 569 }, (_, i) => `MED-${String(i + 1).padStart(4, '0')}`);

class TruncatingSnapshotStore extends MemoryCaptureReliabilityStore {
  constructor(private readonly cap: number) {
    super();
  }
  override async snapshot(): Promise<RecoveryRecord[]> {
    return [...this.queue.values()].slice(0, this.cap);
  }
}

function rec(opts: { url: string; medioId: string; status: RecoveryStatus; publishedAt?: string }): RecoveryRecord {
  const url = opts.url;
  return {
    ...baseRecoveryRecord(
      {
        url,
        canonicalUrl: url,
        hashUrl: primaryHash(url),
        medioId: opts.medioId,
        fuenteId: null,
        hostname: 'medio.example',
        discoveredVia: 'rss',
        publishedAt: opts.publishedAt ?? CYCLE.window_start,
        titulo: opts.medioId,
        resumen: null,
        body: null,
      },
      CYCLE.window_start,
    ),
    status: opts.status,
  };
}

async function seedCompleteSources(
  store: MemoryCaptureReliabilityStore,
  medioIds: string[],
): Promise<void> {
  for (const medioId of medioIds) {
    const st = emptySourceState({
      medioId,
      windowStart: CYCLE.window_start,
      windowEnd: CYCLE.window_end,
    });
    await store.upsertSourceState(markSourceTerminal(st, 'COMPLETE', NOW_ISO));
  }
}

describe('canary hash filter', () => {
  it('medio_ids alone cannot authorize canary writes', () => {
    expect(
      recoveryWritesAllowed({
        dryRun: false,
        allowEnv: null,
        canaryAllowEnv: 'true',
        eventName: 'dispatch',
        limitedScope: true,
        recoveryHashes: [],
      }),
    ).toBe(false);
    expect(() =>
      assertCanaryHashesForWrite({
        wantsWrites: true,
        allowEnv: null,
        canaryAllowEnv: 'true',
        recoveryHashes: [],
      }),
    ).toThrow(/CANARY_HASHES_REQUIRED/);
  });

  it('empty onlyHashes aborts the claim RPC without omitting p_only_hashes', () => {
    const empty = buildClaimBatchRpcArgs({
      workerId: 'w',
      limit: 50,
      nowIso: NOW_ISO,
      onlyHashes: new Set(),
    });
    expect(empty.abort).toBe(true);
    expect(empty.args.p_only_hashes).toBeUndefined();
    const filtered = buildClaimBatchRpcArgs({
      workerId: 'w',
      limit: 50,
      nowIso: NOW_ISO,
      onlyHashes: new Set(['hash-a']),
    });
    expect(filtered.abort).toBe(false);
    expect(filtered.args.p_only_hashes).toEqual(['hash-a']);
  });

  it('claims and writes stay inside the authorized hash set', async () => {
    const store = new MemoryCaptureReliabilityStore();
    const persist = new Map<string, string>();
    const inScope = rec({ url: 'https://a.example/in', medioId: 'MED-0001', status: 'QUEUED' });
    const outA = rec({ url: 'https://b.example/out-a', medioId: 'MED-0002', status: 'QUEUED' });
    const outB = rec({ url: 'https://c.example/out-b', medioId: 'MED-0003', status: 'QUEUED' });
    await store.upsertDiscovered(inScope);
    await store.upsertDiscovered(outA);
    await store.upsertDiscovered(outB);
    const probe = new MemoryCaptureReliabilityStore();
    await probe.upsertDiscovered(inScope);
    await probe.upsertDiscovered(outA);
    await probe.upsertDiscovered(outB);
    const claimed = await probe.claimBatch({
      workerId: 'canary',
      limit: 50,
      nowIso: NOW_ISO,
      onlyHashes: new Set([inScope.hash_url]),
    });
    expect(claimed.map((r) => r.hash_url)).toEqual([inScope.hash_url]);
    expect(claimed.some((r) => r.medio_id !== 'MED-0001')).toBe(false);
    const drain = await drainRecoveryQueue({
      store,
      workerId: 'canary',
      nowIso: NOW_ISO,
      batchSize: 50,
      maxBatches: 4,
      concurrency: 1,
      globalConcurrency: 1,
      perHostConcurrency: 1,
      timeBudgetMs: 30_000,
      writesAllowed: true,
      fetchExtract: async () => okExtract({ titulo: 'in' }),
      persistNews: async (payload) => {
        const hash = payload.insert.hash_url;
        if (hash !== inScope.hash_url) throw new Error(`WRITE_OUT_OF_SCOPE:${hash}`);
        const id = `nid-${hash.slice(0, 8)}`;
        persist.set(hash, id);
        return { noticiaId: id, outcome: 'inserted' };
      },
      onlyHashes: new Set([inScope.hash_url]),
      windowStart: CYCLE.window_start,
      windowEnd: CYCLE.window_end,
    });
    expect(drain.RECOVERY_PROCESSED_THIS_RUN).toBe(1);
    expect(persist.size).toBe(1);
    expect(persist.has(inScope.hash_url)).toBe(true);
    expect((await store.get(outA.hash_url))?.status).toBe('QUEUED');
    expect((await store.get(outB.hash_url))?.status).toBe('QUEUED');
    expect((await store.get(outA.hash_url))?.claimed_at).toBeNull();
    expect((await store.get(outB.hash_url))?.claimed_at).toBeNull();
  });
});

describe('global cursor coverage', () => {
  it('limited dispatch never advances the durable cursor', async () => {
    const store = new MemoryCaptureReliabilityStore();
    await seedCatchUpCursor(store, { mode: '24h', lastSafeWindowEnd: LAST, nowIso: NOW_ISO });
    await seedCompleteSources(store, ['MED-0001']);
    const before = await loadLastSafeWindowEnd(store, '24h');
    const safety = await markWindowSafeComplete(store, CYCLE, NOW_ISO, {
      allowCursorAdvance: false,
      expectedMedioIds: ['MED-0001'],
    });
    expect(safety.reason).toBe('LIMITED_DISPATCH_NO_CURSOR');
    expect(safety.canAdvance).toBe(false);
    expect(await loadLastSafeWindowEnd(store, '24h')).toBe(before);
  });

  it('1/569 and 568/569 do not advance; 569/569 can; shard failure cannot', async () => {
    const store = new MemoryCaptureReliabilityStore();
    await seedCatchUpCursor(store, { mode: '24h', lastSafeWindowEnd: LAST, nowIso: NOW_ISO });

    await seedCompleteSources(store, EXPECTED_569.slice(0, 1));
    const one = await markWindowSafeComplete(store, CYCLE, NOW_ISO, {
      allowCursorAdvance: true,
      coverageComplete: true,
      expectedMedioIds: EXPECTED_569,
    });
    expect(one.reason).toBe('CATALOG_INCOMPLETE');
    expect(await loadLastSafeWindowEnd(store, '24h')).toBe(LAST);

    await seedCompleteSources(store, EXPECTED_569.slice(0, 568));
    const almost = await markWindowSafeComplete(store, CYCLE, NOW_ISO, {
      allowCursorAdvance: true,
      coverageComplete: true,
      expectedMedioIds: EXPECTED_569,
    });
    expect(almost.reason).toBe('CATALOG_INCOMPLETE');
    expect(await loadLastSafeWindowEnd(store, '24h')).toBe(LAST);

    await seedCompleteSources(store, EXPECTED_569);
    const shardFail = await markWindowSafeComplete(store, CYCLE, NOW_ISO, {
      allowCursorAdvance: true,
      coverageComplete: false,
      expectedMedioIds: EXPECTED_569,
    });
    expect(shardFail.reason).toBe('COVERAGE_INCOMPLETE');
    expect(await loadLastSafeWindowEnd(store, '24h')).toBe(LAST);

    const full = await markWindowSafeComplete(store, CYCLE, NOW_ISO, {
      allowCursorAdvance: true,
      coverageComplete: true,
      expectedMedioIds: EXPECTED_569,
    });
    expect(full.reason).toBe('SAFE_COMPLETE');
    expect(await loadLastSafeWindowEnd(store, '24h')).toBe(CYCLE.window_end);
  });
});

describe('complete queue read', () => {
  it('does not advance when a QUEUED row sits after the first 1000-page', async () => {
    const store = new TruncatingSnapshotStore(RECOVERY_PAGE_SIZE);
    await seedCatchUpCursor(store, { mode: '24h', lastSafeWindowEnd: LAST, nowIso: NOW_ISO });
    await seedCompleteSources(store, ['MED-0001']);
    for (let i = 0; i < RECOVERY_PAGE_SIZE; i += 1) {
      await store.upsertDiscovered(
        rec({
          url: `https://medio.example/p${String(i).padStart(4, '0')}`,
          medioId: 'MED-0001',
          status: 'PERSISTED',
        }),
      );
    }
    const queued = rec({
      url: 'https://medio.example/z-queued-after-page',
      medioId: 'MED-0001',
      status: 'QUEUED',
    });
    await store.upsertDiscovered(queued);
    expect((await store.snapshot()).some((r) => r.status === 'QUEUED')).toBe(false);
    expect(await store.countRecovery()).toBe(RECOVERY_PAGE_SIZE + 1);
    const safety = await markWindowSafeComplete(store, CYCLE, NOW_ISO, {
      allowCursorAdvance: true,
      expectedMedioIds: ['MED-0001'],
    });
    expect(safety.reason).toBe('CLAIMABLE_PENDING');
    expect(safety.blockingPending).toBe(1);
    expect(await loadLastSafeWindowEnd(store, '24h')).toBe(LAST);
  });
});

describe('workflow dispatch path', () => {
  const wf = readFileSync(join(process.cwd(), '.github/workflows/capture-reliability.yml'), 'utf8');

  it('requires HASH_SCOPED hashes for canary --no-dry-run and documents default-branch gate', () => {
    expect(wf).toContain('HASH_SCOPED=true');
    expect(wf).toContain('hasta que exista en la rama default');
    expect(wf).not.toMatch(/LIMITED=true; ARGS="\$ARGS --medio-ids=/);
    expect(wf).toContain('medio_ids solo NO autoriza writes');
  });
});
