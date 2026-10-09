import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { sourceJobKey } from './catalog.js';
import { emptySourceState } from './checkpoint.js';
import type {
  GapCandidate,
  ReconcileRun,
  RecoveryObservation,
  RecoveryRecord,
  RecoveryStatus,
  SourceReconcileState,
} from './types.js';

const CLAIMABLE: RecoveryStatus[] = ['QUEUED', 'RETRY', 'FETCH_TO_CLASSIFY'];

export interface CaptureReliabilityStore {
  upsertDiscovered(rec: RecoveryRecord): Promise<RecoveryRecord>;
  claimBatch(opts: { workerId: string; limit: number; nowIso: string; skipHashes?: Set<string>; onlyHashes?: Set<string> }): Promise<RecoveryRecord[]>;
  markFetching(hashUrl: string, workerId: string, nowIso: string): Promise<RecoveryRecord | null>;
  markPersisted(hashUrl: string, noticiaId: string | null, nowIso: string): Promise<RecoveryRecord | null>;
  markKnown(hashUrl: string, noticiaId?: string | null): Promise<RecoveryRecord | null>;
  markRetry(hashUrl: string, nextRetryAt: string, error: string, attempts: number): Promise<RecoveryRecord | null>;
  markBlocked(hashUrl: string, error: string): Promise<RecoveryRecord | null>;
  markRejected(hashUrl: string, reason: string): Promise<RecoveryRecord | null>;
  markFailed(hashUrl: string, error: string): Promise<RecoveryRecord | null>;
  markWouldPersist(hashUrl: string): Promise<RecoveryRecord | null>;
  markStatus(hashUrl: string, status: RecoveryStatus, patch?: Partial<RecoveryRecord>): Promise<RecoveryRecord | null>;
  releaseStaleClaims(staleBeforeIso: string): Promise<number>;
  get(hashUrl: string): Promise<RecoveryRecord | null>;
  snapshot(): Promise<RecoveryRecord[]>;
  listRecoveryPage(opts: { offset: number; pageSize: number }): Promise<RecoveryRecord[]>;
  countRecovery(): Promise<number>;
  byStatus(status: RecoveryStatus): Promise<RecoveryRecord[]>;
  upsertSourceState(state: SourceReconcileState): Promise<SourceReconcileState>;
  getSourceState(medioId: string, windowStart: string, windowEnd: string): Promise<SourceReconcileState | null>;
  listSourceStates(windowStart: string, windowEnd: string): Promise<SourceReconcileState[]>;
  upsertRun(run: ReconcileRun): Promise<ReconcileRun>;
  getRun(runId: string): Promise<ReconcileRun | null>;
  addGapCandidates(rows: GapCandidate[]): Promise<void>;
  listGapCandidates(): Promise<GapCandidate[]>;
  recordObservation(obs: RecoveryObservation): Promise<void>;
  listObservations(windowStart: string, windowEnd: string): Promise<RecoveryObservation[]>;
  claimGapCandidates(opts: { workerId: string; limit: number; nowIso: string }): Promise<GapCandidate[]>;
  markGapConsumed(candidateId: string, nowIso: string): Promise<void>;
  releaseStaleGapClaims(staleBeforeIso: string): Promise<number>;
  claimSourceBatch(opts: {
    workerId: string;
    windowStart: string;
    windowEnd: string;
    medioIds: string[];
    limit: number;
    nowIso: string;
    staleBeforeIso: string;
    resumeIncomplete?: boolean;
  }): Promise<SourceReconcileState[]>;
  persist?(): void;
}

function mergeDiscovered(prev: RecoveryRecord | undefined, rec: RecoveryRecord): RecoveryRecord {
  if (!prev) return rec;
  const via = prev.discovered_via.includes(rec.discovered_via)
    ? prev.discovered_via
    : `${prev.discovered_via}+${rec.discovered_via}`;
  return {
    ...prev,
    ...rec,
    discovered_via: via,
    first_discovered_at: prev.first_discovered_at,
    last_discovered_at: rec.last_discovered_at,
    attempt_count: Math.max(prev.attempt_count, rec.attempt_count),
    status: prev.status === 'PERSISTED' || prev.status === 'KNOWN_IN_LAKE' ? prev.status : rec.status,
    noticia_id: rec.noticia_id ?? prev.noticia_id,
    claimed_at: rec.claimed_at ?? prev.claimed_at,
    claimed_by: rec.claimed_by ?? prev.claimed_by,
  };
}

export class MemoryCaptureReliabilityStore implements CaptureReliabilityStore {
  readonly queue = new Map<string, RecoveryRecord>();
  readonly sourceState = new Map<string, SourceReconcileState>();
  readonly runs = new Map<string, ReconcileRun>();
  gapCandidates: GapCandidate[] = [];
  readonly observations: RecoveryObservation[] = [];
  private claimTail: Promise<unknown> = Promise.resolve();

  async upsertDiscovered(rec: RecoveryRecord): Promise<RecoveryRecord> {
    const merged = mergeDiscovered(this.queue.get(rec.hash_url), rec);
    this.queue.set(rec.hash_url, merged);
    return merged;
  }

  async get(hashUrl: string): Promise<RecoveryRecord | null> {
    return this.queue.get(hashUrl) ?? null;
  }

  async snapshot(): Promise<RecoveryRecord[]> {
    return [...this.queue.values()];
  }

  async listRecoveryPage(opts: { offset: number; pageSize: number }): Promise<RecoveryRecord[]> {
    return [...this.queue.values()].slice(opts.offset, opts.offset + opts.pageSize);
  }

  async countRecovery(): Promise<number> {
    return this.queue.size;
  }

  async byStatus(status: RecoveryStatus): Promise<RecoveryRecord[]> {
    return [...this.queue.values()].filter((r) => r.status === status);
  }

  async claimBatch(opts: { workerId: string; limit: number; nowIso: string; skipHashes?: Set<string>; onlyHashes?: Set<string> }): Promise<RecoveryRecord[]> {
    const run = this.claimTail.then(() => this.claimBatchUnlocked(opts));
    this.claimTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async claimBatchUnlocked(opts: { workerId: string; limit: number; nowIso: string; skipHashes?: Set<string>; onlyHashes?: Set<string> }): Promise<RecoveryRecord[]> {
    if (opts.onlyHashes !== undefined && opts.onlyHashes.size === 0) return [];
    const now = Date.parse(opts.nowIso);
    const out: RecoveryRecord[] = [];
    for (const rec of this.queue.values()) {
      if (out.length >= opts.limit) break;
      if (opts.onlyHashes !== undefined && !opts.onlyHashes.has(rec.hash_url)) continue;
      if (opts.skipHashes?.has(rec.hash_url)) continue;
      if (!CLAIMABLE.includes(rec.status)) continue;
      if (rec.claimed_at) continue;
      if (rec.next_retry_at && Date.parse(rec.next_retry_at) > now) continue;
      const claimed: RecoveryRecord = {
        ...rec,
        status: 'FETCHING',
        claimed_at: opts.nowIso,
        claimed_by: opts.workerId,
      };
      this.queue.set(rec.hash_url, claimed);
      out.push(claimed);
    }
    return out;
  }

  private patch(hashUrl: string, fn: (r: RecoveryRecord) => RecoveryRecord): RecoveryRecord | null {
    const prev = this.queue.get(hashUrl);
    if (!prev) return null;
    const next = fn(prev);
    this.queue.set(hashUrl, next);
    return next;
  }

  async markFetching(hashUrl: string, workerId: string, nowIso: string): Promise<RecoveryRecord | null> {
    return this.patch(hashUrl, (r) => ({ ...r, status: 'FETCHING', claimed_at: nowIso, claimed_by: workerId }));
  }

  async markPersisted(hashUrl: string, noticiaId: string | null, nowIso: string): Promise<RecoveryRecord | null> {
    return this.patch(hashUrl, (r) => ({
      ...r,
      status: 'PERSISTED',
      noticia_id: noticiaId,
      claimed_at: null,
      claimed_by: null,
      last_discovered_at: nowIso,
    }));
  }

  async markWouldPersist(hashUrl: string): Promise<RecoveryRecord | null> {
    return this.patch(hashUrl, (r) => ({ ...r, status: 'WOULD_PERSIST', claimed_at: null, claimed_by: null }));
  }

  async markKnown(hashUrl: string, noticiaId?: string | null): Promise<RecoveryRecord | null> {
    return this.patch(hashUrl, (r) => ({
      ...r,
      status: 'KNOWN_IN_LAKE',
      noticia_id: noticiaId ?? r.noticia_id,
      claimed_at: null,
      claimed_by: null,
    }));
  }

  async markRetry(hashUrl: string, nextRetryAt: string, error: string, attempts: number): Promise<RecoveryRecord | null> {
    return this.patch(hashUrl, (r) => ({
      ...r,
      status: 'RETRY',
      next_retry_at: nextRetryAt,
      last_error: error,
      attempt_count: attempts,
      claimed_at: null,
      claimed_by: null,
    }));
  }

  async markBlocked(hashUrl: string, error: string): Promise<RecoveryRecord | null> {
    return this.patch(hashUrl, (r) => ({
      ...r,
      status: 'BLOCKED',
      last_error: error,
      claimed_at: null,
      claimed_by: null,
    }));
  }

  async markRejected(hashUrl: string, reason: string): Promise<RecoveryRecord | null> {
    return this.patch(hashUrl, (r) => ({
      ...r,
      status: 'REJECTED_NON_ARTICLE',
      last_error: reason,
      claimed_at: null,
      claimed_by: null,
    }));
  }

  async markFailed(hashUrl: string, error: string): Promise<RecoveryRecord | null> {
    return this.patch(hashUrl, (r) => ({
      ...r,
      status: 'FAILED_RETRY_EXHAUSTED',
      last_error: error,
      claimed_at: null,
      claimed_by: null,
    }));
  }

  async markStatus(hashUrl: string, status: RecoveryStatus, patch?: Partial<RecoveryRecord>): Promise<RecoveryRecord | null> {
    return this.patch(hashUrl, (r) => ({ ...r, ...patch, status }));
  }

  async releaseStaleClaims(staleBeforeIso: string): Promise<number> {
    const cut = Date.parse(staleBeforeIso);
    let n = 0;
    for (const rec of [...this.queue.values()]) {
      if (!rec.claimed_at) continue;
      if (Date.parse(rec.claimed_at) > cut) continue;
      if (rec.status !== 'FETCHING' && rec.status !== 'FETCHED' && rec.status !== 'EXTRACTED') continue;
      this.queue.set(rec.hash_url, {
        ...rec,
        status: 'QUEUED',
        claimed_at: null,
        claimed_by: null,
        last_error: rec.last_error ?? 'stale_claim_released',
      });
      n += 1;
    }
    return n;
  }

  async upsertSourceState(state: SourceReconcileState): Promise<SourceReconcileState> {
    const k = sourceJobKey(state.medio_id, state.window_start, state.window_end);
    this.sourceState.set(k, state);
    return state;
  }

  async getSourceState(medioId: string, windowStart: string, windowEnd: string): Promise<SourceReconcileState | null> {
    return this.sourceState.get(sourceJobKey(medioId, windowStart, windowEnd)) ?? null;
  }

  async listSourceStates(windowStart: string, windowEnd: string): Promise<SourceReconcileState[]> {
    return [...this.sourceState.values()].filter((s) => s.window_start === windowStart && s.window_end === windowEnd);
  }

  async upsertRun(run: ReconcileRun): Promise<ReconcileRun> {
    this.runs.set(run.run_id, run);
    return run;
  }

  async getRun(runId: string): Promise<ReconcileRun | null> {
    return this.runs.get(runId) ?? null;
  }

  async addGapCandidates(rows: GapCandidate[]): Promise<void> {
    for (const row of rows) {
      if ((row.discovery_status ?? '').trim() === 'ALREADY_IN_LAKE') continue;
      const idx = this.gapCandidates.findIndex((g) => g.candidate_id === row.candidate_id);
      if (idx >= 0) this.gapCandidates[idx] = { ...this.gapCandidates[idx], ...row };
      else this.gapCandidates.push(row);
    }
  }

  async listGapCandidates(): Promise<GapCandidate[]> {
    return [...this.gapCandidates];
  }

  async recordObservation(obs: RecoveryObservation): Promise<void> {
    const idx = this.observations.findIndex(
      (o) => o.run_id === obs.run_id && o.hash_url === obs.hash_url && o.window_start === obs.window_start,
    );
    if (idx >= 0) this.observations[idx] = obs;
    else this.observations.push(obs);
  }

  async listObservations(windowStart: string, windowEnd: string): Promise<RecoveryObservation[]> {
    return this.observations.filter((o) => o.window_start === windowStart && o.window_end === windowEnd);
  }

  async claimGapCandidates(opts: { workerId: string; limit: number; nowIso: string }): Promise<GapCandidate[]> {
    const out: GapCandidate[] = [];
    for (const g of this.gapCandidates) {
      if (out.length >= opts.limit) break;
      if (g.consumed_at || g.claimed_at) continue;
      if ((g.discovery_status ?? 'MISSING_KNOWN_SOURCE').trim() !== 'MISSING_KNOWN_SOURCE') continue;
      g.claimed_at = opts.nowIso;
      g.claimed_by = opts.workerId;
      out.push({ ...g });
    }
    return out;
  }

  async markGapConsumed(candidateId: string, nowIso: string): Promise<void> {
    const g = this.gapCandidates.find((c) => c.candidate_id === candidateId);
    if (g) g.consumed_at = nowIso;
  }

  async releaseStaleGapClaims(staleBeforeIso: string): Promise<number> {
    const cut = Date.parse(staleBeforeIso);
    let n = 0;
    for (const g of this.gapCandidates) {
      if (!g.claimed_at || g.consumed_at) continue;
      if (Date.parse(g.claimed_at) > cut) continue;
      g.claimed_at = null;
      g.claimed_by = null;
      n += 1;
    }
    return n;
  }

  async claimSourceBatch(opts: {
    workerId: string;
    windowStart: string;
    windowEnd: string;
    medioIds: string[];
    limit: number;
    nowIso: string;
    staleBeforeIso: string;
    resumeIncomplete?: boolean;
  }): Promise<SourceReconcileState[]> {
    const run = this.claimTail.then(() => this.claimSourceUnlocked(opts));
    this.claimTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async claimSourceUnlocked(opts: {
    workerId: string;
    windowStart: string;
    windowEnd: string;
    medioIds: string[];
    limit: number;
    nowIso: string;
    staleBeforeIso: string;
    resumeIncomplete?: boolean;
  }): Promise<SourceReconcileState[]> {
    const staleCut = Date.parse(opts.staleBeforeIso);
    const out: SourceReconcileState[] = [];
    for (const medioId of opts.medioIds) {
      if (out.length >= opts.limit) break;
      const key = sourceJobKey(medioId, opts.windowStart, opts.windowEnd);
      const prev =
        this.sourceState.get(key) ??
        emptySourceState({ medioId, windowStart: opts.windowStart, windowEnd: opts.windowEnd });
      const owned = prev.worker_id === opts.workerId && prev.status === 'IN_PROGRESS';
      const stale = prev.status === 'IN_PROGRESS' && prev.started_at != null && Date.parse(prev.started_at) <= staleCut;
      const free = prev.status === 'PENDING';
      const resume = opts.resumeIncomplete === true && prev.status === 'INCOMPLETE';
      if (!owned && !stale && !free && !resume) continue;
      const next: SourceReconcileState = {
        ...prev,
        status: 'IN_PROGRESS',
        worker_id: opts.workerId,
        started_at: owned ? prev.started_at : opts.nowIso,
      };
      this.sourceState.set(key, next);
      out.push(next);
    }
    return out;
  }
}

interface JsonDump {
  queue: RecoveryRecord[];
  sourceState: SourceReconcileState[];
  runs: ReconcileRun[];
  gapCandidates: GapCandidate[];
  observations?: RecoveryObservation[];
}

export class JsonCaptureReliabilityStore extends MemoryCaptureReliabilityStore {
  constructor(private readonly filePath: string) {
    super();
    this.load();
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as JsonDump;
    for (const r of raw.queue ?? []) this.queue.set(r.hash_url, r);
    for (const s of raw.sourceState ?? []) {
      this.sourceState.set(sourceJobKey(s.medio_id, s.window_start, s.window_end), s);
    }
    for (const run of raw.runs ?? []) this.runs.set(run.run_id, run);
    this.gapCandidates = raw.gapCandidates ?? [];
    for (const obs of raw.observations ?? []) this.observations.push(obs);
  }

  persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const dump: JsonDump = {
      queue: [...this.queue.values()],
      sourceState: [...this.sourceState.values()],
      runs: [...this.runs.values()],
      gapCandidates: this.gapCandidates,
      observations: this.observations,
    };
    writeFileSync(this.filePath, JSON.stringify(dump, null, 2));
  }

  override async upsertDiscovered(rec: RecoveryRecord): Promise<RecoveryRecord> {
    const out = await super.upsertDiscovered(rec);
    this.persist();
    return out;
  }

  override async claimBatch(opts: { workerId: string; limit: number; nowIso: string; skipHashes?: Set<string>; onlyHashes?: Set<string> }): Promise<RecoveryRecord[]> {
    const out = await super.claimBatch(opts);
    this.persist();
    return out;
  }

  override async releaseStaleClaims(staleBeforeIso: string): Promise<number> {
    const n = await super.releaseStaleClaims(staleBeforeIso);
    this.persist();
    return n;
  }

  override async upsertSourceState(state: SourceReconcileState): Promise<SourceReconcileState> {
    const out = await super.upsertSourceState(state);
    this.persist();
    return out;
  }

  override async markFetching(hashUrl: string, workerId: string, nowIso: string) {
    const out = await super.markFetching(hashUrl, workerId, nowIso);
    this.persist();
    return out;
  }

  override async markWouldPersist(hashUrl: string) {
    const out = await super.markWouldPersist(hashUrl);
    this.persist();
    return out;
  }

  override async markPersisted(hashUrl: string, noticiaId: string | null, nowIso: string) {
    const out = await super.markPersisted(hashUrl, noticiaId, nowIso);
    this.persist();
    return out;
  }

  override async markRetry(hashUrl: string, nextRetryAt: string, error: string, attempts: number) {
    const out = await super.markRetry(hashUrl, nextRetryAt, error, attempts);
    this.persist();
    return out;
  }

  override async markBlocked(hashUrl: string, error: string) {
    const out = await super.markBlocked(hashUrl, error);
    this.persist();
    return out;
  }

  override async markFailed(hashUrl: string, error: string) {
    const out = await super.markFailed(hashUrl, error);
    this.persist();
    return out;
  }

  override async markStatus(hashUrl: string, status: RecoveryStatus, patch?: Partial<RecoveryRecord>) {
    const out = await super.markStatus(hashUrl, status, patch);
    this.persist();
    return out;
  }

  override async recordObservation(obs: RecoveryObservation): Promise<void> {
    await super.recordObservation(obs);
    this.persist();
  }

  override async claimSourceBatch(opts: {
    workerId: string;
    windowStart: string;
    windowEnd: string;
    medioIds: string[];
    limit: number;
    nowIso: string;
    staleBeforeIso: string;
  }): Promise<SourceReconcileState[]> {
    const out = await super.claimSourceBatch(opts);
    this.persist();
    return out;
  }

  override async markGapConsumed(candidateId: string, nowIso: string): Promise<void> {
    await super.markGapConsumed(candidateId, nowIso);
    this.persist();
  }
}

export type CaptureRecoveryRepository = CaptureReliabilityStore;

export function createMemoryCaptureRecoveryRepository(): CaptureRecoveryRepository {
  return new MemoryCaptureReliabilityStore();
}

export function createJsonCaptureRecoveryRepository(path: string): CaptureRecoveryRepository {
  return new JsonCaptureReliabilityStore(path);
}
