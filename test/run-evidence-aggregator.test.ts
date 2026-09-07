import { describe, it, expect } from 'vitest';
import { runInNewContext } from 'node:vm';
import {
  aggregateRunEvidence,
  isValidChunkIndexTotal,
  RUN_EVIDENCE_SCHEMA_VERSION,
  type RunEvidence,
  type MediaEvidence,
} from '../src/mediaValidation/runEvidenceAggregator.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de construcción de líneas (mismo shape que emiten hoy crawl.ts,
// src/crawlers/index.ts, enrich-news.ts y news-lake-capture.ts).
// ─────────────────────────────────────────────────────────────────────────────

function crawlSourceResultLine(medio_id: string, over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    level: 30,
    time: 1000,
    run_by: 'test',
    medio_id,
    fuente: 'rss',
    detectadas: 10,
    items: 2,
    msg: 'Fuente con resultados',
    ...over,
  });
}

function crawlTerminalLine(medio_id: string, over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    level: 30,
    time: 1000,
    run_by: 'test',
    medio_id,
    estado: 'ok',
    insertadas: 2,
    duplicados: 0,
    promovidas_diagnostico: 0,
    msg: `Medio procesado: ${medio_id}`,
    ...over,
  });
}

function crawlSourceFailureLine(medio_id: string, err: string, over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    level: 40,
    time: 1000,
    run_by: 'test',
    medio_id,
    fuente: 'rss',
    err,
    msg: 'Fallo en fuente, probando siguiente',
    ...over,
  });
}

function enrichSummaryLine(medio_id: string | null, over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    level: 30,
    time: 1000,
    run_by: 'test',
    event: 'enrich_media_summary',
    schema_version: 1,
    medio_id,
    requested: true,
    processed: 2,
    updated: 2,
    unchanged: 0,
    failed: 0,
    clean_text_count: 2,
    body_count: 2,
    dry_run: false,
    msg: `Enrich por medio completado: ${medio_id}`,
    ...over,
  });
}

function chunkPlanLine(chunk: string[], index: number, total: number, msg: string): string {
  return JSON.stringify({ level: 30, time: 1000, run_by: 'test', chunk, index, total, msg });
}

/** Mismo shape que emite `buildCrawlMediaSummaryLogPayload` (src/crawlers/index.ts) vía scripts/crawl.ts (Hardening Pass 2). */
function crawlMediaSummaryLine(medio_id: string, over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    level: 30,
    time: 1000,
    run_by: 'test',
    event: 'crawl_media_summary',
    schema_version: 1,
    medio_id,
    status: 'ok',
    source_method: 'rss',
    detected: 10,
    items: 2,
    inserted: 2,
    duplicates: 0,
    promoted_diagnostic: 0,
    terminal_error: null,
    msg: `Crawl media summary: ${medio_id}`,
    ...over,
  });
}

function findMedio(result: RunEvidence, medio_id: string): MediaEvidence {
  const m = result.media.find((x) => x.medio_id === medio_id);
  if (!m) throw new Error(`medio_id ${medio_id} no encontrado en el resultado`);
  return m;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1-3: separación por medio_id, no contaminación (§28.21)
// ─────────────────────────────────────────────────────────────────────────────

describe('aggregateRunEvidence — separación por medio_id', () => {
  it('dos medios del mismo chunk permanecen separados', () => {
    const lines = [
      chunkPlanLine(['MED-A', 'MED-B'], 1, 1, '[chunk 1/1] Crawl…'),
      crawlSourceResultLine('MED-A'),
      crawlTerminalLine('MED-A', { insertadas: 5 }),
      crawlSourceResultLine('MED-B'),
      crawlTerminalLine('MED-B', { insertadas: 3 }),
      enrichSummaryLine('MED-A', { processed: 5, updated: 5 }),
      enrichSummaryLine('MED-B', { processed: 3, updated: 3 }),
    ];
    const result = aggregateRunEvidence({ logLines: lines });
    expect(result.media.map((m) => m.medio_id).sort()).toEqual(['MED-A', 'MED-B']);
  });

  it('crawl + enrich del mismo medio se unen correctamente → COMPLETE', () => {
    const lines = [crawlSourceResultLine('MED-A'), crawlTerminalLine('MED-A'), enrichSummaryLine('MED-A')];
    const result = aggregateRunEvidence({ logLines: lines });
    const m = findMedio(result, 'MED-A');
    expect(m.evidence_status).toBe('COMPLETE');
    expect(m.crawl.status).toBe('ok');
    expect(m.crawl.inserted).toBe(2);
    expect(m.enrich.presence).toBe('PRESENT');
    expect(m.enrich.processed).toBe(2);
  });

  it('21. datos de MED-A no contaminan MED-B', () => {
    const lines = [
      crawlSourceResultLine('MED-A', { detectadas: 100 }),
      crawlTerminalLine('MED-A', { insertadas: 9, duplicados: 1 }),
      enrichSummaryLine('MED-A', { processed: 9, updated: 9, failed: 1 }),
      crawlSourceResultLine('MED-B', { detectadas: 1 }),
      crawlTerminalLine('MED-B', { insertadas: 1, duplicados: 0 }),
      enrichSummaryLine('MED-B', { processed: 1, updated: 1, failed: 0 }),
    ];
    const result = aggregateRunEvidence({ logLines: lines });
    const a = findMedio(result, 'MED-A');
    const b = findMedio(result, 'MED-B');
    expect(a.crawl.inserted).toBe(9);
    expect(a.enrich.processed).toBe(9);
    expect(a.enrich.failed).toBe(1);
    expect(b.crawl.inserted).toBe(1);
    expect(b.enrich.processed).toBe(1);
    expect(b.enrich.failed).toBe(0);
  });

  it('medio con crawl error conserva ese error', () => {
    const lines = [
      crawlSourceFailureLine('MED-A', 'Invalid character in entity name'),
      crawlTerminalLine('MED-A', { estado: 'error', insertadas: 0, duplicados: 0 }),
    ];
    const result = aggregateRunEvidence({ logLines: lines });
    const a = findMedio(result, 'MED-A');
    expect(a.crawl.status).toBe('error');
    expect(a.crawl.attempt_errors).toContain('Invalid character in entity name');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B1 — NOT_EXPECTED ya NO se infiere de crawl.status (§28.1, §28.2, §4 del prompt)
// ─────────────────────────────────────────────────────────────────────────────

describe('aggregateRunEvidence — B1: NOT_EXPECTED ya no se infiere de crawl.status', () => {
  it('1. crawl error + medio solicitado + enrich ausente NO produce NOT_EXPECTED/COMPLETE', () => {
    const result = aggregateRunEvidence({
      logLines: [crawlTerminalLine('MED-FAIL', { estado: 'error', insertadas: 0, duplicados: 0 })],
      requestedMediaIds: ['MED-FAIL'],
    });
    const m = findMedio(result, 'MED-FAIL');
    expect(m.enrich.presence).not.toBe('NOT_EXPECTED');
    expect(m.enrich.presence).toBe('MISSING');
    expect(m.enrich.expectation_basis).toBeNull();
    expect(m.evidence_status).not.toBe('COMPLETE');
    expect(m.evidence_status).toBe('PARTIAL');
  });

  it('2. crawl sin_fuente + enrich ausente NO se convierte en COMPLETE por esa sola razón', () => {
    const result = aggregateRunEvidence({
      logLines: [crawlTerminalLine('MED-NOSRC', { estado: 'sin_fuente', insertadas: 0, duplicados: 0 })],
      requestedMediaIds: ['MED-NOSRC'],
    });
    const m = findMedio(result, 'MED-NOSRC');
    expect(m.enrich.presence).toBe('MISSING');
    expect(m.evidence_status).toBe('PARTIAL');
  });

  it('crawl ok + enrich ausente sigue siendo PARTIAL (comportamiento previo conservado)', () => {
    const lines = [crawlSourceResultLine('MED-A'), crawlTerminalLine('MED-A', { estado: 'ok' })];
    const result = aggregateRunEvidence({ logLines: lines });
    const a = findMedio(result, 'MED-A');
    expect(a.enrich.presence).toBe('MISSING');
    expect(a.evidence_status).toBe('PARTIAL');
  });

  it('NOT_EXPECTED nunca es emitido por esta implementación bajo ninguna combinación probada', () => {
    const combos = [
      [crawlTerminalLine('M1', { estado: 'error' })],
      [crawlTerminalLine('M2', { estado: 'sin_fuente' })],
      [crawlTerminalLine('M3', { estado: 'omitido' })],
    ];
    for (const lines of combos) {
      const result = aggregateRunEvidence({ logLines: lines });
      for (const m of result.media) {
        expect(m.enrich.presence).not.toBe('NOT_EXPECTED');
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B2 — validación de eventos enrich_media_summary (§28.3, §28.4, §28.5, §28.6)
// ─────────────────────────────────────────────────────────────────────────────

describe('aggregateRunEvidence — B2: validación del evento enrich_media_summary', () => {
  it('3. enrich summary con schema_version=99 NO se acepta como evidencia válida', () => {
    const lines = [
      crawlSourceResultLine('MED-A'),
      crawlTerminalLine('MED-A'),
      enrichSummaryLine('MED-A', { schema_version: 99 }),
    ];
    const result = aggregateRunEvidence({ logLines: lines });
    const a = findMedio(result, 'MED-A');
    expect(a.enrich.presence).not.toBe('PRESENT');
    expect(a.enrich.presence).toBe('INVALID');
    expect(a.enrich.invalid_event_count).toBe(1);
    expect(a.evidence_status).not.toBe('COMPLETE');
  });

  it('4. enrich summary sin métricas requeridas (processed ausente) NO produce COMPLETE', () => {
    const l = JSON.stringify({
      event: 'enrich_media_summary',
      schema_version: 1,
      medio_id: 'MED-A',
      requested: true,
      // processed ausente a propósito
      updated: 2,
      unchanged: 0,
      failed: 0,
      clean_text_count: 2,
      body_count: 2,
      dry_run: false,
    });
    const lines = [crawlSourceResultLine('MED-A'), crawlTerminalLine('MED-A'), l];
    const result = aggregateRunEvidence({ logLines: lines });
    const a = findMedio(result, 'MED-A');
    expect(a.enrich.presence).toBe('INVALID');
    expect(a.evidence_status).toBe('PARTIAL');
  });

  it('5. contador numérico inválido (string, negativo, null/NaN-serializado) NO se coacciona silenciosamente', () => {
    // NaN/Infinity no son representables en JSON (JSON.stringify los serializa
    // como `null`), así que las tres variantes realmente alcanzables desde un
    // log real son: string numérico, negativo, y ausente/null — las tres
    // deben rechazar el evento, nunca coaccionarse a un número.
    const casos: Record<string, unknown>[] = [{ processed: '2' }, { processed: -1 }, { processed: null }];
    for (const over of casos) {
      const lines = [enrichSummaryLine('MED-A', over)];
      const result = aggregateRunEvidence({ logLines: lines });
      const a = findMedio(result, 'MED-A');
      expect(a.enrich.presence).toBe('INVALID');
      expect(a.enrich.processed).toBeNull();
    }
  });

  it('un evento inválido NO desaparece silenciosamente: queda invalid_event_count > 0 y warning', () => {
    const lines = [enrichSummaryLine('MED-A', { schema_version: 2 })];
    const result = aggregateRunEvidence({ logLines: lines });
    const a = findMedio(result, 'MED-A');
    expect(a.enrich.invalid_event_count).toBe(1);
    expect(result.warnings.some((w) => w.includes('MED-A') && w.toLowerCase().includes('inválido'))).toBe(true);
  });

  it('evento con event=enrich_media_summary y medio_id no-string/no-null se reporta a nivel de run, no fabrica medio', () => {
    const l = JSON.stringify({
      event: 'enrich_media_summary',
      schema_version: 1,
      medio_id: 42, // ni string ni null
      requested: true,
      processed: 1,
      updated: 1,
      unchanged: 0,
      failed: 0,
      clean_text_count: 1,
      body_count: 1,
      dry_run: false,
    });
    const result = aggregateRunEvidence({ logLines: [l] });
    expect(result.unattributable_invalid_enrich_event_count).toBe(1);
    expect(result.media).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B9 — unattributed enrich inválido no fabrica ceros (§28.6)
// ─────────────────────────────────────────────────────────────────────────────

describe('aggregateRunEvidence — B9: unattributed enrich inválido no fabrica ceros', () => {
  it('6. unattributed enrich inválido (processed string, resto ausente) NO fabrica ceros', () => {
    const l = JSON.stringify({
      event: 'enrich_media_summary',
      schema_version: 1,
      medio_id: null,
      processed: '7', // string numérico inválido
      // resto de campos ausentes a propósito
    });
    const result = aggregateRunEvidence({ logLines: [l] });
    expect(result.unattributed_enrich).toBeNull(); // NUNCA se fabrica {processed:7, updated:0, ...}
    expect(result.unattributed_enrich_invalid_event_count).toBe(1);
    expect(result.warnings.some((w) => w.includes('medio_id=null'))).toBe(true);
  });

  it('unattributed enrich válido se representa correctamente sin inventar medio_id (shape completo, Hardening Pass 3 Q3)', () => {
    const result = aggregateRunEvidence({ logLines: [enrichSummaryLine(null, { processed: 3, failed: 3, updated: 0, unchanged: 0, clean_text_count: 0, body_count: 0, dry_run: false })] });
    expect(result.unattributed_enrich).toEqual({
      processed: 3,
      updated: 0,
      unchanged: 0,
      failed: 3,
      clean_text_count: 0,
      body_count: 0,
      dry_run: false,
      content_persistence: 'UNVERIFIED',
      raw_summary_event_count: 1,
      ambiguous_summary_events: false,
      mixed_dry_run: false,
      conflicting_summaries: null,
    });
    expect(result.media).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Hardening Pass 3, Q3/Q19-23 — unattributed_enrich preserva dry_run/mixed/
// persistencia y resuelve conflictos de forma conservadora (nunca "el
// último gana").
// ─────────────────────────────────────────────────────────────────────────────

describe('aggregateRunEvidence — Hardening Pass 3, Q3: unattributed_enrich truthfulness', () => {
  it('25. medio_id=null dry_run=true vs dry_run=false producen outputs distinguibles', () => {
    const dryRunResult = aggregateRunEvidence({ logLines: [enrichSummaryLine(null, { dry_run: true })] });
    const realResult = aggregateRunEvidence({ logLines: [enrichSummaryLine(null, { dry_run: false })] });
    expect(dryRunResult.unattributed_enrich?.dry_run).toBe(true);
    expect(realResult.unattributed_enrich?.dry_run).toBe(false);
    expect(dryRunResult.unattributed_enrich).not.toEqual(realResult.unattributed_enrich);
  });

  it('26. unattributed mixed dry_run queda visible y bloquea COMPLETE en ese bucket', () => {
    const lines = [
      enrichSummaryLine(null, { dry_run: true, time: 1000 }),
      enrichSummaryLine(null, { dry_run: false, time: 2000 }),
    ];
    const result = aggregateRunEvidence({ logLines: lines });
    expect(result.unattributed_enrich?.mixed_dry_run).toBe(true);
    expect(result.unattributed_enrich?.ambiguous_summary_events).toBe(true);
    expect(result.unattributed_enrich?.processed).toBeNull();
    expect(result.warnings.some((w) => w.includes('medio_id=null') && w.toLowerCase().includes('dry_run'))).toBe(true);
  });

  it('27. unattributed válido único → content_persistence=UNVERIFIED', () => {
    const result = aggregateRunEvidence({ logLines: [enrichSummaryLine(null, { processed: 5 })] });
    expect(result.unattributed_enrich?.content_persistence).toBe('UNVERIFIED');
  });

  it('28. múltiples unattributed CONTRADICTORIOS (mismo dry_run) no se resuelven mediante "el último gana"', () => {
    const lines = [
      enrichSummaryLine(null, { processed: 2, updated: 2, dry_run: false, time: 1000 }),
      enrichSummaryLine(null, { processed: 9, updated: 9, dry_run: false, time: 2000 }),
    ];
    const result = aggregateRunEvidence({ logLines: lines });
    expect(result.unattributed_enrich?.ambiguous_summary_events).toBe(true);
    expect(result.unattributed_enrich?.processed).toBeNull();
    expect(result.unattributed_enrich?.raw_summary_event_count).toBe(2);
    expect(result.unattributed_enrich?.conflicting_summaries).toHaveLength(2);
  });

  it('29. unattributed válido + inválido: el inválido queda visible, no se oculta', () => {
    const validLine = enrichSummaryLine(null, { processed: 3 });
    const invalidLine = JSON.stringify({
      event: 'enrich_media_summary',
      schema_version: 1,
      medio_id: null,
      processed: 'no-numero',
    });
    const result = aggregateRunEvidence({ logLines: [validLine, invalidLine] });
    expect(result.unattributed_enrich?.processed).toBe(3); // el válido sigue expuesto (evento único válido)
    expect(result.unattributed_enrich_invalid_event_count).toBe(1);
    expect(result.warnings.some((w) => w.includes('medio_id=null') && w.includes('INVÁLIDO'))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B4 — dry_run se preserva; mixed mode se conserva como ambigüedad (§28.7-10)
// ─────────────────────────────────────────────────────────────────────────────

describe('aggregateRunEvidence — B4: dry_run preservado y mixed mode explícito', () => {
  it('7. dry_run=true se conserva', () => {
    const result = aggregateRunEvidence({ logLines: [enrichSummaryLine('MED-A', { dry_run: true })] });
    expect(findMedio(result, 'MED-A').enrich.dry_run).toBe(true);
  });

  it('8. dry_run=false se conserva', () => {
    const result = aggregateRunEvidence({ logLines: [enrichSummaryLine('MED-A', { dry_run: false })] });
    expect(findMedio(result, 'MED-A').enrich.dry_run).toBe(false);
  });

  it('9. true y false producen outputs distinguibles para el mismo summary', () => {
    const base = { processed: 2, updated: 2, unchanged: 0, failed: 0, clean_text_count: 2, body_count: 2 };
    const rTrue = aggregateRunEvidence({ logLines: [enrichSummaryLine('MED-A', { ...base, dry_run: true })] });
    const rFalse = aggregateRunEvidence({ logLines: [enrichSummaryLine('MED-A', { ...base, dry_run: false })] });
    expect(findMedio(rTrue, 'MED-A').enrich.dry_run).not.toBe(findMedio(rFalse, 'MED-A').enrich.dry_run);
  });

  it('10. eventos contradictorios real/dry-run para el mismo medio se conservan como ambigüedad (mixed_dry_run)', () => {
    const lines = [
      enrichSummaryLine('MED-A', { dry_run: true, time: 1000 }),
      enrichSummaryLine('MED-A', { dry_run: false, time: 2000 }),
    ];
    const result = aggregateRunEvidence({ logLines: lines });
    const a = findMedio(result, 'MED-A');
    expect(a.enrich.mixed_dry_run).toBe(true);
    expect(a.evidence_status).not.toBe('COMPLETE'); // la contradicción impide afirmar COMPLETE
    expect(result.warnings.some((w) => w.includes('MED-A') && w.toLowerCase().includes('dry_run'))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B6 — requested_media_ids: explicit [], cobertura de chunk-plan (§28.11-15)
// ─────────────────────────────────────────────────────────────────────────────

describe('aggregateRunEvidence — B6: requested_media_ids explícito vacío y cobertura de chunk-plan', () => {
  it('11. requestedMediaIds=[] sigue siendo explicit input (no cae a chunk-plan ni a unavailable)', () => {
    const result = aggregateRunEvidence({
      logLines: [chunkPlanLine(['MED-A', 'MED-B'], 1, 1, '[chunk 1/1] Crawl…')],
      requestedMediaIds: [],
      deriveRequestedFromChunkPlan: true, // aunque esté activo, explicit [] tiene prioridad
    });
    expect(result.run.requested_media_ids).toEqual([]);
    expect(result.run.requested_media_ids_source).toBe('explicit_input');
    expect(result.run.requested_media_ids_coverage).toBe('COMPLETE');
  });

  it('12. chunk total=4 pero solo chunk 1 observado → cobertura NO es COMPLETE', () => {
    const result = aggregateRunEvidence({
      logLines: [chunkPlanLine(['MED-A', 'MED-B'], 1, 4, '[chunk 1/4] Crawl…')],
      deriveRequestedFromChunkPlan: true,
    });
    expect(result.run.requested_media_ids_source).toBe('chunk_plan_logs');
    expect(result.run.requested_media_ids_coverage).toBe('PARTIAL');
    expect(result.warnings.some((w) => w.toLowerCase().includes('parcial'))).toBe(true);
  });

  it('13. todos los chunks 1..N observados coherentemente → cobertura COMPLETE', () => {
    const result = aggregateRunEvidence({
      logLines: [
        chunkPlanLine(['MED-A'], 1, 2, '[chunk 1/2] Crawl…'),
        chunkPlanLine(['MED-B'], 2, 2, '[chunk 2/2] Crawl…'),
      ],
      deriveRequestedFromChunkPlan: true,
    });
    expect(result.run.requested_media_ids_coverage).toBe('COMPLETE');
    expect(result.run.requested_media_ids?.sort()).toEqual(['MED-A', 'MED-B']);
  });

  it('14. mismo chunk index con listas conflictivas produce ambigüedad/cobertura incompleta', () => {
    const result = aggregateRunEvidence({
      logLines: [
        chunkPlanLine(['MED-A'], 1, 1, '[chunk 1/1] Crawl…'),
        chunkPlanLine(['MED-A', 'MED-Z'], 1, 1, '[chunk 1/1] Enrich…'), // mismo index, lista distinta
      ],
      deriveRequestedFromChunkPlan: true,
    });
    expect(result.run.requested_media_ids_coverage).toBe('PARTIAL');
    expect(result.warnings.some((w) => w.includes('conflictiv'))).toBe(true);
  });

  it('15. chunk_index se trata como 1-based', () => {
    const result = aggregateRunEvidence({
      logLines: [chunkPlanLine(['MED-A'], 1, 1, '[chunk 1/1] Crawl…'), crawlTerminalLine('MED-A')],
    });
    expect(findMedio(result, 'MED-A').chunk_index).toBe(1);
    expect(result.observed_chunks[0]!.index).toBe(1);
  });

  it('sin requestedMediaIds explícito ni chunk-plan suficiente → coverage UNKNOWN', () => {
    const result = aggregateRunEvidence({ logLines: [crawlTerminalLine('MED-A')] });
    expect(result.run.requested_media_ids_source).toBe('unavailable');
    expect(result.run.requested_media_ids_coverage).toBe('UNKNOWN');
  });

  it('un medio NO solicitado no aparece artificialmente como MISSING', () => {
    const result = aggregateRunEvidence({
      logLines: [crawlSourceResultLine('MED-A'), crawlTerminalLine('MED-A'), enrichSummaryLine('MED-A')],
      requestedMediaIds: ['MED-A'],
    });
    expect(result.media.find((m) => m.medio_id === 'MED-Z')).toBeUndefined();
    expect(result.media).toHaveLength(1);
  });

  it('19. medio solicitado explícitamente sin ninguna evidencia sigue siendo MISSING', () => {
    const result = aggregateRunEvidence({
      logLines: [crawlSourceResultLine('MED-A'), crawlTerminalLine('MED-A'), enrichSummaryLine('MED-A')],
      requestedMediaIds: ['MED-A', 'MED-B'],
    });
    const b = findMedio(result, 'MED-B');
    expect(b.evidence_status).toBe('MISSING');
    expect(b.requested).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Hardening Pass 3, Q2D — validación numérica estricta de chunk-plan
// (index/total: entero finito >= 1, index<=total). Una línea con shape de
// chunk-plan pero index/total corruptos NUNCA alimenta observed_chunks ni
// requested_media_ids, y NUNCA produce coverage COMPLETE.
// ─────────────────────────────────────────────────────────────────────────────

describe('aggregateRunEvidence — Hardening Pass 3, Q2D: validación numérica de chunk-plan', () => {
  it('18. index fraccional (1.5) → línea inválida, no alimenta observed_chunks ni COMPLETE', () => {
    const result = aggregateRunEvidence({
      logLines: [chunkPlanLine(['MED-A'], 1.5, 2, '[chunk 1.5/2] Crawl…')],
      deriveRequestedFromChunkPlan: true,
    });
    expect(result.observed_chunks).toHaveLength(0);
    expect(result.run.requested_media_ids_coverage).not.toBe('COMPLETE');
    expect(result.warnings.some((w) => w.toLowerCase().includes('index/total inválido'))).toBe(true);
  });

  it('19. total fraccional (2.5) → línea inválida, no COMPLETE', () => {
    const result = aggregateRunEvidence({
      logLines: [chunkPlanLine(['MED-A'], 1, 2.5, '[chunk 1/2.5] Crawl…')],
      deriveRequestedFromChunkPlan: true,
    });
    expect(result.observed_chunks).toHaveLength(0);
    expect(result.run.requested_media_ids_coverage).not.toBe('COMPLETE');
  });

  it('20. Infinity/-Infinity/NaN en index/total (no representables vía JSON.stringify) → rechazados en la validación pura', () => {
    // JSON.stringify serializa Infinity/-Infinity/NaN como `null`, así que
    // para probar el rechazo de estos valores concretos se invoca la
    // función de validación exportada directamente (equivalente a recibir
    // un input ya parseado con esos valores), en vez de pasar por
    // JSON.stringify/parse.
    expect(isValidChunkIndexTotal(Infinity, 2)).toBe(false);
    expect(isValidChunkIndexTotal(1, Infinity)).toBe(false);
    expect(isValidChunkIndexTotal(NaN, 2)).toBe(false);
    expect(isValidChunkIndexTotal(-Infinity, 2)).toBe(false);
    expect(isValidChunkIndexTotal(1, NaN)).toBe(false);
    // Control: valores válidos siguen aceptándose.
    expect(isValidChunkIndexTotal(1, 2)).toBe(true);
  });

  it('21. index=0 → rechazado', () => {
    const result = aggregateRunEvidence({
      logLines: [chunkPlanLine(['MED-A'], 0, 2, '[chunk 0/2] Crawl…')],
      deriveRequestedFromChunkPlan: true,
    });
    expect(result.observed_chunks).toHaveLength(0);
  });

  it('22. index>total → rechazado', () => {
    const result = aggregateRunEvidence({
      logLines: [chunkPlanLine(['MED-A'], 3, 2, '[chunk 3/2] Crawl…')],
      deriveRequestedFromChunkPlan: true,
    });
    expect(result.observed_chunks).toHaveLength(0);
  });

  it('index como string numérico ("1") → rechazado (nunca se coacciona)', () => {
    const l = JSON.stringify({ chunk: ['MED-A'], index: '1', total: 2, msg: '[chunk 1/2]' });
    const result = aggregateRunEvidence({ logLines: [l], deriveRequestedFromChunkPlan: true });
    expect(result.observed_chunks).toHaveLength(0);
  });

  it('index/total negativos → rechazados', () => {
    const result = aggregateRunEvidence({
      logLines: [chunkPlanLine(['MED-A'], -1, 2, '[chunk -1/2] Crawl…')],
      deriveRequestedFromChunkPlan: true,
    });
    expect(result.observed_chunks).toHaveLength(0);
  });

  it('un plan 1..N válido sigue produciendo COMPLETE (no sobre-corregido, §28)', () => {
    const result = aggregateRunEvidence({
      logLines: [
        chunkPlanLine(['MED-A'], 1, 3, '[chunk 1/3] Crawl…'),
        chunkPlanLine(['MED-B'], 2, 3, '[chunk 2/3] Crawl…'),
        chunkPlanLine(['MED-C'], 3, 3, '[chunk 3/3] Crawl…'),
      ],
      deriveRequestedFromChunkPlan: true,
    });
    expect(result.run.requested_media_ids_coverage).toBe('COMPLETE');
    expect(result.observed_chunks).toHaveLength(3);
  });

  it(
    'línea de plan de chunk inválida NO impide que las líneas VÁLIDAS restantes se agreguen a observed_chunks, ' +
      'pero SÍ impide presentar la cobertura como COMPLETE (§18: una corrupción observada nunca se ignora del todo)',
    () => {
      const result = aggregateRunEvidence({
        logLines: [
          chunkPlanLine(['MED-A'], 1, 2, '[chunk 1/2] Crawl…'),
          chunkPlanLine(['MED-B'], 1.5, 2, '[chunk raro] Crawl…'), // inválida, ignorada
          chunkPlanLine(['MED-C'], 2, 2, '[chunk 2/2] Crawl…'),
        ],
        deriveRequestedFromChunkPlan: true,
      });
      // Las líneas VÁLIDAS (index 1 y 2) sí se observan y agregan — la línea
      // corrupta no fabrica un índice 1.5 ni rompe el cálculo de 1..total.
      expect(result.observed_chunks.map((c) => c.index)).toEqual([1, 2]);
      // Pero la cobertura NUNCA se presenta como COMPLETE cuando se observó
      // CUALQUIER línea de plan de chunk corrupta, aunque las demás líneas
      // por sí solas hubieran bastado para 1..total.
      expect(result.run.requested_media_ids_coverage).toBe('PARTIAL');
      expect(result.warnings.some((w) => w.toLowerCase().includes('index/total inválido'))).toBe(true);
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// B7 — persistence semantics (§28.16)
// ─────────────────────────────────────────────────────────────────────────────

describe('aggregateRunEvidence — B7: clean_text_count/body_count no prueban persistencia', () => {
  it('16. clean_text_count/body_count quedan explícitamente marcados como no verificación de persistencia', () => {
    const result = aggregateRunEvidence({ logLines: [enrichSummaryLine('MED-A')] });
    const a = findMedio(result, 'MED-A');
    expect(a.enrich.content_persistence).toBe('UNVERIFIED');
    expect(a.enrich.clean_text_count).toBe(2);
    expect(a.enrich.body_count).toBe(2);
  });

  it('content_persistence es null cuando no hay evidencia válida de enrich', () => {
    const result = aggregateRunEvidence({ logLines: [] });
    // nadie en universe, no aplica; probamos explícitamente con requested para forzar entrada MISSING
    const r2 = aggregateRunEvidence({ logLines: [], requestedMediaIds: ['MED-A'] });
    expect(findMedio(r2, 'MED-A').enrich.content_persistence).toBeNull();
  });

  it('caso realista processed=1/failed=1/clean_text_count=1 sigue sin implicar persistencia', () => {
    const result = aggregateRunEvidence({
      logLines: [enrichSummaryLine('MED-A', { processed: 1, updated: 0, unchanged: 0, failed: 1, clean_text_count: 1, body_count: 1 })],
    });
    const a = findMedio(result, 'MED-A');
    expect(a.enrich.content_persistence).toBe('UNVERIFIED');
    expect(a.enrich.failed).toBe(1);
    expect(a.enrich.clean_text_count).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// COMPLETE exige evidencia válida (§28.17-18, §22-23)
// ─────────────────────────────────────────────────────────────────────────────

describe('aggregateRunEvidence — COMPLETE exige evidencia válida', () => {
  it('17/18. crawl ok + enrich con schema_version incompatible NO produce COMPLETE', () => {
    const lines = [crawlSourceResultLine('MED-A'), crawlTerminalLine('MED-A'), enrichSummaryLine('MED-A', { schema_version: 99 })];
    const result = aggregateRunEvidence({ logLines: lines });
    expect(findMedio(result, 'MED-A').evidence_status).not.toBe('COMPLETE');
  });

  it('crawl presente + enrich válido + condiciones satisfechas → COMPLETE', () => {
    const lines = [crawlSourceResultLine('MED-A'), crawlTerminalLine('MED-A'), enrichSummaryLine('MED-A')];
    const result = aggregateRunEvidence({ logLines: lines });
    expect(findMedio(result, 'MED-A').evidence_status).toBe('COMPLETE');
  });

  it('crawl.status=ok sin evidencia de fuente (source_method null) NO produce COMPLETE (§23)', () => {
    const lines = [crawlTerminalLine('MED-A', { estado: 'ok' }), enrichSummaryLine('MED-A')];
    const result = aggregateRunEvidence({ logLines: lines });
    const a = findMedio(result, 'MED-A');
    expect(a.crawl.source_method).toBeNull();
    expect(a.evidence_status).not.toBe('COMPLETE');
  });

  it('medio con alguna evidencia pero falta evidencia requerida → PARTIAL', () => {
    const result = aggregateRunEvidence({ logLines: [crawlSourceFailureLine('MED-A', 'timeout')] });
    expect(findMedio(result, 'MED-A').evidence_status).toBe('PARTIAL');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tolerancia a ruido, merge semantics, determinismo (regresión de comportamiento previo)
// ─────────────────────────────────────────────────────────────────────────────

describe('aggregateRunEvidence — tolerancia a ruido', () => {
  it('JSON inválido y ruido de GitHub Actions se ignoran de forma segura', () => {
    const lines = [
      '',
      'News Lake Capture\tUNKNOWN STEP\t2026-09-05T20:06:56.34Z ##[group]Run npx tsx scripts/news-lake-capture.ts',
      '{"not":"closed"',
      'random text without braces at all',
      crawlSourceResultLine('MED-A'),
      crawlTerminalLine('MED-A'),
      '{esto no es json valido}',
      enrichSummaryLine('MED-A'),
    ];
    const result = aggregateRunEvidence({ logLines: lines });
    expect(result.ignored_lines).toBeGreaterThanOrEqual(3);
    const a = findMedio(result, 'MED-A');
    expect(a.evidence_status).toBe('COMPLETE');
  });

  it('tolera prefijo real de `gh run view --log` (job\\tstep\\ttimestamp {json})', () => {
    const prefixed =
      'News Lake Capture (crawl + enrich general, sin clientes/keywords)\tUNKNOWN STEP\t2026-09-05T20:07:01.4017170Z ' +
      crawlTerminalLine('MED-0029');
    const result = aggregateRunEvidence({ logLines: [prefixed] });
    expect(findMedio(result, 'MED-0029').crawl.status).toBe('ok');
    expect(result.ignored_lines).toBe(0);
  });
});

describe('aggregateRunEvidence — merge semantics (complementarios vs. retries)', () => {
  it('múltiples eventos complementarios de un medio se combinan correctamente', () => {
    const lines = [
      crawlSourceFailureLine('MED-A', 'timeout en rss'),
      crawlSourceResultLine('MED-A', { fuente: 'sitemap' }),
      crawlTerminalLine('MED-A', { estado: 'ok' }),
      enrichSummaryLine('MED-A'),
    ];
    const result = aggregateRunEvidence({ logLines: lines });
    const a = findMedio(result, 'MED-A');
    expect(a.crawl.attempt_errors).toEqual(['timeout en rss']);
    expect(a.crawl.source_method).toBe('sitemap');
    expect(a.crawl.status).toBe('ok');
    expect(a.enrich.presence).toBe('PRESENT');
    expect(a.evidence_status).toBe('COMPLETE');
  });

  it('un retry/evento terminal duplicado NO provoca double-counting', () => {
    const lines = [
      crawlTerminalLine('MED-A', { insertadas: 2, duplicados: 0, time: 1000 }),
      crawlTerminalLine('MED-A', { insertadas: 2, duplicados: 0, time: 2000 }),
    ];
    const result = aggregateRunEvidence({ logLines: lines });
    const a = findMedio(result, 'MED-A');
    expect(a.crawl.inserted).toBe(2);
    expect(a.crawl.raw_terminal_event_count).toBe(2);
    // Hardening Pass 2 (§16 del prompt): dos observaciones EQUIVALENTES
    // (mismo status/insertadas/duplicados/promovidas_diagnostico) son una
    // repetición compatible (p.ej. retry de logging), no una contradicción
    // — por eso ya NO se marcan como `ambiguous_terminal_events` (a
    // diferencia de Pass 1, que marcaba ambiguo cualquier duplicado sin
    // comparar contenido). La propiedad que este test protege — no se
    // suman insertadas/duplicados entre observaciones — sigue intacta.
    expect(a.crawl.ambiguous_terminal_events).toBe(false);
  });

  it('5. dos enrich summaries EQUIVALENTES son repetición compatible (no double-count, no conflicto material)', () => {
    const l1 = enrichSummaryLine('MED-A', { processed: 2, updated: 2, time: 1000 });
    const l2 = enrichSummaryLine('MED-A', { processed: 2, updated: 2, time: 2000 });
    const result = aggregateRunEvidence({ logLines: [crawlMediaSummaryLine('MED-A'), l1, l2] });
    const a = findMedio(result, 'MED-A');
    expect(a.enrich.processed).toBe(2);
    expect(a.enrich.raw_summary_event_count).toBe(2);
    expect(a.enrich.ambiguous_summary_events).toBe(false);
    expect(a.enrich.conflicting_summaries).toBeNull();
    expect(a.evidence_status).toBe('COMPLETE');
  });

  it(
    '6. si un retry NO puede desambiguarse con seguridad (summaries CONTRADICTORIOS), ' +
      'NO se inventan sumas NI se elige "el más reciente" — Hardening Pass 3, Q1B/Q4 ' +
      '(antes este test solo comprobaba "no sumar" y toleraba elegir cualquiera de los dos)',
    () => {
      const l1 = enrichSummaryLine('MED-A', { processed: 2, updated: 2, time: 1000 });
      const l2 = enrichSummaryLine('MED-A', { processed: 7, updated: 7, time: 2000 });
      const result = aggregateRunEvidence({ logLines: [crawlMediaSummaryLine('MED-A'), l1, l2] });
      const a = findMedio(result, 'MED-A');
      expect(a.enrich.processed).not.toBe(9);
      // Hardening Pass 3: contradicción genuina → NINGÚN candidato se elige
      // como verdad única. `processed` (y el resto de contadores) quedan en
      // null, no en 2 ni en 7.
      expect(a.enrich.processed).toBeNull();
      expect(a.enrich.updated).toBeNull();
      expect(a.enrich.ambiguous_summary_events).toBe(true);
      expect(a.enrich.raw_summary_event_count).toBe(2);
      expect(a.enrich.conflicting_summaries).toHaveLength(2);
      expect(a.enrich.conflicting_summaries?.map((c) => c.processed).sort()).toEqual([2, 7]);
      expect(a.evidence_status).not.toBe('COMPLETE');
    },
  );
});

describe('aggregateRunEvidence — determinismo y serialización', () => {
  const lines = [
    crawlSourceResultLine('MED-A'),
    crawlTerminalLine('MED-A'),
    enrichSummaryLine('MED-A'),
    crawlTerminalLine('MED-B', { estado: 'error', insertadas: 0, duplicados: 0 }),
  ];

  it('COMPLETE/PARTIAL/MISSING se calculan de forma determinista', () => {
    const r1 = aggregateRunEvidence({ logLines: lines });
    const r2 = aggregateRunEvidence({ logLines: [...lines] });
    expect(findMedio(r1, 'MED-A').evidence_status).toBe(findMedio(r2, 'MED-A').evidence_status);
    expect(findMedio(r1, 'MED-B').evidence_status).toBe(findMedio(r2, 'MED-B').evidence_status);
  });

  it('20. el output completo es estable y serializable para un mismo input', () => {
    const r1 = aggregateRunEvidence({ logLines: lines, runId: 'RUN-1' });
    const r2 = aggregateRunEvidence({ logLines: [...lines], runId: 'RUN-1' });
    expect(r1).toEqual(r2);
    const json = JSON.stringify(r1);
    expect(JSON.parse(json)).toEqual(r1);
  });

  it('schema_version está presente y es 1', () => {
    const result = aggregateRunEvidence({ logLines: [] });
    expect(result.schema_version).toBe(1);
    expect(result.schema_version).toBe(RUN_EVIDENCE_SCHEMA_VERSION);
  });

  it('el resultado no depende de parsing de frases humanas (msg irrelevante/ausente)', () => {
    const withoutMsg = JSON.stringify({ time: 1, medio_id: 'MED-A', estado: 'ok', insertadas: 2, duplicados: 0 });
    const withMisleadingMsg = JSON.stringify({
      time: 1,
      medio_id: 'MED-A',
      estado: 'ok',
      insertadas: 2,
      duplicados: 0,
      msg: 'esto podría decir cualquier cosa en español y no debe importar',
    });
    const r1 = aggregateRunEvidence({ logLines: [withoutMsg] });
    const r2 = aggregateRunEvidence({ logLines: [withMisleadingMsg] });
    expect(findMedio(r1, 'MED-A').crawl.status).toBe('ok');
    expect(findMedio(r2, 'MED-A').crawl.status).toBe('ok');
  });

  it('dos runs diferentes (inputs/metadata distintos) no se mezclan entre sí', () => {
    const r1 = aggregateRunEvidence({
      logLines: [crawlTerminalLine('MED-A', { insertadas: 1 }), enrichSummaryLine('MED-A', { processed: 1 })],
      runId: 'RUN-1',
    });
    const r2 = aggregateRunEvidence({
      logLines: [crawlTerminalLine('MED-A', { insertadas: 99 }), enrichSummaryLine('MED-A', { processed: 99 })],
      runId: 'RUN-2',
    });
    expect(r1.run.run_id).toBe('RUN-1');
    expect(r2.run.run_id).toBe('RUN-2');
    expect(findMedio(r1, 'MED-A').crawl.inserted).toBe(1);
    expect(findMedio(r2, 'MED-A').crawl.inserted).toBe(99);
  });
});

describe('aggregateRunEvidence — casos adicionales', () => {
  it('asocia chunk_index cuando el medio aparece en exactamente un chunk observado', () => {
    const result = aggregateRunEvidence({
      logLines: [
        chunkPlanLine(['MED-A', 'MED-B'], 1, 2, '[chunk 1/2] Crawl…'),
        crawlTerminalLine('MED-A'),
        chunkPlanLine(['MED-C'], 2, 2, '[chunk 2/2] Crawl…'),
        crawlTerminalLine('MED-C'),
      ],
    });
    expect(findMedio(result, 'MED-A').chunk_index).toBe(1);
    expect(findMedio(result, 'MED-C').chunk_index).toBe(2);
    expect(result.observed_chunks).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HARDENING PASS 2 — crawl_media_summary: atomicidad, terminal_error,
// provenance, Frankenstein regression (§27-28 del prompt de Pass 2)
// ─────────────────────────────────────────────────────────────────────────────

describe('aggregateRunEvidence — Pass 2, 1: crawl_media_summary válido se reconoce (STRUCTURED_V1)', () => {
  it('un evento válido produce provenance STRUCTURED_V1 con todos los campos', () => {
    const result = aggregateRunEvidence({
      logLines: [crawlMediaSummaryLine('MED-A', { detected: 50, items: 3, inserted: 3, duplicates: 0, promoted_diagnostic: 1 })],
    });
    const a = findMedio(result, 'MED-A');
    expect(a.crawl).toMatchObject({
      provenance: 'STRUCTURED_V1',
      status: 'ok',
      source_method: 'rss',
      detected: 50,
      items: 3,
      inserted: 3,
      duplicates: 0,
      promoted_diagnostic: 1,
      terminal_error: null,
      ambiguous_terminal_events: false,
      raw_terminal_event_count: 1,
    });
  });
});

describe('aggregateRunEvidence — Pass 2, 2: schema_version incompatible no produce COMPLETE', () => {
  it('schema_version=99 se rechaza; sin evidencia legacy → provenance INVALID', () => {
    const result = aggregateRunEvidence({ logLines: [crawlMediaSummaryLine('MED-A', { schema_version: 99 })] });
    const a = findMedio(result, 'MED-A');
    expect(a.crawl.provenance).toBe('INVALID');
    expect(a.crawl.status).toBeNull();
    expect(a.crawl.invalid_event_count).toBe(1);
    expect(a.evidence_status).not.toBe('COMPLETE');
  });
});

describe('aggregateRunEvidence — Pass 2, 3: status desconocido no produce COMPLETE', () => {
  it('status="reintentando" (no está en {ok,sin_fuente,omitido,error}) se rechaza', () => {
    const result = aggregateRunEvidence({ logLines: [crawlMediaSummaryLine('MED-A', { status: 'reintentando' })] });
    const a = findMedio(result, 'MED-A');
    expect(a.crawl.provenance).toBe('INVALID');
    expect(a.evidence_status).not.toBe('COMPLETE');
  });

  it('contador negativo/no numérico también invalida el evento (sin coerción)', () => {
    for (const over of [{ items: -1 }, { detected: '10' as unknown as number }, { inserted: null as unknown as number }]) {
      const result = aggregateRunEvidence({ logLines: [crawlMediaSummaryLine('MED-A', over)] });
      const a = findMedio(result, 'MED-A');
      expect(a.crawl.provenance).toBe('INVALID');
      expect(a.crawl.items).toBeNull();
    }
  });
});

describe('aggregateRunEvidence — Pass 2, 4: STRUCTURED_V1 tiene prioridad sobre LEGACY', () => {
  it('con crawl_media_summary presente, las líneas legacy del mismo medio_id se ignoran para construir el resultado', () => {
    const lines = [
      crawlSourceResultLine('MED-A', { fuente: 'sitemap', detectadas: 999, items: 999 }),
      crawlTerminalLine('MED-A', { insertadas: 999, duplicados: 999 }),
      crawlMediaSummaryLine('MED-A', { source_method: 'rss', detected: 10, items: 2, inserted: 2, duplicates: 0 }),
    ];
    const result = aggregateRunEvidence({ logLines: lines });
    const a = findMedio(result, 'MED-A');
    expect(a.crawl.provenance).toBe('STRUCTURED_V1');
    expect(a.crawl.source_method).toBe('rss');
    expect(a.crawl.detected).toBe(10);
    expect(a.crawl.inserted).toBe(2);
  });
});

describe('aggregateRunEvidence — Pass 2, 5/6 + Hardening Pass 3 Q1A/Q4: legacy contradictorio bloquea COMPLETE sin sobrescribir el structured', () => {
  it(
    'crawl_media_summary(rss, items=2, inserted=2, ok) + CRAWL_SOURCE_RESULT(sitemap, items=9) posterior sin terminal propio ' +
      '→ structured conserva sus campos, legacy incompatible queda visible, evidence_status NO es COMPLETE ' +
      '(corregido en Hardening Pass 3, Q1A/Q4 — antes este test consagraba incorrectamente COMPLETE)',
    () => {
      const lines = [
        crawlMediaSummaryLine('MED-A', { source_method: 'rss', items: 2, inserted: 2 }),
        crawlSourceResultLine('MED-A', { fuente: 'sitemap', items: 9, detectadas: 50 }),
        enrichSummaryLine('MED-A'),
      ];
      const result = aggregateRunEvidence({ logLines: lines });
      const a = findMedio(result, 'MED-A');
      // A. NO se convierte en source_method=sitemap/items=9/inserted=2 (Frankenstein) — el
      // structured summary sigue siendo la única fuente de los campos expuestos.
      expect(a.crawl.source_method).toBe('rss');
      expect(a.crawl.items).toBe(2);
      expect(a.crawl.inserted).toBe(2);
      expect(a.crawl.provenance).toBe('STRUCTURED_V1');
      // B. La contradicción queda registrada explícitamente en el contrato...
      expect(a.crawl.legacy_conflict).toBe(true);
      // ...y también en warnings, para auditoría humana.
      expect(
        result.warnings.some((w) => w.includes('MED-A') && w.toLowerCase().includes('contradice materialmente')),
      ).toBe(true);
      // C. Hardening Pass 3, Q1A: evidencia legacy MATERIALMENTE INCOMPATIBLE
      // con un structured summary ya resuelto impide afirmar COMPLETE —
      // "structured gana pero hay una contradicción sin resolver" no es
      // evidencia suficientemente completa.
      expect(a.evidence_status).not.toBe('COMPLETE');
    },
  );

  it('crawl_media_summary(rss, items=2) + CRAWL_SOURCE_RESULT(rss, items=2) legacy COMPATIBLE no degrada innecesariamente', () => {
    const lines = [
      crawlMediaSummaryLine('MED-A', { source_method: 'rss', items: 2, detected: 10, inserted: 2 }),
      crawlSourceResultLine('MED-A', { fuente: 'rss', items: 2, detectadas: 10 }),
      enrichSummaryLine('MED-A'),
    ];
    const result = aggregateRunEvidence({ logLines: lines });
    const a = findMedio(result, 'MED-A');
    expect(a.crawl.legacy_conflict).toBe(false);
    expect(a.evidence_status).toBe('COMPLETE');
  });

  it('crawl_media_summary(status=ok) + CRAWL_MEDIA_RESULT(estado=error) legacy terminal contradictorio → NO COMPLETE', () => {
    const lines = [
      crawlMediaSummaryLine('MED-A', { status: 'ok', source_method: 'rss', inserted: 2, duplicates: 0 }),
      crawlTerminalLine('MED-A', { estado: 'error', insertadas: 0, duplicados: 0 }),
      enrichSummaryLine('MED-A'),
    ];
    const result = aggregateRunEvidence({ logLines: lines });
    const a = findMedio(result, 'MED-A');
    // El structured summary sigue ganando en los campos expuestos.
    expect(a.crawl.status).toBe('ok');
    expect(a.crawl.legacy_conflict).toBe(true);
    expect(a.evidence_status).not.toBe('COMPLETE');
  });

  it('crawl_media_summary válido + crawl_media_summary INVÁLIDO adicional (mismo medio) → inválido visible, NO COMPLETE', () => {
    const invalidLine = JSON.stringify({
      event: 'crawl_media_summary',
      schema_version: 99, // inválido
      medio_id: 'MED-A',
      status: 'ok',
    });
    const lines = [crawlMediaSummaryLine('MED-A'), invalidLine, enrichSummaryLine('MED-A')];
    const result = aggregateRunEvidence({ logLines: lines });
    const a = findMedio(result, 'MED-A');
    expect(a.crawl.provenance).toBe('STRUCTURED_V1');
    expect(a.crawl.invalid_event_count).toBe(1);
    expect(a.evidence_status).not.toBe('COMPLETE');
  });
});

describe('aggregateRunEvidence — Pass 2, 7: summaries equivalentes no generan double-counting', () => {
  it('2 eventos crawl_media_summary idénticos no duplican inserted/items', () => {
    const line = crawlMediaSummaryLine('MED-A', { inserted: 3, items: 3 });
    const result = aggregateRunEvidence({ logLines: [line, line] });
    const a = findMedio(result, 'MED-A');
    expect(a.crawl.inserted).toBe(3);
    expect(a.crawl.items).toBe(3);
    expect(a.crawl.raw_terminal_event_count).toBe(2);
    expect(a.crawl.ambiguous_terminal_events).toBe(false);
    expect(a.crawl.conflicting_summaries).toBeNull();
  });
});

describe('aggregateRunEvidence — Pass 2, 8/9: summaries conflictivos generan ambigüedad, sin mezclar campos (Frankenstein case 2)', () => {
  it('summary ok/rss/inserted=2 + summary error/sitemap/terminal_error distinto → ambigüedad, campos en null, NO mezcla', () => {
    const lines = [
      crawlMediaSummaryLine('MED-A', { status: 'ok', source_method: 'rss', inserted: 2, terminal_error: null, time: 1000 }),
      crawlMediaSummaryLine('MED-A', {
        status: 'error',
        source_method: 'sitemap',
        inserted: 0,
        terminal_error: { message: 'timeout en ingest' },
        time: 2000,
      }),
    ];
    const result = aggregateRunEvidence({ logLines: lines });
    const a = findMedio(result, 'MED-A');
    expect(a.crawl.ambiguous_terminal_events).toBe(true);
    // Nunca "status del segundo + inserted del primero" ni ninguna otra combinación fabricada.
    expect(a.crawl.status).toBeNull();
    expect(a.crawl.source_method).toBeNull();
    expect(a.crawl.inserted).toBeNull();
    expect(a.crawl.terminal_error).toBeNull();
    expect(a.crawl.conflicting_summaries).toHaveLength(2);
    expect(a.evidence_status).not.toBe('COMPLETE');
    expect(
      result.warnings.some((w) => w.includes('MED-A') && w.toLowerCase().includes('contradictorio')),
    ).toBe(true);
  });
});

describe('aggregateRunEvidence — Pass 2, 10: terminal_error queda separado de attempt/source errors', () => {
  it('fallo de intento (rss) + terminal_error real (fallo de ingest) nunca se confunden', () => {
    const lines = [
      crawlSourceFailureLine('MED-A', 'timeout en rss'),
      crawlMediaSummaryLine('MED-A', {
        status: 'error',
        source_method: 'sitemap',
        terminal_error: { message: 'ingestNoticias: constraint violation' },
      }),
    ];
    const result = aggregateRunEvidence({ logLines: lines });
    const a = findMedio(result, 'MED-A');
    expect(a.crawl.attempt_errors).toEqual(['timeout en rss']);
    expect(a.crawl.terminal_error).toEqual({ message: 'ingestNoticias: constraint violation' });
    expect(a.crawl.terminal_error?.message).not.toContain('timeout en rss');
  });
});

describe('aggregateRunEvidence — Pass 2, 11: fallback (RSS falla, sitemap funciona) conserva status final ok', () => {
  it('RSS falla (attempt error) + summary terminal ok/sitemap → status=ok, terminal_error=null', () => {
    const lines = [
      crawlSourceFailureLine('MED-A', 'RSS inválido'),
      crawlMediaSummaryLine('MED-A', { status: 'ok', source_method: 'sitemap', terminal_error: null }),
    ];
    const result = aggregateRunEvidence({ logLines: lines });
    const a = findMedio(result, 'MED-A');
    expect(a.crawl.status).toBe('ok');
    expect(a.crawl.source_method).toBe('sitemap');
    expect(a.crawl.terminal_error).toBeNull();
    expect(a.crawl.attempt_errors).toContain('RSS inválido');
  });
});

describe('aggregateRunEvidence — Pass 2, 12: legacy simple sigue funcionando (provenance LEGACY_RECONSTRUCTED)', () => {
  it('sin crawl_media_summary, terminal legacy único + source legacy único → COMPLETE con promoted_diagnostic expuesto', () => {
    const lines = [
      crawlSourceResultLine('MED-A'),
      crawlTerminalLine('MED-A', { promovidas_diagnostico: 2 }),
      enrichSummaryLine('MED-A'),
    ];
    const result = aggregateRunEvidence({ logLines: lines });
    const a = findMedio(result, 'MED-A');
    expect(a.crawl.provenance).toBe('LEGACY_RECONSTRUCTED');
    expect(a.crawl.promoted_diagnostic).toBe(2);
    expect(a.crawl.terminal_error).toBeNull();
    expect(a.evidence_status).toBe('COMPLETE');
  });
});

describe('aggregateRunEvidence — Pass 2, 13: legacy ambiguo NO produce Frankenstein COMPLETE', () => {
  it('dos CRAWL_MEDIA_RESULT legacy contradictorios para el mismo medio_id bloquean COMPLETE', () => {
    const lines = [
      crawlSourceResultLine('MED-A'),
      crawlTerminalLine('MED-A', { insertadas: 2, duplicados: 0, time: 1000 }),
      crawlTerminalLine('MED-A', { insertadas: 0, duplicados: 0, estado: 'error', time: 2000 }),
      enrichSummaryLine('MED-A'),
    ];
    const result = aggregateRunEvidence({ logLines: lines });
    const a = findMedio(result, 'MED-A');
    expect(a.crawl.provenance).toBe('LEGACY_RECONSTRUCTED');
    expect(a.crawl.ambiguous_terminal_events).toBe(true);
    expect(a.crawl.status).toBeNull();
    expect(a.crawl.inserted).toBeNull();
    expect(a.crawl.conflicting_summaries).toHaveLength(2);
    expect(a.evidence_status).not.toBe('COMPLETE');
  });

  it('más de un CRAWL_SOURCE_RESULT legacy distinto (posible mezcla de intentos) bloquea COMPLETE aunque el terminal sea único', () => {
    const lines = [
      crawlSourceResultLine('MED-A', { fuente: 'rss', detectadas: 10, items: 2 }),
      crawlSourceResultLine('MED-A', { fuente: 'sitemap', detectadas: 50, items: 9 }),
      crawlTerminalLine('MED-A'),
      enrichSummaryLine('MED-A'),
    ];
    const result = aggregateRunEvidence({ logLines: lines });
    const a = findMedio(result, 'MED-A');
    expect(a.crawl.ambiguous_source_events).toBe(true);
    expect(a.crawl.source_method).toBeNull();
    expect(a.crawl.detected).toBeNull();
    // El terminal en sí no es ambiguo (status/inserted siguen conocidos)…
    expect(a.crawl.status).toBe('ok');
    // …pero la ambigüedad de fuente sigue bloqueando COMPLETE (§19).
    expect(a.evidence_status).not.toBe('COMPLETE');
  });
});

describe('aggregateRunEvidence — Pass 2, 14: provenance distingue STRUCTURED_V1 / LEGACY_RECONSTRUCTED / INVALID / NONE', () => {
  it('cuatro medios, cuatro provenance distintos', () => {
    const lines = [
      crawlMediaSummaryLine('MED-STRUCT'),
      crawlTerminalLine('MED-LEGACY'),
      crawlMediaSummaryLine('MED-INVALID', { schema_version: 99 }),
    ];
    const result = aggregateRunEvidence({ logLines: lines, requestedMediaIds: ['MED-STRUCT', 'MED-LEGACY', 'MED-INVALID', 'MED-NONE'] });
    expect(findMedio(result, 'MED-STRUCT').crawl.provenance).toBe('STRUCTURED_V1');
    expect(findMedio(result, 'MED-LEGACY').crawl.provenance).toBe('LEGACY_RECONSTRUCTED');
    expect(findMedio(result, 'MED-INVALID').crawl.provenance).toBe('INVALID');
    expect(findMedio(result, 'MED-NONE').crawl.provenance).toBe('NONE');
  });
});

describe('aggregateRunEvidence — Pass 2: unattributable_invalid_crawl_event_count', () => {
  it('evento crawl_media_summary con medio_id no-string no fabrica un medio', () => {
    const l = JSON.stringify({
      event: 'crawl_media_summary',
      schema_version: 1,
      medio_id: 42,
      status: 'ok',
      source_method: 'rss',
      detected: 1,
      items: 1,
      inserted: 1,
      duplicates: 0,
      promoted_diagnostic: 0,
      terminal_error: null,
    });
    const result = aggregateRunEvidence({ logLines: [l] });
    expect(result.unattributable_invalid_crawl_event_count).toBe(1);
    expect(result.media).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Hardening Pass 3, Q2A/§11-12 — EVENT-FIRST DISPATCH: un `event` explícito
// SIEMPRE se clasifica primero por su propio validador, nunca cae a un
// shape legacy por coincidencia de campos.
// ─────────────────────────────────────────────────────────────────────────────

describe('aggregateRunEvidence — Hardening Pass 3, Q2A: event-first dispatch', () => {
  it(
    '9. event=crawl_media_summary + schema_version=99 + campos con shape legacy completo → ' +
      'SOLO INVALID structured, NUNCA LEGACY_RECONSTRUCTED, NO COMPLETE',
    () => {
      const bypassAttempt = JSON.stringify({
        event: 'crawl_media_summary',
        schema_version: 99, // inválido
        medio_id: 'MED-X',
        // Campos que coinciden exactamente con el shape legacy
        // (isCrawlMediaResultLine): medio_id string + estado string +
        // insertadas/duplicados numéricos — antes de Pass 3 esto podía
        // "colarse" como LEGACY_RECONSTRUCTED.
        estado: 'ok',
        insertadas: 2,
        duplicados: 0,
      });
      const result = aggregateRunEvidence({ logLines: [bypassAttempt, enrichSummaryLine('MED-X')] });
      const x = findMedio(result, 'MED-X');
      expect(x.crawl.provenance).toBe('INVALID');
      expect(x.crawl.provenance).not.toBe('LEGACY_RECONSTRUCTED');
      expect(x.crawl.invalid_event_count).toBe(1);
      expect(x.crawl.status).toBeNull();
      expect(x.crawl.inserted).toBeNull();
      expect(x.evidence_status).not.toBe('COMPLETE');
    },
  );

  it(
    '10. event=enrich_media_summary + schema_version=99 no se reclasifica como ningún otro tipo de evidencia',
    () => {
      const bypassAttempt = JSON.stringify({
        event: 'enrich_media_summary',
        schema_version: 99, // inválido
        medio_id: 'MED-X',
        requested: true,
        processed: 2,
        updated: 2,
        unchanged: 0,
        failed: 0,
        clean_text_count: 2,
        body_count: 2,
        dry_run: false,
      });
      const result = aggregateRunEvidence({ logLines: [crawlMediaSummaryLine('MED-X'), bypassAttempt] });
      const x = findMedio(result, 'MED-X');
      expect(x.enrich.presence).toBe('INVALID');
      expect(x.enrich.invalid_event_count).toBe(1);
      // No contamina crawl: crawl sigue siendo el structured summary válido
      // observado, pero la evidencia total no puede ser COMPLETE por el
      // enrich inválido.
      expect(x.crawl.provenance).toBe('STRUCTURED_V1');
      expect(x.evidence_status).not.toBe('COMPLETE');
    },
  );

  it('11. event explícito desconocido con campos de shape legacy NO se clasifica accidentalmente como legacy crawl', () => {
    const unknownEvent = JSON.stringify({
      event: 'algo_desconocido',
      medio_id: 'MED-X',
      estado: 'ok',
      insertadas: 2,
      duplicados: 0,
    });
    const result = aggregateRunEvidence({ logLines: [unknownEvent], requestedMediaIds: ['MED-X'] });
    const x = findMedio(result, 'MED-X');
    expect(x.crawl.provenance).toBe('NONE');
    expect(x.evidence_status).toBe('MISSING');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Hardening Pass 3, Q2B/Q2C — medio_id y source_method en blanco/inválidos
// se rechazan consistentemente en eventos estructurados.
// ─────────────────────────────────────────────────────────────────────────────

describe('aggregateRunEvidence — Hardening Pass 3, Q2B/Q2C: validación de medio_id y source_method', () => {
  it('12. crawl_media_summary con medio_id="" → INVALID (unattributable, nunca fabrica medio)', () => {
    const l = JSON.stringify({ ...JSON.parse(crawlMediaSummaryLine('X')), medio_id: '' });
    const result = aggregateRunEvidence({ logLines: [l] });
    expect(result.unattributable_invalid_crawl_event_count).toBe(1);
    expect(result.media).toHaveLength(0);
  });

  it('13. crawl_media_summary con medio_id="   " (solo whitespace) → INVALID', () => {
    const l = JSON.stringify({ ...JSON.parse(crawlMediaSummaryLine('X')), medio_id: '   ' });
    const result = aggregateRunEvidence({ logLines: [l] });
    expect(result.unattributable_invalid_crawl_event_count).toBe(1);
    expect(result.media).toHaveLength(0);
  });

  it('12b. enrich_media_summary con medio_id="" → INVALID (unattributable, no confundido con medio_id=null)', () => {
    const l = JSON.stringify({ ...JSON.parse(enrichSummaryLine('X')), medio_id: '' });
    const result = aggregateRunEvidence({ logLines: [l] });
    expect(result.unattributable_invalid_enrich_event_count).toBe(1);
    expect(result.unattributed_enrich).toBeNull();
  });

  it('13b. enrich_media_summary con medio_id="   " → INVALID', () => {
    const l = JSON.stringify({ ...JSON.parse(enrichSummaryLine('X')), medio_id: '   ' });
    const result = aggregateRunEvidence({ logLines: [l] });
    expect(result.unattributable_invalid_enrich_event_count).toBe(1);
    expect(result.unattributed_enrich).toBeNull();
  });

  it('14. crawl_media_summary con status=ok y source_method="" → INVALID', () => {
    const l = crawlMediaSummaryLine('MED-A', { source_method: '' });
    const result = aggregateRunEvidence({ logLines: [l] });
    const a = findMedio(result, 'MED-A');
    expect(a.crawl.provenance).toBe('INVALID');
  });

  it('15. crawl_media_summary con source_method="   " → INVALID', () => {
    const l = crawlMediaSummaryLine('MED-A', { source_method: '   ' });
    const result = aggregateRunEvidence({ logLines: [l] });
    const a = findMedio(result, 'MED-A');
    expect(a.crawl.provenance).toBe('INVALID');
  });

  it('16. crawl_media_summary con source_method="bogus" (fuente desconocida) → INVALID', () => {
    const l = crawlMediaSummaryLine('MED-A', { source_method: 'bogus' });
    const result = aggregateRunEvidence({ logLines: [l] });
    const a = findMedio(result, 'MED-A');
    expect(a.crawl.provenance).toBe('INVALID');
  });

  it('17. crawl_media_summary con source_method real (rss/sitemap) sigue siendo válido', () => {
    const rss = aggregateRunEvidence({ logLines: [crawlMediaSummaryLine('MED-A', { source_method: 'rss' })] });
    const sitemap = aggregateRunEvidence({ logLines: [crawlMediaSummaryLine('MED-B', { source_method: 'sitemap' })] });
    expect(findMedio(rss, 'MED-A').crawl.provenance).toBe('STRUCTURED_V1');
    expect(findMedio(sitemap, 'MED-B').crawl.provenance).toBe('STRUCTURED_V1');
  });

  it('source_method=null sigue siendo legítimo cuando status no es "ok" (p.ej. sin_fuente)', () => {
    const l = crawlMediaSummaryLine('MED-A', {
      status: 'sin_fuente',
      source_method: null,
      detected: 0,
      items: 0,
      inserted: 0,
      terminal_error: { message: 'sin fuente disponible' },
    });
    const result = aggregateRunEvidence({ logLines: [l] });
    const a = findMedio(result, 'MED-A');
    expect(a.crawl.provenance).toBe('STRUCTURED_V1');
    expect(a.crawl.source_method).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Hardening Pass 3, Q1/§9 — evidencia enrich inválida ADICIONAL atribuible
// al mismo medio bloquea COMPLETE, aunque coexista con un summary válido.
// ─────────────────────────────────────────────────────────────────────────────

describe('aggregateRunEvidence — Hardening Pass 3, Q1: invalid enrich adicional atribuible', () => {
  it('7. enrich válido + enrich INVÁLIDO adicional atribuible al mismo medio → inválido visible, NO COMPLETE', () => {
    const validLine = enrichSummaryLine('MED-A');
    const invalidLine = JSON.stringify({
      event: 'enrich_media_summary',
      schema_version: 1,
      medio_id: 'MED-A',
      processed: 'no-numero', // inválido
    });
    const result = aggregateRunEvidence({
      logLines: [crawlMediaSummaryLine('MED-A'), validLine, invalidLine],
    });
    const a = findMedio(result, 'MED-A');
    // El evento válido sigue siendo evidencia consultable...
    expect(a.enrich.presence).toBe('PRESENT');
    expect(a.enrich.processed).toBe(2);
    // ...pero el inválido adicional queda visible y bloquea COMPLETE.
    expect(a.enrich.invalid_event_count).toBe(1);
    expect(a.evidence_status).not.toBe('COMPLETE');
    expect(result.warnings.some((w) => w.includes('MED-A') && w.includes('INVÁLIDO'))).toBe(true);
  });

  it('8. mixed dry_run sigue bloqueando COMPLETE incluso con crawl STRUCTURED_V1 válido', () => {
    const lines = [
      crawlMediaSummaryLine('MED-A'),
      enrichSummaryLine('MED-A', { dry_run: true, time: 1000 }),
      enrichSummaryLine('MED-A', { dry_run: false, time: 2000 }),
    ];
    const result = aggregateRunEvidence({ logLines: lines });
    const a = findMedio(result, 'MED-A');
    expect(a.crawl.provenance).toBe('STRUCTURED_V1');
    expect(a.enrich.mixed_dry_run).toBe(true);
    expect(a.evidence_status).not.toBe('COMPLETE');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 22: reconstrucción con fragmentos reales del run 33989117197 (sigue funcionando)
// (MED-0029 = La Jornada, MED-0191 = La Silla Rota; sin credenciales ni datos
// sensibles, solo shape de logs ya público en el propio run).
// ─────────────────────────────────────────────────────────────────────────────

describe('aggregateRunEvidence — reconstrucción con evidencia real (run 33989117197)', () => {
  const rawLogFragment = [
    'News Lake Capture (crawl + enrich general, sin clientes/keywords)\tUNKNOWN STEP\t2026-09-05T20:06:57.3085203Z {"level":30,"time":1788638817307,"run_by":"github-actions-news-lake-capture","dry_run":false,"max_medios":2,"medio_ids":["MED-0029","MED-0191"],"max_notas":2,"enrich_limit":20,"window_days":30,"chunk_size":2,"msg":"=== News Lake Capture (crawl -> enrich general, sin clientes/keywords) ==="}',
    'News Lake Capture (crawl + enrich general, sin clientes/keywords)\tUNKNOWN STEP\t2026-09-05T20:06:58.1808816Z {"level":30,"time":1788638818175,"run_by":"github-actions-news-lake-capture","chunk":["MED-0029","MED-0191"],"index":1,"total":1,"msg":"[chunk 1/1] Crawl..."}',
    'News Lake Capture (crawl + enrich general, sin clientes/keywords)\tUNKNOWN STEP\t2026-09-05T20:07:00.1331842Z {"level":30,"time":1788638820132,"run_by":"github-actions-news-lake-capture","medioIds":["MED-0029","MED-0191"],"encontrados":2,"de":196,"msg":"Filtro --medio-ids aplicado"}',
    'News Lake Capture (crawl + enrich general, sin clientes/keywords)\tUNKNOWN STEP\t2026-09-05T20:07:00.3102011Z {"level":30,"time":1788638820309,"run_by":"github-actions-news-lake-capture","medio_id":"MED-0029","fuente":"rss","detectadas":96,"items":2,"msg":"Fuente con resultados"}',
    'News Lake Capture (crawl + enrich general, sin clientes/keywords)\tUNKNOWN STEP\t2026-09-05T20:07:01.4017170Z {"level":30,"time":1788638821401,"run_by":"github-actions-news-lake-capture","medio_id":"MED-0029","estado":"ok","insertadas":2,"duplicados":0,"promovidas_diagnostico":0,"msg":"Medio procesado: La Jornada"}',
    'News Lake Capture (crawl + enrich general, sin clientes/keywords)\tUNKNOWN STEP\t2026-09-05T20:07:01.7393928Z {"level":30,"time":1788638821738,"run_by":"github-actions-news-lake-capture","medio_id":"MED-0191","fuente":"sitemap","detectadas":2,"items":2,"msg":"Fuente con resultados"}',
    'News Lake Capture (crawl + enrich general, sin clientes/keywords)\tUNKNOWN STEP\t2026-09-05T20:07:02.6660810Z {"level":30,"time":1788638822665,"run_by":"github-actions-news-lake-capture","medio_id":"MED-0191","estado":"ok","insertadas":2,"duplicados":0,"promovidas_diagnostico":0,"msg":"Medio procesado: La Silla Rota"}',
    'News Lake Capture (crawl + enrich general, sin clientes/keywords)\tUNKNOWN STEP\t2026-09-05T20:07:02.6934015Z {"level":30,"time":1788638822693,"run_by":"github-actions-news-lake-capture","chunk":["MED-0029","MED-0191"],"index":1,"total":1,"msg":"[chunk 1/1] Enrich..."}',
    'News Lake Capture (crawl + enrich general, sin clientes/keywords)\tUNKNOWN STEP\t2026-09-05T20:07:03.6798579Z {"level":30,"time":1788638823679,"run_by":"github-actions-news-lake-capture","dryRun":false,"limit":20,"onlyMissingCleanText":true,"recentFirst":true,"windowDays":30,"medioIds":["MED-0029","MED-0191"],"msg":"Iniciando enrich-news"}',
    'News Lake Capture (crawl + enrich general, sin clientes/keywords)\tUNKNOWN STEP\t2026-09-05T20:07:05.7598986Z {"level":30,"time":1788638825759,"run_by":"github-actions-news-lake-capture","event":"enrich_media_summary","schema_version":1,"medio_id":"MED-0029","requested":true,"processed":2,"updated":2,"unchanged":0,"failed":0,"clean_text_count":2,"body_count":2,"dry_run":false,"msg":"Enrich por medio completado: MED-0029"}',
    'News Lake Capture (crawl + enrich general, sin clientes/keywords)\tUNKNOWN STEP\t2026-09-05T20:07:05.7602943Z {"level":30,"time":1788638825759,"run_by":"github-actions-news-lake-capture","event":"enrich_media_summary","schema_version":1,"medio_id":"MED-0191","requested":true,"processed":2,"updated":2,"unchanged":0,"failed":0,"clean_text_count":2,"body_count":2,"dry_run":false,"msg":"Enrich por medio completado: MED-0191"}',
  ];

  it('reconstruye MED-0029 y MED-0191 como registros separados, con crawl + enrich, sin contaminarse', () => {
    const result = aggregateRunEvidence({
      logLines: rawLogFragment,
      runId: '33989117197',
      requestedMediaIds: ['MED-0029', 'MED-0191'],
    });

    expect(result.ignored_lines).toBe(0);
    expect(result.media).toHaveLength(2);

    const med0029 = findMedio(result, 'MED-0029');
    expect(med0029.crawl).toMatchObject({
      provenance: 'LEGACY_RECONSTRUCTED',
      status: 'ok',
      source_method: 'rss',
      detected: 96,
      items: 2,
      inserted: 2,
      duplicates: 0,
      terminal_error: null, // el run 33989117197 es ANTERIOR a crawl_media_summary — legacy nunca transportó esta info (§29)
    });
    expect(med0029.enrich).toMatchObject({ presence: 'PRESENT', requested: true, processed: 2, updated: 2, failed: 0, dry_run: false, content_persistence: 'UNVERIFIED' });
    expect(med0029.evidence_status).toBe('COMPLETE');
    expect(med0029.chunk_index).toBe(1);

    const med0191 = findMedio(result, 'MED-0191');
    expect(med0191.crawl).toMatchObject({ provenance: 'LEGACY_RECONSTRUCTED', status: 'ok', source_method: 'sitemap', detected: 2, items: 2, inserted: 2, duplicates: 0 });
    expect(med0191.enrich).toMatchObject({ presence: 'PRESENT', requested: true, processed: 2, updated: 2, failed: 0, dry_run: false, content_persistence: 'UNVERIFIED' });
    expect(med0191.evidence_status).toBe('COMPLETE');
    expect(med0191.chunk_index).toBe(1);

    // MED-0029 (rss) no contamina el source_method/detected de MED-0191 (sitemap), y viceversa.
    expect(med0029.crawl.source_method).not.toBe(med0191.crawl.source_method);
    expect(med0029.crawl.detected).not.toBe(med0191.crawl.detected);

    expect(result.observed_chunks).toEqual([{ index: 1, total: 1, medio_ids: ['MED-0029', 'MED-0191'] }]);
    expect(result.run.requested_media_ids_coverage).toBe('COMPLETE'); // explicit_input
  });
});

describe('Final closure — legacy inválido/incompleto se conserva', () => {
  const partialTerminal = JSON.stringify({ medio_id: 'MED-A', estado: 'error', insertadas: 0 });
  const partialSource = JSON.stringify({ medio_id: 'MED-A', fuente: 'sitemap', items: 9 });

  it.each([
    ['contador negativo', { estado: 'error', insertadas: -1 }],
    ['estado desconocido', { estado: 'bogus' }],
    ['contador string', { insertadas: '2' }],
    ['contador fraccional', { duplicados: 0.5 }],
    ['contador null', { duplicados: null }],
    ['promovidas negativo', { promovidas_diagnostico: -1 }],
    ['promovidas string', { promovidas_diagnostico: '0' }],
    ['promovidas null', { promovidas_diagnostico: null }],
  ])('terminal legacy %s + fuente/enrich válidos nunca es COMPLETE', (_label, over) => {
    const result = aggregateRunEvidence({
      logLines: [crawlSourceResultLine('MED-A'), crawlTerminalLine('MED-A', over), enrichSummaryLine('MED-A')],
    });
    const m = findMedio(result, 'MED-A');
    expect(m.evidence_status).toBe('PARTIAL');
    expect(m.crawl.invalid_event_count).toBe(1);
    expect(m.crawl.invalid_legacy_event_count).toBe(1);
    expect(m.crawl.status).toBeNull();
    expect(m.crawl.inserted).toBeNull();
    expect(result.warnings.some(w => w.includes('legacy INVÁLIDO') && w.includes('MED-A'))).toBe(true);
  });

  it.each([
    ['fuente desconocida', { fuente: 'bogus' }],
    ['fuente vacía', { fuente: '' }],
    ['detectadas negativo', { detectadas: -1 }],
    ['items string', { items: '2' }],
    ['items fraccional', { items: 0.5 }],
    ['items ausente', { items: undefined }],
  ])('source legacy %s + terminal/enrich válidos nunca es COMPLETE', (_label, over) => {
    const result = aggregateRunEvidence({
      logLines: [crawlSourceResultLine('MED-A', over), crawlTerminalLine('MED-A'), enrichSummaryLine('MED-A')],
    });
    const m = findMedio(result, 'MED-A');
    expect(m.evidence_status).toBe('PARTIAL');
    expect(m.crawl.invalid_legacy_event_count).toBe(1);
    expect(m.crawl.source_method).toBeNull();
    expect(m.crawl.items).toBeNull();
  });

  it.each([partialTerminal, partialSource])('legacy incompleto aislado no desaparece como MISSING: %s', line => {
    const result = aggregateRunEvidence({ logLines: [line], requestedMediaIds: ['MED-A', 'MED-NONE'] });
    const m = findMedio(result, 'MED-A');
    expect(m.evidence_status).toBe('PARTIAL');
    expect(m.crawl.provenance).toBe('INVALID');
    expect(m.crawl.invalid_event_count).toBe(1);
    expect(m.crawl.invalid_legacy_event_count).toBe(1);
    expect(findMedio(result, 'MED-NONE').evidence_status).toBe('MISSING');
  });

  it.each([partialTerminal, partialSource, crawlTerminalLine('MED-A', { insertadas: -1 })])(
    'structured válido + legacy inválido conserva campos, bloquea COMPLETE: %s', line => {
      const result = aggregateRunEvidence({
        logLines: [crawlMediaSummaryLine('MED-A'), enrichSummaryLine('MED-A'), line],
      });
      const m = findMedio(result, 'MED-A');
      expect(m.crawl).toMatchObject({ provenance: 'STRUCTURED_V1', status: 'ok', source_method: 'rss', items: 2, inserted: 2 });
      expect(m.crawl.invalid_legacy_event_count).toBe(1);
      expect(m.evidence_status).toBe('PARTIAL');
    },
  );

  it.each(['', '   ', null, 42])('legacy sin ID válido no fabrica medio: %s', id => {
    const result = aggregateRunEvidence({ logLines: [
      JSON.stringify({ medio_id: id, estado: 'ok', insertadas: 2, duplicados: 0 }),
      JSON.stringify({ medio_id: id, fuente: 'rss', detectadas: 2, items: 2 }),
    ] });
    expect(result.media).toHaveLength(0);
    expect(result.unattributable_invalid_legacy_event_count).toBe(2);
  });

  it('overflow JSON y NaN serializado se rechazan sin fabricar ceros', () => {
    const result = aggregateRunEvidence({ logLines: [
      '{"medio_id":"MED-A","estado":"error","insertadas":1e309,"duplicados":0}',
      crawlTerminalLine('MED-A', { duplicados: NaN }),
      crawlSourceResultLine('MED-A', { detectadas: -Infinity }),
      enrichSummaryLine('MED-A'),
    ] });
    const m = findMedio(result, 'MED-A');
    expect(m.crawl.invalid_legacy_event_count).toBe(3);
    expect(m.crawl.inserted).toBeNull();
    expect(m.evidence_status).toBe('PARTIAL');
  });

  it('legacy válido sin campo opcional de promoción mantiene COMPLETE e identidad', () => {
    const result = aggregateRunEvidence({ logLines: [
      crawlSourceResultLine('MED-0029'),
      crawlTerminalLine('MED-0029', { promovidas_diagnostico: undefined }),
      enrichSummaryLine('MED-0029'),
    ] });
    const m = findMedio(result, 'MED-0029');
    expect(m.crawl.provenance).toBe('LEGACY_RECONSTRUCTED');
    expect(m.crawl.promoted_diagnostic).toBeNull();
    expect(m.crawl.invalid_event_count).toBe(0);
    expect(m.evidence_status).toBe('COMPLETE');
  });

  it('un fallo RSS válido seguido de éxito sitemap no crea invalid legacy', () => {
    const result = aggregateRunEvidence({ logLines: [
      crawlSourceFailureLine('MED-A', 'RSS falló'),
      crawlSourceResultLine('MED-A', { fuente: 'sitemap' }),
      crawlTerminalLine('MED-A'),
      crawlMediaSummaryLine('MED-A', { source_method: 'sitemap' }),
      enrichSummaryLine('MED-A'),
    ] });
    const m = findMedio(result, 'MED-A');
    expect(m.crawl.attempt_errors).toEqual(['RSS falló']);
    expect(m.crawl.terminal_error).toBeNull();
    expect(m.crawl.invalid_legacy_event_count).toBe(0);
    expect(m.evidence_status).toBe('COMPLETE');
  });
});

describe('Final closure — supported / unsupported domain / unrelated', () => {
  it.each(['crawl_media_summary_v2', 'crawl_media_summary_future', 'enrich_media_summary_v2', 'enrich_media_summary_future'])(
    '%s conserva señal atribuible y bloquea COMPLETE/MISSING', event => {
      const line = JSON.stringify({ event, schema_version: 2, medio_id: 'MED-A', status: 'error',
        estado: 'error', insertadas: 0, duplicados: 0, terminal_error: { message: 'late failure' } });
      const complete = aggregateRunEvidence({ logLines: [crawlMediaSummaryLine('MED-A'), enrichSummaryLine('MED-A')] });
      expect(findMedio(complete, 'MED-A').evidence_status).toBe('COMPLETE');
      const result = aggregateRunEvidence({ logLines: [crawlMediaSummaryLine('MED-A'), enrichSummaryLine('MED-A'), line] });
      const m = findMedio(result, 'MED-A');
      expect(m.unsupported_event_count).toBe(1);
      expect(m.crawl.provenance).toBe('STRUCTURED_V1');
      expect(m.crawl.status).toBe('ok');
      expect(m.crawl.legacy_conflict).toBe(false);
      expect(m.evidence_status).toBe('PARTIAL');
      expect(result.warnings.some(w => w.includes(event) && w.includes('MED-A'))).toBe(true);
      const alone = aggregateRunEvidence({ logLines: [line], requestedMediaIds: ['MED-A', 'MED-NONE'] });
      expect(findMedio(alone, 'MED-A').unsupported_event_count).toBe(1);
      expect(findMedio(alone, 'MED-A').crawl.provenance).toBe('NONE');
      expect(findMedio(alone, 'MED-A').evidence_status).toBe('PARTIAL');
      expect(findMedio(alone, 'MED-NONE').evidence_status).toBe('MISSING');
    },
  );

  it.each(['crawl_media_summary_v2', 'enrich_media_summary_future'])('%s sin ID atribuible conserva señal global sin contaminar medios', event => {
    const lines = [undefined, null, '', '   ', 42].map(medio_id => JSON.stringify({ event, medio_id }));
    const result = aggregateRunEvidence({ logLines: [crawlMediaSummaryLine('MED-A'), enrichSummaryLine('MED-A'), ...lines] });
    expect(result.unattributed_unsupported_event_count).toBe(5);
    expect(result.media).toHaveLength(1);
    expect(findMedio(result, 'MED-A').evidence_status).toBe('COMPLETE');
    expect(findMedio(result, 'MED-A').unsupported_event_count).toBe(0);
    expect(result.unattributed_enrich).toBeNull();
  });

  it.each(['http_request_completed', '', null, 42])('event explícito ajeno/malformado nunca habilita legacy: %s', event => {
    const lines = [crawlMediaSummaryLine('MED-A'), enrichSummaryLine('MED-A')];
    const baseline = aggregateRunEvidence({ logLines: lines });
    const result = aggregateRunEvidence({ logLines: [...lines,
      JSON.stringify({ event, medio_id: 'MED-A', estado: 'error', insertadas: -1, duplicados: 0 }),
    ] });
    expect(result).toEqual(baseline);
  });

  it('enrich soportado inválido con campos legacy sigue siendo solo enrich inválido', () => {
    const result = aggregateRunEvidence({ logLines: [crawlMediaSummaryLine('MED-A'),
      enrichSummaryLine('MED-A', { schema_version: 99, estado: 'error', insertadas: 0, duplicados: 0 }),
    ] });
    const m = findMedio(result, 'MED-A');
    expect(m.enrich.invalid_event_count).toBe(1);
    expect(m.crawl.invalid_legacy_event_count).toBe(0);
    expect(m.crawl.legacy_conflict).toBe(false);
    expect(m.unsupported_event_count).toBe(0);
    expect(m.evidence_status).toBe('PARTIAL');
  });

  it('invalid/unsupported de MED-B no contamina MED-A', () => {
    const result = aggregateRunEvidence({ logLines: [
      crawlMediaSummaryLine('MED-A'), enrichSummaryLine('MED-A'),
      JSON.stringify({ event: 'crawl_media_summary_v2', medio_id: 'MED-B' }),
      JSON.stringify({ medio_id: 'MED-B', estado: 'error', insertadas: 0 }),
    ], requestedMediaIds: ['MED-A', 'MED-B'] });
    expect(findMedio(result, 'MED-A').evidence_status).toBe('COMPLETE');
    expect(findMedio(result, 'MED-B')).toMatchObject({ evidence_status: 'PARTIAL', unsupported_event_count: 1 });
    expect(findMedio(result, 'MED-B').crawl.invalid_legacy_event_count).toBe(1);
  });
});

describe('Final closure — cobertura acotada por observaciones', () => {
  // La VM impide que una regresión a 1..total cuelgue la suite. No es un
  // benchmark: el resultado debe calcularse directamente con un solo chunk.
  function bounded(input: Parameters<typeof aggregateRunEvidence>[0]): RunEvidence {
    return runInNewContext('aggregateRunEvidence(input)', { aggregateRunEvidence, input }, { timeout: 100 }) as RunEvidence;
  }

  it('total=10^12 no expande el rango: devuelve PARTIAL y conserva el total', () => {
    const result = bounded({ logLines: [chunkPlanLine(['MED-A'], 1, 1_000_000_000_000, '')], deriveRequestedFromChunkPlan: true });
    expect(result.observed_chunks).toEqual([{ index: 1, total: 1_000_000_000_000, medio_ids: ['MED-A'] }]);
    expect(result.run.requested_media_ids_coverage).toBe('PARTIAL');
    expect(result.warnings.some(w => w.includes('1 índices únicos observados'))).toBe(true);
  });

  it('solo acepta safe integers, sin límite arbitrario del catálogo', () => {
    expect(isValidChunkIndexTotal(1, Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(isValidChunkIndexTotal(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(isValidChunkIndexTotal(1, Number.MAX_SAFE_INTEGER + 1)).toBe(false);
    expect(isValidChunkIndexTotal(Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER + 1)).toBe(false);
    const result = bounded({ logLines: [chunkPlanLine(['MED-A'], 1, Number.MAX_SAFE_INTEGER + 1, '')], deriveRequestedFromChunkPlan: true });
    expect(result.invalid_chunk_plan_event_count).toBe(1);
    expect(result.observed_chunks).toHaveLength(0);
    expect(result.run.requested_media_ids_coverage).toBe('UNKNOWN');
  });

  it.each([
    ['index ausente', { chunk: ['MED-B'], total: 2 }],
    ['total ausente', { chunk: ['MED-B'], index: 2 }],
    ['chunk ausente', { index: 2, total: 2 }],
    ['chunk no array', { chunk: 'MED-B', index: 2, total: 2 }],
    ['ID no string', { chunk: ['MED-B', 42], index: 2, total: 2 }],
    ['ID blank', { chunk: ['   '], index: 2, total: 2 }],
  ])('plan completo + declaración %s conserva corrupción y no COMPLETE', (_label, corrupt) => {
    const valid = chunkPlanLine(['MED-A'], 1, 1, '');
    expect(aggregateRunEvidence({ logLines: [valid], deriveRequestedFromChunkPlan: true }).run.requested_media_ids_coverage).toBe('COMPLETE');
    const result = aggregateRunEvidence({ logLines: [valid, JSON.stringify(corrupt)], deriveRequestedFromChunkPlan: true });
    expect(result.run.requested_media_ids_coverage).toBe('PARTIAL');
    expect(result.run.requested_media_ids).toEqual(['MED-A']);
    expect(result.observed_chunks).toEqual([{ index: 1, total: 1, medio_ids: ['MED-A'] }]);
    expect(result.invalid_chunk_plan_event_count).toBe(1);
    expect(result.warnings.some(w => w.includes('plan de chunk INVÁLIDO'))).toBe(true);
  });

  it('explicit [] conserva prioridad y diagnóstico de plan enorme/inválido', () => {
    const result = bounded({ logLines: [
      chunkPlanLine(['MED-A'], 1, 1_000_000_000_000, ''),
      JSON.stringify({ chunk: ['MED-B'], index: 2 }),
      chunkPlanLine(['MED-C'], 1, Number.MAX_SAFE_INTEGER + 1, ''),
    ], requestedMediaIds: [], deriveRequestedFromChunkPlan: true });
    expect(result.run).toMatchObject({ requested_media_ids: [], requested_media_ids_source: 'explicit_input', requested_media_ids_coverage: 'COMPLETE' });
    expect(result.media).toHaveLength(0);
    expect(result.invalid_chunk_plan_event_count).toBe(2);
    expect(result.warnings.some(w => w.includes('plan de chunks observado incompleto'))).toBe(true);
  });

  it('cardinalidad de índices únicos distingue completo de hueco interior y no suma repeticiones', () => {
    const lines = [4, 1, 2, 2].map(index => chunkPlanLine([`MED-${index}`], index, 4, ''));
    const partial = aggregateRunEvidence({ logLines: lines, deriveRequestedFromChunkPlan: true });
    expect(partial.observed_chunks).toHaveLength(3);
    expect(partial.run.requested_media_ids_coverage).toBe('PARTIAL');
    const complete = aggregateRunEvidence({ logLines: [...lines, chunkPlanLine(['MED-3'], 3, 4, '')], deriveRequestedFromChunkPlan: true });
    expect(complete.observed_chunks).toHaveLength(4);
    expect(complete.run.requested_media_ids_coverage).toBe('COMPLETE');
  });

  it('logs reales {chunk, code/error} son diagnósticos, no planes corruptos', () => {
    const result = aggregateRunEvidence({ logLines: [
      chunkPlanLine(['MED-A'], 1, 1, ''),
      JSON.stringify({ chunk: ['MED-A'], code: 1 }),
      JSON.stringify({ chunk: ['MED-A'], error: 'crawl exit=1' }),
    ], deriveRequestedFromChunkPlan: true });
    expect(result.invalid_chunk_plan_event_count).toBe(0);
    expect(result.run.requested_media_ids_coverage).toBe('COMPLETE');
    expect(findMedio(result, 'MED-A').evidence_status).toBe('MISSING');
  });
});
