/**
 * Batch Validation Runner V1 — lock / lease / process ownership.
 *
 * BATCH-RUNNER-GUARD-001: un run_id no puede tener dos procesos ACTIVE.
 * Distingue ACTIVE (PID padre o child vivo) vs STALE (ningún PID vivo).
 * Nunca mata procesos. Nunca borra un lock stale en silencio.
 *
 * Cross-platform (Windows/Node): `process.kill(pid, 0)` — sin flock/bash.
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';

export const BATCH_LOCK_SCHEMA_VERSION = 1;

export type BatchLockStatus = 'ACTIVE';

export interface BatchLock {
  schema_version: typeof BATCH_LOCK_SCHEMA_VERSION;
  run_id: string;
  pid: number;
  child_pid: number | null;
  created_at: string;
  updated_at: string;
  scope_hash: string;
  status: BatchLockStatus;
}

export type LockClassification = 'NONE' | 'ACTIVE' | 'STALE';

export class BatchRunnerError extends Error {
  readonly code: BatchErrorCode;
  readonly reason: string | null;
  readonly exitCode: number | null;

  constructor(
    code: BatchErrorCode,
    message: string,
    extras: { reason?: string | null; exitCode?: number | null } = {},
  ) {
    super(message);
    this.name = 'BatchRunnerError';
    this.code = code;
    this.reason = extras.reason ?? null;
    this.exitCode = extras.exitCode ?? null;
  }
}

export type BatchErrorCode =
  | 'INPUT_ERROR'
  | 'LOCK_ERROR'
  | 'CAPTURE_ERROR'
  | 'ENRICH_ERROR'
  | 'SNAPSHOT_ERROR'
  | 'EVIDENCE_ERROR'
  | 'VALIDATION_ERROR'
  | 'PROCESS_ERROR';

/** PID vivo: signal 0. EPERM ⇒ existe pero no hay permiso. ESRCH ⇒ no existe. */
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EPERM') return true;
    return false;
  }
}

export function classifyLock(lock: BatchLock | null, pidAlive: (pid: number) => boolean = isPidAlive): LockClassification {
  if (!lock) return 'NONE';
  if (pidAlive(lock.pid)) return 'ACTIVE';
  if (lock.child_pid != null && pidAlive(lock.child_pid)) return 'ACTIVE';
  return 'STALE';
}

export function readLockFile(lockPath: string): BatchLock {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(lockPath, 'utf-8'));
  } catch (err) {
    throw new BatchRunnerError(
      'LOCK_ERROR',
      `lock ilegible en ${lockPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!raw || typeof raw !== 'object') {
    throw new BatchRunnerError('LOCK_ERROR', `lock con forma inválida en ${lockPath}`);
  }
  const rec = raw as Record<string, unknown>;
  if (rec.schema_version !== BATCH_LOCK_SCHEMA_VERSION) {
    throw new BatchRunnerError('LOCK_ERROR', `lock schema_version incompatible en ${lockPath}`);
  }
  if (typeof rec.run_id !== 'string' || typeof rec.pid !== 'number') {
    throw new BatchRunnerError('LOCK_ERROR', `lock incompleto en ${lockPath}`);
  }
  return rec as unknown as BatchLock;
}

export interface AcquireLockInput {
  lockPath: string;
  runId: string;
  scopeHash: string;
  resume: boolean;
  pid: number;
  nowIso: string;
  pidAlive?: (pid: number) => boolean;
}

export interface AcquireLockResult {
  lock: BatchLock;
  staleDetected: boolean;
}

function serializeLock(lock: BatchLock): string {
  return `${JSON.stringify(lock, null, 2)}\n`;
}

export function writeLockFile(lockPath: string, lock: BatchLock): void {
  writeFileSync(lockPath, serializeLock(lock), 'utf-8');
}

/**
 * Adquiere el lease. Si el lock existente está ACTIVE → ABORT (duplicate / live child).
 * Si está STALE: NO se borra en silencio. Sin `--resume` → ABORT STALE_LOCK_DETECTED.
 * Con `--resume` → se reescribe con el PID actual (takeover documentado).
 */
export function acquireLock(input: AcquireLockInput): AcquireLockResult {
  const pidAlive = input.pidAlive ?? isPidAlive;
  const fresh = (createdAt: string): BatchLock => ({
    schema_version: BATCH_LOCK_SCHEMA_VERSION,
    run_id: input.runId,
    pid: input.pid,
    child_pid: null,
    created_at: createdAt,
    updated_at: input.nowIso,
    scope_hash: input.scopeHash,
    status: 'ACTIVE',
  });

  if (!existsSync(input.lockPath)) {
    const lock = fresh(input.nowIso);
    try {
      writeFileSync(input.lockPath, serializeLock(lock), { encoding: 'utf-8', flag: 'wx' });
      return { lock, staleDetected: false };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') {
        throw new BatchRunnerError(
          'LOCK_ERROR',
          `no se pudo crear lock: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  const existing = readLockFile(input.lockPath);
  if (existing.run_id !== input.runId) {
    throw new BatchRunnerError(
      'LOCK_ERROR',
      `lock.run_id=${existing.run_id} no coincide con run_id=${input.runId}`,
    );
  }
  const classification = classifyLock(existing, pidAlive);
  if (classification === 'ACTIVE') {
    throw new BatchRunnerError(
      'LOCK_ERROR',
      `run_id=${input.runId} ya tiene un proceso ACTIVE (pid=${existing.pid}, child_pid=${existing.child_pid ?? 'null'})`,
      { reason: 'DUPLICATE_RUN' },
    );
  }

  // STALE — no unlink silencioso.
  if (!input.resume) {
    throw new BatchRunnerError(
      'LOCK_ERROR',
      `STALE_LOCK_DETECTED run_id=${input.runId} pid=${existing.pid} child_pid=${existing.child_pid ?? 'null'} — usar --resume para takeover seguro (el lock NO se elimina)`,
      { reason: 'STALE_LOCK_DETECTED' },
    );
  }

  const lock = fresh(existing.created_at);
  writeLockFile(input.lockPath, lock);
  return { lock, staleDetected: true };
}

export function releaseLock(lockPath: string, expectedPid: number): void {
  if (!existsSync(lockPath)) return;
  try {
    const current = readLockFile(lockPath);
    if (current.pid !== expectedPid) return;
  } catch {
    return;
  }
  try {
    unlinkSync(lockPath);
  } catch {
    // best-effort: el artifact de run permanece; el lock es el lease.
  }
}

export function assertNoLiveChild(lock: BatchLock, pidAlive: (pid: number) => boolean = isPidAlive): void {
  if (lock.child_pid != null && pidAlive(lock.child_pid)) {
    throw new BatchRunnerError(
      'PROCESS_ERROR',
      `child pid ${lock.child_pid} sigue vivo — no se inicia un segundo child ni un retry`,
      { reason: 'LIVE_CHILD' },
    );
  }
}

export interface SpawnOwnedSpec {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Tope de captura por stream (bytes de string). Default 256 KiB. */
  maxOutputChars?: number;
  onSpawn?: (pid: number) => void;
}

export interface OwnedProcessResult {
  pid: number;
  exitCode: number;
  stdout: string;
  stderr: string;
}

function appendCapped(current: string, chunk: string, max: number): string {
  const next = current + chunk;
  if (next.length <= max) return next;
  return next.slice(next.length - max);
}

/**
 * spawn(command, args, { shell: false }) — espera close real, captura exit/stdio.
 * NO fire-and-forget. NO construye un string de shell.
 */
export function spawnOwned(spec: SpawnOwnedSpec): Promise<OwnedProcessResult> {
  const max = spec.maxOutputChars ?? 256 * 1024;
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(spec.command, spec.args, {
        shell: false,
        cwd: spec.cwd,
        env: spec.env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      reject(
        new BatchRunnerError(
          'PROCESS_ERROR',
          `spawn falló: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
      return;
    }

    const pid = child.pid;
    if (pid == null) {
      reject(new BatchRunnerError('PROCESS_ERROR', 'spawn no asignó PID'));
      return;
    }
    spec.onSpawn?.(pid);

    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf-8');
    child.stderr?.setEncoding('utf-8');
    child.stdout?.on('data', (chunk: string) => {
      stdout = appendCapped(stdout, chunk, max);
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr = appendCapped(stderr, chunk, max);
    });
    child.on('error', (err) => {
      reject(
        new BatchRunnerError(
          'PROCESS_ERROR',
          `child error: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    });
    child.on('close', (code) => {
      resolve({ pid, exitCode: code ?? 1, stdout, stderr });
    });
  });
}

export interface GuardedChildContext {
  lock: BatchLock;
  lockPath: string;
  nowIso: () => string;
  pidAlive?: (pid: number) => boolean;
}

/**
 * Ejecuta un child bajo ownership del lock. Rechaza si ya hay child vivo.
 * Marca complete solo tras `close`. Limpia `child_pid` al terminar.
 */
export async function runGuardedChild(
  ctx: GuardedChildContext,
  spec: SpawnOwnedSpec,
): Promise<OwnedProcessResult> {
  const pidAlive = ctx.pidAlive ?? isPidAlive;
  assertNoLiveChild(ctx.lock, pidAlive);
  const result = await spawnOwned({
    ...spec,
    onSpawn: (pid) => {
      ctx.lock.child_pid = pid;
      ctx.lock.updated_at = ctx.nowIso();
      writeLockFile(ctx.lockPath, ctx.lock);
      spec.onSpawn?.(pid);
    },
  });
  ctx.lock.child_pid = null;
  ctx.lock.updated_at = ctx.nowIso();
  writeLockFile(ctx.lockPath, ctx.lock);
  return result;
}
