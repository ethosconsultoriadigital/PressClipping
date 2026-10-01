/**
 * Shadow / dry-run selectivo. NO escribe MASTER. NO alertas. NO detector DB.
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getAllClientes, getKeywordsActivas } from '../src/supabase/repositories.js';
import {
  BRAND_SPECIFIC_BODY_SHADOW_KEYWORD_IDS,
  MERY_FRASE_EXACTA_BODY_KEYWORD_IDS,
} from '../src/matching/masterBodyCanary.js';
import {
  fetchEligibleNews,
  groupKeywordsByActiveClient,
  buildRows,
} from './mentions-master-fast-lane.js';
import { logger } from '../src/utils/logger.js';

const CANARY_ID = '498630e1-5b8e-42d2-b6c5-cbc70387004f';
const FETCH_CAP = 80_000;

function pickRow(row: Record<string, string | number | boolean | null>) {
  return {
    cliente_id: row['cliente_id'],
    noticia_id: row['NOTICIA'],
    medio: row['medio'],
    titulo: row['titulo / titular'],
    url: row['url'],
    campo_match: row['campo_match'],
    keyword_id: row['keyword_id'],
    keyword_ids_matched: row['keyword_ids_matched'],
    keywords_matched: row['keywords_matched'],
    dedupe_key: row['dedupe_key'],
  };
}

function keyOf(row: Record<string, string | number | boolean | null>): string {
  return String(row['dedupe_key'] ?? '').toLowerCase();
}

function filterByKeywordIds(
  rows: Array<Record<string, string | number | boolean | null>>,
  ids: readonly string[],
) {
  const set = new Set(ids.map((id) => id.toUpperCase()));
  return rows.filter((r) =>
    String(r['keyword_ids_matched'] ?? '')
      .split('|')
      .map((s) => s.trim().toUpperCase())
      .some((id) => set.has(id)),
  );
}

async function main(): Promise<void> {
  const sinceIso = new Date(Date.now() - 48 * 3600_000).toISOString();
  const [clients, keywords] = await Promise.all([getAllClientes(), getKeywordsActivas()]);
  const { keywordsByClient, clientNames } = groupKeywordsByActiveClient(clients, keywords);
  logger.info({ sinceIso }, 'selective body canary shadow start (no MASTER writes)');
  const news = await fetchEligibleNews(sinceIso, undefined, FETCH_CAP);
  const current = buildRows(news, keywordsByClient, clientNames);
  const meryCanary = buildRows(news, keywordsByClient, clientNames, {
    masterBodyV2: true,
    keywordAllowlist: MERY_FRASE_EXACTA_BODY_KEYWORD_IDS,
  });
  const brandCanary = buildRows(news, keywordsByClient, clientNames, {
    masterBodyV2: true,
    keywordAllowlist: BRAND_SPECIFIC_BODY_SHADOW_KEYWORD_IDS,
  });

  const meryCurrent = filterByKeywordIds(current, MERY_FRASE_EXACTA_BODY_KEYWORD_IDS);
  const meryRows = filterByKeywordIds(meryCanary, MERY_FRASE_EXACTA_BODY_KEYWORD_IDS);
  const currentKeys = new Set(meryCurrent.map(keyOf));
  const meryBodyOnly = meryRows.filter((r) => !currentKeys.has(keyOf(r)));

  const brandCurrent = filterByKeywordIds(current, BRAND_SPECIFIC_BODY_SHADOW_KEYWORD_IDS);
  const brandRows = filterByKeywordIds(brandCanary, BRAND_SPECIFIC_BODY_SHADOW_KEYWORD_IDS);
  const brandCurrentKeys = new Set(brandCurrent.map(keyOf));
  const brandBodyOnly = brandRows.filter((r) => !brandCurrentKeys.has(keyOf(r)));

  const canaryNews = news.find((n) => n.noticia_id === CANARY_ID);
  const canaryCurrent = current.filter((r) => String(r['NOTICIA']) === CANARY_ID);
  const canaryV2 = meryCanary.filter((r) => String(r['NOTICIA']) === CANARY_ID);

  const payload = {
    generated_at: new Date().toISOString(),
    production_writes: 0,
    master_rows_written: 0,
    alerts_sent: 0,
    fetched: news.length,
    sinceIso,
    milenio_canary: {
      found: Boolean(canaryNews),
      titulo: canaryNews?.titulo ?? null,
      current: canaryCurrent.map(pickRow),
      canary: canaryV2.map(pickRow),
    },
    mery: {
      current: meryCurrent.length,
      canary: meryRows.length,
      body_only: meryBodyOnly.length,
      body_only_rows: meryBodyOnly.map(pickRow),
      all_canary_rows: meryRows.map(pickRow),
    },
    brands: {
      keyword_ids: [...BRAND_SPECIFIC_BODY_SHADOW_KEYWORD_IDS],
      current: brandCurrent.length,
      canary: brandRows.length,
      body_only: brandBodyOnly.length,
      body_only_rows: brandBodyOnly.map(pickRow),
      all_canary_rows: brandRows.map(pickRow),
    },
    broad_keywords_body_enabled: false,
  };

  const dir = join(process.cwd(), 'artifacts');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `selective-body-canary-shadow-${new Date().toISOString().slice(0, 10)}.json`);
  writeFileSync(out, JSON.stringify(payload, null, 2));
  logger.info({ out, fetched: news.length, mery_body_only: meryBodyOnly.length, brand_body_only: brandBodyOnly.length }, 'selective canary shadow written');
  console.log(JSON.stringify({
    out,
    fetched: news.length,
    CURRENT_MERY: meryCurrent.length,
    CANARY_MERY: meryRows.length,
    MERY_BODY_ONLY: meryBodyOnly.length,
    BRAND_BODY_ONLY: brandBodyOnly.length,
    canary_found: Boolean(canaryNews),
  }, null, 2));
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
