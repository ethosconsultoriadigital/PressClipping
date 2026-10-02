import { admitDiscoveredArticle } from './articleAdmission.js';
import { lakeHasUrl, primaryHash, captureCanonicalUrl, hostOf, captureUrlHashes } from './urlIndex.js';
import { classifyFetchFailure } from './retry.js';
import type { DiscoveredUrl, ReconcileDecision, RecoveryRecord, RootCause } from './types.js';

export interface LakeRow {
  hash_url: string;
  url_original: string | null;
  url_canonica: string | null;
  texto_cuerpo_nota: string | null;
  texto_nota_limpia: string | null;
}

export interface ReconcileOpts {
  nowIso: string;
  lakeHashes: Set<string>;
  lakeByHash: Map<string, LakeRow>;
  knownHosts: Map<string, { medioId: string }>;
  maxAttempts?: number;
}

function needsEnrich(row: LakeRow | undefined): boolean {
  if (!row) return false;
  const body = (row.texto_cuerpo_nota ?? '').trim();
  const clean = (row.texto_nota_limpia ?? '').trim();
  return body.length < 40 && clean.length < 40;
}

export function decideDiscoveredUrl(item: DiscoveredUrl, opts: ReconcileOpts): ReconcileDecision {
  const canonical = captureCanonicalUrl(item.url);
  const host = hostOf(item.url);
  const known = opts.knownHosts.get(host);
  const medioId = item.medioId ?? known?.medioId ?? null;
  const admission = admitDiscoveredArticle({
    url: item.url,
    medioId,
    titulo: item.titulo,
    resumen: item.resumen,
    body: item.body,
    publishedAt: item.publishedAt,
  });

  const base: RecoveryRecord = {
    canonical_url: canonical,
    discovered_url: item.url,
    hash_url: item.hashUrl || primaryHash(item.url),
    medio_id: medioId,
    fuente_id: item.fuenteId,
    discovered_via: item.discoveredVia,
    first_discovered_at: opts.nowIso,
    last_discovered_at: opts.nowIso,
    attempt_count: 1,
    status: 'DISCOVERED',
    root_cause: null,
    last_error: null,
  };

  if (!medioId) {
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
  if (lakeHasUrl(opts.lakeHashes, item.url)) {
    const hashes = captureUrlHashes(item.url);
    let row: LakeRow | undefined;
    for (const h of hashes) {
      const hit = opts.lakeByHash.get(h);
      if (hit) {
        row = hit;
        break;
      }
    }
    if (needsEnrich(row)) {
      return { action: 'WOULD_ENRICH', record: { ...base, status: 'NEEDS_ENRICH' } };
    }
    return { action: 'SKIP_KNOWN', record: { ...base, status: 'KNOWN_IN_LAKE' } };
  }
  return { action: 'WOULD_INSERT', record: { ...base, status: 'QUEUED', root_cause: 'CRON_GAP' } };
}

export function decideFetchError(
  rec: RecoveryRecord,
  failure: { httpStatus: number | null; timeout?: boolean; networkError?: boolean },
  maxAttempts = 8,
): ReconcileDecision {
  const klass = classifyFetchFailure(failure);
  const attempts = rec.attempt_count + 1;
  if (klass === 'BLOCKED') {
    return {
      action: 'WOULD_RETRY',
      record: {
        ...rec,
        attempt_count: attempts,
        status: 'BLOCKED',
        root_cause: 'FETCH_BLOCKED',
        last_error: `http ${failure.httpStatus}`,
      },
    };
  }
  const retryable = klass === 'RETRY';
  const exhausted = attempts >= maxAttempts;
  const root: RootCause = retryable ? 'FETCH_TRANSIENT' : 'OTHER';
  return {
    action: retryable && !exhausted ? 'WOULD_RETRY' : 'WOULD_RETRY',
    record: {
      ...rec,
      attempt_count: attempts,
      status: retryable && !exhausted ? 'RETRY' : 'RETRY',
      root_cause: root,
      last_error: failure.timeout ? 'timeout' : `http ${failure.httpStatus}`,
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
        discoveredVia: `${prev.discoveredVia}+${it.discoveredVia}`,
        publishedAt: prev.publishedAt ?? it.publishedAt,
        titulo: prev.titulo ?? it.titulo,
        resumen: prev.resumen ?? it.resumen,
        body: prev.body ?? it.body,
      });
    }
  }
  return [...map.values()];
}
