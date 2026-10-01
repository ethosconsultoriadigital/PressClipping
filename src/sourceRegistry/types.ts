/** Contratos del Source Registry V1. Cero IA. */

export const LIFECYCLE_STATUSES = [
  'DISCOVERED',
  'IDENTITY_VERIFIED',
  'PROBED',
  'CERTIFIED',
  'PROMOTED',
  'REJECTED',
] as const;
export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];

export const HEALTH_STATUSES = [
  'HEALTHY',
  'DEGRADED',
  'STALE',
  'BLOCKED_EXTERNAL',
  'DEAD',
  'UNKNOWN',
] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export const CAPTURE_STATUSES = [
  'READY',
  'PARTIAL',
  'API_REQUIRED',
  'SEARCH_ONLY',
  'MANUAL_ONLY',
  'UNSUPPORTED',
  'UNKNOWN',
] as const;
export type CaptureStatus = (typeof CAPTURE_STATUSES)[number];

export const TECHNICAL_CLASSES = ['A', 'B', 'C', 'D', 'E'] as const;
export type TechnicalClass = (typeof TECHNICAL_CLASSES)[number];

export const PLATFORMS = [
  'WEB',
  'FACEBOOK',
  'YOUTUBE',
  'INSTAGRAM',
  'TIKTOK',
  'TELEGRAM',
  'PETITION',
  'OTHER',
] as const;
export type Platform = (typeof PLATFORMS)[number];

export const SOURCE_KINDS = [
  'NEWS_MEDIA',
  'BLOG',
  'REPUBLISHER',
  'REGIONAL_EDITION',
  'PETITION_PLATFORM',
  'NGO',
  'INSTITUTIONAL',
  'SOCIAL_COMMUNITY',
  'OTHER',
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const CONTENT_ORIGINS = [
  'EDITORIAL',
  'UGC_ADVOCACY',
  'INSTITUTIONAL',
  'SOCIAL',
  'MIXED',
  'UNKNOWN',
] as const;
export type ContentOrigin = (typeof CONTENT_ORIGINS)[number];

export const EVIDENCE_TIERS = ['RECENT_30D', 'PRIMARY', 'DIRECTORY'] as const;
export type EvidenceTier = (typeof EVIDENCE_TIERS)[number];

export interface FuenteRow {
  fuente_id: string;
  canonical_name: string;
  display_name: string;
  source_kind: SourceKind;
  content_origin: ContentOrigin;
  pais: string | null;
  estado: string | null;
  municipio: string | null;
  region: string | null;
  categoria: string | null;
  lifecycle_status: LifecycleStatus;
  health_status: HealthStatus;
  capture_status: CaptureStatus;
  technical_class: TechnicalClass | null;
  priority: string | null;
  group_parent_fuente_id: string | null;
  legacy_medio_id: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  notes: string | null;
  expansion_score: number | null;
  astra_batch: string | null;
  evidence_tier: EvidenceTier | null;
  uniqueness_key: string | null;
}

export interface FuenteCanalRow {
  canal_id: string;
  fuente_id: string;
  platform: Platform;
  canonical_url: string | null;
  canonical_domain: string | null;
  hostname: string | null;
  rss_url: string | null;
  sitemap_url: string | null;
  capture_method: string | null;
  capture_feasibility: string | null;
  activo: boolean;
  health_status: HealthStatus;
  capture_status: CaptureStatus;
  technical_class: TechnicalClass | null;
  last_http_status: number | null;
  last_light_probe_at: string | null;
  last_deep_probe_at: string | null;
  last_success_at: string | null;
  latest_content_at: string | null;
  consecutive_failures: number;
  redirect_final_url: string | null;
}

export interface AstraCandidateRow {
  name: string;
  url: string | null;
  domain: string | null;
  estado: string | null;
  municipio: string | null;
  categoria: string | null;
  source_kind_hint: string | null;
  evidence_tier: EvidenceTier;
  astra_batch: string;
  sample_within_30d: boolean;
  notes: string | null;
  facebook_url: string | null;
}

export const GEO_GAP_P1 = ['Hidalgo', 'Campeche', 'Colima', 'Durango'] as const;
export const GEO_GAP_P2 = [
  'Nayarit',
  'Aguascalientes',
  'Oaxaca',
  'Tlaxcala',
  'Chiapas',
  'Nuevo León',
] as const;
