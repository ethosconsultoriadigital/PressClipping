import { expansionPriority, isNewsKind } from './priority.js';
import type { AstraCandidateRow, SourceKind } from './types.js';
import { classifySourceKind } from './classifyKind.js';
import { hostnameOf } from './identity.js';

export interface RankedCandidate {
  row: AstraCandidateRow;
  sourceKind: SourceKind;
  score: number;
  band: 'NEWS' | 'SIGNAL';
  uniquenessVsLegacy: boolean;
}

export function rankCandidates(
  rows: AstraCandidateRow[],
  legacyHosts: Set<string>,
): RankedCandidate[] {
  return rows
    .map((row) => {
      const kind = classifySourceKind({
        name: row.name,
        url: row.url,
        hint: row.source_kind_hint,
      });
      const host = hostnameOf(row.url) ?? hostnameOf(row.domain ? `https://${row.domain}` : null);
      const uniquenessVsLegacy = !host || !legacyHosts.has(host);
      const score = expansionPriority({
        evidenceTier: row.evidence_tier,
        sampleWithin30d: row.sample_within_30d,
        estado: row.estado,
        categoria: row.categoria,
        sourceKind: kind.source_kind,
        hasWebCaptureHint: Boolean(row.url || row.domain),
        uniquenessVsLegacy,
        municipio: row.municipio,
      }).total;
      return {
        row,
        sourceKind: kind.source_kind,
        score,
        band: (isNewsKind(kind.source_kind) ? 'NEWS' : 'SIGNAL') as 'NEWS' | 'SIGNAL',
        uniquenessVsLegacy,
      };
    })
    .sort((a, b) => b.score - a.score);
}

export function selectWave1(ranked: RankedCandidate[], max = 25): RankedCandidate[] {
  const news = ranked.filter(
    (r) => r.band === 'NEWS' && r.row.sample_within_30d && r.uniquenessVsLegacy,
  );
  const out: RankedCandidate[] = [];
  const seen = new Set<string>();
  for (const c of news) {
    const k = `${c.row.name}|${c.row.url ?? c.row.domain ?? ''}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
    if (out.length >= max) break;
  }
  return out;
}

export function selectSignalWave(ranked: RankedCandidate[], max = 15): RankedCandidate[] {
  return ranked.filter((r) => r.band === 'SIGNAL').slice(0, max);
}
