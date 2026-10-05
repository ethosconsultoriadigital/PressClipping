import { admitDiscoveredArticle } from './articleAdmission.js';
import { decideFetchError } from './reconcile.js';
import { nextBackoffSeconds } from './retry.js';
import type { FetchExtractResult } from '../extractors/html.js';
import { buildRecoveredNewsPayload, type RecoveredNewsPayload } from './recoveryPayload.js';
import type { NoticiaInsert } from '../normalizers/noticia.js';
import type { CaptureReliabilityStore } from './captureRecoveryRepository.js';
import type { RecoveryRecord, RecoveryStatus } from './types.js';
import { isAutoWriteEligible } from './writeEligibility.js';

export interface RecoveryFetchExtract {
  (url: string): Promise<FetchExtractResult>;
}

export interface RecoveryPersistResult {
  noticiaId: string | null;
  outcome: 'inserted' | 'known';
}

export interface RecoveryPersist {
  (payload: RecoveredNewsPayload): Promise<RecoveryPersistResult>;
}

/** Metadata row only. Trusted fields live on payload.enrichment. */
export function extractToNoticia(opts: {
  url: string;
  medioId: string;
  extract: FetchExtractResult;
  publishedAt?: string | null;
  discoveredTitle?: string | null;
  discoveredSummary?: string | null;
}): NoticiaInsert {
  return buildRecoveredNewsPayload(opts).insert;
}

const CLAIMABLE_RESTORE: RecoveryStatus[] = ['QUEUED', 'RETRY', 'FETCH_TO_CLASSIFY'];

export async function processRecoveryRecord(opts: {
  record: RecoveryRecord;
  store: CaptureReliabilityStore;
  fetchExtract: RecoveryFetchExtract;
  persistNews?: RecoveryPersist;
  writesAllowed: boolean;
  nowIso: string;
  maxAttempts?: number;
  windowStart?: string;
  windowEnd?: string;
  targeted?: boolean;
}): Promise<RecoveryRecord> {
  const rec = opts.record;
  const maxAttempts = opts.maxAttempts ?? 8;
  const restore: RecoveryStatus = CLAIMABLE_RESTORE.includes(rec.status) ? rec.status : 'QUEUED';
  await opts.store.markFetching(rec.hash_url, rec.claimed_by ?? 'worker', opts.nowIso);

  const extracted = await opts.fetchExtract(rec.discovered_url);
  if (!extracted.ok) {
    const dec = decideFetchError(
      rec,
      {
        httpStatus: extracted.httpError?.status ?? null,
        timeout: extracted.httpError?.kind === 'timeout',
        networkError: extracted.httpError?.kind === 'network',
      },
      maxAttempts,
    );
    if (dec.record.status === 'BLOCKED') {
      return (await opts.store.markBlocked(rec.hash_url, dec.record.last_error ?? 'blocked')) ?? dec.record;
    }
    if (dec.record.status === 'FAILED_RETRY_EXHAUSTED') {
      return (await opts.store.markFailed(rec.hash_url, dec.record.last_error ?? 'exhausted')) ?? dec.record;
    }
    if (dec.record.status === 'MANUAL_REVIEW') {
      return (await opts.store.markStatus(rec.hash_url, 'MANUAL_REVIEW', { last_error: dec.record.last_error })) ?? dec.record;
    }
    const backoff = nextBackoffSeconds(dec.record.attempt_count, maxAttempts) ?? 15;
    const next = new Date(Date.parse(opts.nowIso) + backoff * 1000).toISOString();
    return (
      (await opts.store.markRetry(rec.hash_url, next, dec.record.last_error ?? 'retry', dec.record.attempt_count)) ?? dec.record
    );
  }

  const body = extracted.texto_cuerpo_nota || extracted.texto_nota_limpia || '';
  const admission = admitDiscoveredArticle({
    url: rec.discovered_url,
    medioId: rec.medio_id,
    titulo: extracted.titulo ?? rec.discovered_title,
    resumen: extracted.resumen ?? rec.discovered_summary,
    body,
  });
  if (!admission.admit) {
    return (await opts.store.markRejected(rec.hash_url, admission.reason)) ?? rec;
  }
  if (!rec.medio_id) {
    return (await opts.store.markStatus(rec.hash_url, 'UNKNOWN_SOURCE')) ?? rec;
  }

  const payload = buildRecoveredNewsPayload({
    url: rec.discovered_url,
    medioId: rec.medio_id,
    extract: extracted,
    publishedAt: rec.published_at,
    discoveredTitle: rec.discovered_title,
    discoveredSummary: rec.discovered_summary,
  });

  const eligibility = isAutoWriteEligible(
    rec,
    { start: opts.windowStart, end: opts.windowEnd },
    payload.insert.fecha_publicacion,
    { targeted: opts.targeted === true },
  );
  if (!eligibility.eligible) {
    return (
      (await opts.store.markStatus(rec.hash_url, 'MANUAL_REVIEW', {
        last_error: `NOT_AUTO_WRITE_ELIGIBLE:${eligibility.reason}`,
        last_dry_run_result: eligibility.reason,
        claimed_at: null,
        claimed_by: null,
      })) ?? rec
    );
  }

  if (!opts.writesAllowed || !opts.persistNews) {
    return (
      (await opts.store.markStatus(rec.hash_url, restore, {
        last_dry_run_result: 'WOULD_PERSIST',
        claimed_at: null,
        claimed_by: null,
      })) ?? rec
    );
  }

  const persisted = await opts.persistNews(payload);
  if (persisted.outcome === 'known') {
    return (await opts.store.markKnown(rec.hash_url, persisted.noticiaId)) ?? rec;
  }
  if (!persisted.noticiaId) {
    return (await opts.store.markStatus(rec.hash_url, 'MANUAL_REVIEW', { last_error: 'persist_without_noticia_id' })) ?? rec;
  }
  return (await opts.store.markPersisted(rec.hash_url, persisted.noticiaId, opts.nowIso)) ?? rec;
}
