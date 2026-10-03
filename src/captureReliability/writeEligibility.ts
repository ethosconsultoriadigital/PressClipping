import type { RecoveryRecord } from './types.js';

export type AutoWriteReason =
  | 'MISSING_KNOWN_SOURCE'
  | 'IN_WINDOW_DATE'
  | 'CONFIRMED_WINDOW_MEMBERSHIP';

export type AutoWriteBlockReason =
  | 'WINDOW_MEMBERSHIP_UNKNOWN'
  | 'OUTSIDE_WINDOW'
  | 'UNKNOWN_SOURCE'
  | 'AMBIGUOUS_SOURCE';

export interface WriteEligibility {
  eligible: boolean;
  reason: AutoWriteReason | AutoWriteBlockReason;
}

function inWindow(iso: string, start?: string, end?: string): boolean {
  if (!start || !end) return true;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  return t >= Date.parse(start) && t <= Date.parse(end);
}

function isPublisherGap(rec: Pick<RecoveryRecord, 'discovered_via'>): boolean {
  const via = (rec.discovered_via ?? '').toLowerCase();
  return via.includes('google') || via.includes('gap') || via.includes('auditor');
}

/** 24h/72h auto-write gate. Dry-run may still WOULD_PERSIST; this blocks production persist. */
export function isAutoWriteEligible(
  rec: Pick<RecoveryRecord, 'status' | 'medio_id' | 'discovered_via' | 'window_membership' | 'published_at'>,
  window?: { start?: string; end?: string },
  extractedPublishedAt?: string | null,
): WriteEligibility {
  if (rec.status === 'UNKNOWN_SOURCE' || !rec.medio_id) {
    return { eligible: false, reason: 'UNKNOWN_SOURCE' };
  }
  if (rec.status === 'AMBIGUOUS_SOURCE') {
    return { eligible: false, reason: 'AMBIGUOUS_SOURCE' };
  }
  if (isPublisherGap(rec)) {
    return { eligible: true, reason: 'MISSING_KNOWN_SOURCE' };
  }
  const published = extractedPublishedAt || rec.published_at;
  if (published && window?.start && window?.end) {
    if (inWindow(published, window.start, window.end)) {
      return { eligible: true, reason: 'IN_WINDOW_DATE' };
    }
    return { eligible: false, reason: 'OUTSIDE_WINDOW' };
  }
  if (rec.window_membership === 'IN_WINDOW') {
    return { eligible: true, reason: 'CONFIRMED_WINDOW_MEMBERSHIP' };
  }
  if (rec.window_membership === 'OUT_OF_WINDOW') {
    return { eligible: false, reason: 'OUTSIDE_WINDOW' };
  }
  return { eligible: false, reason: 'WINDOW_MEMBERSHIP_UNKNOWN' };
}
