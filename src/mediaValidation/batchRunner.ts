/**
 * Batch Validation Runner V1 — orquesta capture/enrich/1C/1B/1D/1E/1F.
 *
 * NO reimplementa thresholds, sanity, snapshot, evidence ni validator.
 * NO promueve medios (REPORT_ONLY). NO descubre el catálogo: exige --media-ids.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chunkArray } from '../utils/chunk.js';
import { parseIntOrNull } from '../utils/parse.js';
import {
  OPERATIONAL_CALIBRATION_PROFILE_PATH,
  type CalibrationProfile,
} from './calibration.js';
import { validateCalibrationProfile } from './calibrationSchemas.js';
import { OPERATIONAL_CONTENT_SANITY_POLICY } from './contentSanity.js';
import { computeQualityMetricsForRun } from './qualityMetrics.js';
import { aggregateRunEvidence } from './runEvidenceAggregator.js';
import { buildRunContextFromRunEvidence } from './runContext.js';
import { composeRunValidationEvidence, type RunValidationEvidence } from './runValidationEvidence.js';
import { evaluateRun, type Recommendation, type ValidationResult } from './shadowValidator.js';
import type { SnapshotResult } from './newsLakeSnapshot.js';
import {
  acquireLock,
  assertNoLiveChild,
  BatchRunnerError,
  classifyLock,
  isPidAlive,
  readLockFile,
  releaseLock,
  runGuardedChild,
  type BatchErrorCode,
  type BatchLock,
  type OwnedProcessResult,
  type SpawnOwnedSpec,
} from './batchLock.js';

export { BatchRunnerError } from './batchLock.js';
export type { BatchErrorCode } from './batchLock.js';

export const BATCH_RUNNER_VERSION = 1;
export const BATCH_MANIFEST_SCHEMA_VERSION = 1;
export const BATCH_MEDIA_RESULT_SCHEMA_VERSION = 1;
export const BATCH_SUMMARY_SCHEMA_VERSION = 1;
export const BATCH_RUNNER_PROMOTION_MODE = 'REPORT_ONLY' as const;
/** Default operacional V1 — misma ventana con la que se aprobó CalibrationProfile V1. Override CLI permitido. */
export const DEFAULT_WINDOW_DAYS = 7;

/**
 * Identidad 1C del CHUNK (no del batch). Determinista: run_id + índice 1-based.
 * BEFORE/AFTER/evidence de un chunk DEBEN compartir este valor; chunks distintos NO.
 */
export function batchChunkContextId(runId: string, chunkIndex: number): string {
  if (!Number.isInteger(chunkIndex) || chunkIndex < 1) {
    throw new BatchRunnerError('INPUT_ERROR', `chunkIndex debe ser entero >= 1 (recibido: ${chunkIndex})`);
  }
  return `VAL-${runId}-chunk-${String(chunkIndex).padStart(3, '0')}`;
}

/** Formato canónico del catálogo (MED-0001). */
export const MEDIA_ID_PATTERN = /^MED-\d{4}$/;

export type BatchOverallStatus = 'CREATED' | 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'ABORTED';
export type MediaExecutionStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED_DRY_RUN';

export interface BatchCliArgs {
  mediaIdsRaw: string | null;
  profile: string;
  windowDays: number;
  windowAnchor: string | null;
  maxNotas: number;
  enrichLimit: number;
  chunkSize: number;
  dryRun: boolean;
  runId: string | null;
  outputDir: string;
  resume: boolean;
  maxRetries: number;
}

export interface MediaCaptureCounts {
  inserted: number | null;
  duplicates: number | null;
  errors: number | null;
}

export interface MediaAttemptRecord {
  attempt: number;
  error: string | null;
  timestamp: string;
  exit_code: number | null;
}

export interface MediaBatchResult {
  schema_version: typeof BATCH_MEDIA_RESULT_SCHEMA_VERSION;
  medio_id: string;
  run_id: string;
  context_id: string;
  execution_status: MediaExecutionStatus;
  capture_status: string | null;
  enrich_status: string | null;
  capture: MediaCaptureCounts | null;
  enrich: {
    processed: number | null;
    updated: number | null;
    failed: number | null;
    dry_run: boolean | null;
  } | null;
  run_evidence_completeness: 'COMPLETE' | 'PARTIAL' | 'MISSING' | null;
  persistence_status: string | null;
  clean_ratio: number | null;
  body_ratio: number | null;
  content_sanity_outcome: string | null;
  evaluation_status: string | null;
  validation_result: ValidationResult;
  recommendation: Recommendation;
  review_reasons: string[];
  issues: string[];
  error: { code: BatchErrorCode; message: string; exit_code: number | null } | null;
  simulated: boolean;
  dry_run: boolean;
  chunk_index: number | null;
  attempts: MediaAttemptRecord[];
  artifact_refs: Record<string, string>;
}

export interface BatchManifest {
  schema_version: typeof BATCH_MANIFEST_SCHEMA_VERSION;
  run_id: string;
  context_id: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  profile_id: string;
  profile_path: string;
  profile_status: CalibrationProfile['status'];
  policy_id: string;
  policy_status: string;
  requested_media_ids: string[];
  effective_media_ids: string[];
  /**
   * Identidades 1C por chunk (`VAL-<run_id>-chunk-NNN`).
   * `context_id` del manifest es el envelope del BATCH (`VAL-<run_id>`), nunca se reutiliza
   * como context_id de snapshots/evidence de chunks con universos distintos.
   */
  chunk_context_ids: string[];
  window_days: number;
  window_anchor: string;
  max_notas: number;
  enrich_limit: number;
  chunk_size: number;
  dry_run: boolean;
  resume: boolean;
  max_retries: number;
  runner_version: number;
  git_sha: string;
  params_fingerprint: string;
  scope_hash: string;
  promotion_mode: typeof BATCH_RUNNER_PROMOTION_MODE;
  overall_status: BatchOverallStatus;
}

export interface BatchSummary {
  schema_version: typeof BATCH_SUMMARY_SCHEMA_VERSION;
  run_id: string;
  overall_status: BatchOverallStatus;
  requested_media_count: number;
  completed_media_count: number;
  execution_failed_count: number;
  skipped_dry_run_count: number;
  pending_count: number;
  pass_count: number;
  review_count: number;
  fail_count: number;
  recommendation_counts: Record<string, number>;
  review_reason_counts: Record<string, number>;
  duration_ms: number | null;
  chunk_count: number;
  retry_count: number;
  promotions_applied: 0;
  catalog_mutations: 0;
  dry_run: boolean;
}

export interface ExecutionLogEvent {
  ts: string;
  event: string;
  [key: string]: unknown;
}

export interface SnapshotStepInput {
  contextId: string;
  role: 'BEFORE' | 'AFTER';
  mediaIds: string[];
  windowDays: number;
  windowAnchor: string;
}

export interface CaptureStepInput {
  mediaIds: string[];
  maxNotas: number;
  chunkIndex: number;
  chunkCount: number;
}

export interface EnrichStepInput {
  mediaIds: string[];
  enrichLimit: number;
  windowDays: number;
  chunkIndex: number;
  chunkCount: number;
}

export interface ComposeStepInput {
  runLogText: string;
  before: SnapshotResult;
  after: SnapshotResult;
  contextId: string;
  mediaIds: string[];
  runId: string;
  windowDays: number;
  windowAnchor: string;
  maxNotas: number;
  enrichLimit: number;
}

export interface BatchChildGuard {
  run(spec: SpawnOwnedSpec): Promise<OwnedProcessResult>;
}

export interface BatchRunnerAdapters {
  snapshot: (input: SnapshotStepInput) => Promise<SnapshotResult>;
  capture: (input: CaptureStepInput, guard: BatchChildGuard) => Promise<OwnedProcessResult>;
  enrich: (input: EnrichStepInput, guard: BatchChildGuard) => Promise<OwnedProcessResult>;
  compose: (input: ComposeStepInput) => Promise<RunValidationEvidence>;
}

export interface BatchRunnerOptions {
  mediaIdsRaw?: string | null;
  mediaIds?: string[];
  profilePath?: string;
  windowDays?: number;
  windowAnchor?: string | null;
  maxNotas?: number;
  enrichLimit?: number;
  chunkSize?: number;
  dryRun?: boolean;
  runId?: string | null;
  outputDir?: string;
  resume?: boolean;
  maxRetries?: number;
  adapters?: BatchRunnerAdapters;
  nowIso?: () => string;
  gitSha?: string;
  pid?: number;
  pidAlive?: (pid: number) => boolean;
  signal?: AbortSignal;
  repoRoot?: string;
}

export interface BatchRunOutcome {
  manifest: BatchManifest;
  summary: BatchSummary;
  media: MediaBatchResult[];
  reviewQueue: MediaBatchResult[];
  runDir: string;
  staleLockDetected: boolean;
}

const DEFAULT_OUTPUT_DIR = 'tmp/media-validation-runs';

export function parseBatchArgs(argv: string[]): BatchCliArgs {
  const out: BatchCliArgs = {
    mediaIdsRaw: null,
    profile: OPERATIONAL_CALIBRATION_PROFILE_PATH,
    windowDays: DEFAULT_WINDOW_DAYS,
    windowAnchor: null,
    maxNotas: 5,
    enrichLimit: 20,
    chunkSize: 5,
    dryRun: true,
    runId: null,
    outputDir: DEFAULT_OUTPUT_DIR,
    resume: false,
    maxRetries: 0,
  };
  for (const arg of argv) {
    if (arg === '--dry-run') {
      out.dryRun = true;
      continue;
    }
    if (arg === '--no-dry-run') {
      out.dryRun = false;
      continue;
    }
    if (arg === '--resume') {
      out.resume = true;
      continue;
    }
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    const key = eq === -1 ? body : body.slice(0, eq);
    const val = eq === -1 ? '' : body.slice(eq + 1);
    switch (key) {
      case 'media-ids':
        out.mediaIdsRaw = val;
        break;
      case 'profile':
        out.profile = val;
        break;
      case 'window-days': {
        const n = parseIntOrNull(val);
        if (n !== null) out.windowDays = n;
        break;
      }
      case 'window-anchor':
        out.windowAnchor = val;
        break;
      case 'max-notas': {
        const n = parseIntOrNull(val);
        if (n !== null) out.maxNotas = n;
        break;
      }
      case 'enrich-limit': {
        const n = parseIntOrNull(val);
        if (n !== null) out.enrichLimit = n;
        break;
      }
      case 'chunk-size': {
        const n = parseIntOrNull(val);
        if (n !== null) out.chunkSize = n;
        break;
      }
      case 'dry-run':
        out.dryRun = val === '' ? true : val !== 'false';
        break;
      case 'run-id':
        out.runId = val;
        break;
      case 'output-dir':
        out.outputDir = val;
        break;
      case 'resume':
        out.resume = val === '' ? true : val !== 'false';
        break;
      case 'max-retries': {
        const n = parseIntOrNull(val);
        if (n !== null) out.maxRetries = n;
        break;
      }
      default:
        break;
    }
  }
  return out;
}

export function parseMediaIds(raw: string): string[] {
  const tokens = raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  if (tokens.length === 0) {
    throw new BatchRunnerError('INPUT_ERROR', 'lista --media-ids vacía — el runner exige scope explícito (no catálogo completo)');
  }
  const invalid = tokens.filter((id) => !MEDIA_ID_PATTERN.test(id));
  if (invalid.length > 0) {
    throw new BatchRunnerError(
      'INPUT_ERROR',
      `medio_id inválido(s): ${invalid.join(', ')} — se espera MED-0001 (4 dígitos)`,
    );
  }
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const id of tokens) {
    if (seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
  }
  return ordered;
}

export function readGitHead(cwd: string): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd,
      encoding: 'utf-8',
      shell: false,
    }).trim();
  } catch {
    return 'UNKNOWN';
  }
}

export function loadApprovedProfile(profilePath: string): CalibrationProfile {
  if (!existsSync(profilePath)) {
    throw new BatchRunnerError('INPUT_ERROR', `CalibrationProfile no encontrado: ${profilePath}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(profilePath, 'utf-8'));
  } catch (err) {
    throw new BatchRunnerError(
      'INPUT_ERROR',
      `CalibrationProfile ilegible: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  let profile: CalibrationProfile;
  try {
    profile = validateCalibrationProfile(json) as CalibrationProfile;
  } catch (err) {
    throw new BatchRunnerError(
      'INPUT_ERROR',
      `CalibrationProfile inválido: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (profile.status !== 'APPROVED') {
    throw new BatchRunnerError(
      'INPUT_ERROR',
      `profile status=${profile.status} — Batch Runner V1 exige APPROVED (FAIL FAST, sin steps operativos)`,
      { reason: 'PROFILE_NOT_APPROVED' },
    );
  }
  return profile;
}

export function composeFromArtifacts(input: ComposeStepInput): RunValidationEvidence {
  const runEvidence = aggregateRunEvidence({
    logLines: input.runLogText,
    runId: input.runId,
    requestedMediaIds: input.mediaIds,
  });
  const context = buildRunContextFromRunEvidence(runEvidence, {
    contextId: input.contextId,
    windowAnchor: input.windowAnchor,
    windowDays: input.windowDays,
    maxNotas: input.maxNotas,
    enrichLimit: input.enrichLimit,
  });
  return composeRunValidationEvidence({
    context,
    runEvidence,
    before: input.before,
    after: input.after,
  });
}

export function createLiveBatchAdapters(repoRoot: string): BatchRunnerAdapters {
  const tsxCli = join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const crawlScript = join(repoRoot, 'scripts', 'crawl.ts');
  const enrichScript = join(repoRoot, 'scripts', 'enrich-news.ts');
  return {
    snapshot: async (input) => {
      const { buildNewsLakeSnapshot, createSupabaseFetchNoticiasPage } = await import('./newsLakeSnapshot.js');
      return buildNewsLakeSnapshot({
        contextId: input.contextId,
        snapshotRole: input.role,
        mediaIds: input.mediaIds,
        windowDays: input.windowDays,
        windowAnchor: input.windowAnchor,
        fetchPage: createSupabaseFetchNoticiasPage(),
      });
    },
    capture: async (input, guard) =>
      guard.run({
        command: process.execPath,
        args: [
          tsxCli,
          crawlScript,
          `--medio-ids=${input.mediaIds.join(',')}`,
          `--max-notas=${input.maxNotas}`,
        ],
        cwd: repoRoot,
      }),
    enrich: async (input, guard) =>
      guard.run({
        command: process.execPath,
        args: [
          tsxCli,
          enrichScript,
          `--medio-ids=${input.mediaIds.join(',')}`,
          `--limit=${input.enrichLimit}`,
          `--window-days=${input.windowDays}`,
          '--recent-first',
          '--only-missing-clean-text',
        ],
        cwd: repoRoot,
      }),
    compose: async (input) => composeFromArtifacts(input),
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function paramsFingerprint(input: {
  mediaIds: string[];
  profileId: string;
  profilePath: string;
  windowDays: number;
  windowAnchor: string;
  maxNotas: number;
  enrichLimit: number;
  chunkSize: number;
  dryRun: boolean;
}): string {
  return sha256(
    JSON.stringify({
      media_ids: input.mediaIds,
      profile_id: input.profileId,
      profile_path: input.profilePath,
      window_days: input.windowDays,
      window_anchor: input.windowAnchor,
      max_notas: input.maxNotas,
      enrich_limit: input.enrichLimit,
      chunk_size: input.chunkSize,
      dry_run: input.dryRun,
    }),
  );
}

function emptyMediaResult(medioId: string, runId: string, contextId: string, dryRun: boolean): MediaBatchResult {
  return {
    schema_version: BATCH_MEDIA_RESULT_SCHEMA_VERSION,
    medio_id: medioId,
    run_id: runId,
    context_id: contextId,
    execution_status: 'PENDING',
    capture_status: null,
    enrich_status: null,
    capture: null,
    enrich: null,
    run_evidence_completeness: null,
    persistence_status: null,
    clean_ratio: null,
    body_ratio: null,
    content_sanity_outcome: null,
    evaluation_status: null,
    validation_result: null,
    recommendation: null,
    review_reasons: [],
    issues: [],
    error: null,
    simulated: dryRun,
    dry_run: dryRun,
    chunk_index: null,
    attempts: [],
    artifact_refs: {},
  };
}

export function buildBatchSummary(
  manifest: BatchManifest,
  media: MediaBatchResult[],
  durationMs: number | null,
  retryCount: number,
): BatchSummary {
  const recommendation_counts: Record<string, number> = {};
  const review_reason_counts: Record<string, number> = {};
  for (const m of media) {
    const recKey = m.recommendation ?? 'null';
    recommendation_counts[recKey] = (recommendation_counts[recKey] ?? 0) + 1;
    for (const reason of m.review_reasons) {
      review_reason_counts[reason] = (review_reason_counts[reason] ?? 0) + 1;
    }
  }
  const summary: BatchSummary = {
    schema_version: BATCH_SUMMARY_SCHEMA_VERSION,
    run_id: manifest.run_id,
    overall_status: manifest.overall_status,
    requested_media_count: media.length,
    completed_media_count: media.filter((m) => m.execution_status === 'COMPLETED').length,
    execution_failed_count: media.filter((m) => m.execution_status === 'FAILED').length,
    skipped_dry_run_count: media.filter((m) => m.execution_status === 'SKIPPED_DRY_RUN').length,
    pending_count: media.filter((m) => m.execution_status === 'PENDING' || m.execution_status === 'RUNNING').length,
    pass_count: media.filter((m) => m.validation_result === 'PASS').length,
    review_count: media.filter((m) => m.validation_result === 'REVIEW').length,
    fail_count: media.filter((m) => m.validation_result === 'FAIL').length,
    recommendation_counts,
    review_reason_counts,
    duration_ms: durationMs,
    chunk_count: chunkArray(manifest.effective_media_ids, manifest.chunk_size).length,
    retry_count: retryCount,
    promotions_applied: 0,
    catalog_mutations: 0,
    dry_run: manifest.dry_run,
  };
  assertBatchCountInvariants(summary, media);
  return summary;
}

export function assertBatchCountInvariants(summary: BatchSummary, media: MediaBatchResult[]): void {
  if (summary.requested_media_count !== media.length) {
    throw new Error(
      `invariante batch: requested_media_count=${summary.requested_media_count} != media.length=${media.length}`,
    );
  }
  const validated = media.filter(
    (m) => m.validation_result === 'PASS' || m.validation_result === 'REVIEW' || m.validation_result === 'FAIL',
  );
  const resultSum = summary.pass_count + summary.review_count + summary.fail_count;
  if (resultSum !== validated.length) {
    throw new Error(`invariante batch: PASS+REVIEW+FAIL=${resultSum} != validated=${validated.length}`);
  }
  if (resultSum > summary.completed_media_count) {
    throw new Error(
      `invariante batch: PASS+REVIEW+FAIL=${resultSum} > completed_media_count=${summary.completed_media_count}`,
    );
  }
  const accounted =
    summary.completed_media_count +
    summary.execution_failed_count +
    summary.skipped_dry_run_count +
    summary.pending_count;
  if (accounted !== summary.requested_media_count) {
    throw new Error(
      `invariante batch: completed+failed+skipped+pending=${accounted} != requested=${summary.requested_media_count}`,
    );
  }
}

export function buildReviewQueue(media: MediaBatchResult[]): MediaBatchResult[] {
  return media.filter(
    (m) =>
      m.validation_result === 'REVIEW' ||
      m.validation_result === 'FAIL' ||
      m.execution_status === 'FAILED',
  );
}

function deriveOverallStatus(media: MediaBatchResult[], aborted: boolean): BatchOverallStatus {
  if (aborted) return 'ABORTED';
  const statuses = media.map((m) => m.execution_status);
  if (statuses.every((s) => s === 'SKIPPED_DRY_RUN')) return 'COMPLETED';
  if (statuses.every((s) => s === 'COMPLETED')) return 'COMPLETED';
  if (statuses.every((s) => s === 'FAILED')) return 'FAILED';
  if (statuses.some((s) => s === 'COMPLETED') && statuses.some((s) => s === 'FAILED' || s === 'PENDING' || s === 'RUNNING')) {
    return 'PARTIAL';
  }
  if (statuses.some((s) => s === 'PENDING' || s === 'RUNNING')) return 'PARTIAL';
  return 'FAILED';
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

function defaultRunId(nowIso: string): string {
  return `bvr-${nowIso.replace(/[^0-9A-Za-z]/g, '').slice(0, 20)}`;
}

function assertRunId(runId: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(runId)) {
    throw new BatchRunnerError(
      'INPUT_ERROR',
      `run_id inválido '${runId}' — solo [A-Za-z0-9._-] (evita path traversal)`,
    );
  }
}

function asErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function asBatchError(err: unknown, fallback: BatchErrorCode): BatchRunnerError {
  if (err instanceof BatchRunnerError) return err;
  return new BatchRunnerError(fallback, asErrorMessage(err));
}

function pendingWork(m: MediaBatchResult): boolean {
  return m.execution_status === 'PENDING' || m.execution_status === 'FAILED' || m.execution_status === 'RUNNING';
}

export async function runBatch(options: BatchRunnerOptions): Promise<BatchRunOutcome> {
  const nowIso = options.nowIso ?? (() => new Date().toISOString());
  const repoRoot = options.repoRoot ?? process.cwd();
  const pid = options.pid ?? process.pid;
  const dryRun = options.dryRun ?? true;
  const resume = options.resume ?? false;
  const maxRetries = options.maxRetries ?? 0;
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 1) {
    throw new BatchRunnerError('INPUT_ERROR', `max_retries debe ser 0 o 1 (recibido: ${maxRetries})`);
  }

  const mediaIds =
    options.mediaIds ??
    (options.mediaIdsRaw != null && options.mediaIdsRaw.length > 0
      ? parseMediaIds(options.mediaIdsRaw)
      : null);
  if (!mediaIds || mediaIds.length === 0) {
    throw new BatchRunnerError(
      'INPUT_ERROR',
      'Falta --media-ids — Batch Runner V1 no descubre el catálogo (FAIL FAST, evita mass crawl)',
    );
  }

  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const maxNotas = options.maxNotas ?? 5;
  const enrichLimit = options.enrichLimit ?? 20;
  const chunkSize = options.chunkSize ?? 5;
  for (const [name, value] of [
    ['window-days', windowDays],
    ['max-notas', maxNotas],
    ['enrich-limit', enrichLimit],
    ['chunk-size', chunkSize],
  ] as const) {
    if (!Number.isInteger(value) || value < 1) {
      throw new BatchRunnerError('INPUT_ERROR', `${name} debe ser un entero >= 1 (recibido: ${value})`);
    }
  }

  const profilePath = resolve(repoRoot, options.profilePath ?? OPERATIONAL_CALIBRATION_PROFILE_PATH);
  const profile = loadApprovedProfile(profilePath);

  const outputDir = resolve(repoRoot, options.outputDir ?? DEFAULT_OUTPUT_DIR);
  mkdirSync(outputDir, { recursive: true });

  let runId = options.runId ?? null;
  if (resume && !runId) {
    throw new BatchRunnerError('INPUT_ERROR', '--resume exige --run-id del manifest original');
  }
  if (!runId) runId = defaultRunId(nowIso());
  assertRunId(runId);

  const runDir = join(outputDir, runId);
  const manifestPath = join(runDir, 'manifest.json');
  const mediaPath = join(runDir, 'media-results.json');
  const lockPath = join(runDir, 'lock.json');
  mkdirSync(runDir, { recursive: true });

  let existingManifest: BatchManifest | null = null;
  if (existsSync(manifestPath)) {
    existingManifest = readJson<BatchManifest>(manifestPath);
  }

  if (existsSync(lockPath)) {
    const existingLock = readLockFile(lockPath);
    const classification = classifyLock(existingLock, options.pidAlive ?? isPidAlive);
    if (classification === 'ACTIVE') {
      throw new BatchRunnerError(
        'LOCK_ERROR',
        `run_id=${runId} ya tiene un proceso ACTIVE (pid=${existingLock.pid}, child_pid=${existingLock.child_pid ?? 'null'})`,
        { reason: 'DUPLICATE_RUN' },
      );
    }
    if (classification === 'STALE' && !resume) {
      throw new BatchRunnerError(
        'LOCK_ERROR',
        `STALE_LOCK_DETECTED run_id=${runId} pid=${existingLock.pid} child_pid=${existingLock.child_pid ?? 'null'} — usar --resume para takeover seguro (el lock NO se elimina)`,
        { reason: 'STALE_LOCK_DETECTED' },
      );
    }
  }

  if (resume) {
    if (!existingManifest) {
      throw new BatchRunnerError('INPUT_ERROR', `--resume: no existe manifest en ${manifestPath}`);
    }
    if (existingManifest.overall_status === 'COMPLETED') {
      throw new BatchRunnerError(
        'INPUT_ERROR',
        `run_id=${runId} ya está COMPLETED — no se reejecuta`,
        { reason: 'ALREADY_COMPLETED' },
      );
    }
  } else if (existingManifest) {
    throw new BatchRunnerError(
      'INPUT_ERROR',
      `run_id=${runId} ya tiene manifest (status=${existingManifest.overall_status}) — usar --resume o un run-id nuevo`,
    );
  }

  const windowAnchor =
    options.windowAnchor ??
    existingManifest?.window_anchor ??
    nowIso();

  if (resume && existingManifest) {
    const provided = {
      mediaIds,
      profileId: profile.calibration_id,
      profilePath,
      windowDays,
      windowAnchor,
      maxNotas,
      enrichLimit,
      chunkSize,
      dryRun,
    };
    const expected = paramsFingerprint({
      mediaIds: existingManifest.requested_media_ids,
      profileId: existingManifest.profile_id,
      profilePath: existingManifest.profile_path,
      windowDays: existingManifest.window_days,
      windowAnchor: existingManifest.window_anchor,
      maxNotas: existingManifest.max_notas,
      enrichLimit: existingManifest.enrich_limit,
      chunkSize: existingManifest.chunk_size,
      dryRun: existingManifest.dry_run,
    });
    const actual = paramsFingerprint(provided);
    if (expected !== actual) {
      throw new BatchRunnerError(
        'INPUT_ERROR',
        'PARAMETER_DRIFT: --resume exige el mismo scope/profile/window/max-notas/enrich-limit/chunk-size/dry-run que el manifest original',
        { reason: 'PARAMETER_DRIFT' },
      );
    }
  }

  const batchContextId = existingManifest?.context_id ?? `VAL-${runId}`;
  const chunks = chunkArray(mediaIds, chunkSize);
  const chunkContextIds = chunks.map((_, i) => batchChunkContextId(runId, i + 1));
  const contextByMedio = new Map<string, string>();
  chunks.forEach((ids, i) => {
    const ctx = chunkContextIds[i]!;
    for (const id of ids) contextByMedio.set(id, ctx);
  });
  const createdAt = existingManifest?.created_at ?? nowIso();
  const scopeHash = sha256(mediaIds.join(','));
  const fingerprint = paramsFingerprint({
    mediaIds,
    profileId: profile.calibration_id,
    profilePath,
    windowDays,
    windowAnchor,
    maxNotas,
    enrichLimit,
    chunkSize,
    dryRun,
  });

  const startedAt = nowIso();
  let manifest: BatchManifest = {
    schema_version: BATCH_MANIFEST_SCHEMA_VERSION,
    run_id: runId,
    context_id: batchContextId,
    created_at: createdAt,
    started_at: existingManifest?.started_at ?? startedAt,
    completed_at: null,
    profile_id: profile.calibration_id,
    profile_path: profilePath,
    profile_status: profile.status,
    policy_id: OPERATIONAL_CONTENT_SANITY_POLICY.policy_id,
    policy_status: OPERATIONAL_CONTENT_SANITY_POLICY.status,
    requested_media_ids: mediaIds,
    effective_media_ids: mediaIds,
    chunk_context_ids: chunkContextIds,
    window_days: windowDays,
    window_anchor: windowAnchor,
    max_notas: maxNotas,
    enrich_limit: enrichLimit,
    chunk_size: chunkSize,
    dry_run: dryRun,
    resume,
    max_retries: maxRetries,
    runner_version: BATCH_RUNNER_VERSION,
    git_sha: options.gitSha ?? readGitHead(repoRoot),
    params_fingerprint: fingerprint,
    scope_hash: scopeHash,
    promotion_mode: BATCH_RUNNER_PROMOTION_MODE,
    overall_status: 'RUNNING',
  };

  const acquired = acquireLock({
    lockPath,
    runId,
    scopeHash,
    resume,
    pid,
    nowIso: nowIso(),
    pidAlive: options.pidAlive,
  });
  const lock: BatchLock = acquired.lock;
  const events: ExecutionLogEvent[] = existsSync(join(runDir, 'execution-log.json'))
    ? readJson<ExecutionLogEvent[]>(join(runDir, 'execution-log.json'))
    : [];

  const log = (event: string, extra: Record<string, unknown> = {}): void => {
    events.push({ ts: nowIso(), event, ...extra });
    writeJson(join(runDir, 'execution-log.json'), events);
  };

  if (acquired.staleDetected) {
    log('STALE_LOCK_DETECTED', { previous_note: 'takeover via --resume; lock no se eliminó en silencio' });
  }
  log('LOCK_ACQUIRED', { pid, stale: acquired.staleDetected });

  let media: MediaBatchResult[] = mediaIds.map((id) =>
    emptyMediaResult(id, runId, contextByMedio.get(id) ?? batchChunkContextId(runId, 1), dryRun),
  );
  if (resume && existsSync(mediaPath)) {
    const prior = readJson<MediaBatchResult[]>(mediaPath);
    const byId = new Map(prior.map((m) => [m.medio_id, m]));
    media = mediaIds.map((id) => {
      const chunkCtx = contextByMedio.get(id) ?? batchChunkContextId(runId, 1);
      const prev = byId.get(id);
      if (!prev) return emptyMediaResult(id, runId, chunkCtx, dryRun);
      if (prev.execution_status === 'RUNNING') {
        return { ...prev, execution_status: 'PENDING', context_id: prev.context_id || chunkCtx };
      }
      return prev;
    });
  }

  let retryCount = 0;
  let aborted = false;
  const persist = (): void => {
    manifest.overall_status = deriveOverallStatus(media, aborted);
    writeJson(manifestPath, manifest);
    writeJson(mediaPath, media);
    const summary = buildBatchSummary(manifest, media, null, retryCount);
    writeJson(join(runDir, 'batch-summary.json'), summary);
    writeJson(join(runDir, 'review-queue.json'), buildReviewQueue(media));
  };

  persist();

  const guard: BatchChildGuard = {
    run: (spec) =>
      runGuardedChild(
        { lock, lockPath, nowIso, pidAlive: options.pidAlive },
        spec,
      ),
  };

  try {
    if (dryRun) {
      log('DRY_RUN_PLAN', { media_ids: mediaIds, chunk_size: chunkSize });
      for (const m of media) {
        if (m.execution_status === 'COMPLETED') continue;
        m.execution_status = 'SKIPPED_DRY_RUN';
        m.simulated = true;
        m.dry_run = true;
        m.validation_result = null;
        m.recommendation = null;
      }
      persist();
    } else {
      if (!options.adapters) {
        throw new BatchRunnerError(
          'INPUT_ERROR',
          'adapters operativos ausentes — el CLI live debe pasar createLiveBatchAdapters (los tests inyectan fakes)',
        );
      }
      const adapters = options.adapters;
      const byId = () => new Map(media.map((m) => [m.medio_id, m]));

      for (let i = 0; i < chunks.length; i++) {
        if (options.signal?.aborted) {
          aborted = true;
          log('ABORTED', { reason: 'signal' });
          break;
        }
        const chunk = chunks[i]!;
        const chunkIndex = i + 1;
        const records = chunk.map((id) => byId().get(id)!);
        if (records.every((m) => m.execution_status === 'COMPLETED')) {
          log('CHUNK_SKIP_COMPLETED', { chunk_index: chunkIndex, media_ids: chunk });
          continue;
        }
        const work = records.filter(pendingWork);
        if (work.length === 0) continue;

        const workIds = work.map((m) => m.medio_id);
        const chunkCtx = batchChunkContextId(runId, chunkIndex);
        for (const m of records) {
          m.context_id = chunkCtx;
          m.chunk_index = chunkIndex;
        }
        for (const m of work) {
          m.execution_status = 'RUNNING';
        }
        persist();
        log('CHUNK_START', { chunk_index: chunkIndex, media_ids: workIds, context_id: chunkCtx });

        const chunkDir = join(runDir, 'chunks', String(chunkIndex).padStart(3, '0'));
        mkdirSync(chunkDir, { recursive: true });

        try {
          const before = await adapters.snapshot({
            contextId: chunkCtx,
            role: 'BEFORE',
            mediaIds: chunk,
            windowDays,
            windowAnchor,
          });
          writeJson(join(chunkDir, 'before.json'), before);

          let captureResult: OwnedProcessResult | null = null;
          for (let attempt = 1; attempt <= 1 + maxRetries; attempt++) {
            assertNoLiveChild(lock, options.pidAlive);
            try {
              captureResult = await adapters.capture(
                { mediaIds: workIds, maxNotas, chunkIndex, chunkCount: chunks.length },
                guard,
              );
              for (const m of work) {
                m.attempts.push({
                  attempt,
                  error: captureResult.exitCode === 0 ? null : `capture exit=${captureResult.exitCode}`,
                  timestamp: nowIso(),
                  exit_code: captureResult.exitCode,
                });
              }
              if (captureResult.exitCode === 0) break;
              if (attempt <= maxRetries) retryCount += 1;
            } catch (err) {
              for (const m of work) {
                m.attempts.push({
                  attempt,
                  error: asErrorMessage(err),
                  timestamp: nowIso(),
                  exit_code: err instanceof BatchRunnerError ? err.exitCode : null,
                });
              }
              if (attempt > maxRetries) throw asBatchError(err, 'CAPTURE_ERROR');
              retryCount += 1;
            }
          }
          if (!captureResult || captureResult.exitCode !== 0) {
            throw new BatchRunnerError(
              'CAPTURE_ERROR',
              `capture exit=${captureResult?.exitCode ?? 'null'}`,
              { exitCode: captureResult?.exitCode ?? 1 },
            );
          }
          writeFileSync(join(chunkDir, 'capture.stdout.log'), captureResult.stdout, 'utf-8');
          writeFileSync(join(chunkDir, 'capture.stderr.log'), captureResult.stderr, 'utf-8');

          let enrichResult: OwnedProcessResult | null = null;
          for (let attempt = 1; attempt <= 1 + maxRetries; attempt++) {
            assertNoLiveChild(lock, options.pidAlive);
            try {
              enrichResult = await adapters.enrich(
                { mediaIds: workIds, enrichLimit, windowDays, chunkIndex, chunkCount: chunks.length },
                guard,
              );
              for (const m of work) {
                m.attempts.push({
                  attempt,
                  error: enrichResult.exitCode === 0 ? null : `enrich exit=${enrichResult.exitCode}`,
                  timestamp: nowIso(),
                  exit_code: enrichResult.exitCode,
                });
              }
              if (enrichResult.exitCode === 0) break;
              if (attempt <= maxRetries) retryCount += 1;
            } catch (err) {
              for (const m of work) {
                m.attempts.push({
                  attempt,
                  error: asErrorMessage(err),
                  timestamp: nowIso(),
                  exit_code: err instanceof BatchRunnerError ? err.exitCode : null,
                });
              }
              if (attempt > maxRetries) throw asBatchError(err, 'ENRICH_ERROR');
              retryCount += 1;
            }
          }
          if (!enrichResult || enrichResult.exitCode !== 0) {
            throw new BatchRunnerError(
              'ENRICH_ERROR',
              `enrich exit=${enrichResult?.exitCode ?? 'null'}`,
              { exitCode: enrichResult?.exitCode ?? 1 },
            );
          }
          writeFileSync(join(chunkDir, 'enrich.stdout.log'), enrichResult.stdout, 'utf-8');
          writeFileSync(join(chunkDir, 'enrich.stderr.log'), enrichResult.stderr, 'utf-8');

          const after = await adapters.snapshot({
            contextId: chunkCtx,
            role: 'AFTER',
            mediaIds: chunk,
            windowDays,
            windowAnchor,
          });
          writeJson(join(chunkDir, 'after.json'), after);

          const runLogText = [captureResult.stdout, captureResult.stderr, enrichResult.stdout, enrichResult.stderr]
            .filter((s) => s.length > 0)
            .join('\n');
          writeFileSync(join(chunkDir, 'run.log'), runLogText, 'utf-8');

          const evidence = await adapters.compose({
            runLogText,
            before,
            after,
            contextId: chunkCtx,
            mediaIds: chunk,
            runId,
            windowDays,
            windowAnchor,
            maxNotas,
            enrichLimit,
          });
          writeJson(join(chunkDir, 'evidence.json'), evidence);

          let reports;
          let metricsList;
          try {
            metricsList = computeQualityMetricsForRun(evidence);
            reports = evaluateRun(metricsList, profile);
          } catch (err) {
            throw new BatchRunnerError('VALIDATION_ERROR', asErrorMessage(err));
          }

          const reportById = new Map(reports.map((r) => [r.medio_id, r]));
          const recordById = new Map(evidence.media.map((r) => [r.medio_id, r]));
          const metricsById = new Map(metricsList.map((m) => [m.medio_id, m]));

          for (const m of work) {
            const ev = recordById.get(m.medio_id);
            const report = reportById.get(m.medio_id);
            m.artifact_refs = {
              before: join(chunkDir, 'before.json'),
              after: join(chunkDir, 'after.json'),
              evidence: join(chunkDir, 'evidence.json'),
            };
            if (!ev || !report) {
              m.execution_status = 'FAILED';
              m.error = {
                code: 'EVIDENCE_ERROR',
                message: `sin evidence/report para ${m.medio_id}`,
                exit_code: null,
              };
              m.validation_result = null;
              m.recommendation = null;
              persist();
              continue;
            }
            m.execution_status = 'COMPLETED';
            m.capture_status = ev.run_evidence.crawl.status;
            m.enrich_status = ev.run_evidence.enrich.presence;
            m.capture = {
              inserted: ev.run_evidence.crawl.inserted,
              duplicates: ev.run_evidence.crawl.duplicates,
              errors: ev.run_evidence.crawl.attempt_errors?.length ?? null,
            };
            m.enrich = {
              processed: ev.run_evidence.enrich.processed,
              updated: ev.run_evidence.enrich.updated,
              failed: ev.run_evidence.enrich.failed,
              dry_run: ev.run_evidence.enrich.dry_run,
            };
            m.run_evidence_completeness = ev.run_evidence.evidence_status;
            m.persistence_status = ev.persistence.status;
            const metricsFor = metricsById.get(m.medio_id);
            m.clean_ratio = metricsFor?.ratios.persisted_clean_text_ratio.value ?? null;
            m.body_ratio = metricsFor?.ratios.persisted_body_ratio.value ?? null;
            m.content_sanity_outcome = report.content_sanity.outcome;
            m.evaluation_status = report.evaluation_status;
            m.validation_result = report.validation_result;
            m.recommendation = report.recommendation;
            m.review_reasons = report.review_reasons;
            m.issues = report.issues;
            m.simulated = report.simulated;
            m.dry_run = report.dry_run === true || dryRun;
            m.error = null;
          }
          persist();
          log('CHUNK_COMPLETED', { chunk_index: chunkIndex, media_ids: workIds });
        } catch (err) {
          const wrapped = asBatchError(
            err,
            err instanceof BatchRunnerError ? err.code : 'PROCESS_ERROR',
          );
          log('CHUNK_FAILED', {
            chunk_index: chunkIndex,
            code: wrapped.code,
            message: wrapped.message,
            media_ids: workIds,
          });
          for (const m of work) {
            if (m.execution_status === 'COMPLETED') continue;
            m.execution_status = 'FAILED';
            m.validation_result = null;
            m.recommendation = null;
            m.error = { code: wrapped.code, message: wrapped.message, exit_code: wrapped.exitCode };
          }
          persist();
        }
      }
    }

    aborted = aborted || Boolean(options.signal?.aborted);
    manifest.completed_at = nowIso();
    manifest.overall_status = deriveOverallStatus(media, aborted);
    const durationMs = Date.parse(manifest.completed_at) - Date.parse(manifest.started_at ?? manifest.created_at);
    const summary = buildBatchSummary(manifest, media, Number.isFinite(durationMs) ? durationMs : null, retryCount);
    writeJson(manifestPath, manifest);
    writeJson(mediaPath, media);
    writeJson(join(runDir, 'batch-summary.json'), summary);
    const reviewQueue = buildReviewQueue(media);
    writeJson(join(runDir, 'review-queue.json'), reviewQueue);
    log('RUN_FINISHED', { overall_status: manifest.overall_status });
    return {
      manifest,
      summary,
      media,
      reviewQueue,
      runDir,
      staleLockDetected: acquired.staleDetected,
    };
  } finally {
    releaseLock(lockPath, pid);
  }
}

export function optionsFromCliArgs(args: BatchCliArgs, extras: Partial<BatchRunnerOptions> = {}): BatchRunnerOptions {
  return {
    mediaIdsRaw: args.mediaIdsRaw,
    profilePath: args.profile,
    windowDays: args.windowDays,
    windowAnchor: args.windowAnchor,
    maxNotas: args.maxNotas,
    enrichLimit: args.enrichLimit,
    chunkSize: args.chunkSize,
    dryRun: args.dryRun,
    runId: args.runId,
    outputDir: args.outputDir,
    resume: args.resume,
    maxRetries: args.maxRetries,
    ...extras,
  };
}

/** Solo para el CLI live: resuelve adapters reales. Los tests NUNCA deben llamarlo. */
export function liveCliExtras(repoRoot: string): Pick<BatchRunnerOptions, 'adapters' | 'repoRoot'> {
  return { repoRoot, adapters: createLiveBatchAdapters(repoRoot) };
}

export function thisRepoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../..');
}
