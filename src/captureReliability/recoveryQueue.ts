import type { RecoveryRecord, RecoveryStatus } from './types.js';

/** Memory Map SOLO para tests unitarios legacy. Runtime usa captureRecoveryRepository. */
export class RecoveryQueue {
  private readonly byHash = new Map<string, RecoveryRecord>();

  upsert(rec: RecoveryRecord): RecoveryRecord {
    const prev = this.byHash.get(rec.hash_url);
    if (!prev) {
      this.byHash.set(rec.hash_url, rec);
      return rec;
    }
    const merged: RecoveryRecord = {
      ...prev,
      ...rec,
      first_discovered_at: prev.first_discovered_at,
      last_discovered_at: rec.last_discovered_at,
      attempt_count: Math.max(prev.attempt_count, rec.attempt_count),
      discovered_via: prev.discovered_via.includes(rec.discovered_via)
        ? prev.discovered_via
        : `${prev.discovered_via}+${rec.discovered_via}`,
    };
    this.byHash.set(rec.hash_url, merged);
    return merged;
  }

  byStatus(status: RecoveryStatus): RecoveryRecord[] {
    return [...this.byHash.values()].filter((r) => r.status === status);
  }

  snapshot(): RecoveryRecord[] {
    return [...this.byHash.values()];
  }
}

export function googleAuditorClassify(opts: {
  publisherHost: string;
  knownHosts: Set<string>;
  inLake: boolean;
}): 'AUDIT_HIT' | 'RECOVERY_CANDIDATE' | 'SOURCE_DISCOVERY_PENDING' {
  if (opts.inLake) return 'AUDIT_HIT';
  if (opts.knownHosts.has(opts.publisherHost)) return 'RECOVERY_CANDIDATE';
  return 'SOURCE_DISCOVERY_PENDING';
}
