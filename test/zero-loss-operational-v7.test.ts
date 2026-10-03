import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { effectiveRecoveryDryRun } from '../src/matching/recoveryWrites.js';
import { newsLakeUrlKeys, matchLakeRowsToPublisher } from '../src/matching/newsLakeUrlLookup.js';
import { registryLoadFromQueryResult, parseFuenteCanales } from '../src/matching/sourceRegistryIdentity.js';
import { classifyPublisherIdentity } from '../src/matching/publisherIdentity.js';
import {
  FileRadarCursorStore,
  afterSlice,
  googleQueryPlanHash,
  reconcileCursor,
} from '../src/matching/radarCursorStore.js';
import { buildGoogleRecoveryQueryPlan, sliceQueryPlan } from '../src/matching/googleQueryPlan.js';
import { applySerializedMasterAppend } from '../src/matching/masterWriterSerialize.js';
import { ArtifactGapCandidateSink, type GapCandidate } from '../src/matching/gapCandidateSink.js';
import { paginationOutcome } from '../src/matching/recoveryPagination.js';
import { canonicalizeUrl } from '../src/normalizers/url.js';
import { sha256 } from '../src/utils/hash.js';
import {
  buildRows,
  type MasterNewsRow,
} from '../scripts/mentions-master-fast-lane.js';
import { MERY_FRASE_EXACTA_BODY_KEYWORD_IDS, MERY_CONTEXTUAL_BODY_CANDIDATE_IDS } from '../src/matching/masterBodyCanary.js';
import { evaluateKeywordContextPolicy, matchKeyword } from '../src/matchers/keyword.js';
import { toKeywordRule } from '../src/matching/detectMentionsCore.js';
import type { KeywordActivaRow } from '../src/supabase/repositories.js';

const ROOT = process.cwd();
const ALLOW = [...MERY_FRASE_EXACTA_BODY_KEYWORD_IDS];
const allowOpts = { masterBodyV2: true, bodyPolicy: 'allowlist' as const, keywordAllowlist: ALLOW, mode: 'body_v4' as const };
const signalOpts = { masterBodyV2: false, mode: 'current' as const };

function kw(over: Partial<KeywordActivaRow> & Pick<KeywordActivaRow, 'keyword_id' | 'keyword'>): KeywordActivaRow {
  return {
    cliente_id: 'CLI-MERY-TEST',
    alias_o_variantes: null,
    tipo_keyword: 'frase_exacta',
    regla: null,
    contexto_incluir: null,
    contexto_excluir: null,
    alerta: false,
    ...over,
  };
}

function news(over: Partial<MasterNewsRow> = {}): MasterNewsRow {
  return {
    noticia_id: 'n1',
    medio_id: 'MED-0001',
    medio_nombre: 'El Informador',
    titulo: null,
    subtitulo: null,
    resumen: null,
    url_original: 'https://www.informador.mx/nota',
    fecha_publicacion: null,
    fecha_captura: '2026-10-01T12:00:00.000Z',
    autor: null,
    seccion: null,
    texto_extraido: null,
    texto_nota_limpia: null,
    texto_cuerpo_nota: null,
    tipo_nota: null,
    calidad_extraccion: 'alta',
    ...over,
  };
}

describe('V7 operational hardening', () => {
  it('T21 shared writer concurrency group on Fast Lane + 24h + 72h', () => {
    for (const f of [
      '.github/workflows/mentions-master-fast-lane.yml',
      '.github/workflows/mentions-master-reconciliation-24h.yml',
      '.github/workflows/mentions-master-deep-reconciliation.yml',
    ]) {
      const wf = readFileSync(join(ROOT, f), 'utf8');
      expect(wf).toContain('group: ethos-mentions-master-writer');
      expect(wf).toContain('cancel-in-progress: false');
    }
  });

  it('T22 missing ALLOW secret => forced dry', () => {
    const r = effectiveRecoveryDryRun(false, {});
    expect(r.writes_enabled).toBe(false);
    expect(r.fail_closed).toBe(true);
  });

  it('T23 false ALLOW secret => forced dry', () => {
    const r = effectiveRecoveryDryRun(false, { ALLOW_MENTIONS_RECOVERY_WRITES: 'false' });
    expect(r.dryRun).toBe(true);
    expect(r.writes_enabled).toBe(false);
  });

  it('T24 true secret + dry_run=false enables fixture write', () => {
    expect(effectiveRecoveryDryRun(false, { ALLOW_MENTIONS_RECOVERY_WRITES: 'true' }).writes_enabled).toBe(true);
  });

  it('T25/T27 canonical-equivalent URL found in Lake', () => {
    const keys = newsLakeUrlKeys('https://WWW.Informador.MX/nota/?utm_source=x');
    const hit = matchLakeRowsToPublisher(keys, [{
      noticia_id: 'abc',
      url_original: 'https://www.informador.mx/nota',
      url_canonica: keys.canonical,
      hash_url: keys.hash_url,
    }]);
    expect(hit?.noticia_id).toBe('abc');
    expect(keys.hash_url).toBe(sha256(canonicalizeUrl('https://www.informador.mx/nota')));
  });

  it('T26 missing known when no lake row', () => {
    const keys = newsLakeUrlKeys('https://entornoinformativo.com.mx/nota-x');
    expect(matchLakeRowsToPublisher(keys, [])).toBeNull();
  });

  it('T28 registry parser uses fuente_canales fields not fuentes.url_base', () => {
    const src = readFileSync(join(ROOT, 'scripts/google-news-gap-radar.ts'), 'utf8');
    expect(src).toContain("from('fuente_canales')");
    expect(src).not.toContain("from('fuentes').select('fuente_id,url_base')");
    const parsed = parseFuenteCanales([{ fuente_id: 'F1', hostname: 'x.com', canonical_domain: 'x.com', platform: 'WEB', activo: true }]);
    expect(parsed[0]?.fuente_id).toBe('F1');
  });

  it('T29 registry failure reports fallback explicitly', () => {
    const r = registryLoadFromQueryResult({ error: 'column fuentes.url_base does not exist', rows: [] });
    expect(r.SOURCE_REGISTRY_READY).toBe(false);
    expect(r.SOURCE_REGISTRY_FALLBACK).toBe(true);
    expect(r.error).toContain('url_base');
  });

  it('T30 durable query cursor survives fresh process (file store)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'radar-cursor-'));
    const path = join(dir, 'cursor.json');
    const a = new FileRadarCursorStore(path);
    await a.save({
      plan_hash: 'h1',
      offset: 12,
      cycle_started_at: 't0',
      last_query_normalized: 'mery pozos',
      updated_at: 't1',
    });
    const b = new FileRadarCursorStore(path);
    const loaded = await b.load();
    expect(loaded?.offset).toBe(12);
  });

  it('T31 47 query plan completes over 4 batches of 12 then rotates', () => {
    const kws = Array.from({ length: 47 }, (_, i) => kw({
      keyword_id: `KEY-${2000 + i}`,
      keyword: `Identidad Marca ${i} SA de CV`,
    }));
    const plan = buildGoogleRecoveryQueryPlan(kws);
    expect(plan.QUERY_TOTAL).toBe(47);
    let cur = { offset: 0, updated_at: '' };
    const seen = new Set<string>();
    for (let i = 0; i < 4; i++) {
      const s = sliceQueryPlan(plan, cur, 12);
      for (const q of s.processed) seen.add(q.normalized);
      cur = s.next;
    }
    expect(seen.size).toBe(47);
    expect(cur.offset).toBe(0);
  });

  it('T32 final URL dedupe before gap handoff', async () => {
    const collected: GapCandidate[][] = [];
    const sink = new ArtifactGapCandidateSink((p) => collected.push((p as { candidates: GapCandidate[] }).candidates));
    await sink.emit([
      { publisher_final_url: 'https://a.mx/n', canonical_hash: 'h', hostname: 'a.mx', medio_id: 'MED-1', candidate_medio_ids: ['MED-1'], fuente_id: null, candidate_fuente_ids: [], cliente_ids: ['C1'], keyword_ids: ['K1'], queries: ['q'], google_item_urls: ['g1'], first_discovered_at: 't', last_discovered_at: 't', discovered_via: 'GOOGLE_NEWS_RADAR', discovery_status: 'MISSING_KNOWN_SOURCE' },
    ]);
    expect(collected[0]).toHaveLength(1);
  });

  it('T33 ambiguous host no arbitrary medio', () => {
    const r = classifyPublisherIdentity('https://ejemplo.mx/n', [
      { medio_id: 'MED-A', url_base: 'https://ejemplo.mx' },
      { medio_id: 'MED-B', url_base: 'https://www.ejemplo.mx' },
    ]);
    expect(r.kind).toBe('KNOWN_AMBIGUOUS');
    expect(r.medio_id).toBeNull();
  });

  it('T34 artifact upload config present', () => {
    const wf = readFileSync(join(ROOT, '.github/workflows/google-news-gap-radar.yml'), 'utf8');
    expect(wf).toContain('actions/upload-artifact@v4');
    expect(wf).toContain('google-gap-radar-');
    expect(wf).toContain("cron: '37 * * * *'");
  });

  it('T35/T36 Mery contextual 0048-0051 use shared context policy', () => {
    expect([...MERY_CONTEXTUAL_BODY_CANDIDATE_IDS]).toEqual(['KEY-0048', 'KEY-0049', 'KEY-0050', 'KEY-0051']);
    const rule = toKeywordRule(kw({
      keyword_id: 'KEY-0048',
      keyword: 'Merilyn Gómez',
      tipo_keyword: 'exacta_contextual',
      contexto_incluir: 'Pozos|Mery',
    }));
    const campos = [
      { nombre: 'titulo', texto: 'Diputada', peso: 1 },
      { nombre: 'texto_cuerpo_nota', texto: `${'x '.repeat(30)} Merilyn Gómez Pozos presidió la mesa`, peso: 0.4 },
    ];
    expect(Boolean(matchKeyword(rule, campos))).toBe(evaluateKeywordContextPolicy(rule, campos).pasa);
  });

  it('T37 three Informador are SIGNAL recovery cases', () => {
    const g = {
      keywordsByClient: new Map([['CLI-MERY-TEST', [kw({ keyword_id: 'KEY-0041', keyword: 'Mery Pozos' })]]]),
      clientNames: new Map([['CLI-MERY-TEST', 'Mery']]),
    };
    const ids = [
      '7a790fdf-49bb-47c9-8153-d341614c14a7',
      'c00957ec-4bb7-4f66-85ba-e4965e02678b',
      'cde2e64c-767d-41a0-ac31-793ea9cff836',
    ];
    for (const id of ids) {
      const n = news({ noticia_id: id, titulo: 'Mery Pozos en Jalisco', resumen: null });
      const signal = buildRows([n], g.keywordsByClient, g.clientNames, signalOpts);
      expect(signal[0]?.['campo_match']).toBe('TITULO');
      expect(buildRows([n], g.keywordsByClient, g.clientNames, allowOpts)[0]?.['campo_match']).toBe('TITULO');
    }
  });

  it('T38 dry 24h would-append skips existing keys', () => {
    const existing = new Set<string>();
    const first = applySerializedMasterAppend(existing, ['cli-mery-test//7a790fdf-49bb-47c9-8153-d341614c14a7']);
    const second = applySerializedMasterAppend(existing, ['cli-mery-test//7a790fdf-49bb-47c9-8153-d341614c14a7']);
    expect(first.appended).toHaveLength(1);
    expect(second.appended).toHaveLength(0);
    expect(second.skipped).toHaveLength(1);
  });

  it('T39 24h CAP_HIT flags incomplete', () => {
    expect(paginationOutcome({ lastBatchLen: 1000, pageSize: 1000, nextFrom: 100_000, cap: 100_000 })).toEqual({
      complete: false,
      capHit: true,
    });
  });

  it('T40 Agent A untouched in recovery workflows', () => {
    const wf = readFileSync(join(ROOT, '.github/workflows/mentions-master-reconciliation-24h.yml'), 'utf8');
    expect(wf).not.toContain('catalog-batch');
    expect(wf).toContain("cron: '07 * * * *'");
    expect(wf).toContain('secrets.ALLOW_MENTIONS_RECOVERY_WRITES');
    expect(wf).not.toContain("MENTIONS_MASTER_BODY_POLICY: 'general'");
  });
});

describe('V7 cursor plan hash', () => {
  it('changing plan resets offset', () => {
    const planA = buildGoogleRecoveryQueryPlan([kw({ keyword_id: 'KEY-1', keyword: 'Alpha Brand SA' })]);
    const planB = buildGoogleRecoveryQueryPlan([kw({ keyword_id: 'KEY-2', keyword: 'Beta Brand SA' })]);
    expect(googleQueryPlanHash(planA)).not.toBe(googleQueryPlanHash(planB));
    const rec = reconcileCursor(planB, {
      plan_hash: googleQueryPlanHash(planA),
      offset: 12,
      cycle_started_at: 'old',
      last_query_normalized: 'x',
      updated_at: 'old',
    });
    expect(rec.offset).toBe(0);
  });
});
