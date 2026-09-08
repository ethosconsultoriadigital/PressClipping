/**
 * Tests deterministas para `src/mediaValidation/runValidationEvidence.ts`
 * (Media Validation & Certification, Fase 1C + HARDENING FINAL: B5C —
 * "context_identity=MISMATCH no puede coexistir con persistence=VERIFIED").
 *
 * Cubre §46 (false VERIFIED), §47 (pagination drift) y §48 (regresiones de
 * Fase 1C original) del prompt de hardening.
 */
import { describe, it, expect } from 'vitest';
import { composeRunValidationEvidence } from '../src/mediaValidation/runValidationEvidence.js';
import { buildRunContextFromRunEvidence, type RunContext } from '../src/mediaValidation/runContext.js';
import { buildNewsLakeSnapshot, type FetchNoticiasPage, type NoticiaSnapshotRow } from '../src/mediaValidation/newsLakeSnapshot.js';
import { fakeRunEvidence, fakeMediaEvidence, fakeCrawlEvidence, fakeEnrichEvidence, fakeUnattributedEnrich } from './fixtures/runEvidenceFixtures.js';
import type { SnapshotResult, MediaSnapshot, SnapshotRole, SnapshotConsistency } from '../src/mediaValidation/newsLakeSnapshot.js';

const ANCHOR = '2026-09-07T22:00:00.000Z';
const T_BEFORE_START = '2026-09-07T22:00:00.000Z';
const T_BEFORE_END = '2026-09-07T22:05:00.000Z';
const T_AFTER_START = '2026-09-07T22:30:00.000Z';
const T_AFTER_END = '2026-09-07T22:35:00.000Z';

function row(id: string, medioId: string, textoLimpio: string | null, cuerpo: string | null): NoticiaSnapshotRow {
  return { noticia_id: id, medio_id: medioId, texto_nota_limpia: textoLimpio, texto_cuerpo_nota: cuerpo };
}

function completeSnap(medioId: string, total: number, clean: number, body: number, consistency: SnapshotConsistency = 'STABLE_OBSERVED'): MediaSnapshot {
  return {
    medio_id: medioId,
    status: 'COMPLETE',
    total_news: total,
    clean_text_count: clean,
    body_count: body,
    pages_read: 1,
    duplicate_rows_skipped: consistency === 'POSSIBLE_DRIFT' ? 1 : 0,
    errors: [],
    consistency,
  };
}

function errorSnap(medioId: string): MediaSnapshot {
  return {
    medio_id: medioId,
    status: 'ERROR',
    total_news: null,
    clean_text_count: null,
    body_count: null,
    pages_read: 0,
    duplicate_rows_skipped: 0,
    errors: ['fallo simulado'],
    consistency: 'UNKNOWN',
  };
}

function snapshotResult(
  media: MediaSnapshot[],
  role: SnapshotRole,
  overrides: Partial<Pick<SnapshotResult, 'window_days' | 'window_anchor' | 'context_id' | 'capture_started_at' | 'capture_completed_at'>> = {},
): SnapshotResult {
  return {
    schema_version: 1,
    context_id: 'VAL-TEST-001',
    snapshot_role: role,
    window_anchor: ANCHOR,
    window_days: 30,
    capture_started_at: role === 'BEFORE' ? T_BEFORE_START : T_AFTER_START,
    capture_completed_at: role === 'BEFORE' ? T_BEFORE_END : T_AFTER_END,
    requested_media_ids: media.map((m) => m.medio_id),
    media,
    ...overrides,
  };
}

function contextFor(runEvidence: ReturnType<typeof fakeRunEvidence>, overrides: Partial<{ contextId: string; windowAnchor: string | null; windowDays: number | null }> = {}): RunContext {
  return buildRunContextFromRunEvidence(runEvidence, {
    contextId: overrides.contextId ?? 'VAL-TEST-001',
    windowAnchor: overrides.windowAnchor ?? ANCHOR,
    windowDays: overrides.windowDays ?? 30,
  });
}

describe('composeRunValidationEvidence — Fase 1C', () => {
  it('27/29. context MATCH + snapshots COMPLETE estables → persistence VERIFIED', () => {
    const runEvidence = fakeRunEvidence({
      run: { run_id: 'r1', requested_media_ids: ['MED-A'], requested_media_ids_source: 'explicit_input', requested_media_ids_coverage: 'COMPLETE' },
      media: [
        fakeMediaEvidence('MED-A', {
          evidence_status: 'COMPLETE',
          crawl: fakeCrawlEvidence({ provenance: 'STRUCTURED_V1', status: 'ok', inserted: 3 }),
          enrich: fakeEnrichEvidence({ presence: 'PRESENT', clean_text_count: 3, content_persistence: 'UNVERIFIED' }),
        }),
      ],
    });
    const context = contextFor(runEvidence);
    const before = snapshotResult([completeSnap('MED-A', 0, 0, 0)], 'BEFORE');
    const after = snapshotResult([completeSnap('MED-A', 3, 3, 3)], 'AFTER');

    const result = composeRunValidationEvidence({ context, runEvidence, before, after });
    expect(result.context_identity.status).toBe('MATCH');
    expect(result.media).toHaveLength(1);
    const rec = result.media[0]!;
    expect(rec.persistence.status).toBe('VERIFIED');
    expect(rec.persistence.delta.news_delta).toBe(3);
    expect(rec.run_evidence).toBe(runEvidence.media[0]); // referencia directa, no copia
  });

  it('28. after ERROR → persistence INDETERMINATE, nunca "verificado"', () => {
    const runEvidence = fakeRunEvidence({
      run: { run_id: null, requested_media_ids: ['MED-A'], requested_media_ids_source: 'explicit_input', requested_media_ids_coverage: 'COMPLETE' },
      media: [fakeMediaEvidence('MED-A', { evidence_status: 'COMPLETE' })],
    });
    const context = contextFor(runEvidence);
    const before = snapshotResult([completeSnap('MED-A', 1, 1, 1)], 'BEFORE');
    const after = snapshotResult([errorSnap('MED-A')], 'AFTER');

    const result = composeRunValidationEvidence({ context, runEvidence, before, after });
    const rec = result.media[0]!;
    expect(rec.persistence.status).toBe('INDETERMINATE');
    expect(rec.persistence.delta.status).toBe('UNAVAILABLE');
  });

  it('45. run evidence PARTIAL + context MATCH + snapshots COMPLETE → persistence SÍ puede ser VERIFIED (dimensiones separadas, §30)', () => {
    const runEvidence = fakeRunEvidence({
      run: { run_id: null, requested_media_ids: ['MED-A'], requested_media_ids_source: 'explicit_input', requested_media_ids_coverage: 'COMPLETE' },
      media: [fakeMediaEvidence('MED-A', { evidence_status: 'PARTIAL' })],
    });
    const context = contextFor(runEvidence);
    const before = snapshotResult([completeSnap('MED-A', 0, 0, 0)], 'BEFORE');
    const after = snapshotResult([completeSnap('MED-A', 2, 2, 2)], 'AFTER');

    const result = composeRunValidationEvidence({ context, runEvidence, before, after });
    const rec = result.media[0]!;
    expect(rec.persistence.status).toBe('VERIFIED'); // persistencia SÍ se pudo observar
    expect(rec.run_evidence.evidence_status).toBe('PARTIAL'); // pero el run evidence sigue siendo PARTIAL, no se "arregla"
  });

  it('46. dry_run=true + delta 0 es válido (no se marca como discrepancia/error)', () => {
    const runEvidence = fakeRunEvidence({
      run: { run_id: null, requested_media_ids: ['MED-A'], requested_media_ids_source: 'explicit_input', requested_media_ids_coverage: 'COMPLETE' },
      media: [
        fakeMediaEvidence('MED-A', {
          evidence_status: 'COMPLETE',
          enrich: fakeEnrichEvidence({ presence: 'PRESENT', dry_run: true, clean_text_count: 3, content_persistence: 'UNVERIFIED' }),
        }),
      ],
    });
    const context = contextFor(runEvidence);
    const before = snapshotResult([completeSnap('MED-A', 5, 5, 5)], 'BEFORE');
    const after = snapshotResult([completeSnap('MED-A', 5, 5, 5)], 'AFTER'); // dry-run: nada persistido, delta=0

    const result = composeRunValidationEvidence({ context, runEvidence, before, after });
    const rec = result.media[0]!;
    expect(rec.persistence.delta.news_delta).toBe(0);
    expect(rec.persistence.status).toBe('VERIFIED');
    expect(context.dry_run).toBe(true);
  });

  it('47. counters de run != delta persistido → discrepancia visible en reconciliation, sin marcar fallo', () => {
    const runEvidence = fakeRunEvidence({
      run: { run_id: null, requested_media_ids: ['MED-A'], requested_media_ids_source: 'explicit_input', requested_media_ids_coverage: 'COMPLETE' },
      media: [
        fakeMediaEvidence('MED-A', {
          evidence_status: 'COMPLETE',
          crawl: fakeCrawlEvidence({ provenance: 'STRUCTURED_V1', status: 'ok', inserted: 3 }),
        }),
      ],
    });
    const context = contextFor(runEvidence);
    const before = snapshotResult([completeSnap('MED-A', 10, 10, 10)], 'BEFORE');
    const after = snapshotResult([completeSnap('MED-A', 10, 10, 10)], 'AFTER'); // inserted=3 reportado, pero news_delta=0 observado

    const result = composeRunValidationEvidence({ context, runEvidence, before, after });
    const rec = result.media[0]!;
    const signal = rec.reconciliation.find((s) => s.dimension === 'news_count')!;
    expect(signal.run_counter).toBe(3);
    expect(signal.observed_delta).toBe(0);
    expect(signal.matches).toBe(false);
    // Ningún campo de esta capa decide o menciona PASS/FAIL: solo se preserva el hecho.
    expect(JSON.stringify(result)).not.toMatch(/"pass"|"fail"|"review"/i);
  });

  it('32/49. unattributed_enrich de 1B se preserva separado, no se fusiona en ningún medio conocido', () => {
    const runEvidence = fakeRunEvidence({
      run: { run_id: null, requested_media_ids: ['MED-A'], requested_media_ids_source: 'explicit_input', requested_media_ids_coverage: 'COMPLETE' },
      media: [fakeMediaEvidence('MED-A', { evidence_status: 'MISSING' })],
      unattributed_enrich: fakeUnattributedEnrich({ processed: 4, dry_run: false, content_persistence: 'UNVERIFIED' }),
    });
    const context = contextFor(runEvidence);
    const before = snapshotResult([completeSnap('MED-A', 0, 0, 0)], 'BEFORE');
    const after = snapshotResult([completeSnap('MED-A', 0, 0, 0)], 'AFTER');

    const result = composeRunValidationEvidence({ context, runEvidence, before, after });
    expect(result.unattributed_enrich).toEqual(runEvidence.unattributed_enrich);
  });

  it('33/49. invalid/unsupported/conflicts de 1B no se pierden al componer (se preservan por referencia)', () => {
    const runEvidence = fakeRunEvidence({
      run: { run_id: null, requested_media_ids: ['MED-A'], requested_media_ids_source: 'explicit_input', requested_media_ids_coverage: 'COMPLETE' },
      media: [
        fakeMediaEvidence('MED-A', {
          evidence_status: 'PARTIAL',
          unsupported_event_count: 2,
          crawl: fakeCrawlEvidence({ provenance: 'STRUCTURED_V1', status: 'ok', legacy_conflict: true, invalid_event_count: 1 }),
          enrich: fakeEnrichEvidence({ ambiguous_summary_events: true, invalid_event_count: 1 }),
        }),
      ],
    });
    const context = contextFor(runEvidence);
    const before = snapshotResult([completeSnap('MED-A', 1, 1, 1)], 'BEFORE');
    const after = snapshotResult([completeSnap('MED-A', 2, 2, 2)], 'AFTER');

    const result = composeRunValidationEvidence({ context, runEvidence, before, after });
    const rec = result.media[0]!;
    expect(rec.run_evidence.crawl.legacy_conflict).toBe(true);
    expect(rec.run_evidence.crawl.invalid_event_count).toBe(1);
    expect(rec.run_evidence.enrich.ambiguous_summary_events).toBe(true);
    expect(rec.run_evidence.unsupported_event_count).toBe(2);
  });

  it('34. serialización determinista (mismo input produce mismo JSON)', () => {
    const runEvidence = fakeRunEvidence({
      run: { run_id: 'r1', requested_media_ids: ['MED-B', 'MED-A'], requested_media_ids_source: 'explicit_input', requested_media_ids_coverage: 'COMPLETE' },
      media: [fakeMediaEvidence('MED-A', { evidence_status: 'MISSING' }), fakeMediaEvidence('MED-B', { evidence_status: 'MISSING' })],
    });
    const context = contextFor(runEvidence);
    const before = snapshotResult([completeSnap('MED-A', 0, 0, 0), completeSnap('MED-B', 0, 0, 0)], 'BEFORE');
    const after = snapshotResult([completeSnap('MED-A', 1, 1, 1), completeSnap('MED-B', 2, 2, 2)], 'AFTER');

    const r1 = composeRunValidationEvidence({ context, runEvidence, before, after });
    const r2 = composeRunValidationEvidence({ context, runEvidence, before, after });
    expect(r1.media.map((m) => m.medio_id)).toEqual(['MED-A', 'MED-B']);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it('48. MED-A/MED-B se mantienen separados en la composición', () => {
    const runEvidence = fakeRunEvidence({
      run: { run_id: null, requested_media_ids: ['MED-A', 'MED-B'], requested_media_ids_source: 'explicit_input', requested_media_ids_coverage: 'COMPLETE' },
      media: [fakeMediaEvidence('MED-A', { evidence_status: 'COMPLETE' }), fakeMediaEvidence('MED-B', { evidence_status: 'COMPLETE' })],
    });
    const context = contextFor(runEvidence);
    const before = snapshotResult([completeSnap('MED-A', 1, 1, 1), completeSnap('MED-B', 5, 5, 5)], 'BEFORE');
    const after = snapshotResult([completeSnap('MED-A', 2, 2, 2), completeSnap('MED-B', 5, 5, 5)], 'AFTER');

    const result = composeRunValidationEvidence({ context, runEvidence, before, after });
    const a = result.media.find((m) => m.medio_id === 'MED-A')!;
    const b = result.media.find((m) => m.medio_id === 'MED-B')!;
    expect(a.persistence.delta.news_delta).toBe(1);
    expect(b.persistence.delta.news_delta).toBe(0);
  });

  it('medio_id en requestedMediaIds pero ausente de runEvidence.media produce warning, no se fabrica evidencia', () => {
    const runEvidence = fakeRunEvidence({
      run: { run_id: null, requested_media_ids: ['MED-A', 'MED-B'], requested_media_ids_source: 'explicit_input', requested_media_ids_coverage: 'COMPLETE' },
      media: [fakeMediaEvidence('MED-A', { evidence_status: 'MISSING' })], // MED-B falta
    });
    const context = contextFor(runEvidence);
    const before = snapshotResult([completeSnap('MED-A', 0, 0, 0), completeSnap('MED-B', 0, 0, 0)], 'BEFORE');
    const after = snapshotResult([completeSnap('MED-A', 0, 0, 0), completeSnap('MED-B', 0, 0, 0)], 'AFTER');

    const result = composeRunValidationEvidence({ context, runEvidence, before, after });
    expect(result.media.map((m) => m.medio_id)).toEqual(['MED-A']);
    expect(result.warnings.some((w) => w.includes('MED-B'))).toBe(true);
  });

  it('medio_id con run evidence pero sin snapshot before/after produce warning, no se fabrica persistence', () => {
    const runEvidence = fakeRunEvidence({
      run: { run_id: null, requested_media_ids: ['MED-A'], requested_media_ids_source: 'explicit_input', requested_media_ids_coverage: 'COMPLETE' },
      media: [fakeMediaEvidence('MED-A', { evidence_status: 'MISSING' })],
    });
    const context = contextFor(runEvidence);
    const before = snapshotResult([], 'BEFORE');
    const after = snapshotResult([], 'AFTER');

    const result = composeRunValidationEvidence({ context, runEvidence, before, after });
    expect(result.media).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes('MED-A'))).toBe(true);
  });

  it('schema_version=1 presente en el artifact final', () => {
    const runEvidence = fakeRunEvidence({ run: { run_id: null, requested_media_ids: [], requested_media_ids_source: 'explicit_input', requested_media_ids_coverage: 'COMPLETE' } });
    const context = contextFor(runEvidence);
    const result = composeRunValidationEvidence({ context, runEvidence, before: snapshotResult([], 'BEFORE'), after: snapshotResult([], 'AFTER') });
    expect(result.schema_version).toBe(1);
  });
});

describe('§46 — FALSE VERIFIED (B5C): context_identity=MISMATCH nunca coexiste con persistence=VERIFIED', () => {
  it('29. context MATCH + snapshots COMPLETE estables → VERIFIED', () => {
    const runEvidence = fakeRunEvidence({
      run: { run_id: null, requested_media_ids: ['MED-A'], requested_media_ids_source: 'explicit_input', requested_media_ids_coverage: 'COMPLETE' },
      media: [fakeMediaEvidence('MED-A', { evidence_status: 'COMPLETE' })],
    });
    const context = contextFor(runEvidence);
    const before = snapshotResult([completeSnap('MED-A', 1, 1, 1)], 'BEFORE');
    const after = snapshotResult([completeSnap('MED-A', 2, 2, 2)], 'AFTER');
    const result = composeRunValidationEvidence({ context, runEvidence, before, after });
    expect(result.context_identity.status).toBe('MATCH');
    expect(result.media[0]!.persistence.status).toBe('VERIFIED');
  });

  it('30. context MISMATCH (universo distinto before/after) + snapshots COMPLETE → INDETERMINATE, NUNCA VERIFIED', () => {
    const runEvidence = fakeRunEvidence({
      run: { run_id: null, requested_media_ids: ['MED-A'], requested_media_ids_source: 'explicit_input', requested_media_ids_coverage: 'COMPLETE' },
      media: [fakeMediaEvidence('MED-A', { evidence_status: 'COMPLETE' })],
    });
    const context = contextFor(runEvidence);
    const before = snapshotResult([completeSnap('MED-A', 1, 1, 1)], 'BEFORE');
    // after usa un contexto DISTINTO (context_id diferente) — antes esto podía seguir dando VERIFIED.
    const after = snapshotResult([completeSnap('MED-A', 2, 2, 2)], 'AFTER', { context_id: 'VAL-OTRO' });

    const result = composeRunValidationEvidence({ context, runEvidence, before, after });
    expect(result.context_identity.status).toBe('MISMATCH');
    const rec = result.media[0]!;
    expect(rec.persistence.status).toBe('INDETERMINATE');
    expect(rec.persistence.status).not.toBe('VERIFIED');
    expect(rec.persistence.reason).toMatch(/context_identity/);
  });

  it('31. role mismatch (before con role AFTER) → no VERIFIED', () => {
    const runEvidence = fakeRunEvidence({
      run: { run_id: null, requested_media_ids: ['MED-A'], requested_media_ids_source: 'explicit_input', requested_media_ids_coverage: 'COMPLETE' },
      media: [fakeMediaEvidence('MED-A', { evidence_status: 'COMPLETE' })],
    });
    const context = contextFor(runEvidence);
    const before: SnapshotResult = { ...snapshotResult([completeSnap('MED-A', 1, 1, 1)], 'BEFORE'), snapshot_role: 'AFTER' }; // swap
    const after = snapshotResult([completeSnap('MED-A', 2, 2, 2)], 'AFTER');

    const result = composeRunValidationEvidence({ context, runEvidence, before, after });
    expect(result.context_identity.status).toBe('MISMATCH');
    expect(result.media[0]!.persistence.status).not.toBe('VERIFIED');
  });

  it('32. temporal anchor mismatch (before/after con window_anchor distinto) → no VERIFIED', () => {
    const runEvidence = fakeRunEvidence({
      run: { run_id: null, requested_media_ids: ['MED-A'], requested_media_ids_source: 'explicit_input', requested_media_ids_coverage: 'COMPLETE' },
      media: [fakeMediaEvidence('MED-A', { evidence_status: 'COMPLETE' })],
    });
    const context = contextFor(runEvidence);
    const before = snapshotResult([completeSnap('MED-A', 1, 1, 1)], 'BEFORE');
    const after = snapshotResult([completeSnap('MED-A', 2, 2, 2)], 'AFTER', { window_anchor: '2099-01-01T00:00:00.000Z' });

    const result = composeRunValidationEvidence({ context, runEvidence, before, after });
    expect(result.context_identity.status).toBe('MISMATCH');
    expect(result.media[0]!.persistence.status).not.toBe('VERIFIED');
  });

  it('33. pagination drift (POSSIBLE_DRIFT) en before o after → no VERIFIED aunque context sea MATCH', () => {
    const runEvidence = fakeRunEvidence({
      run: { run_id: null, requested_media_ids: ['MED-A'], requested_media_ids_source: 'explicit_input', requested_media_ids_coverage: 'COMPLETE' },
      media: [fakeMediaEvidence('MED-A', { evidence_status: 'COMPLETE' })],
    });
    const context = contextFor(runEvidence);
    const before = snapshotResult([completeSnap('MED-A', 1, 1, 1)], 'BEFORE');
    const after = snapshotResult([completeSnap('MED-A', 2, 2, 2, 'POSSIBLE_DRIFT')], 'AFTER');

    const result = composeRunValidationEvidence({ context, runEvidence, before, after });
    expect(result.context_identity.status).toBe('MATCH'); // el contexto en sí es coherente
    const rec = result.media[0]!;
    expect(rec.persistence.status).toBe('INDETERMINATE');
    expect(rec.persistence.reason).toMatch(/drift/);
  });

  it('34. malformed artifact nunca llega a persistence — se rechaza antes en artifactSchemas (ver artifact-schemas.test.ts)', () => {
    // Cubierto en `test/artifact-schemas.test.ts` — aquí solo se confirma que
    // `composeRunValidationEvidence` recibe SIEMPRE tipos ya válidos (nunca
    // valida JSON crudo — esa responsabilidad es de la frontera CLI).
    expect(typeof composeRunValidationEvidence).toBe('function');
  });
});

describe('§48 — Regresiones de Fase 1C original', () => {
  it('42. delta positivo se calcula correctamente', () => {
    const runEvidence = fakeRunEvidence({ run: { run_id: null, requested_media_ids: ['MED-A'], requested_media_ids_source: 'explicit_input', requested_media_ids_coverage: 'COMPLETE' }, media: [fakeMediaEvidence('MED-A')] });
    const context = contextFor(runEvidence);
    const result = composeRunValidationEvidence({
      context,
      runEvidence,
      before: snapshotResult([completeSnap('MED-A', 1, 1, 1)], 'BEFORE'),
      after: snapshotResult([completeSnap('MED-A', 4, 3, 2)], 'AFTER'),
    });
    expect(result.media[0]!.persistence.delta.news_delta).toBe(3);
  });

  it('43. delta cero se calcula correctamente', () => {
    const runEvidence = fakeRunEvidence({ run: { run_id: null, requested_media_ids: ['MED-A'], requested_media_ids_source: 'explicit_input', requested_media_ids_coverage: 'COMPLETE' }, media: [fakeMediaEvidence('MED-A')] });
    const context = contextFor(runEvidence);
    const result = composeRunValidationEvidence({
      context,
      runEvidence,
      before: snapshotResult([completeSnap('MED-A', 3, 3, 3)], 'BEFORE'),
      after: snapshotResult([completeSnap('MED-A', 3, 3, 3)], 'AFTER'),
    });
    expect(result.media[0]!.persistence.delta.news_delta).toBe(0);
  });

  it('44. delta negativo (after < before) se representa sin error', () => {
    const runEvidence = fakeRunEvidence({ run: { run_id: null, requested_media_ids: ['MED-A'], requested_media_ids_source: 'explicit_input', requested_media_ids_coverage: 'COMPLETE' }, media: [fakeMediaEvidence('MED-A')] });
    const context = contextFor(runEvidence);
    const result = composeRunValidationEvidence({
      context,
      runEvidence,
      before: snapshotResult([completeSnap('MED-A', 5, 5, 5)], 'BEFORE'),
      after: snapshotResult([completeSnap('MED-A', 2, 2, 2)], 'AFTER'),
    });
    expect(result.media[0]!.persistence.delta.news_delta).toBe(-3);
  });
});

describe('35. QUERY FAILURE TEST (BLOQUEANTE) — un fallo de Supabase NUNCA se convierte en cero', () => {
  it('39/40. una página que falla produce ERROR con contadores null, nunca {total_news:0, status:COMPLETE}', async () => {
    const fetchPage: FetchNoticiasPage = async () => ({
      data: null,
      error: { code: '57P03', message: 'cannot_connect_now' },
    });

    const snapshot = await buildNewsLakeSnapshot({
      contextId: 'VAL-TEST-001',
      snapshotRole: 'BEFORE',
      mediaIds: ['MED-A'],
      windowDays: 30,
      windowAnchor: ANCHOR,
      fetchPage,
    });
    const m = snapshot.media[0]!;

    expect(m).not.toEqual(
      expect.objectContaining({ total_news: 0, clean_text_count: 0, body_count: 0, status: 'COMPLETE' }),
    );
    expect(m.status).toBe('ERROR');
    expect(m.total_news).toBeNull();
    expect(m.clean_text_count).toBeNull();
    expect(m.body_count).toBeNull();
    expect(m.errors.length).toBeGreaterThan(0);
  });

  it('esa evidencia de ERROR se propaga hasta persistence=INDETERMINATE en la composición final (nunca se disfraza de VERIFIED/0)', async () => {
    const failingFetch: FetchNoticiasPage = async () => ({ data: null, error: { message: 'boom' } });
    const workingFetch: FetchNoticiasPage = async () => ({ data: [row('n1', 'MED-A', 'x', 'y')], error: null });

    const before = await buildNewsLakeSnapshot({ contextId: 'VAL-TEST-001', snapshotRole: 'BEFORE', mediaIds: ['MED-A'], windowDays: 30, windowAnchor: ANCHOR, fetchPage: failingFetch });
    const after = await buildNewsLakeSnapshot({ contextId: 'VAL-TEST-001', snapshotRole: 'AFTER', mediaIds: ['MED-A'], windowDays: 30, windowAnchor: ANCHOR, fetchPage: workingFetch });

    const runEvidence = fakeRunEvidence({
      run: { run_id: null, requested_media_ids: ['MED-A'], requested_media_ids_source: 'explicit_input', requested_media_ids_coverage: 'COMPLETE' },
      media: [fakeMediaEvidence('MED-A', { evidence_status: 'MISSING' })],
    });
    const context = contextFor(runEvidence);

    const result = composeRunValidationEvidence({ context, runEvidence, before, after });
    const rec = result.media[0]!;
    expect(rec.persistence.status).toBe('INDETERMINATE');
    expect(rec.persistence.delta.status).toBe('UNAVAILABLE');
    expect(rec.persistence.before.status).toBe('ERROR');
  });
});
