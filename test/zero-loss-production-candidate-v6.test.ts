import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildRows,
  type MasterNewsRow,
} from '../scripts/mentions-master-fast-lane.js';
import { parseReconciliationArgs } from '../scripts/mentions-master-reconciliation.js';
import { hasTrustedSearchableText, selectTrustedBody } from '../src/matching/trustedBody.js';
import { MERY_FRASE_EXACTA_BODY_KEYWORD_IDS } from '../src/matching/masterBodyCanary.js';
import { recoveredBy24h, recoveredBy72h } from '../src/matching/matchWindows.js';
import { effectiveRecoveryDryRun } from '../src/matching/recoveryWrites.js';
import { evaluateKeywordContextPolicy, matchKeyword, splitTerminos } from '../src/matchers/keyword.js';
import { toKeywordRule } from '../src/matching/detectMentionsCore.js';
import {
  buildGoogleRecoveryQueryPlan,
  sliceQueryPlan,
} from '../src/matching/googleQueryPlan.js';
import { classifyPublisherIdentity, aggregatePublisherArticles } from '../src/matching/publisherIdentity.js';
import {
  clearUnwindCache,
  resolveGoogleNewsUrl,
  seedUnwindCache,
  unwindCacheSize,
} from '../src/matching/googleNewsUrlUnwind.js';
import type { KeywordActivaRow } from '../src/supabase/repositories.js';

const ROOT = process.cwd();
const ALLOW = [...MERY_FRASE_EXACTA_BODY_KEYWORD_IDS];
const allowOpts = { masterBodyV2: true, bodyPolicy: 'allowlist' as const, keywordAllowlist: ALLOW, mode: 'body_v4' as const };
const signalOpts = { masterBodyV2: false, mode: 'current' as const };
const generalOpts = { masterBodyV2: true, bodyPolicy: 'general' as const, mode: 'body_v4' as const };

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

const BODY =
  'El espacio público requiere debate serio. '.repeat(15) +
  'Que Mery Gómez Pozos tendrá el foro idóneo. ' +
  'El recinto debe elevar la calidad. '.repeat(8);

describe('V6 production candidate runtime', () => {
  it('T1 24h allowlist recovers Informador title with summary NULL', () => {
    const g = {
      keywordsByClient: new Map([['CLI-MERY-TEST', [kw({ keyword_id: 'KEY-0041', keyword: 'Mery Pozos' })]]]),
      clientNames: new Map([['CLI-MERY-TEST', 'Mery']]),
    };
    const n = news({
      noticia_id: '7a790fdf-49bb-47c9-8153-d341614c14a7',
      titulo: 'Mery Pozos destaca cercanía con tapatíos',
      resumen: null,
    });
    expect(hasTrustedSearchableText(n)).toBe(true);
    expect(buildRows([n], g.keywordsByClient, g.clientNames, allowOpts)).toHaveLength(1);
  });

  it('T2/T3 signal gap 6h and 23h recovered by 24h job window', () => {
    expect(recoveredBy24h(6)).toBe(true);
    expect(recoveredBy24h(23)).toBe(true);
    expect(parseReconciliationArgs(['--hours=24']).hours).toBe(24);
  });

  it('T4 26h missed by 24h, recovered by 72h', () => {
    expect(recoveredBy24h(26)).toBe(false);
    expect(recoveredBy72h(26)).toBe(true);
    expect(parseReconciliationArgs(['--hours=72']).hours).toBe(72);
  });

  it('T5 Mery body allowlist recovers BODY-only', () => {
    const g = {
      keywordsByClient: new Map([['CLI-MERY-TEST', [kw({ keyword_id: 'KEY-0042', keyword: 'Mery Gómez Pozos' })]]]),
      clientNames: new Map([['CLI-MERY-TEST', 'Mery']]),
    };
    const n = news({ titulo: 'Presupuesto', resumen: 'Hacienda', texto_cuerpo_nota: BODY });
    expect(buildRows([n], g.keywordsByClient, g.clientNames, signalOpts)).toHaveLength(0);
    expect(buildRows([n], g.keywordsByClient, g.clientNames, allowOpts)).toHaveLength(1);
  });

  it('T6/T7 non-allowlist BODY-only is not production candidate, appears in general shadow', () => {
    const kws = [kw({
      cliente_id: 'CLI-0003',
      keyword_id: 'KEY-0005',
      keyword: 'salario mínimo',
      tipo_keyword: 'frase_exacta',
      contexto_incluir: 'trabajo|empleo|IMSS|comisión|conasami',
    })];
    const n = news({
      noticia_id: 'lab-1',
      titulo: 'Universidades piden presupuesto',
      resumen: 'Cámara',
      texto_cuerpo_nota: `${'La rectora planteó recursos. '.repeat(12)} nivelación de trabajadores por debajo del salario mínimo en la mesa de trabajo.`,
    });
    const grouped = new Map([['CLI-0003', kws]]);
    const names = new Map([['CLI-0003', 'Laboral']]);
    expect(buildRows([n], grouped, names, allowOpts)).toHaveLength(0);
    expect(buildRows([n], grouped, names, generalOpts)).toHaveLength(1);
  });

  it('T8 deep 72h workflow BODY policy is allowlist not general', () => {
    const wf = readFileSync(join(ROOT, '.github/workflows/mentions-master-deep-reconciliation.yml'), 'utf8');
    expect(wf).toContain("MENTIONS_MASTER_BODY_POLICY: 'allowlist'");
    expect(wf).not.toContain("MENTIONS_MASTER_BODY_POLICY: 'general'");
    expect(wf).toContain('--hours=72');
  });

  it('T9 dry_run false without ALLOW flag is fail-closed', () => {
    const r = effectiveRecoveryDryRun(false, { ALLOW_MENTIONS_RECOVERY_WRITES: 'false' });
    expect(r.writes_enabled).toBe(false);
    expect(r.fail_closed).toBe(true);
    expect(r.dryRun).toBe(true);
  });

  it('T10 dry_run false + ALLOW flag enables writes in fixture', () => {
    const r = effectiveRecoveryDryRun(false, { ALLOW_MENTIONS_RECOVERY_WRITES: 'true' });
    expect(r.writes_enabled).toBe(true);
    expect(r.fail_closed).toBe(false);
    expect(r.dryRun).toBe(false);
  });

  it('T11/T12 canonical publisher URL dedupe collapses 3 keywords to one article', () => {
    const items = [
      { publisher_final_url: 'https://concienciapublica.com.mx/2026/10/02/monreal-mery-pozos/' },
      { publisher_final_url: 'https://concienciapublica.com.mx/2026/10/02/monreal-mery-pozos' },
      { publisher_final_url: 'https://concienciapublica.com.mx/2026/10/02/monreal-mery-pozos/' },
    ].map((x) => ({ publisher_final_url: x.publisher_final_url.replace(/\/$/, '') }));
    expect(aggregatePublisherArticles(items).size).toBe(1);
  });

  it('T13 duplicate hostname → KNOWN_AMBIGUOUS', () => {
    const r = classifyPublisherIdentity('https://ejemplo.mx/nota', [
      { medio_id: 'MED-A', url_base: 'https://ejemplo.mx' },
      { medio_id: 'MED-B', url_base: 'https://www.ejemplo.mx' },
    ]);
    expect(r.kind).toBe('KNOWN_AMBIGUOUS');
    expect(r.medio_id).toBeNull();
    expect(r.candidate_medio_ids.sort()).toEqual(['MED-A', 'MED-B']);
  });

  it('T14/T15 query plan has no silent max=16 and cursor resumes', () => {
    const kws = Array.from({ length: 20 }, (_, i) => kw({
      keyword_id: `KEY-${1000 + i}`,
      keyword: `Marca Exacta ${i} SA`,
      tipo_keyword: 'frase_exacta',
    }));
    const plan = buildGoogleRecoveryQueryPlan(kws);
    expect(plan.QUERY_TOTAL).toBe(20);
    const a = sliceQueryPlan(plan, { offset: 0, updated_at: '' }, 8);
    expect(a.QUERY_PROCESSED).toBe(8);
    const b = sliceQueryPlan(plan, a.next, 8);
    expect(b.processed[0]?.query).not.toBe(a.processed[0]?.query);
    expect(b.next.offset).toBe(16);
  });

  it('T16 garturl fail → unresolved, not thrown', async () => {
    const r = await resolveGoogleNewsUrl('https://news.google.com/rss/articles/CBMiOPAQUEFAIL', { allowNetwork: false });
    expect(r.status).toBe('GOOGLE_URL_UNRESOLVED');
  });

  it('T17 cached unwind skips second remote resolution', async () => {
    clearUnwindCache();
    seedUnwindCache('CBMiCACHE1', {
      google_url: 'https://news.google.com/rss/articles/CBMiCACHE1',
      publisher_final_url: 'https://informador.mx/nota',
      canonical_url: 'https://informador.mx/nota',
      publisher_hostname: 'informador.mx',
      status: 'GOOGLE_URL_RESOLVED',
      method: 'google_garturl',
    });
    const r = await resolveGoogleNewsUrl('https://news.google.com/rss/articles/CBMiCACHE1', { allowNetwork: false });
    expect(r.publisher_final_url).toContain('informador.mx');
    expect(unwindCacheSize()).toBeGreaterThan(0);
    clearUnwindCache();
  });

  it('T18 auditor context policy equals production matcher', () => {
    const rule = toKeywordRule(kw({
      keyword_id: 'KEY-IMU',
      keyword: 'IMU',
      tipo_keyword: 'exacta_contextual',
      contexto_incluir: 'publicidad|mobiliario',
      cliente_id: 'CLI-0010',
    }));
    const campos = [
      { nombre: 'titulo', texto: 'Infraestructura', peso: 1 },
      { nombre: 'texto_cuerpo_nota', texto: `${'x '.repeat(40)} IMU gana contrato de mobiliario urbano`, peso: 0.4 },
    ];
    const hit = matchKeyword(rule, campos);
    const ctx = evaluateKeywordContextPolicy(rule, campos);
    expect(Boolean(hit)).toBe(ctx.pasa);
    const camposNo = [
      { nombre: 'titulo', texto: 'Deporte', peso: 1 },
      { nombre: 'texto_cuerpo_nota', texto: `${'x '.repeat(40)} IMU presentó números de taquilla`, peso: 0.4 },
    ];
    expect(matchKeyword(rule, camposNo)).toBeNull();
    expect(evaluateKeywordContextPolicy(rule, camposNo).pasa).toBe(false);
  });

  it('T19 RAW never used', () => {
    const g = {
      keywordsByClient: new Map([['CLI-MERY-TEST', [kw({ keyword_id: 'KEY-0042', keyword: 'Mery Gómez Pozos' })]]]),
      clientNames: new Map([['CLI-MERY-TEST', 'Mery']]),
    };
    const n = news({ texto_extraido: 'Mery Gómez Pozos RAW' });
    expect(buildRows([n], g.keywordsByClient, g.clientNames, allowOpts)).toHaveLength(0);
    expect(selectTrustedBody(n, 'body_v4').text).toBe('');
  });

  it('T20 Agent A workflows/catalog not in new recovery jobs', () => {
    const a = readFileSync(join(ROOT, '.github/workflows/mentions-master-reconciliation-24h.yml'), 'utf8');
    const b = readFileSync(join(ROOT, '.github/workflows/mentions-master-deep-reconciliation.yml'), 'utf8');
    const c = readFileSync(join(ROOT, '.github/workflows/google-news-gap-radar.yml'), 'utf8');
    for (const wf of [a, b, c]) {
      expect(wf).not.toContain('catalog-batch');
      expect(wf).not.toContain('MENTIONS_MASTER_BODY_POLICY: \'general\'');
    }
  });
});

describe('V6 24h job wiring', () => {
  it('24h workflow is match-only allowlist fail-closed', () => {
    const wf = readFileSync(join(ROOT, '.github/workflows/mentions-master-reconciliation-24h.yml'), 'utf8');
    expect(wf).toContain('--hours=24');
    expect(wf).toContain("MENTIONS_MASTER_BODY_POLICY: 'allowlist'");
    expect(wf).toContain('secrets.ALLOW_MENTIONS_RECOVERY_WRITES');
    expect(wf).toContain('mentions-master:reconciliation');
    expect(wf).not.toContain('news-lake:capture');
  });

  it('splitTerminos still splits contexto_incluir', () => {
    expect(splitTerminos('trabajo|empleo|IMSS')).toContain('trabajo');
  });
});
