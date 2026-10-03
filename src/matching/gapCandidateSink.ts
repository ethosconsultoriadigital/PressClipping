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

/** Prepared. Disabled until Agent A capture_gap_candidates contract. */
export class SupabaseGapCandidateSink implements GapCandidateSink {
  constructor(
    private readonly enabled: boolean,
    private readonly client?: { from: (t: string) => any },
    private readonly table = 'capture_gap_candidates',
  ) {}
  async emit(rows: GapCandidate[]): Promise<{ written: number; backend: string }> {
    if (!this.enabled || !this.client) return { written: 0, backend: 'supabase_disabled' };
    const { error } = await this.client.from(this.table).upsert(rows);
    if (error) throw new Error(`GAP_SINK_DB: ${error.message}`);
    return { written: rows.length, backend: 'supabase' };
  }
}
