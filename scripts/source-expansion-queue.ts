/**
 * Cola de expansión + Wave 1 / Signal. NO promociona medios.
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { getSupabase } from '../src/supabase/client.js';
import { logger } from '../src/utils/logger.js';
import { loadAstraV3Package } from '../src/sourceRegistry/astraPackage.js';
import { rankCandidates, selectSignalWave, selectWave1 } from '../src/sourceRegistry/waveSelect.js';
import { hostnameOf } from '../src/sourceRegistry/identity.js';

async function main() {
  const pkg = loadAstraV3Package('data/source-registry');
  for (const f of pkg.missing) logger.warn({ file: f }, `ASTRA_INPUT_MISSING=${f}`);
  const rows = pkg.merged;

  const sb = getSupabase();
  const { data: medios } = await sb.from('medios').select('url_base');
  const legacy = new Set(
    (medios ?? []).map((m) => hostnameOf(m.url_base as string | null)).filter((h): h is string => Boolean(h)),
  );

  const ranked = rankCandidates(rows, legacy);
  const wave1 = selectWave1(ranked, 25);
  const signal = selectSignalWave(ranked, 15);
  const recent = ranked.filter((r) => r.row.sample_within_30d && r.band === 'NEWS');

  const report = {
    files: pkg.filesFound,
    astra_input_missing: pkg.missing,
    stats: pkg.stats,
    ranked: ranked.length,
    recent_candidates_ready: recent.length,
    wave1_selected: wave1.map((w) => ({
      name: w.row.name,
      url: w.row.url,
      estado: w.row.estado,
      score: w.score,
      kind: w.sourceKind,
      tier: w.row.evidence_tier,
    })),
    signal_wave_selected: signal.map((w) => ({
      name: w.row.name,
      url: w.row.url,
      kind: w.sourceKind,
      score: w.score,
    })),
    production_media_added: 0,
    note: 'NO auto-promote. Usa paquete mergeado BASE+ENRICH; cobertura no entra.',
  };
  writeFileSync('artifacts/source-registry-expansion-queue.json', JSON.stringify(report, null, 2));
  logger.info(
    {
      recent: recent.length,
      wave1: wave1.length,
      signal: signal.length,
      merged: pkg.stats.merged_unique,
      production_media_added: 0,
    },
    'expansion queue written',
  );
}

main().catch((err) => {
  logger.error(err, 'source-expansion-queue fatal');
  process.exit(1);
});
