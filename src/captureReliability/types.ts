/** Contratos Capture Reliability V2. Cero IA. Cero matching. */

export const RECOVERY_STATUSES = [
  'DISCOVERED',
  'KNOWN_IN_LAKE',
  'QUEUED',
  'FETCHED',
  'PERSISTED',
  'RETRY',
  'BLOCKED',
  'REJECTED_NON_ARTICLE',
  'UNKNOWN_SOURCE',
  'NEEDS_ENRICH',
] as const;
export type RecoveryStatus = (typeof RECOVERY_STATUSES)[number];

export const ROOT_CAUSES = [
  'CRON_GAP',
  'RSS_TRUNCATION',
  'RSS_NOT_EXPOSED',
  'SITEMAP_NOT_SCANNED',
  'PAGINATION_INCOMPLETE',
  'SOURCE_NOT_IN_PLAN',
  'DISCOVERY_FILTER_FALSE_NEGATIVE',
  'ARTICLE_FILTER_FALSE_NEGATIVE',
  'URL_CANONICALIZATION_COLLISION',
  'DEDUPE_FALSE_POSITIVE',
  'FETCH_TRANSIENT',
  'FETCH_BLOCKED',
  'EXTRACTION_FAILURE',
  'LATE_PUBLISHER_DISCOVERY',
  'DELAYED_CAPTURE',
  'OTHER',
] as const;
export type RootCause = (typeof ROOT_CAUSES)[number];

export type CompletenessFlag = 'YES' | 'NO' | 'UNKNOWN';

export interface DiscoveredUrl {
  url: string;
  canonicalUrl: string;
  hashUrl: string;
  medioId: string | null;
  fuenteId: string | null;
  hostname: string;
  discoveredVia: string;
  publishedAt: string | null;
  titulo: string | null;
  resumen: string | null;
  body: string | null;
}

export interface RecoveryRecord {
  canonical_url: string;
  discovered_url: string;
  hash_url: string;
  medio_id: string | null;
  fuente_id: string | null;
  discovered_via: string;
  first_discovered_at: string;
  last_discovered_at: string;
  attempt_count: number;
  status: RecoveryStatus;
  root_cause: RootCause | null;
  last_error: string | null;
}

export interface Checkpoint {
  run_id: string;
  mode: '24h' | '72h' | 'auditor';
  window_start: string;
  window_end: string;
  last_medio_id: string | null;
  processed_medio_ids: string[];
  cap_hit: boolean;
  time_budget_hit: boolean;
  updated_at: string;
}

export interface ReconcileDecision {
  action: 'SKIP_KNOWN' | 'WOULD_INSERT' | 'WOULD_ENRICH' | 'WOULD_RETRY' | 'WOULD_REJECT' | 'SOURCE_DISCOVERY_PENDING';
  record: RecoveryRecord;
}
