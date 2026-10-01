/**
 * Cola de expansión + Wave 1 / Signal. NO promociona medios.
 */
import 'dotenv/config';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getSupabase } from '../src/supabase/client.js';
import { logger } from '../src/utils/logger.js';
import { loadAstraCsvFile } from '../src/sourceRegistry/csv.js';
import { rankCandidates, selectSignalWave, selectWave1 } from '../src/sourceRegistry/waveSelect.js';
import { hostnameOf } from '../src/sourceRegistry/identity.js';
import type { AstraCandidateRow } from '../src/sourceRegistry/types.js';

const SEARCH = [
  'data/source-registry/CANDIDATAS_ACUMULADAS_V2_V3.csv',
  'data/source-registry/CON_MUESTRA_30D_V3.csv',
  'data/source-registry/CDMX_EDOMEX_ADICIONALES_V3.csv',
  'data/source-registry/COBERTURA_32_ENTIDADES_V3.csv',
];

async function main() {
  const extra = process.argv.find((a) => a.startsWith('--csv='))?.slice(6);
  const paths = [...SEARCH, extra].filter((p): p is string => Boolean(p)).map((p) => resolve(p));
  const rows: AstraCandidateRow[] = [];
  const found: string[] = [];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    found.push(p);
    rows.push(...loadAstraCsvFile(p));
  }
  const required = [
    'CANDIDATAS_ACUMULADAS_V2_V3.csv',
    'CON_MUESTRA_30D_V3.csv',
    'CDMX_EDOMEX_ADICIONALES_V3.csv',
    'COBERTURA_32_ENTIDADES_V3.csv',
  ];
  const missing = required.filter(
    (f) => !found.some((p) => p.replace(/\\/g, '/').endsWith(`/${f}`) || p.replace(/\\/g, '/').endsWith(f)),
  );
  for (const f of missing) logger.warn({ file: f }, `ASTRA_INPUT_MISSING=${f}`);

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
    files: found,
    astra_input_missing: missing,
    input_rows: rows.length,
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
    note: 'NO auto-promote. Gate A>=90/D=0/E=0 se aplica sólo tras light+deep autorizados.',
  };
  writeFileSync('artifacts/source-registry-expansion-queue.json', JSON.stringify(report, null, 2));
  logger.info(
    {
      recent: recent.length,
      wave1: wave1.length,
      signal: signal.length,
      production_media_added: 0,
    },
    'expansion queue written',
  );
}

main().catch((err) => {
  logger.error(err, 'source-expansion-queue fatal');
  process.exit(1);
});
