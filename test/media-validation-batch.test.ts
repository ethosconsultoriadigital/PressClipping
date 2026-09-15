/**
 * BVR-01 — Batch Validation Runner V1.
 *
 * Fixtures / mocks / temp dirs / fake children. 0 capture live, 0 enrich live,
 * 0 writes a Supabase, 0 promociones.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertNoLiveChild,
  classifyLock,
  isPidAlive,
  runGuardedChild,
  spawnOwned,
  type BatchLock,
} from '../src/mediaValidation/batchLock.js';
import {
  BATCH_RUNNER_PROMOTION_MODE,
  BatchRunnerError,
  DEFAULT_WINDOW_DAYS,
  assertBatchCountInvariants,
  batchChunkContextId,
  parseBatchArgs,
  parseMediaIds,
  runBatch,
  type BatchRunnerAdapters,
  type SnapshotStepInput,
} from '../src/mediaValidation/batchRunner.js';
import { OPERATIONAL_CALIBRATION_PROFILE_PATH } from '../src/mediaValidation/calibration.js';
import { OPERATIONAL_CONTENT_SANITY_POLICY } from '../src/mediaValidation/contentSanity.js';
import type { ContentSanitySummary } from '../src/mediaValidation/contentSanity.js';
import type { SnapshotResult } from '../src/mediaValidation/newsLakeSnapshot.js';
import type { RunValidationEvidence } from '../src/mediaValidation/runValidationEvidence.js';
import { fakeCrawlEvidence, fakeEnrichEvidence, fakeMediaEvidence } from './fixtures/runEvidenceFixtures.js';
import {
  fakeMediaDelta,
  fakeMediaSnapshot,
  fakeMediaValidationRecord,
  fakePersistenceEvidence,
  fakeRunContext,
  fakeRunValidationEvidence,
} from './fixtures/validationEvidenceFixtures.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APPROVED_PROFILE = join(REPO_ROOT, OPERATIONAL_CALIBRATION_PROFILE_PATH);
const NOW = '2026-09-14T18:00:00.000Z';
const GIT = '66551b617478330911301f000db95a1d9390b0b1';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bvr-01-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function healthySanity(sampleTotal: number): ContentSanitySummary {
  return {
    schema_version: 1,
    availability: 'AVAILABLE',
    issue: null,
    sample_total: sampleTotal,
    encoding_suspect_count: 0,
    listing_suspect_count: 0,
    boilerplate_suspect_count: 0,
    placeholder_count: 0,
    blocking_defective_count: 0,
    blocking_defective_rate: 0,
    example_noticia_ids: [],
  };
}

function passingRecord(medioId: string) {
  return fakeMediaValidationRecord(medioId, {
    run_evidence: fakeMediaEvidence(medioId, {
      evidence_status: 'COMPLETE',
      crawl: fakeCrawlEvidence({
        provenance: 'STRUCTURED_V1',
        status: 'ok',
        source_method: 'rss',
        detected: 10,
        items: 10,
        inserted: 9,
        duplicates: 1,
      }),
      enrich: fakeEnrichEvidence({
        presence: 'PRESENT',
        requested: true,
        processed: 10,
        updated: 9,
        unchanged: 0,
        failed: 0,
        clean_text_count: 10,
        body_count: 10,
        dry_run: false,
        content_persistence: 'UNVERIFIED',
        raw_summary_event_count: 1,
      }),
    }),
    persistence: fakePersistenceEvidence(medioId, {
      status: 'VERIFIED',
      before: fakeMediaSnapshot(medioId, {
        status: 'COMPLETE',
        total_news: 1,
        clean_text_count: 1,
        body_count: 1,
        content_sanity: healthySanity(1),
      }),
      after: fakeMediaSnapshot(medioId, {
        status: 'COMPLETE',
        total_news: 10,
        clean_text_count: 10,
        body_count: 10,
        content_sanity: healthySanity(10),
      }),
      delta: fakeMediaDelta(medioId, {
        status: 'COMPUTED',
        news_delta: 9,
        clean_text_delta: 9,
        body_delta: 9,
        reason: null,
      }),
    }),
  });
}

function reviewRecord(medioId: string) {
  return fakeMediaValidationRecord(medioId, {
    run_evidence: fakeMediaEvidence(medioId, {
      evidence_status: 'PARTIAL',
      crawl: fakeCrawlEvidence({ provenance: 'STRUCTURED_V1', status: 'ok', source_method: 'rss' }),
      enrich: fakeEnrichEvidence({ presence: 'MISSING' }),
    }),
    persistence: fakePersistenceEvidence(medioId, { status: 'UNVERIFIED' }),
  });
}

function evidenceFor(
  ids: string[],
  contextId: string,
  runId: string,
  kind: 'PASS' | 'REVIEW',
): RunValidationEvidence {
  return fakeRunValidationEvidence({
    context: fakeRunContext({
      context_id: contextId,
      run_id: runId,
      requested_media_ids: ids,
      window_anchor: NOW,
      window_days: 30,
      dry_run: false,
    }),
    context_identity: { status: 'MATCH', issues: [] },
    media: ids.map((id) => (kind === 'PASS' ? passingRecord(id) : reviewRecord(id))),
  });
}

function fakeSnapshot(input: {
  contextId: string;
  role: 'BEFORE' | 'AFTER';
  mediaIds: string[];
  windowDays: number;
  windowAnchor: string;
}): SnapshotResult {
  return {
    schema_version: 1,
    context_id: input.contextId,
    snapshot_role: input.role,
    window_anchor: input.windowAnchor,
    window_days: input.windowDays,
    capture_started_at: NOW,
    capture_completed_at: NOW,
    requested_media_ids: input.mediaIds,
    media: input.mediaIds.map((id) => fakeMediaSnapshot(id)),
  };
}

function okProc(): { pid: number; exitCode: number; stdout: string; stderr: string } {
  return { pid: process.pid, exitCode: 0, stdout: '', stderr: '' };
}

function adapters(opts: {
  captureExitFor?: (ids: string[]) => number;
  kindFor?: (ids: string[]) => 'PASS' | 'REVIEW';
  onCapture?: (ids: string[]) => void;
  onEnrich?: (ids: string[]) => void;
  onSnapshot?: (role: 'BEFORE' | 'AFTER', ids: string[]) => void;
  blockSnapshot?: Promise<void>;
  notifySnapshot?: () => void;
}): BatchRunnerAdapters {
  return {
    snapshot: async (input) => {
      opts.notifySnapshot?.();
      if (opts.blockSnapshot) await opts.blockSnapshot;
      opts.onSnapshot?.(input.role, input.mediaIds);
      return fakeSnapshot(input);
    },
    capture: async (input) => {
      opts.onCapture?.(input.mediaIds);
      const code = opts.captureExitFor?.(input.mediaIds) ?? 0;
      return { ...okProc(), exitCode: code, stderr: code === 0 ? '' : 'capture failed' };
    },
    enrich: async (input) => {
      opts.onEnrich?.(input.mediaIds);
      return okProc();
    },
    compose: async (input) => {
      const kind = opts.kindFor?.(input.mediaIds) ?? 'PASS';
      return evidenceFor(input.mediaIds, input.contextId, input.runId, kind);
    },
  };
}

function baseOpts(dir: string, extras: Record<string, unknown> = {}) {
  return {
    mediaIds: ['MED-0001', 'MED-0002'],
    profilePath: APPROVED_PROFILE,
    outputDir: dir,
    dryRun: false,
    windowDays: 30,
    windowAnchor: NOW,
    maxNotas: 5,
    enrichLimit: 20,
    chunkSize: 5,
    nowIso: () => NOW,
    gitSha: GIT,
    repoRoot: REPO_ROOT,
    ...extras,
  };
}

describe('parseBatchArgs / parseMediaIds', () => {
  it('parsea flags V1 y default dry-run=true (anti mass-crawl)', () => {
    const args = parseBatchArgs([
      '--media-ids=MED-0001,MED-0002',
      '--profile=config/media-validation/calibration-profile-v1.json',
      '--window-days=7',
      '--max-notas=10',
      '--enrich-limit=30',
      '--chunk-size=5',
      '--run-id=wave-1',
      '--output-dir=tmp/media-validation-runs',
    ]);
    expect(args.mediaIdsRaw).toBe('MED-0001,MED-0002');
    expect(args.profile).toBe('config/media-validation/calibration-profile-v1.json');
    expect(args.windowDays).toBe(7);
    expect(args.maxNotas).toBe(10);
    expect(args.enrichLimit).toBe(30);
    expect(args.chunkSize).toBe(5);
    expect(args.dryRun).toBe(true);
    expect(args.runId).toBe('wave-1');
    expect(args.resume).toBe(false);
    expect(args.maxRetries).toBe(0);
  });

  it('--no-dry-run apaga el default seguro', () => {
    expect(parseBatchArgs(['--no-dry-run']).dryRun).toBe(false);
  });

  it('F1. default window-days=7; --window-days=30 explícito se conserva', () => {
    expect(parseBatchArgs([]).windowDays).toBe(7);
    expect(parseBatchArgs([]).dryRun).toBe(true);
    expect(DEFAULT_WINDOW_DAYS).toBe(7);
    expect(parseBatchArgs(['--window-days=30']).windowDays).toBe(30);
  });

  it('trim + dedupe + orden determinista; rechaza vacío e IDs inválidos', () => {
    expect(parseMediaIds(' MED-0002, MED-0001,MED-0002 ')).toEqual(['MED-0002', 'MED-0001']);
    expect(() => parseMediaIds('   ,  ')).toThrow(BatchRunnerError);
    expect(() => parseMediaIds('MED-1,foo')).toThrow(/inválido/);
  });
});

describe('BATCH-RUNNER-GUARD-001 / lock', () => {
  it('AE. duplicate run: segundo aborta ANTES de capture', async () => {
    const dir = tempDir();
    const gate = deferred();
    const started = deferred();
    const captured: string[][] = [];
    const blocking = adapters({
      notifySnapshot: () => started.resolve(),
      blockSnapshot: gate.promise,
      onCapture: (ids) => captured.push(ids),
    });
    const first = runBatch({
      ...baseOpts(dir),
      runId: 'dup-1',
      mediaIds: ['MED-0001'],
      adapters: blocking,
    });
    await started.promise;
    const captureCallsBeforeSecond = captured.length;
    await expect(
      runBatch({
        ...baseOpts(dir),
        runId: 'dup-1',
        mediaIds: ['MED-0001'],
        adapters: adapters({
          onCapture: () => {
            throw new Error('segundo proceso no debe llegar a capture');
          },
        }),
      }),
    ).rejects.toMatchObject({ code: 'LOCK_ERROR', reason: 'DUPLICATE_RUN' });
    expect(captureCallsBeforeSecond).toBe(0);
    expect(captured).toEqual([]);
    gate.resolve();
    const out = await first;
    expect(out.media[0]?.validation_result).toBe('PASS');
  });

  it('AF. live child: no se inicia segundo child mientras el primero vive', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    try {
      const pid = child.pid;
      expect(pid).toBeTypeOf('number');
      expect(isPidAlive(pid!)).toBe(true);
      const lock: BatchLock = {
        schema_version: 1,
        run_id: 'live-child',
        pid: process.pid,
        child_pid: pid!,
        created_at: NOW,
        updated_at: NOW,
        scope_hash: 'x',
        status: 'ACTIVE',
      };
      expect(classifyLock(lock)).toBe('ACTIVE');
      expect(() => assertNoLiveChild(lock)).toThrow(BatchRunnerError);
      const lockPath = join(tempDir(), 'lock.json');
      writeFileSync(lockPath, JSON.stringify(lock));
      await expect(
        runGuardedChild(
          { lock, lockPath, nowIso: () => NOW },
          { command: process.execPath, args: ['-e', 'process.exit(0)'] },
        ),
      ).rejects.toMatchObject({ code: 'PROCESS_ERROR', reason: 'LIVE_CHILD' });
    } finally {
      child.kill();
    }
  });

  it('AG. stale lock: PID inexistente → STALE, no se borra, no se mata nada', async () => {
    const dir = tempDir();
    const runDir = join(dir, 'stale-1');
    mkdirSync(runDir, { recursive: true });
    const lockPath = join(runDir, 'lock.json');
    const dead = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore', windowsHide: true });
    const deadPid = dead.pid;
    expect(deadPid).toBeTypeOf('number');
    await new Promise<void>((resolve) => {
      dead.on('close', () => resolve());
    });
    expect(isPidAlive(deadPid!)).toBe(false);
    const lock: BatchLock = {
      schema_version: 1,
      run_id: 'stale-1',
      pid: deadPid!,
      child_pid: null,
      created_at: NOW,
      updated_at: NOW,
      scope_hash: 'x',
      status: 'ACTIVE',
    };
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    expect(classifyLock(lock)).toBe('STALE');
    await expect(
      runBatch({
        ...baseOpts(dir),
        runId: 'stale-1',
        mediaIds: ['MED-0001'],
        adapters: adapters({
          onCapture: () => {
            throw new Error('stale lock no debe llegar a capture');
          },
        }),
      }),
    ).rejects.toMatchObject({ code: 'LOCK_ERROR', reason: 'STALE_LOCK_DETECTED' });
    expect(existsSync(lockPath)).toBe(true);
  });
});

describe('batch execution', () => {
  it('AH. partial batch: A PASS, B execution error, C REVIEW — conserva los tres', async () => {
    const dir = tempDir();
    const out = await runBatch({
      ...baseOpts(dir),
      runId: 'partial-1',
      mediaIds: ['MED-0001', 'MED-0002', 'MED-0003'],
      chunkSize: 1,
      adapters: adapters({
        captureExitFor: (ids) => (ids.includes('MED-0002') ? 1 : 0),
        kindFor: (ids) => (ids.includes('MED-0003') ? 'REVIEW' : 'PASS'),
      }),
    });
    expect(out.manifest.overall_status).toBe('PARTIAL');
    const byId = Object.fromEntries(out.media.map((m) => [m.medio_id, m]));
    expect(byId['MED-0001']?.execution_status).toBe('COMPLETED');
    expect(byId['MED-0001']?.validation_result).toBe('PASS');
    expect(byId['MED-0002']?.execution_status).toBe('FAILED');
    expect(byId['MED-0002']?.validation_result).toBeNull();
    expect(byId['MED-0002']?.error?.code).toBe('CAPTURE_ERROR');
    expect(byId['MED-0003']?.execution_status).toBe('COMPLETED');
    expect(byId['MED-0003']?.validation_result).toBe('REVIEW');
    expect(out.summary.pass_count).toBe(1);
    expect(out.summary.review_count).toBe(1);
    expect(out.summary.fail_count).toBe(0);
    expect(out.summary.execution_failed_count).toBe(1);
    assertBatchCountInvariants(out.summary, out.media);
    expect(out.reviewQueue.map((m) => m.medio_id).sort()).toEqual(['MED-0002', 'MED-0003']);
  });

  it('AI. workflow success != media PASS: capture exit 0 + evidence REVIEW → REVIEW', async () => {
    const dir = tempDir();
    const out = await runBatch({
      ...baseOpts(dir),
      runId: 'wf-1',
      mediaIds: ['MED-0001'],
      adapters: adapters({ kindFor: () => 'REVIEW' }),
    });
    expect(out.media[0]?.execution_status).toBe('COMPLETED');
    expect(out.media[0]?.validation_result).toBe('REVIEW');
    expect(out.media[0]?.validation_result).not.toBe('PASS');
    expect(out.manifest.overall_status).toBe('COMPLETED');
  });

  it('AJ. DRAFT profile FAIL FAST antes de capture', async () => {
    const dir = tempDir();
    const draftPath = join(dir, 'draft.json');
    const approved = JSON.parse(readFileSync(APPROVED_PROFILE, 'utf-8')) as Record<string, unknown>;
    writeFileSync(draftPath, `${JSON.stringify({ ...approved, status: 'DRAFT' }, null, 2)}\n`);
    let captureCalls = 0;
    await expect(
      runBatch({
        ...baseOpts(dir),
        runId: 'draft-1',
        mediaIds: ['MED-0001'],
        profilePath: draftPath,
        adapters: adapters({
          onCapture: () => {
            captureCalls += 1;
          },
        }),
      }),
    ).rejects.toMatchObject({ code: 'INPUT_ERROR', reason: 'PROFILE_NOT_APPROVED' });
    expect(captureCalls).toBe(0);
    expect(existsSync(join(dir, 'draft-1', 'manifest.json'))).toBe(false);
  });

  it('AK. resume PARTIAL solo reprocesa FAILED/PENDING, no COMPLETED', async () => {
    const dir = tempDir();
    const captured: string[][] = [];
    let failSecond = true;
    const shared = adapters({
      captureExitFor: (ids) => (failSecond && ids.includes('MED-0002') ? 1 : 0),
      kindFor: (ids) => (ids.includes('MED-0003') ? 'REVIEW' : 'PASS'),
      onCapture: (ids) => captured.push([...ids]),
    });
    const first = await runBatch({
      ...baseOpts(dir),
      runId: 'resume-1',
      mediaIds: ['MED-0001', 'MED-0002', 'MED-0003'],
      chunkSize: 1,
      adapters: shared,
    });
    expect(first.manifest.overall_status).toBe('PARTIAL');
    expect(captured).toEqual([['MED-0001'], ['MED-0002'], ['MED-0003']]);
    captured.length = 0;
    failSecond = false;
    const second = await runBatch({
      ...baseOpts(dir),
      runId: 'resume-1',
      mediaIds: ['MED-0001', 'MED-0002', 'MED-0003'],
      chunkSize: 1,
      resume: true,
      adapters: shared,
    });
    expect(captured).toEqual([['MED-0002']]);
    expect(second.media.find((m) => m.medio_id === 'MED-0001')?.validation_result).toBe('PASS');
    expect(second.media.find((m) => m.medio_id === 'MED-0002')?.validation_result).toBe('PASS');
    expect(second.media.find((m) => m.medio_id === 'MED-0003')?.validation_result).toBe('REVIEW');
    expect(second.manifest.overall_status).toBe('COMPLETED');
    expect(second.manifest.window_days).toBe(30);
    expect(second.media.find((m) => m.medio_id === 'MED-0002')?.context_id).toBe(
      batchChunkContextId('resume-1', 2),
    );
    expect(first.media.find((m) => m.medio_id === 'MED-0002')?.context_id).toBe(
      batchChunkContextId('resume-1', 2),
    );
  });

  it('AL. resume con profile/window/scope distintos → PARAMETER_DRIFT', async () => {
    const dir = tempDir();
    await runBatch({
      ...baseOpts(dir),
      runId: 'drift-1',
      mediaIds: ['MED-0001', 'MED-0002'],
      chunkSize: 1,
      adapters: adapters({
        captureExitFor: (ids) => (ids.includes('MED-0002') ? 1 : 0),
      }),
    });
    await expect(
      runBatch({
        ...baseOpts(dir),
        runId: 'drift-1',
        mediaIds: ['MED-0001', 'MED-0002'],
        windowDays: 7,
        resume: true,
        adapters: adapters({}),
      }),
    ).rejects.toMatchObject({ code: 'INPUT_ERROR', reason: 'PARAMETER_DRIFT' });
    await expect(
      runBatch({
        ...baseOpts(dir),
        runId: 'drift-1',
        mediaIds: ['MED-0001', 'MED-0002', 'MED-0003'],
        resume: true,
        adapters: adapters({}),
      }),
    ).rejects.toMatchObject({ code: 'INPUT_ERROR', reason: 'PARAMETER_DRIFT' });
  });

  it('AM. PASS + ELIGIBLE_FOR_PROMOTION se REPORTA — promotions_applied=0, sin mutation', async () => {
    const dir = tempDir();
    const out = await runBatch({
      ...baseOpts(dir),
      runId: 'promo-1',
      mediaIds: ['MED-0001'],
      adapters: adapters({}),
    });
    expect(out.media[0]?.validation_result).toBe('PASS');
    expect(out.media[0]?.recommendation).toBe('ELIGIBLE_FOR_PROMOTION');
    expect(out.summary.promotions_applied).toBe(0);
    expect(out.summary.catalog_mutations).toBe(0);
    expect(BATCH_RUNNER_PROMOTION_MODE).toBe('REPORT_ONLY');
    expect(out.manifest.promotion_mode).toBe('REPORT_ONLY');
    const src = readFileSync(join(REPO_ROOT, 'src/mediaValidation/batchRunner.ts'), 'utf-8');
    expect(src).not.toMatch(/updateMedioEstado/);
    expect(src).not.toMatch(/readiness_state/);
  });

  it('AN. dry-run nunca llama snapshot/capture/enrich', async () => {
    const dir = tempDir();
    const out = await runBatch({
      ...baseOpts(dir),
      runId: 'dry-1',
      dryRun: true,
      mediaIds: ['MED-0001', 'MED-0002'],
      adapters: {
        snapshot: async () => {
          throw new Error('dry-run no debe snapshot');
        },
        capture: async () => {
          throw new Error('dry-run no debe capture');
        },
        enrich: async () => {
          throw new Error('dry-run no debe enrich');
        },
        compose: async () => {
          throw new Error('dry-run no debe compose');
        },
      },
    });
    expect(out.manifest.dry_run).toBe(true);
    expect(out.manifest.overall_status).toBe('COMPLETED');
    expect(out.media.every((m) => m.execution_status === 'SKIPPED_DRY_RUN')).toBe(true);
    expect(out.media.every((m) => m.validation_result === null)).toBe(true);
    expect(out.summary.skipped_dry_run_count).toBe(2);
    expect(existsSync(join(out.runDir, 'chunks'))).toBe(false);
  });

  it('FAIL FAST sin --media-ids (no descubre catálogo)', async () => {
    await expect(
      runBatch({
        profilePath: APPROVED_PROFILE,
        outputDir: tempDir(),
        dryRun: true,
        repoRoot: REPO_ROOT,
      }),
    ).rejects.toMatchObject({ code: 'INPUT_ERROR' });
  });

  it('usa Profile V1 APPROVED real y policy operacional (sin override)', async () => {
    const dir = tempDir();
    const out = await runBatch({
      ...baseOpts(dir),
      runId: 'profile-1',
      mediaIds: ['MED-0001'],
      adapters: adapters({}),
    });
    expect(out.manifest.profile_id).toBe('media-validation-profile-v1');
    expect(out.manifest.profile_status).toBe('APPROVED');
    expect(out.manifest.policy_id).toBe(OPERATIONAL_CONTENT_SANITY_POLICY.policy_id);
    expect(out.manifest.policy_status).toBe('ACTIVE');
    expect(out.manifest.git_sha).toBe(GIT);
    expect(out.media[0]?.content_sanity_outcome).toBe('PASS');
  });

  it('result counts cuadran (PASS+REVIEW+FAIL <= completed)', async () => {
    const dir = tempDir();
    const out = await runBatch({
      ...baseOpts(dir),
      runId: 'counts-1',
      mediaIds: ['MED-0001', 'MED-0002', 'MED-0003'],
      chunkSize: 1,
      adapters: adapters({
        captureExitFor: (ids) => (ids.includes('MED-0002') ? 1 : 0),
        kindFor: (ids) => (ids.includes('MED-0003') ? 'REVIEW' : 'PASS'),
      }),
    });
    const s = out.summary;
    expect(s.pass_count + s.review_count + s.fail_count).toBeLessThanOrEqual(s.completed_media_count);
    expect(s.pass_count + s.review_count + s.fail_count + s.execution_failed_count).toBe(s.requested_media_count);
    assertBatchCountInvariants(s, out.media);
  });
});

describe('F1 window_days default 7', () => {
  it('A. sin windowDays: manifest.window_days = 7', async () => {
    const dir = tempDir();
    const out = await runBatch({
      ...baseOpts(dir),
      runId: 'win-default',
      dryRun: true,
      windowDays: undefined,
      mediaIds: ['MED-0001'],
    });
    expect(out.manifest.window_days).toBe(7);
  });

  it('B. --window-days=30 explícito: manifest.window_days = 30', async () => {
    const dir = tempDir();
    const out = await runBatch({
      ...baseOpts(dir),
      runId: 'win-30',
      dryRun: true,
      windowDays: 30,
      mediaIds: ['MED-0001'],
    });
    expect(out.manifest.window_days).toBe(30);
  });

  it('C+D. resume conserva window_days; distinto → PARAMETER_DRIFT', async () => {
    const dir = tempDir();
    const first = await runBatch({
      ...baseOpts(dir),
      runId: 'win-resume',
      mediaIds: ['MED-0001', 'MED-0002'],
      chunkSize: 1,
      windowDays: 30,
      adapters: adapters({
        captureExitFor: (ids) => (ids.includes('MED-0002') ? 1 : 0),
      }),
    });
    expect(first.manifest.window_days).toBe(30);
    await expect(
      runBatch({
        ...baseOpts(dir),
        runId: 'win-resume',
        mediaIds: ['MED-0001', 'MED-0002'],
        chunkSize: 1,
        windowDays: 7,
        resume: true,
        adapters: adapters({}),
      }),
    ).rejects.toMatchObject({ code: 'INPUT_ERROR', reason: 'PARAMETER_DRIFT' });
    const second = await runBatch({
      ...baseOpts(dir),
      runId: 'win-resume',
      mediaIds: ['MED-0001', 'MED-0002'],
      chunkSize: 1,
      windowDays: 30,
      resume: true,
      adapters: adapters({}),
    });
    expect(second.manifest.window_days).toBe(30);
  });
});

describe('F2 chunk context_id identity', () => {
  it('chunks distintos no comparten context_id; BEFORE/AFTER y resume sí', async () => {
    const dir = tempDir();
    const snaps: SnapshotStepInput[] = [];
    const composeIds: Array<{ contextId: string; mediaIds: string[] }> = [];
    let failSecond = true;
    const base = adapters({
      captureExitFor: (ids) => (failSecond && ids.includes('MED-0002') ? 1 : 0),
      kindFor: (ids) => (ids.includes('MED-0003') ? 'REVIEW' : 'PASS'),
    });
    const recording: BatchRunnerAdapters = {
      ...base,
      snapshot: async (input) => {
        snaps.push({ ...input, mediaIds: [...input.mediaIds] });
        return base.snapshot(input);
      },
      compose: async (input) => {
        composeIds.push({ contextId: input.contextId, mediaIds: [...input.mediaIds] });
        return base.compose(input);
      },
    };

    const first = await runBatch({
      ...baseOpts(dir),
      runId: 'wave-001',
      mediaIds: ['MED-0001', 'MED-0002', 'MED-0003'],
      chunkSize: 1,
      adapters: recording,
    });

    const ctx1 = batchChunkContextId('wave-001', 1);
    const ctx2 = batchChunkContextId('wave-001', 2);
    const ctx3 = batchChunkContextId('wave-001', 3);
    expect(ctx1).toBe('VAL-wave-001-chunk-001');
    expect(ctx2).toBe('VAL-wave-001-chunk-002');
    expect(ctx3).toBe('VAL-wave-001-chunk-003');
    expect(new Set([ctx1, ctx2, ctx3]).size).toBe(3);

    expect(first.manifest.run_id).toBe('wave-001');
    expect(first.manifest.context_id).toBe('VAL-wave-001');
    expect(first.manifest.chunk_context_ids).toEqual([ctx1, ctx2, ctx3]);
    expect(first.manifest.window_anchor).toBe(NOW);

    expect(first.media.find((m) => m.medio_id === 'MED-0001')?.context_id).toBe(ctx1);
    expect(first.media.find((m) => m.medio_id === 'MED-0002')?.context_id).toBe(ctx2);
    expect(first.media.find((m) => m.medio_id === 'MED-0003')?.context_id).toBe(ctx3);

    const before1 = snaps.filter((s) => s.contextId === ctx1 && s.role === 'BEFORE');
    const after1 = snaps.filter((s) => s.contextId === ctx1 && s.role === 'AFTER');
    const before3 = snaps.filter((s) => s.contextId === ctx3 && s.role === 'BEFORE');
    const after3 = snaps.filter((s) => s.contextId === ctx3 && s.role === 'AFTER');
    expect(before1).toHaveLength(1);
    expect(after1).toHaveLength(1);
    expect(before1[0]?.contextId).toBe(after1[0]?.contextId);
    expect(before3[0]?.contextId).toBe(after3[0]?.contextId);
    expect(before1[0]?.contextId).not.toBe(before3[0]?.contextId);

    expect(before1[0]?.mediaIds).toEqual(['MED-0001']);
    expect(after1[0]?.mediaIds).toEqual(['MED-0001']);
    expect(before3[0]?.mediaIds).toEqual(['MED-0003']);
    expect(after3[0]?.mediaIds).toEqual(['MED-0003']);

    expect(snaps.every((s) => s.windowAnchor === NOW)).toBe(true);
    expect(snaps.every((s) => s.windowDays === 30)).toBe(true);

    expect(composeIds.find((c) => c.contextId === ctx1)?.mediaIds).toEqual(['MED-0001']);
    expect(composeIds.find((c) => c.contextId === ctx3)?.mediaIds).toEqual(['MED-0003']);
    expect(composeIds.some((c) => c.contextId === ctx2)).toBe(false);

    snaps.length = 0;
    failSecond = false;
    const second = await runBatch({
      ...baseOpts(dir),
      runId: 'wave-001',
      mediaIds: ['MED-0001', 'MED-0002', 'MED-0003'],
      chunkSize: 1,
      resume: true,
      adapters: recording,
    });
    expect(second.media.find((m) => m.medio_id === 'MED-0002')?.context_id).toBe(ctx2);
    expect(second.manifest.chunk_context_ids).toEqual([ctx1, ctx2, ctx3]);
    expect(second.manifest.window_anchor).toBe(NOW);
    const resumeSnaps = snaps.filter((s) => s.contextId === ctx2);
    expect(resumeSnaps.length).toBeGreaterThanOrEqual(2);
    expect(resumeSnaps.every((s) => s.contextId === ctx2)).toBe(true);
    expect(resumeSnaps.every((s) => s.mediaIds.join(',') === 'MED-0002')).toBe(true);
    expect(resumeSnaps.every((s) => s.windowAnchor === NOW)).toBe(true);
    expect(second.media.find((m) => m.medio_id === 'MED-0001')?.context_id).toBe(ctx1);
    expect(second.media.find((m) => m.medio_id === 'MED-0003')?.context_id).toBe(ctx3);
  });
});

describe('owned spawn (Windows / shell:false)', () => {
  it('espera close real y captura exit code sin shell', async () => {
    const result = await spawnOwned({
      command: process.execPath,
      args: ['-e', 'process.stdout.write("hi"); process.exit(4);'],
    });
    expect(result.exitCode).toBe(4);
    expect(result.stdout).toContain('hi');
    expect(result.pid).toBeGreaterThan(0);
  });
});
