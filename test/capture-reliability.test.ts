import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { admitDiscoveredArticle } from '../src/captureReliability/articleAdmission.js';
import { rssWindowCompleteness, sitemapWindowCompleteness } from '../src/captureReliability/rssWindow.js';
import { classifyFetchFailure, nextBackoffSeconds } from '../src/captureReliability/retry.js';
import { emptyCheckpoint, persistProgress, resumeFrom, timeBudgetExceeded } from '../src/captureReliability/checkpoint.js';
import { decideDiscoveredUrl, decideFetchError, unionDiscovery, type LakeRow } from '../src/captureReliability/reconcile.js';
import { lakeHasUrl, primaryHash, captureCanonicalUrl } from '../src/captureReliability/urlIndex.js';
import { googleAuditorClassify } from '../src/captureReliability/recoveryQueue.js';
import type { DiscoveredUrl } from '../src/captureReliability/types.js';

const AFONDO =
  'https://afondojalisco.com/monreal-arropa-a-mery-pozos-durante-su-informe-fortalece-su-presencia-rumbo-a-guadalajara/';
const CONCIENCIA = 'https://concienciapublica.com.mx/2026/10/02/monreal-mery-pozos/';
const ENTORNO =
  'https://entornoinformativo.com.mx/plantea-fortalecer-presupuesto-a-universidades-publicas-la-rectora-de-unison-dena-maria-camarena/';

function disc(over: Partial<DiscoveredUrl> & { url: string }): DiscoveredUrl {
  return {
    canonicalUrl: captureCanonicalUrl(over.url),
    hashUrl: primaryHash(over.url),
    medioId: over.medioId ?? 'MED-0202',
    fuenteId: null,
    hostname: 'afondojalisco.com',
    discoveredVia: over.discoveredVia ?? 'rss',
    publishedAt: over.publishedAt ?? '2026-10-02T14:20:00.000Z',
    titulo: over.titulo ?? 'Nota',
    resumen: over.resumen ?? null,
    body: over.body ?? null,
    ...over,
  };
}

function opts(lake: string[] = [], rows: LakeRow[] = []) {
  const lakeHashes = new Set(lake);
  const lakeByHash = new Map(rows.map((r) => [r.hash_url, r] as const));
  return {
    nowIso: '2026-10-02T18:00:00.000Z',
    lakeHashes,
    lakeByHash,
    knownHosts: new Map([
      ['afondojalisco.com', { medioId: 'MED-0202' }],
      ['concienciapublica.com.mx', { medioId: 'MED-0201' }],
      ['entornoinformativo.com.mx', { medioId: 'MED-0441' }],
    ]),
  };
}

describe('Capture reliability V2', () => {
  it('T1 cron gap 6h recoverable', () => {
    const d = disc({ url: AFONDO, publishedAt: '2026-10-02T12:00:00.000Z' });
    const dec = decideDiscoveredUrl(d, opts());
    expect(dec.action).toBe('WOULD_INSERT');
    expect(dec.record.status).toBe('QUEUED');
  });

  it('T2 cron gap 26h recoverable por ventana 72h', () => {
    const d = disc({
      url: ENTORNO,
      medioId: 'MED-0441',
      publishedAt: '2026-10-01T10:00:00.000Z',
    });
    const dec = decideDiscoveredUrl(d, opts());
    expect(dec.action).toBe('WOULD_INSERT');
  });

  it('T3 same URL rediscovered does not duplicate', () => {
    const a = disc({ url: AFONDO, discoveredVia: 'rss' });
    const b = disc({ url: AFONDO, discoveredVia: 'rss-again' });
    const u = unionDiscovery([[a], [b]]);
    expect(u).toHaveLength(1);
  });

  it('T4 RSS + sitemap same article does not duplicate', () => {
    const u = unionDiscovery([
      [disc({ url: CONCIENCIA, medioId: 'MED-0201', discoveredVia: 'rss' })],
      [disc({ url: CONCIENCIA, medioId: 'MED-0201', discoveredVia: 'sitemap' })],
    ]);
    expect(u).toHaveLength(1);
    expect(u[0]!.discoveredVia).toContain('rss');
    expect(u[0]!.discoveredVia).toContain('sitemap');
  });

  it('T5 tracking URL canonicalizes to existing article', () => {
    const clean = AFONDO;
    const tracked = `${AFONDO}?utm_source=google&fbclid=abc`;
    expect(lakeHasUrl(new Set([primaryHash(clean)]), tracked)).toBe(true);
  });

  it('T6 title NULL + valid article body is not rejected solely for title', () => {
    const r = admitDiscoveredArticle({
      url: AFONDO,
      medioId: 'MED-0202',
      titulo: null,
      body: 'Cuerpo editorial válido '.repeat(8),
    });
    expect(r.admit).toBe(true);
  });

  it('T7 resumen NULL does not invalidate article', () => {
    const r = admitDiscoveredArticle({
      url: CONCIENCIA,
      medioId: 'MED-0201',
      titulo: 'Monreal llama a no dejar sola a Mery Pozos',
      resumen: null,
      publishedAt: '2026-10-02T12:25:22.000Z',
    });
    expect(r.admit).toBe(true);
  });

  it('T8 homepage/tag/category still rejected', () => {
    expect(admitDiscoveredArticle({ url: 'https://afondojalisco.com/', medioId: 'MED-0202' }).admit).toBe(false);
    expect(
      admitDiscoveredArticle({ url: 'https://concienciapublica.com.mx/tag/jalisco/', medioId: 'MED-0201' }).admit,
    ).toBe(false);
    expect(
      admitDiscoveredArticle({ url: 'https://concienciapublica.com.mx/category/politica/', medioId: 'MED-0201' }).admit,
    ).toBe(false);
  });

  it('T9 transient 5xx remains retryable', () => {
    expect(classifyFetchFailure({ httpStatus: 503 })).toBe('RETRY');
    const rec = decideFetchError(
      {
        canonical_url: AFONDO,
        discovered_url: AFONDO,
        hash_url: primaryHash(AFONDO),
        medio_id: 'MED-0202',
        fuente_id: null,
        discovered_via: 'rss',
        first_discovered_at: 't',
        last_discovered_at: 't',
        attempt_count: 1,
        status: 'QUEUED',
        root_cause: null,
        last_error: null,
      },
      { httpStatus: 500 },
    );
    expect(rec.record.status).toBe('RETRY');
    expect(nextBackoffSeconds(2)).toBeGreaterThan(0);
  });

  it('T10 blocked source explicitly classified', () => {
    expect(classifyFetchFailure({ httpStatus: 403 })).toBe('BLOCKED');
  });

  it('T11 RSS truncated -> reconciliation_complete false unless supplemented', () => {
    const r = rssWindowCompleteness(
      [{ publishedAt: '2026-10-02T16:00:00.000Z' }, { publishedAt: '2026-10-02T17:00:00.000Z' }],
      '2026-10-01T18:00:00.000Z',
      '2026-10-02T18:00:00.000Z',
    );
    expect(r.flag).toBe('NO');
  });

  it('T12 sitemap pagination covers window', () => {
    expect(
      sitemapWindowCompleteness({ paginationComplete: true, datedInWindow: 10, indexFollowed: true, capHit: false }),
    ).toBe('YES');
    expect(
      sitemapWindowCompleteness({ paginationComplete: false, datedInWindow: 10, indexFollowed: true, capHit: false }),
    ).toBe('NO');
  });

  it('T13 safety cap -> incomplete explicit', () => {
    expect(
      sitemapWindowCompleteness({ paginationComplete: true, datedInWindow: 1, indexFollowed: true, capHit: true }),
    ).toBe('NO');
  });

  it('T14 time budget -> checkpoint persists', () => {
    let cp = emptyCheckpoint({
      run_id: 'r1',
      mode: '24h',
      window_start: 'a',
      window_end: 'b',
    });
    cp = persistProgress(cp, 'MED-0202', '2026-10-02T18:00:00.000Z');
    expect(cp.last_medio_id).toBe('MED-0202');
    expect(resumeFrom(cp, ['MED-0202', 'MED-0441'])).toEqual(['MED-0441']);
    expect(timeBudgetExceeded(0, 1000, 1000)).toBe(true);
  });

  it('T15 existing noticia missing body -> enrich path, not new insert', () => {
    const hash = primaryHash(AFONDO);
    const row: LakeRow = {
      hash_url: hash,
      url_original: AFONDO,
      url_canonica: captureCanonicalUrl(AFONDO),
      texto_cuerpo_nota: null,
      texto_nota_limpia: null,
    };
    const dec = decideDiscoveredUrl(disc({ url: AFONDO }), opts([hash], [row]));
    expect(dec.action).toBe('WOULD_ENRICH');
  });

  it('T16 A Fondo incident explainable/recoverable', () => {
    const published = Date.parse('2026-10-02T14:20:22Z');
    const captured = Date.parse('2026-10-02T15:59:37Z');
    expect(captured - published).toBeGreaterThan(60 * 60 * 1000);
    const ifMissed = decideDiscoveredUrl(disc({ url: AFONDO }), opts());
    expect(ifMissed.action).toBe('WOULD_INSERT');
  });

  it('T17 Conciencia incident explainable/recoverable', () => {
    const d = disc({ url: CONCIENCIA, medioId: 'MED-0201' });
    expect(decideDiscoveredUrl(d, opts()).action).toBe('WOULD_INSERT');
  });

  it('T18 Entorno incident discovered as gap/recoverable', () => {
    const d = disc({ url: ENTORNO, medioId: 'MED-0441' });
    expect(decideDiscoveredUrl(d, opts()).action).toBe('WOULD_INSERT');
    expect(googleAuditorClassify({ publisherHost: 'entornoinformativo.com.mx', knownHosts: new Set(['entornoinformativo.com.mx']), inLake: false })).toBe(
      'RECOVERY_CANDIDATE',
    );
  });

  it('T19 Agent B untouched', () => {
    const ingest = readFileSync('scripts/capture-reconcile.ts', 'utf8');
    expect(ingest).not.toMatch(/mentions-master-fast-lane/);
    expect(ingest).not.toMatch(/detect-mentions/);
  });

  it('T20 sends = 0', () => {
    const ingest = readFileSync('scripts/capture-reconcile.ts', 'utf8');
    expect(ingest).not.toMatch(/send-internal-alerts|whatsapp|twilio|nodemailer/i);
    expect(ingest).toMatch(/PRODUCTION_RECOVERY_WRITES: 0/);
  });
});
