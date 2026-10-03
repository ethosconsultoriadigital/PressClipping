import { bGapCandidateToCaptureGapRow, shouldInsertGapCandidate } from './bGapCandidateToCaptureGapRow.js';
import { googleGapDbWritesAllowed } from './googleGapWrites.js';

export interface GapCandidate {
  publisher_final_url: string;
  canonical_hash: string;
  hostname: string | null;
  medio_id: string | null;
  candidate_medio_ids: string[];
  fuente_id: string | null;
  candidate_fuente_ids: string[];
  cliente_ids: string[];
  keyword_ids: string[];
  queries: string[];
  google_item_urls: string[];
  first_discovered_at: string;
  last_discovered_at: string;
  discovered_via: 'GOOGLE_NEWS_RADAR';
  discovery_status: string;
}

export interface GapCandidateSink {
  emit(rows: GapCandidate[]): Promise<{ written: number; backend: string }>;
}

export class ArtifactGapCandidateSink implements GapCandidateSink {
  constructor(private readonly write: (payload: unknown) => void) {}
  async emit(rows: GapCandidate[]): Promise<{ written: number; backend: string }> {
    this.write({ generated_at: new Date().toISOString(), writes: 0, discovered_via: 'GOOGLE_NEWS_RADAR', candidates: rows });
    return { written: rows.length, backend: 'artifact' };
  }
}

/** Metadata only. Never writes News Lake. Upserts by candidate_id = canonical_hash. */
export class SupabaseGapCandidateSink implements GapCandidateSink {
  constructor(
    private readonly enabled: boolean,
    private readonly client?: { from: (t: string) => any },
    private readonly table = 'capture_gap_candidates',
  ) {}
  async emit(rows: GapCandidate[]): Promise<{ written: number; backend: string }> {
    if (!this.enabled || !this.client) return { written: 0, backend: 'supabase_disabled' };
    const payload = rows
      .filter((r) => shouldInsertGapCandidate(r.discovery_status))
      .map((r) => bGapCandidateToCaptureGapRow(r))
      .filter((r): r is NonNullable<typeof r> => r != null);
    if (!payload.length) return { written: 0, backend: 'supabase' };
    const { error } = await this.client.from(this.table).upsert(payload, { onConflict: 'candidate_id' });
    if (error) throw new Error(`GAP_SINK_DB: ${error.message}`);
    return { written: payload.length, backend: 'supabase' };
  }
}

export function createGapCandidateSink(opts: {
  artifactWrite: (payload: unknown) => void;
  client?: { from: (t: string) => any };
  env?: NodeJS.ProcessEnv;
}): { artifact: ArtifactGapCandidateSink; db: SupabaseGapCandidateSink; dbEnabled: boolean } {
  const dbEnabled = googleGapDbWritesAllowed(opts.env);
  return {
    artifact: new ArtifactGapCandidateSink(opts.artifactWrite),
    db: new SupabaseGapCandidateSink(dbEnabled, opts.client),
    dbEnabled,
  };
}
