import { GEO_GAP_P1, GEO_GAP_P2, type EvidenceTier, type SourceKind } from './types.js';
import { foldName } from './identity.js';

export interface PriorityInput {
  evidenceTier: EvidenceTier;
  sampleWithin30d: boolean;
  estado: string | null;
  categoria: string | null;
  sourceKind: SourceKind;
  hasWebCaptureHint: boolean;
  uniquenessVsLegacy: boolean;
  municipio: string | null;
}

export interface PriorityBreakdown {
  RECENT_ACTIVITY: number;
  PRIMARY_EVIDENCE: number;
  GEO_GAP: number;
  POLITICAL_VALUE: number;
  LOCAL_VALUE: number;
  REPUTATIONAL_SIGNAL_VALUE: number;
  TECHNICAL_FEASIBILITY: number;
  UNIQUENESS: number;
  SOURCE_KIND: number;
  total: number;
}

/**
 * Score determinista. POLITICAL_VALUE = beat de política/nacional (cobertura),
 * no orientación partidista.
 */
export function expansionPriority(p: PriorityInput): PriorityBreakdown {
  const RECENT_ACTIVITY = p.sampleWithin30d ? 40 : p.evidenceTier === 'PRIMARY' ? 12 : 0;
  const PRIMARY_EVIDENCE = p.evidenceTier === 'PRIMARY' || p.evidenceTier === 'RECENT_30D' ? 20 : 4;
  const est = foldName(p.estado ?? '');
  let GEO_GAP = 4;
  if (GEO_GAP_P1.some((g) => foldName(g) === est)) GEO_GAP = 28;
  else if (GEO_GAP_P2.some((g) => foldName(g) === est)) GEO_GAP = 16;
  const cat = foldName(p.categoria ?? '');
  const POLITICAL_VALUE = /politic|gobierno|congreso|nacional/.test(cat) ? 14 : 0;
  const LOCAL_VALUE = p.municipio && p.municipio.trim() ? 12 : /local|municipal|hiperlocal/.test(cat) ? 10 : 2;
  const signal = p.sourceKind === 'PETITION_PLATFORM' || p.sourceKind === 'NGO' || p.sourceKind === 'INSTITUTIONAL';
  const REPUTATIONAL_SIGNAL_VALUE = signal ? 8 : 0;
  const TECHNICAL_FEASIBILITY = p.hasWebCaptureHint ? 18 : p.sourceKind === 'NEWS_MEDIA' ? 6 : 2;
  const UNIQUENESS = p.uniquenessVsLegacy ? 16 : 0;
  let SOURCE_KIND = 4;
  if (p.sourceKind === 'NEWS_MEDIA' || p.sourceKind === 'REGIONAL_EDITION') SOURCE_KIND = 20;
  else if (p.sourceKind === 'BLOG') SOURCE_KIND = 8;
  else if (p.sourceKind === 'REPUBLISHER') SOURCE_KIND = 6;
  else if (signal) SOURCE_KIND = 2;
  const parts = {
    RECENT_ACTIVITY,
    PRIMARY_EVIDENCE,
    GEO_GAP,
    POLITICAL_VALUE,
    LOCAL_VALUE,
    REPUTATIONAL_SIGNAL_VALUE,
    TECHNICAL_FEASIBILITY,
    UNIQUENESS,
    SOURCE_KIND,
  };
  const total = Object.values(parts).reduce((a, b) => a + b, 0);
  return { ...parts, total };
}

export function isSignalKind(k: SourceKind): boolean {
  return k === 'PETITION_PLATFORM' || k === 'NGO' || k === 'INSTITUTIONAL';
}

export function isNewsKind(k: SourceKind): boolean {
  return k === 'NEWS_MEDIA' || k === 'REGIONAL_EDITION' || k === 'BLOG' || k === 'REPUBLISHER';
}
