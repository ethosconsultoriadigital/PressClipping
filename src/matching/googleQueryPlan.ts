import { foldText } from '../matchers/text.js';
import type { KeywordActivaRow } from '../supabase/repositories.js';

export interface GoogleRecoveryQuery {
  query: string;
  normalized: string;
  keyword_ids: string[];
  cliente_ids: string[];
}

export interface GoogleQueryPlan {
  queries: GoogleRecoveryQuery[];
  QUERY_TOTAL: number;
}

export interface GoogleQueryCursor {
  offset: number;
  updated_at: string;
}

export function normalizeGoogleQuery(q: string): string {
  return foldText(q).replace(/\s+/g, ' ').trim();
}

/** Universo completo de queries elegibles. Sin tope arbitrario. */
export function buildGoogleRecoveryQueryPlan(keywords: KeywordActivaRow[]): GoogleQueryPlan {
  const byNorm = new Map<string, GoogleRecoveryQuery>();
  for (const kw of keywords) {
    const tipo = String(kw.tipo_keyword ?? '').toLowerCase();
    if (tipo !== 'frase_exacta') continue;
    const q = kw.keyword.trim();
    if (q.length < 6) continue;
    const normalized = normalizeGoogleQuery(q);
    if (!normalized) continue;
    const rec = byNorm.get(normalized) ?? {
      query: q,
      normalized,
      keyword_ids: [],
      cliente_ids: [],
    };
    if (!rec.keyword_ids.includes(kw.keyword_id)) rec.keyword_ids.push(kw.keyword_id);
    if (kw.cliente_id && !rec.cliente_ids.includes(kw.cliente_id)) rec.cliente_ids.push(kw.cliente_id);
    byNorm.set(normalized, rec);
  }
  const queries = [...byNorm.values()].sort((a, b) => a.normalized.localeCompare(b.normalized));
  return { queries, QUERY_TOTAL: queries.length };
}

export function sliceQueryPlan(
  plan: GoogleQueryPlan,
  cursor: GoogleQueryCursor | null,
  batchSize: number,
): {
  processed: GoogleRecoveryQuery[];
  next: GoogleQueryCursor;
  QUERY_PROCESSED: number;
  QUERY_PENDING: number;
} {
  const size = Math.max(1, batchSize);
  const offset = cursor?.offset ?? 0;
  const start = offset >= plan.QUERY_TOTAL ? 0 : offset;
  const processed = plan.queries.slice(start, start + size);
  const nextOffset = start + processed.length >= plan.QUERY_TOTAL ? 0 : start + processed.length;
  return {
    processed,
    next: { offset: nextOffset, updated_at: new Date().toISOString() },
    QUERY_PROCESSED: processed.length,
    QUERY_PENDING: Math.max(0, plan.QUERY_TOTAL - (start + processed.length === plan.QUERY_TOTAL ? plan.QUERY_TOTAL : start + processed.length)),
  };
}

export function queriesByClient(plan: GoogleQueryPlan, executed: GoogleRecoveryQuery[]): Map<string, { total: number; executed: number }> {
  const out = new Map<string, { total: number; executed: number }>();
  for (const q of plan.queries) {
    for (const cid of q.cliente_ids) {
      const rec = out.get(cid) ?? { total: 0, executed: 0 };
      rec.total += 1;
      out.set(cid, rec);
    }
  }
  const execNorm = new Set(executed.map((q) => q.normalized));
  for (const q of plan.queries) {
    if (!execNorm.has(q.normalized)) continue;
    for (const cid of q.cliente_ids) {
      const rec = out.get(cid);
      if (rec) rec.executed += 1;
    }
  }
  return out;
}
