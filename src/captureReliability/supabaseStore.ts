import type { SupabaseClient } from '@supabase/supabase-js';
import type { CaptureReliabilityStore } from './captureRecoveryRepository.js';
import { emptySourceState } from './checkpoint.js';
import { buildClaimBatchRpcArgs } from './writesGuard.js';
import type { GapCandidate, ReconcileRun, RecoveryRecord, RecoveryStatus, SourceReconcileState } from './types.js';

function recFromRow(r: Record<string, unknown>): RecoveryRecord {
  return {
    canonical_url: String(r.canonical_url),
    discovered_url: String(r.discovered_url),
    hash_url: String(r.hash_url),
    medio_id: (r.medio_id as string | null) ?? null,
    fuente_id: (r.fuente_id as string | null) ?? null,
    hostname: (r.hostname as string | null) ?? null,
    discovered_via: String(r.discovered_via ?? ''),
    first_discovered_at: String(r.first_discovered_at),
    last_discovered_at: String(r.last_discovered_at),
    attempt_count: Number(r.attempt_count ?? 0),
    status: r.status as RecoveryStatus,
    root_cause: (r.root_cause as RecoveryRecord['root_cause']) ?? null,
    last_error: (r.last_error as string | null) ?? null,
    claimed_at: (r.claimed_at as string | null) ?? null,
    claimed_by: (r.claimed_by as string | null) ?? null,
    next_retry_at: (r.next_retry_at as string | null) ?? null,
    noticia_id: (r.noticia_id as string | null) ?? null,
    published_at: (r.published_at as string | null) ?? null,
    discovered_title: (r.discovered_title as string | null) ?? null,
    discovered_summary: (r.discovered_summary as string | null) ?? null,
    last_dry_run_result: (r.last_dry_run_result as string | null) ?? null,
    window_membership: (r.window_membership as RecoveryRecord['window_membership']) ?? null,
  };
}

function recToRow(rec: RecoveryRecord): Record<string, unknown> {
  return {
    hash_url: rec.hash_url,
    canonical_url: rec.canonical_url,
    discovered_url: rec.discovered_url,
    medio_id: rec.medio_id,
    fuente_id: rec.fuente_id,
    hostname: rec.hostname,
    discovered_via: rec.discovered_via,
    first_discovered_at: rec.first_discovered_at,
    last_discovered_at: rec.last_discovered_at,
    attempt_count: rec.attempt_count,
    status: rec.status,
    root_cause: rec.root_cause,
    last_error: rec.last_error,
    claimed_at: rec.claimed_at,
    claimed_by: rec.claimed_by,
    next_retry_at: rec.next_retry_at,
    noticia_id: rec.noticia_id,
    published_at: rec.published_at,
    discovered_title: rec.discovered_title,
    discovered_summary: rec.discovered_summary,
    last_dry_run_result: rec.last_dry_run_result,
    window_membership: rec.window_membership ?? null,
    updated_at: new Date().toISOString(),
  };
}

function stateFromRow(r: Record<string, unknown>): SourceReconcileState {
  return {
    medio_id: String(r.medio_id),
    window_start: String(r.window_start),
    window_end: String(r.window_end),
    status: r.status as SourceReconcileState['status'],
    cursor: (r.cursor as string | null) ?? null,
    started_at: (r.started_at as string | null) ?? null,
    completed_at: (r.completed_at as string | null) ?? null,
    last_error: (r.last_error as string | null) ?? null,
    discovery_surfaces: String(r.discovery_surfaces ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    rss_span_covered: (r.rss_span_covered as SourceReconcileState['rss_span_covered']) ?? 'UNKNOWN',
    sitemap_span_covered: (r.sitemap_span_covered as SourceReconcileState['sitemap_span_covered']) ?? 'UNKNOWN',
    listing_span_covered: (r.listing_span_covered as SourceReconcileState['listing_span_covered']) ?? 'UNKNOWN',
    sitemap_runtime_completeness_invoked: Boolean(r.sitemap_runtime_completeness_invoked),
    urls_discovered: Number(r.urls_discovered ?? 0),
    urls_known: Number(r.urls_known ?? 0),
    urls_queued: Number(r.urls_queued ?? 0),
    urls_persisted: Number(r.urls_persisted ?? 0),
    urls_rejected: Number(r.urls_rejected ?? 0),
    urls_blocked: Number(r.urls_blocked ?? 0),
    urls_failed: Number(r.urls_failed ?? 0),
    unexplained_missing: Number(r.unexplained_missing ?? 0),
    cap_hit: Boolean(r.cap_hit),
    time_budget_hit: Boolean(r.time_budget_hit),
    complete: Boolean(r.complete),
    coverage_verdict: (r.coverage_verdict as SourceReconcileState['coverage_verdict']) ?? undefined,
    worker_id: (r.worker_id as string | null) ?? null,
  };
}

function stateToRow(s: SourceReconcileState): Record<string, unknown> {
  return {
    ...s,
    discovery_surfaces: s.discovery_surfaces.join(','),
    updated_at: new Date().toISOString(),
  };
}

export class SupabaseCaptureReliabilityStore implements CaptureReliabilityStore {
  constructor(private readonly sb: SupabaseClient) {}

  async pingQueueTable(): Promise<boolean> {
    const { error } = await this.sb.from('capture_recovery_queue').select('hash_url').limit(1);
    return !error;
  }

  async upsertDiscovered(rec: RecoveryRecord): Promise<RecoveryRecord> {
    const prev = await this.get(rec.hash_url);
    const merged = prev
      ? {
          ...prev,
          ...rec,
          first_discovered_at: prev.first_discovered_at,
          discovered_via: prev.discovered_via.includes(rec.discovered_via)
            ? prev.discovered_via
            : `${prev.discovered_via}+${rec.discovered_via}`,
          status: prev.status === 'PERSISTED' || prev.status === 'KNOWN_IN_LAKE' ? prev.status : rec.status,
        }
      : rec;
    const { error } = await this.sb.from('capture_recovery_queue').upsert(recToRow(merged), { onConflict: 'hash_url' });
    if (error) throw error;
    return merged;
  }

  async claimBatch(opts: { workerId: string; limit: number; nowIso: string; skipHashes?: Set<string>; onlyHashes?: Set<string> }): Promise<RecoveryRecord[]> {
    const built = buildClaimBatchRpcArgs({
      workerId: opts.workerId,
      limit: opts.limit,
      nowIso: opts.nowIso,
      onlyHashes: opts.onlyHashes,
    });
    if (built.abort) return [];
    const { data, error } = await this.sb.rpc('claim_capture_recovery_batch', built.args);
    if (error) throw error;
    let rows = (data ?? []).map((row: Record<string, unknown>) => recFromRow(row));
    if (opts.onlyHashes !== undefined) rows = rows.filter((r: RecoveryRecord) => opts.onlyHashes!.has(r.hash_url));
    if (opts.skipHashes?.size) rows = rows.filter((r: RecoveryRecord) => !opts.skipHashes!.has(r.hash_url));
    return rows;
  }

  private async patch(hashUrl: string, fn: (r: RecoveryRecord) => RecoveryRecord): Promise<RecoveryRecord | null> {
    const prev = await this.get(hashUrl);
    if (!prev) return null;
    const next = fn(prev);
    const { error } = await this.sb.from('capture_recovery_queue').update(recToRow(next)).eq('hash_url', hashUrl);
    if (error) throw error;
    return next;
  }

  markFetching(hashUrl: string, workerId: string, nowIso: string) {
    return this.patch(hashUrl, (r) => ({ ...r, status: 'FETCHING', claimed_at: nowIso, claimed_by: workerId }));
  }
  markPersisted(hashUrl: string, noticiaId: string | null, nowIso: string) {
    return this.patch(hashUrl, (r) => ({ ...r, status: 'PERSISTED', noticia_id: noticiaId, claimed_at: null, claimed_by: null, last_discovered_at: nowIso }));
  }
  markWouldPersist(hashUrl: string) {
    return this.patch(hashUrl, (r) => ({ ...r, status: 'WOULD_PERSIST', claimed_at: null, claimed_by: null }));
  }
  markKnown(hashUrl: string, noticiaId?: string | null) {
    return this.patch(hashUrl, (r) => ({ ...r, status: 'KNOWN_IN_LAKE', noticia_id: noticiaId ?? r.noticia_id, claimed_at: null, claimed_by: null }));
  }
  markRetry(hashUrl: string, nextRetryAt: string, error: string, attempts: number) {
    return this.patch(hashUrl, (r) => ({ ...r, status: 'RETRY', next_retry_at: nextRetryAt, last_error: error, attempt_count: attempts, claimed_at: null, claimed_by: null }));
  }
  markBlocked(hashUrl: string, error: string) {
    return this.patch(hashUrl, (r) => ({ ...r, status: 'BLOCKED', last_error: error, claimed_at: null, claimed_by: null }));
  }
  markRejected(hashUrl: string, reason: string) {
    return this.patch(hashUrl, (r) => ({ ...r, status: 'REJECTED_NON_ARTICLE', last_error: reason, claimed_at: null, claimed_by: null }));
  }
  markFailed(hashUrl: string, error: string) {
    return this.patch(hashUrl, (r) => ({ ...r, status: 'FAILED_RETRY_EXHAUSTED', last_error: error, claimed_at: null, claimed_by: null }));
  }
  markStatus(hashUrl: string, status: RecoveryStatus, patch?: Partial<RecoveryRecord>) {
    return this.patch(hashUrl, (r) => ({ ...r, ...patch, status }));
  }

  async releaseStaleClaims(staleBeforeIso: string): Promise<number> {
    const { data, error } = await this.sb
      .from('capture_recovery_queue')
      .select('*')
      .in('status', ['FETCHING', 'FETCHED', 'EXTRACTED'])
      .not('claimed_at', 'is', null)
      .lt('claimed_at', staleBeforeIso);
    if (error) throw error;
    let n = 0;
    for (const row of data ?? []) {
      const rec = recFromRow(row as Record<string, unknown>);
      await this.sb.from('capture_recovery_queue').update(recToRow({
        ...rec,
        status: 'QUEUED',
        claimed_at: null,
        claimed_by: null,
        last_error: rec.last_error ?? 'stale_claim_released',
      })).eq('hash_url', rec.hash_url);
      n += 1;
    }
    return n;
  }

  async get(hashUrl: string): Promise<RecoveryRecord | null> {
    const { data, error } = await this.sb.from('capture_recovery_queue').select('*').eq('hash_url', hashUrl).maybeSingle();
    if (error) throw error;
    return data ? recFromRow(data as Record<string, unknown>) : null;
  }

  async snapshot(): Promise<RecoveryRecord[]> {
    const counted = await this.countRecovery();
    const rows: RecoveryRecord[] = [];
    const pageSize = 1000;
    for (let offset = 0; offset < counted; offset += pageSize) {
      const page = await this.listRecoveryPage({ offset, pageSize });
      rows.push(...page);
      if (page.length < pageSize) break;
    }
    if (rows.length !== counted) {
      throw new Error(`QUEUE_READ_INCOMPLETE: scanned=${rows.length} counted=${counted}`);
    }
    return rows;
  }

  async listRecoveryPage(opts: { offset: number; pageSize: number }): Promise<RecoveryRecord[]> {
    const to = opts.offset + opts.pageSize - 1;
    const { data, error } = await this.sb
      .from('capture_recovery_queue')
      .select('*')
      .order('hash_url')
      .range(opts.offset, to);
    if (error) throw error;
    return (data ?? []).map((r) => recFromRow(r as Record<string, unknown>));
  }

  async countRecovery(): Promise<number> {
    const { count, error } = await this.sb
      .from('capture_recovery_queue')
      .select('hash_url', { count: 'exact', head: true });
    if (error) throw error;
    return count ?? 0;
  }

  async byStatus(status: RecoveryStatus): Promise<RecoveryRecord[]> {
    const { data, error } = await this.sb.from('capture_recovery_queue').select('*').eq('status', status);
    if (error) throw error;
    return (data ?? []).map((r) => recFromRow(r as Record<string, unknown>));
  }

  async upsertSourceState(state: SourceReconcileState): Promise<SourceReconcileState> {
    const { error } = await this.sb.from('capture_source_reconcile_state').upsert(stateToRow(state), {
      onConflict: 'medio_id,window_start,window_end',
    });
    if (error) throw error;
    return state;
  }

  async getSourceState(medioId: string, windowStart: string, windowEnd: string): Promise<SourceReconcileState | null> {
    const { data, error } = await this.sb
      .from('capture_source_reconcile_state')
      .select('*')
      .eq('medio_id', medioId)
      .eq('window_start', windowStart)
      .eq('window_end', windowEnd)
      .maybeSingle();
    if (error) throw error;
    return data ? stateFromRow(data as Record<string, unknown>) : null;
  }

  async listSourceStates(windowStart: string, windowEnd: string): Promise<SourceReconcileState[]> {
    const { data, error } = await this.sb
      .from('capture_source_reconcile_state')
      .select('*')
      .eq('window_start', windowStart)
      .eq('window_end', windowEnd);
    if (error) throw error;
    return (data ?? []).map((r) => stateFromRow(r as Record<string, unknown>));
  }

  async upsertRun(run: ReconcileRun): Promise<ReconcileRun> {
    const { error } = await this.sb.from('capture_reconcile_runs').upsert(run);
    if (error) throw error;
    return run;
  }

  async getRun(runId: string): Promise<ReconcileRun | null> {
    const { data, error } = await this.sb.from('capture_reconcile_runs').select('*').eq('run_id', runId).maybeSingle();
    if (error) throw error;
    return (data as ReconcileRun | null) ?? null;
  }

  async addGapCandidates(rows: GapCandidate[]): Promise<void> {
    if (!rows.length) return;
    const payload = rows.map((r) => ({
      candidate_id: r.candidate_id,
      discovered_url: r.discovered_url,
      publisher_final_url: r.publisher_final_url,
      hostname: r.hostname,
      discovered_via: r.discovered_via,
      discovered_at: r.discovered_at,
      canonical_hash: r.canonical_hash,
      discovered_urls: r.discovered_urls,
      medio_id: r.medio_id,
      fuente_id: r.fuente_id,
      candidate_medio_ids: r.candidate_medio_ids ?? [],
      candidate_fuente_ids: r.candidate_fuente_ids ?? [],
      cliente_ids: r.cliente_ids ?? [],
      keyword_ids: r.keyword_ids ?? [],
      queries: r.queries ?? [],
      google_item_urls: r.google_item_urls ?? [],
      first_discovered_at: r.first_discovered_at ?? r.discovered_at,
      last_discovered_at: r.last_discovered_at ?? r.discovered_at,
      discovery_status: r.discovery_status ?? null,
    }));
    const { error } = await this.sb.from('capture_gap_candidates').upsert(payload, { onConflict: 'candidate_id' });
    if (error) throw error;
  }

  async listGapCandidates(): Promise<GapCandidate[]> {
    const { data, error } = await this.sb.from('capture_gap_candidates').select('*').is('consumed_at', null);
    if (error) throw error;
    return (data ?? []).map((r) => {
      const row = r as Record<string, unknown>;
      const url = String(row.discovered_url);
      return {
        candidate_id: String(row.candidate_id ?? url),
        discovered_url: url,
        publisher_final_url: (row.publisher_final_url as string | null) ?? null,
        hostname: (row.hostname as string | null) ?? null,
        discovered_via: String(row.discovered_via ?? 'gap_candidate'),
        discovered_at: String(row.discovered_at),
        canonical_hash: (row.canonical_hash as string | null) ?? null,
        discovered_urls: Array.isArray(row.discovered_urls)
          ? (row.discovered_urls as string[])
          : String(row.discovered_urls ?? url).split('|').filter(Boolean),
        medio_id: (row.medio_id as string | null) ?? null,
        fuente_id: (row.fuente_id as string | null) ?? null,
        candidate_medio_ids: Array.isArray(row.candidate_medio_ids) ? (row.candidate_medio_ids as string[]) : [],
        candidate_fuente_ids: Array.isArray(row.candidate_fuente_ids) ? (row.candidate_fuente_ids as string[]) : [],
        cliente_ids: Array.isArray(row.cliente_ids) ? (row.cliente_ids as string[]) : [],
        keyword_ids: Array.isArray(row.keyword_ids) ? (row.keyword_ids as string[]) : [],
        queries: Array.isArray(row.queries) ? (row.queries as string[]) : [],
        google_item_urls: Array.isArray(row.google_item_urls) ? (row.google_item_urls as string[]) : [],
        first_discovered_at: (row.first_discovered_at as string | null) ?? String(row.discovered_at),
        last_discovered_at: (row.last_discovered_at as string | null) ?? String(row.discovered_at),
        discovery_status: (row.discovery_status as string | null) ?? null,
        claimed_at: (row.claimed_at as string | null) ?? null,
        claimed_by: (row.claimed_by as string | null) ?? null,
        consumed_at: (row.consumed_at as string | null) ?? null,
      };
    });
  }

  async recordObservation(obs: import('./types.js').RecoveryObservation): Promise<void> {
    const { error } = await this.sb.from('capture_recovery_observations').upsert(obs, {
      onConflict: 'run_id,hash_url,window_start',
    });
    if (error) throw error;
  }

  async listObservations(windowStart: string, windowEnd: string) {
    const { data, error } = await this.sb
      .from('capture_recovery_observations')
      .select('*')
      .eq('window_start', windowStart)
      .eq('window_end', windowEnd);
    if (error) throw error;
    return (data ?? []) as import('./types.js').RecoveryObservation[];
  }

  async claimGapCandidates(opts: { workerId: string; limit: number; nowIso: string }) {
    const { data, error } = await this.sb.rpc('claim_capture_gap_batch', {
      p_worker_id: opts.workerId,
      p_limit: opts.limit,
      p_now: opts.nowIso,
    });
    if (error) throw error;
    return this.listGapCandidates().then((rows) => rows.filter((r) => (data ?? []).some((d: { candidate_id: string }) => d.candidate_id === r.candidate_id)));
  }

  async markGapConsumed(candidateId: string, nowIso: string): Promise<void> {
    const { error } = await this.sb
      .from('capture_gap_candidates')
      .update({ consumed_at: nowIso })
      .eq('candidate_id', candidateId);
    if (error) throw error;
  }

  async releaseStaleGapClaims(staleBeforeIso: string): Promise<number> {
    const { data, error } = await this.sb
      .from('capture_gap_candidates')
      .update({ claimed_at: null, claimed_by: null })
      .is('consumed_at', null)
      .lt('claimed_at', staleBeforeIso)
      .select('candidate_id');
    if (error) throw error;
    return data?.length ?? 0;
  }

  async claimSourceBatch(opts: {
    workerId: string;
    windowStart: string;
    windowEnd: string;
    medioIds: string[];
    limit: number;
    nowIso: string;
    staleBeforeIso: string;
  }): Promise<SourceReconcileState[]> {
    for (const medioId of opts.medioIds) {
      const existing = await this.getSourceState(medioId, opts.windowStart, opts.windowEnd);
      if (existing) continue;
      await this.upsertSourceState({
        ...emptySourceState({ medioId, windowStart: opts.windowStart, windowEnd: opts.windowEnd }),
        status: 'PENDING',
      });
    }
    const { data, error } = await this.sb.rpc('claim_capture_source_batch', {
      p_worker_id: opts.workerId,
      p_window_start: opts.windowStart,
      p_window_end: opts.windowEnd,
      p_medio_ids: opts.medioIds,
      p_limit: opts.limit,
      p_now: opts.nowIso,
    });
    if (error) throw error;
    const claimed = ((data ?? []) as Record<string, unknown>[]).map((row) => stateFromRow(row));
    const wanted = new Set(opts.medioIds);
    return claimed.filter((s) => wanted.has(s.medio_id)).slice(0, opts.limit);
  }
}

export async function captureRecoveryQueueTableExists(sb: SupabaseClient): Promise<boolean> {
  const { error } = await sb.from('capture_recovery_queue').select('hash_url').limit(1);
  return !error;
}
