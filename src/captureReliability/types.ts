/** Contratos Capture Reliability V3. */

export const RECOVERY_STATUSES = [
  'DISCOVERED',
  'KNOWN_IN_LAKE',
  'QUEUED',
  'FETCH_TO_CLASSIFY',
  'FETCHING',
  'FETCHED',
  'EXTRACTED',
  'PERSISTED',
  'RETRY',
  'BLOCKED',
  'REJECTED_NON_ARTICLE',
  'UNKNOWN_SOURCE',
  'AMBIGUOUS_SOURCE',
  'NEEDS_ENRICH',
  'FAILED_RETRY_EXHAUSTED',
  'MANUAL_REVIEW',
  'WOULD_PERSIST',
] as const;
export type RecoveryStatus = (typeof RECOVERY_STATUSES)[number];

export const ROOT_CAUSES = [
  'CRON_GAP',
  'RSS_TRUNCATION',
  'RSS_NOT_EXPOSED',
  'SITEMAP_NOT_SCANNED',
  'PAGINATION_INCOMPLETE',
  'SOURCE_NOT_IN_PLAN',
  'NO_DISCOVERY_SURFACE',
  'DISCOVERY_FILTER_FALSE_NEGATIVE',
  'ARTICLE_FILTER_FALSE_NEGATIVE',
  'URL_CANONICALIZATION_COLLISION',
  'DEDUPE_FALSE_POSITIVE',
  'FETCH_TRANSIENT',
  'FETCH_BLOCKED',
  'EXTRACTION_FAILURE',
  'LATE_PUBLISHER_DISCOVERY',
  'DELAYED_CAPTURE',
  'AMBIGUOUS_SOURCE',
] as const;
export type RootCause = (typeof ROOT_CAUSES)[number];

export type CompletenessFlag = 'YES' | 'NO' | 'UNKNOWN';
export type SourceJobStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETE' | 'INCOMPLETE';

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
  windowMembership?: 'IN_WINDOW' | 'OUT_OF_WINDOW' | 'WINDOW_MEMBERSHIP_UNKNOWN';
}

export interface RecoveryRecord {
  canonical_url: string;
  discovered_url: string;
  hash_url: string;
  medio_id: string | null;
  fuente_id: string | null;
  hostname: string | null;
  discovered_via: string;
  first_discovered_at: string;
  last_discovered_at: string;
  attempt_count: number;
  status: RecoveryStatus;
  root_cause: RootCause | null;
  last_error: string | null;
  claimed_at: string | null;
  claimed_by: string | null;
  next_retry_at: string | null;
  noticia_id: string | null;
  published_at: string | null;
  discovered_title: string | null;
  discovered_summary: string | null;
  last_dry_run_result: string | null;
  window_membership?: 'IN_WINDOW' | 'OUT_OF_WINDOW' | 'WINDOW_MEMBERSHIP_UNKNOWN' | null;
}

export interface SourceReconcileState {
  medio_id: string;
  window_start: string;
  window_end: string;
  status: SourceJobStatus;
  cursor: string | null;
  started_at: string | null;
  completed_at: string | null;
  last_error: string | null;
  discovery_surfaces: string[];
  rss_span_covered: CompletenessFlag;
  sitemap_span_covered: CompletenessFlag;
  listing_span_covered: CompletenessFlag;
  sitemap_runtime_completeness_invoked: boolean;
  urls_discovered: number;
  urls_known: number;
  urls_queued: number;
  urls_persisted: number;
  urls_rejected: number;
  urls_blocked: number;
  urls_failed: number;
  unexplained_missing: number;
  cap_hit: boolean;
  time_budget_hit: boolean;
  complete: boolean;
  coverage_verdict?: CoverageVerdict;
  worker_id?: string | null;
}

export interface ReconcileRun {
  run_id: string;
  cycle_id?: string | null;
  mode: '24h' | '72h' | 'auditor';
  window_start: string;
  window_end: string;
  shard_index: number;
  shard_count: number;
  status: 'PENDING' | 'RUNNING' | 'PAUSED' | 'DONE' | 'DRAINED';
  created_at: string;
  updated_at: string;
}

export interface GapCandidate {
  candidate_id: string;
  discovered_url: string;
  publisher_final_url: string | null;
  hostname: string | null;
  discovered_via: string;
  discovered_at: string;
  canonical_hash: string | null;
  discovered_urls: string[];
  medio_id: string | null;
  fuente_id: string | null;
  candidate_medio_ids?: string[] | null;
  candidate_fuente_ids?: string[] | null;
  cliente_ids?: string[] | null;
  keyword_ids?: string[] | null;
  queries?: string[] | null;
  google_item_urls?: string[] | null;
  first_discovered_at?: string | null;
  last_discovered_at?: string | null;
  discovery_status?: string | null;
  claimed_at?: string | null;
  claimed_by?: string | null;
  consumed_at?: string | null;
}

export interface ReconcileDecision {
  action:
    | 'SKIP_KNOWN'
    | 'WOULD_INSERT'
    | 'WOULD_ENRICH'
    | 'WOULD_RETRY'
    | 'WOULD_REJECT'
    | 'SOURCE_DISCOVERY_PENDING'
    | 'AMBIGUOUS_SOURCE'
    | 'WOULD_PERSIST';
  record: RecoveryRecord;
}

export interface ChannelCatalogRow {
  medio_id: string;
  url_base: string | null;
  rss_url: string | null;
  sitemap_url: string | null;
  hostname: string | null;
  metodo_extraccion?: string | null;
  secciones_urls?: string | null;
}

export interface DiscoverOpts {
  resumeCursor?: string | null;
  skipSurfaces?: string[];
  onlySurfaces?: string[];
  probeListing?: boolean;
  sitemapPageSize?: number;
}

/** Vista de corrida para reportes. El estado durable vive en SourceReconcileState. */
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

export const TERMINAL_RECOVERY: RecoveryStatus[] = [
  'KNOWN_IN_LAKE',
  'PERSISTED',
  'WOULD_PERSIST',
  'BLOCKED',
  'REJECTED_NON_ARTICLE',
  'FAILED_RETRY_EXHAUSTED',
  'MANUAL_REVIEW',
  'AMBIGUOUS_SOURCE',
  'UNKNOWN_SOURCE',
];

export const EXPLAINED_RECOVERY: RecoveryStatus[] = [
  ...TERMINAL_RECOVERY,
  'QUEUED',
  'FETCH_TO_CLASSIFY',
  'RETRY',
  'FETCHING',
  'FETCHED',
  'EXTRACTED',
  'NEEDS_ENRICH',
];

export type CoverageVerdict = 'COVERAGE_CONFIRMED' | 'COVERAGE_PARTIAL' | 'COVERAGE_UNKNOWN';

export interface RecoveryObservation {
  run_id: string;
  hash_url: string;
  medio_id: string | null;
  window_start: string;
  window_end: string;
  discovered_via: string;
  observed_status: RecoveryStatus;
  observed_at: string;
  reject_reason: string | null;
}
