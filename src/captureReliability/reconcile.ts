import { admitDiscoveredArticle } from './articleAdmission.js';
import { lakeRowNeedsEnrich, type LakeRow } from './lakeLookup.js';
import { classifyFetchFailure } from './retry.js';
import { resolveSourceForUrl } from './sourceResolve.js';
import { captureCanonicalUrl, hostOf, primaryHash } from './urlIndex.js';
import type { ChannelCatalogRow, DiscoveredUrl, ReconcileDecision, RecoveryRecord, RootCause } from './types.js';

export type { LakeRow };

export interface ReconcileOpts {
  nowIso: string;
  lakeByCanonical: Map<string, LakeRow | null>;
  catalog: ChannelCatalogRow[];
  provenRootCause?: RootCause | null;
}

export function baseRecoveryRecord(item: DiscoveredUrl, nowIso: string): RecoveryRecord {
  return {
    canonical_url: captureCanonicalUrl(item.url),
    discovered_url: item.url,
    hash_url: item.hashUrl || primaryHash(item.url),
    medio_id: item.medioId,
    fuente_id: item.fuenteId,
    hostname: item.hostname || hostOf(item.url),
    discovered_via: item.discoveredVia,
    first_discovered_at: nowIso,
    last_discovered_at: nowIso,
    attempt_count: 0,
    status: 'DISCOVERED',
    root_cause: null,
    last_error: null,
    claimed_at: null,
    claimed_by: null,
    next_retry_at: null,
    noticia_id: null,
  };
}

export function decideDiscoveredUrl(item: DiscoveredUrl, opts: ReconcileOpts): ReconcileDecision {
  const canonical = captureCanonicalUrl(item.url);
  const resolved = item.medioId
    ? { kind: 'resolved' as const, medioId: item.medioId }
    : resolveSourceForUrl(item.url, opts.catalog);
  const medioId = resolved.kind === 'resolved' ? resolved.medioId : item.medioId;
  const admission = admitDiscoveredArticle({
    url: item.url,
    medioId,
    titulo: item.titulo,
    resumen: item.resumen,
    body: item.body,
    publishedAt: item.publishedAt,
  });

  const base = baseRecoveryRecord({ ...item, medioId: medioId ?? item.medioId }, opts.nowIso);

  if (resolved.kind === 'ambiguous') {
    return {
      action: 'AMBIGUOUS_SOURCE',
      record: {
        ...base,
        status: 'AMBIGUOUS_SOURCE',
        root_cause: 'AMBIGUOUS_SOURCE',
        last_error: resolved.medioIds.join(','),
      },
    };
  }
  if (resolved.kind === 'unknown' && !medioId) {
    return {
      action: 'SOURCE_DISCOVERY_PENDING',
      record: { ...base, status: 'UNKNOWN_SOURCE', root_cause: 'SOURCE_NOT_IN_PLAN' },
    };
  }
  if (!admission.admit) {
    return {
      action: 'WOULD_REJECT',
      record: { ...base, status: 'REJECTED_NON_ARTICLE', last_error: admission.reason },
    };
  }

  const existing = opts.lakeByCanonical.get(canonical) ?? opts.lakeByCanonical.get(item.url) ?? null;
  if (existing) {
    if (lakeRowNeedsEnrich(existing)) {
      return {
        action: 'WOULD_ENRICH',
        record: { ...base, status: 'NEEDS_ENRICH', noticia_id: existing.noticia_id ?? null },
      };
    }
    return {
      action: 'SKIP_KNOWN',
      record: { ...base, status: 'KNOWN_IN_LAKE', noticia_id: existing.noticia_id ?? null },
    };
  }

  return {
    action: 'WOULD_INSERT',
    record: {
      ...base,
      status: 'QUEUED',
      root_cause: opts.provenRootCause ?? null,
    },
  };
}

export function decideFetchError(
  rec: RecoveryRecord,
  failure: { httpStatus: number | null; timeout?: boolean; networkError?: boolean },
  maxAttempts = 8,
): ReconcileDecision {
  const klass = classifyFetchFailure(failure);
  const attempts = rec.attempt_count + 1;
  const err = failure.timeout ? 'timeout' : `http ${failure.httpStatus}`;

  if (klass === 'BLOCKED') {
    return {
      action: 'WOULD_RETRY',
      record: {
        ...rec,
        attempt_count: attempts,
        status: 'BLOCKED',
        root_cause: 'FETCH_BLOCKED',
        last_error: err,
      },
    };
  }

  if (klass === 'GONE') {
    return {
      action: 'WOULD_RETRY',
      record: {
        ...rec,
        attempt_count: attempts,
        status: 'MANUAL_REVIEW',
        root_cause: null,
        last_error: err,
      },
    };
  }

  if (klass === 'RETRY' && attempts >= maxAttempts) {
    return {
      action: 'WOULD_RETRY',
      record: {
        ...rec,
        attempt_count: attempts,
        status: 'FAILED_RETRY_EXHAUSTED',
        root_cause: 'FETCH_TRANSIENT',
        last_error: `${err};max_attempts`,
      },
    };
  }

  return {
    action: 'WOULD_RETRY',
    record: {
      ...rec,
      attempt_count: attempts,
      status: 'RETRY',
      root_cause: 'FETCH_TRANSIENT',
      last_error: err,
    },
  };
}

export function unionDiscovery(layers: DiscoveredUrl[][]): DiscoveredUrl[] {
  const map = new Map<string, DiscoveredUrl>();
  for (const layer of layers) {
    for (const it of layer) {
      const k = captureCanonicalUrl(it.url);
      const prev = map.get(k);
      if (!prev) {
        map.set(k, it);
        continue;
      }
      map.set(k, {
        ...prev,
        discoveredVia: prev.discoveredVia.includes(it.discoveredVia)
          ? prev.discoveredVia
          : `${prev.discoveredVia}+${it.discoveredVia}`,
        publishedAt: prev.publishedAt ?? it.publishedAt,
        titulo: prev.titulo ?? it.titulo,
        resumen: prev.resumen ?? it.resumen,
        body: prev.body ?? it.body,
      });
    }
  }
  return [...map.values()];
}
