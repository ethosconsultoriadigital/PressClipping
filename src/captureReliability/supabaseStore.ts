import type { SupabaseClient } from '@supabase/supabase-js';
import type { CaptureReliabilityStore } from './captureRecoveryRepository.js';
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

  async claimBatch(opts: { workerId: string; limit: number; nowIso: string }): Promise<RecoveryRecord[]> {
    const { data, error } = await this.sb
      .from('capture_recovery_queue')
      .select('*')
      .in('status', ['QUEUED', 'RETRY'])
      .is('claimed_at', null)
      .limit(opts.limit);
    if (error) throw error;
    const out: RecoveryRecord[] = [];
    for (const row of data ?? []) {
      const rec = recFromRow(row as Record<string, unknown>);
      if (rec.next_retry_at && Date.parse(rec.next_retry_at) > Date.parse(opts.nowIso)) continue;
      const next = { ...rec, status: 'FETCHING' as const, claimed_at: opts.nowIso, claimed_by: opts.workerId };
      const { error: uerr } = await this.sb.from('capture_recovery_queue').update(recToRow(next)).eq('hash_url', rec.hash_url);
      if (uerr) throw uerr;
      out.push(next);
    }
    return out;
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
    const { data, error } = await this.sb.from('capture_recovery_queue').select('*');
    if (error) throw error;
    return (data ?? []).map((r) => recFromRow(r as Record<string, unknown>));
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
      candidate_id: r.discovered_url,
      discovered_url: r.discovered_url,
      publisher_final_url: r.publisher_final_url,
      hostname: r.hostname,
      discovered_via: r.discovered_via,
      discovered_at: r.discovered_at,
      cliente_ids: r.cliente_ids?.join(',') ?? null,
      keyword_ids: r.keyword_ids?.join(',') ?? null,
    }));
    const { error } = await this.sb.from('capture_gap_candidates').upsert(payload, { onConflict: 'candidate_id' });
    if (error) throw error;
  }

  async listGapCandidates(): Promise<GapCandidate[]> {
    const { data, error } = await this.sb.from('capture_gap_candidates').select('*').is('consumed_at', null);
    if (error) throw error;
    return (data ?? []).map((r) => ({
      discovered_url: String((r as { discovered_url: string }).discovered_url),
      publisher_final_url: ((r as { publisher_final_url: string | null }).publisher_final_url) ?? null,
      hostname: ((r as { hostname: string | null }).hostname) ?? null,
      discovered_via: String((r as { discovered_via: string }).discovered_via),
      discovered_at: String((r as { discovered_at: string }).discovered_at),
    }));
  }
}

export async function captureRecoveryQueueTableExists(sb: SupabaseClient): Promise<boolean> {
  const { error } = await sb.from('capture_recovery_queue').select('hash_url').limit(1);
  return !error;
}
