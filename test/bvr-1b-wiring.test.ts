/**
 * BVR-1B-WIRING-001 — cableado de evidencia estructurada.
 *
 * Fixtures / fake children / logger real en subprocess. 0 crawl live, 0 enrich live,
 * 0 writes a Supabase. No parsea pino-pretty.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { spawnOwned } from '../src/mediaValidation/batchLock.js';
import {
  BVR_CHILD_LOG_FORMAT,
  BVR_EVIDENCE_TRANSPORT,
  childEvidenceEnv,
  composeChildEvidenceLogText,
  composeFromArtifacts,
  createLiveBatchAdapters,
  runBatch,
  type BatchRunnerAdapters,
} from '../src/mediaValidation/batchRunner.js';
import { OPERATIONAL_CALIBRATION_PROFILE_PATH } from '../src/mediaValidation/calibration.js';
import type { ContentSanitySummary } from '../src/mediaValidation/contentSanity.js';
import type { SnapshotResult } from '../src/mediaValidation/newsLakeSnapshot.js';
import { aggregateRunEvidence } from '../src/mediaValidation/runEvidenceAggregator.js';
import { buildCrawlMediaSummaryLogPayload } from '../src/crawlers/index.js';
import { buildEnrichMediaSummaryLogPayload } from '../src/enrichers/enrichNews.js';
import { fakeMediaSnapshot } from './fixtures/validationEvidenceFixtures.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APPROVED_PROFILE = join(REPO_ROOT, OPERATIONAL_CALIBRATION_PROFILE_PATH);
const TSX_CLI = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const EMIT_FIXTURE = join(REPO_ROOT, 'test', 'fixtures', 'bvr-emit-structured-summary.ts');
const NOW = '2026-09-15T18:00:00.000Z';
const GIT = 'dd3079f0af815a49ecf799ea7b7acfddcaa2fb32';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bvr-1b-wiring-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function healthySanity(sampleTotal: number): ContentSanitySummary {
  return {
    schema_version: 1,
    availability: 'AVAILABLE',
    issue: null,
    sample_total: sampleTotal,
    encoding_suspect_count: 0,
    listing_suspect_count: 0,
    boilerplate_suspect_count: 0,
    placeholder_count: 0,
    blocking_defective_count: 0,
    blocking_defective_rate: 0,
    example_noticia_ids: [],
  };
}

function pinoJsonLine(payload: object, msg: string): string {
  return JSON.stringify({ level: 30, time: 1000, run_by: 'test', ...payload, msg });
}

function crawlJsonLine(
  medioId: string,
  over: Partial<{
    inserted: number;
    duplicates: number;
    detected: number;
    items: number;
    status: string;
    sourceMethod: string | null;
  }> = {},
): string {
  const inserted = over.inserted ?? 2;
  const duplicates = over.duplicates ?? 1;
  const detected = over.detected ?? inserted + duplicates;
  const items = over.items ?? inserted + duplicates;
  return pinoJsonLine(
    buildCrawlMediaSummaryLogPayload({
      medioId,
      status: over.status ?? 'ok',
      sourceMethod: over.sourceMethod === undefined ? 'rss' : over.sourceMethod,
      detected,
      items,
      inserted,
      duplicates,
      promotedDiagnostic: 0,
      terminalErrorMessage: null,
    }),
    `Crawl media summary: ${medioId}`,
  );
}

function enrichJsonLine(
  medioId: string,
  over: Partial<{ processed: number; updated: number; failed: number }> = {},
): string {
  const processed = over.processed ?? 2;
  return pinoJsonLine(
    buildEnrichMediaSummaryLogPayload(
      {
        medio_id: medioId,
        requested: true,
        processed,
        updated: over.updated ?? processed,
        unchanged: 0,
        failed: over.failed ?? 0,
        clean_text_count: processed,
        body_count: processed,
      },
      { dryRun: false },
    ),
    `Enrich por medio completado: ${medioId}`,
  );
}

/** Forma observada en canary-12-v1 (pino-pretty + ANSI). No es JSONL. */
const PINO_PRETTY_CRAWL_SNIPPET = [
  '[10:48:18] \u001b[32mINFO\u001b[39m: \u001b[36mCrawl media summary: MED-0001\u001b[39m',
  '    run_by: "local"',
  '    event: "crawl_media_summary"',
  '    schema_version: 1',
  '    medio_id: "MED-0001"',
  '    status: "ok"',
  '    source_method: "rss"',
  '    detected: 100',
  '    items: 3',
  '    inserted: 3',
  '    duplicates: 0',
  '    promoted_diagnostic: 0',
  '    terminal_error: null',
].join('\n');

const PINO_PRETTY_ENRICH_SNIPPET = [
  '[10:48:22] \u001b[32mINFO\u001b[39m: \u001b[36mEnrich por medio completado: MED-0001\u001b[39m',
  '    run_by: "local"',
  '    event: "enrich_media_summary"',
  '    schema_version: 1',
  '    medio_id: "MED-0001"',
  '    requested: true',
  '    processed: 3',
  '    updated: 3',
  '    unchanged: 0',
  '    failed: 0',
  '    clean_text_count: 3',
  '    body_count: 3',
  '    dry_run: false',
].join('\n');

function snapshotFor(input: {
  contextId: string;
  role: 'BEFORE' | 'AFTER';
  mediaIds: string[];
  windowDays: number;
  windowAnchor: string;
}): SnapshotResult {
  const after = input.role === 'AFTER';
  return {
    schema_version: 1,
    context_id: input.contextId,
    snapshot_role: input.role,
    window_anchor: input.windowAnchor,
    window_days: input.windowDays,
    capture_started_at: NOW,
    capture_completed_at: NOW,
    requested_media_ids: input.mediaIds,
    media: input.mediaIds.map((id) =>
      fakeMediaSnapshot(id, {
        status: 'COMPLETE',
        total_news: after ? 10 : 1,
        clean_text_count: after ? 10 : 1,
        body_count: after ? 10 : 1,
        consistency: 'STABLE_OBSERVED',
        content_sanity: healthySanity(after ? 10 : 1),
      }),
    ),
  };
}

function wiringAdapters(opts: {
  captureStdout: string;
  enrichStdout: string;
  captureStderr?: string;
  enrichStderr?: string;
  captureExit?: number;
  enrichExit?: number;
}): BatchRunnerAdapters {
  return {
    snapshot: async (input) => snapshotFor(input),
    capture: async () => ({
      pid: process.pid,
      exitCode: opts.captureExit ?? 0,
      stdout: opts.captureStdout,
      stderr: opts.captureStderr ?? '',
    }),
    enrich: async () => ({
      pid: process.pid,
      exitCode: opts.enrichExit ?? 0,
      stdout: opts.enrichStdout,
      stderr: opts.enrichStderr ?? '',
    }),
    compose: async (input) => composeFromArtifacts(input),
  };
}

function jsonlLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

describe('BVR-1B-WIRING-001 logger control', () => {
  it('childEvidenceEnv fuerza LOG_FORMAT=json sin tocar NODE_ENV', () => {
    const env = childEvidenceEnv({ LOG_FORMAT: 'pretty', NODE_ENV: 'development', PATH: '/bin' });
    expect(env.LOG_FORMAT).toBe('json');
    expect(env.LOG_FORMAT).toBe(BVR_CHILD_LOG_FORMAT);
    expect(env.NODE_ENV).toBe('development');
    expect(env.CI).toBeUndefined();
  });

  it('createLiveBatchAdapters pide LOG_FORMAT=json en capture y enrich', async () => {
    const adapters = createLiveBatchAdapters(REPO_ROOT);
    const seen: Array<NodeJS.ProcessEnv | undefined> = [];
    const guard = {
      run: async (spec: { env?: NodeJS.ProcessEnv; command: string; args: string[] }) => {
        seen.push(spec.env);
        return { pid: 1, exitCode: 0, stdout: '', stderr: '' };
      },
    };
    await adapters.capture(
      { mediaIds: ['MED-0001'], maxNotas: 3, chunkIndex: 1, chunkCount: 1 },
      guard,
    );
    await adapters.enrich(
      { mediaIds: ['MED-0001'], enrichLimit: 20, windowDays: 7, chunkIndex: 1, chunkCount: 1 },
      guard,
    );
    expect(seen).toHaveLength(2);
    expect(seen[0]?.LOG_FORMAT).toBe('json');
    expect(seen[1]?.LOG_FORMAT).toBe('json');
    expect(seen[0]?.NODE_ENV).toBe(process.env.NODE_ENV);
  });
});

describe('BVR-1B-WIRING-001 machine-readable child (logger real, sin red)', () => {
  it('crawl fixture con LOG_FORMAT=json emite JSONL parseable con crawl_media_summary', async () => {
    const result = await spawnOwned({
      command: process.execPath,
      args: [TSX_CLI, EMIT_FIXTURE, '--kind=crawl', '--medio-id=MED-0001', '--inserted=2', '--duplicates=1'],
      cwd: REPO_ROOT,
      env: childEvidenceEnv(),
    });
    expect(result.exitCode).toBe(0);
    const lines = jsonlLines(result.stdout);
    expect(lines.length).toBeGreaterThan(0);
    const parsed = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    const summary = parsed.find((row) => row.event === 'crawl_media_summary');
    expect(summary).toMatchObject({
      event: 'crawl_media_summary',
      schema_version: 1,
      medio_id: 'MED-0001',
      inserted: 2,
      duplicates: 1,
    });
    const evidence = aggregateRunEvidence({
      logLines: result.stdout,
      requestedMediaIds: ['MED-0001'],
    });
    expect(evidence.media[0]?.crawl.provenance).toBe('STRUCTURED_V1');
  });

  it('enrich fixture con LOG_FORMAT=json emite JSONL parseable con enrich_media_summary', async () => {
    const result = await spawnOwned({
      command: process.execPath,
      args: [TSX_CLI, EMIT_FIXTURE, '--kind=enrich', '--medio-id=MED-0001', '--processed=2'],
      cwd: REPO_ROOT,
      env: childEvidenceEnv(),
    });
    expect(result.exitCode).toBe(0);
    const parsed = jsonlLines(result.stdout).map((line) => JSON.parse(line) as Record<string, unknown>);
    const summary = parsed.find((row) => row.event === 'enrich_media_summary');
    expect(summary).toMatchObject({
      event: 'enrich_media_summary',
      schema_version: 1,
      medio_id: 'MED-0001',
      processed: 2,
      dry_run: false,
    });
    const evidence = aggregateRunEvidence({
      logLines: result.stdout,
      requestedMediaIds: ['MED-0001'],
    });
    expect(evidence.media[0]?.enrich.presence).toBe('PRESENT');
  });
});

describe('BVR-1B-WIRING-001 pretty no se parsea', () => {
  it('PRETTY_PARSER_ADDED = NO: BVR/1B no contienen parser de pino-pretty', () => {
    const batchSrc = readFileSync(join(REPO_ROOT, 'src/mediaValidation/batchRunner.ts'), 'utf-8');
    const aggSrc = readFileSync(join(REPO_ROOT, 'src/mediaValidation/runEvidenceAggregator.ts'), 'utf-8');
    const lockSrc = readFileSync(join(REPO_ROOT, 'src/mediaValidation/batchLock.ts'), 'utf-8');
    const joined = `${batchSrc}\n${aggSrc}\n${lockSrc}`;
    expect(joined).not.toMatch(/pino-pretty/);
    expect(joined).not.toMatch(/translateTime/);
    expect(joined).not.toMatch(/colorize/);
    expect(joined).not.toMatch(/\\x1b\[/);
    expect(joined).not.toMatch(/stripAnsi|strip-ansi|ansi-regex/i);
  });

  it('stdout pretty (forma canary) no produce COMPLETE ni STRUCTURED_V1', () => {
    const pretty = composeChildEvidenceLogText(PINO_PRETTY_CRAWL_SNIPPET, PINO_PRETTY_ENRICH_SNIPPET);
    for (const line of jsonlLines(pretty)) {
      expect(() => JSON.parse(line)).toThrow();
    }
    const evidence = aggregateRunEvidence({
      logLines: pretty,
      requestedMediaIds: ['MED-0001'],
    });
    expect(evidence.media[0]?.evidence_status).toBe('MISSING');
    expect(evidence.media[0]?.crawl.provenance).toBe('NONE');
    expect(evidence.media[0]?.enrich.presence).toBe('MISSING');
  });
});

describe('BVR-1B-WIRING-001 aggregateRunEvidence path', () => {
  it('multi-media: summaries A/B no se mezclan y 1B queda COMPLETE / STRUCTURED_V1', () => {
    const capture = [crawlJsonLine('MED-0001', { inserted: 4, duplicates: 1 }), crawlJsonLine('MED-0002', { inserted: 1, duplicates: 2 })].join(
      '\n',
    );
    const enrich = [enrichJsonLine('MED-0001', { processed: 4 }), enrichJsonLine('MED-0002', { processed: 1 })].join('\n');
    const evidence = aggregateRunEvidence({
      logLines: composeChildEvidenceLogText(capture, enrich),
      requestedMediaIds: ['MED-0001', 'MED-0002'],
    });
    const a = evidence.media.find((m) => m.medio_id === 'MED-0001');
    const b = evidence.media.find((m) => m.medio_id === 'MED-0002');
    expect(a?.evidence_status).toBe('COMPLETE');
    expect(b?.evidence_status).toBe('COMPLETE');
    expect(a?.crawl.provenance).toBe('STRUCTURED_V1');
    expect(b?.crawl.provenance).toBe('STRUCTURED_V1');
    expect(a?.crawl.inserted).toBe(4);
    expect(b?.crawl.inserted).toBe(1);
    expect(a?.enrich.processed).toBe(4);
    expect(b?.enrich.processed).toBe(1);
  });

  it('zero-insert: summary válido con inserted=0 no es MISSING', () => {
    const capture = crawlJsonLine('MED-0001', { inserted: 0, duplicates: 5, detected: 5, items: 5 });
    const enrich = enrichJsonLine('MED-0001', { processed: 0, updated: 0 });
    const evidence = aggregateRunEvidence({
      logLines: composeChildEvidenceLogText(capture, enrich),
      requestedMediaIds: ['MED-0001'],
    });
    expect(evidence.media[0]?.evidence_status).toBe('COMPLETE');
    expect(evidence.media[0]?.crawl.provenance).toBe('STRUCTURED_V1');
    expect(evidence.media[0]?.crawl.inserted).toBe(0);
    expect(evidence.media[0]?.crawl.duplicates).toBe(5);
    expect(evidence.media[0]?.enrich.presence).toBe('PRESENT');
    expect(evidence.media[0]?.enrich.processed).toBe(0);
  });

  it('summary ausente: exit conceptual 0 no se convierte en COMPLETE', () => {
    const capture = JSON.stringify({ level: 30, msg: 'Corrida de ingesta completada.', procesados: 1 });
    const enrich = JSON.stringify({ level: 30, msg: 'Enrich completado', leidas: 0 });
    const evidence = aggregateRunEvidence({
      logLines: composeChildEvidenceLogText(capture, enrich),
      requestedMediaIds: ['MED-0001'],
    });
    expect(evidence.media[0]?.evidence_status).not.toBe('COMPLETE');
    expect(evidence.media[0]?.evidence_status).toBe('MISSING');
    expect(evidence.media[0]?.crawl.provenance).toBe('NONE');
  });
});

describe('BVR-1B-WIRING-001 runBatch + composeFromArtifacts', () => {
  it('canary-shape sintético: exit 0 + persistence VERIFIED + summaries JSONL → evidence no MISSING', async () => {
    const dir = tempDir();
    const capture = [crawlJsonLine('MED-0001', { inserted: 3, duplicates: 0 }), crawlJsonLine('MED-0002', { inserted: 2, duplicates: 1 })].join(
      '\n',
    );
    const enrich = [enrichJsonLine('MED-0001', { processed: 3 }), enrichJsonLine('MED-0002', { processed: 2 })].join('\n');
    const stderrNoise = pinoJsonLine(
      buildCrawlMediaSummaryLogPayload({
        medioId: 'MED-9999',
        status: 'ok',
        sourceMethod: 'rss',
        detected: 9,
        items: 9,
        inserted: 9,
        duplicates: 0,
        promotedDiagnostic: 0,
        terminalErrorMessage: null,
      }),
      'NO debe entrar a 1B',
    );
    const out = await runBatch({
      mediaIds: ['MED-0001', 'MED-0002'],
      profilePath: APPROVED_PROFILE,
      outputDir: dir,
      dryRun: false,
      windowDays: 7,
      windowAnchor: NOW,
      maxNotas: 5,
      enrichLimit: 20,
      chunkSize: 5,
      runId: 'wiring-canary-shape',
      nowIso: () => NOW,
      gitSha: GIT,
      repoRoot: REPO_ROOT,
      adapters: wiringAdapters({
        captureStdout: capture,
        enrichStdout: enrich,
        captureStderr: stderrNoise,
        enrichStderr: 'human warning on stderr',
      }),
    });

    expect(out.manifest.child_log_format).toBe('json');
    expect(out.manifest.evidence_transport).toBe(BVR_EVIDENCE_TRANSPORT);
    expect(out.manifest.window_days).toBe(7);

    const byId = Object.fromEntries(out.media.map((m) => [m.medio_id, m]));
    expect(byId['MED-0001']?.execution_status).toBe('COMPLETED');
    expect(byId['MED-0002']?.execution_status).toBe('COMPLETED');
    expect(byId['MED-0001']?.run_evidence_completeness).toBe('COMPLETE');
    expect(byId['MED-0002']?.run_evidence_completeness).toBe('COMPLETE');
    expect(byId['MED-0001']?.run_evidence_completeness).not.toBe('MISSING');
    expect(byId['MED-0001']?.persistence_status).toBe('VERIFIED');
    expect(byId['MED-0002']?.persistence_status).toBe('VERIFIED');
    expect(out.media.map((m) => m.medio_id).sort()).toEqual(['MED-0001', 'MED-0002']);

    const evidenceJson = JSON.parse(
      readFileSync(join(dir, 'wiring-canary-shape', 'chunks', '001', 'evidence.json'), 'utf-8'),
    ) as {
      media: Array<{
        medio_id: string;
        run_evidence: { evidence_status: string; crawl: { provenance: string; inserted: number }; enrich: { presence: string } };
      }>;
    };
    const ev1 = evidenceJson.media.find((m) => m.medio_id === 'MED-0001');
    const ev2 = evidenceJson.media.find((m) => m.medio_id === 'MED-0002');
    expect(ev1?.run_evidence.crawl.provenance).toBe('STRUCTURED_V1');
    expect(ev2?.run_evidence.crawl.provenance).toBe('STRUCTURED_V1');
    expect(ev1?.run_evidence.enrich.presence).toBe('PRESENT');
    expect(ev1?.run_evidence.crawl.inserted).toBe(3);
    expect(ev2?.run_evidence.crawl.inserted).toBe(2);

    const runLog = readFileSync(join(dir, 'wiring-canary-shape', 'chunks', '001', 'run.log'), 'utf-8');
    expect(runLog).toContain('crawl_media_summary');
    expect(runLog).toContain('enrich_media_summary');
    expect(runLog).not.toContain('MED-9999');
    expect(runLog).not.toContain('human warning on stderr');
  });

  it('child exit 0 + summaries missing → no PASS; 1B MISSING', async () => {
    const dir = tempDir();
    const out = await runBatch({
      mediaIds: ['MED-0001'],
      profilePath: APPROVED_PROFILE,
      outputDir: dir,
      dryRun: false,
      windowDays: 7,
      windowAnchor: NOW,
      maxNotas: 5,
      enrichLimit: 20,
      chunkSize: 5,
      runId: 'wiring-missing-summary',
      nowIso: () => NOW,
      gitSha: GIT,
      repoRoot: REPO_ROOT,
      adapters: wiringAdapters({
        captureStdout: JSON.stringify({ level: 30, msg: 'Corrida de ingesta completada.', procesados: 1 }),
        enrichStdout: JSON.stringify({ level: 30, msg: 'Enrich ok', leidas: 0 }),
      }),
    });
    expect(out.media[0]?.execution_status).toBe('COMPLETED');
    expect(out.media[0]?.run_evidence_completeness).toBe('MISSING');
    expect(out.media[0]?.validation_result).not.toBe('PASS');
    expect(out.media[0]?.issues.some((issue) => issue.includes('run_evidence_not_complete'))).toBe(true);
  });

  it('capture exit != 0 sigue siendo CAPTURE_ERROR aunque stdout tenga summary JSON', async () => {
    const dir = tempDir();
    const out = await runBatch({
      mediaIds: ['MED-0001'],
      profilePath: APPROVED_PROFILE,
      outputDir: dir,
      dryRun: false,
      windowDays: 7,
      windowAnchor: NOW,
      maxNotas: 5,
      enrichLimit: 20,
      chunkSize: 5,
      runId: 'wiring-capture-error',
      nowIso: () => NOW,
      gitSha: GIT,
      repoRoot: REPO_ROOT,
      adapters: wiringAdapters({
        captureStdout: crawlJsonLine('MED-0001'),
        enrichStdout: enrichJsonLine('MED-0001'),
        captureExit: 1,
      }),
    });
    expect(out.media[0]?.execution_status).toBe('FAILED');
    expect(out.media[0]?.error?.code).toBe('CAPTURE_ERROR');
    expect(out.media[0]?.validation_result).toBeNull();
    expect(out.media[0]?.run_evidence_completeness).toBeNull();
  });

  it('enrich exit != 0 sigue siendo ENRICH_ERROR', async () => {
    const dir = tempDir();
    const out = await runBatch({
      mediaIds: ['MED-0001'],
      profilePath: APPROVED_PROFILE,
      outputDir: dir,
      dryRun: false,
      windowDays: 7,
      windowAnchor: NOW,
      maxNotas: 5,
      enrichLimit: 20,
      chunkSize: 5,
      runId: 'wiring-enrich-error',
      nowIso: () => NOW,
      gitSha: GIT,
      repoRoot: REPO_ROOT,
      adapters: wiringAdapters({
        captureStdout: crawlJsonLine('MED-0001'),
        enrichStdout: enrichJsonLine('MED-0001'),
        enrichExit: 2,
      }),
    });
    expect(out.media[0]?.execution_status).toBe('FAILED');
    expect(out.media[0]?.error?.code).toBe('ENRICH_ERROR');
    expect(out.media[0]?.validation_result).toBeNull();
  });
});
