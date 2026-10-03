import { classifyPreFetch } from './articleAdmission.js';
import type { RecoveryRecord } from './types.js';

export type QueueAuditClass =
  | 'VALID_ARTICLE_RECENT'
  | 'VALID_ARTICLE_OLD'
  | 'NON_ARTICLE'
  | 'DUPLICATE_VARIANT'
  | 'WRONG_WINDOW'
  | 'WINDOW_MEMBERSHIP_UNKNOWN'
  | 'UNKNOWN';

export interface QueueAuditRow {
  hash_url: string;
  url: string;
  discovered_via: string;
  medio_id: string | null;
  published_at: string | null;
  class: QueueAuditClass;
}

function inWindow(iso: string | null, start: string, end: string): boolean | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return t >= Date.parse(start) && t <= Date.parse(end);
}

export function classifyQueuedRecord(
  rec: RecoveryRecord,
  window: { start: string; end: string },
): QueueAuditClass {
  const pre = classifyPreFetch(
    {
      url: rec.discovered_url,
      medioId: rec.medio_id,
      titulo: rec.discovered_title,
      resumen: rec.discovered_summary,
      publishedAt: rec.published_at,
    },
    rec.discovered_via,
  );
  if (pre.disposition === 'REJECT') return 'NON_ARTICLE';
  const membership = inWindow(rec.published_at, window.start, window.end);
  if (membership === false) return rec.published_at ? 'VALID_ARTICLE_OLD' : 'WRONG_WINDOW';
  if (membership === null) {
    if (rec.discovered_via.includes('sitemap')) return 'WINDOW_MEMBERSHIP_UNKNOWN';
    return 'UNKNOWN';
  }
  return 'VALID_ARTICLE_RECENT';
}

export function stratifiedQueueSample(
  rows: RecoveryRecord[],
  perBucket: number,
): RecoveryRecord[] {
  const buckets = new Map<string, RecoveryRecord[]>();
  for (const r of rows) {
    const via = (r.discovered_via || 'unknown').split('+')[0] || 'unknown';
    const list = buckets.get(via) ?? [];
    list.push(r);
    buckets.set(via, list);
  }
  const out: RecoveryRecord[] = [];
  for (const list of buckets.values()) {
    out.push(...list.slice(0, perBucket));
  }
  return out;
}

export function auditQueuedSample(
  rows: RecoveryRecord[],
  window: { start: string; end: string },
  perBucket = 40,
): { sample: QueueAuditRow[]; rates: Record<QueueAuditClass, number>; total: number } {
  const sampleRows = stratifiedQueueSample(rows, perBucket);
  const sample = sampleRows.map((r) => ({
    hash_url: r.hash_url,
    url: r.discovered_url,
    discovered_via: r.discovered_via,
    medio_id: r.medio_id,
    published_at: r.published_at,
    class: classifyQueuedRecord(r, window),
  }));
  const counts: Record<QueueAuditClass, number> = {
    VALID_ARTICLE_RECENT: 0,
    VALID_ARTICLE_OLD: 0,
    NON_ARTICLE: 0,
    DUPLICATE_VARIANT: 0,
    WRONG_WINDOW: 0,
    WINDOW_MEMBERSHIP_UNKNOWN: 0,
    UNKNOWN: 0,
  };
  for (const s of sample) counts[s.class] += 1;
  const n = sample.length || 1;
  const rates = Object.fromEntries(
    Object.entries(counts).map(([k, v]) => [k, v / n]),
  ) as Record<QueueAuditClass, number>;
  return { sample, rates, total: sample.length };
}
