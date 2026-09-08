/**
 * Fábricas mínimas de `RunEvidence`/`MediaEvidence` (contrato de Fase 1B,
 * `src/mediaValidation/runEvidenceAggregator.ts`) para tests de Fase 1C.
 *
 * Fase 1C NO reabre `runEvidenceAggregator.ts` — estas fábricas construyen
 * objetos con la FORMA del contrato ya publicado, con valores por defecto
 * neutros ("sin evidencia observada"), para poder testear los módulos de
 * Fase 1C (run context, composición) sin depender de logs reales ni del
 * parser de Fase 1B.
 */
import type {
  RunEvidence,
  MediaEvidence,
  CrawlMediaEvidence,
  EnrichMediaEvidence,
  UnattributedEnrichEvidence,
} from '../../src/mediaValidation/runEvidenceAggregator.js';

export function fakeCrawlEvidence(overrides: Partial<CrawlMediaEvidence> = {}): CrawlMediaEvidence {
  return {
    provenance: 'NONE',
    status: null,
    source_method: null,
    detected: null,
    items: null,
    inserted: null,
    duplicates: null,
    promoted_diagnostic: null,
    terminal_error: null,
    attempt_errors: [],
    raw_terminal_event_count: 0,
    ambiguous_terminal_events: false,
    ambiguous_source_events: false,
    invalid_event_count: 0,
    invalid_legacy_event_count: 0,
    conflicting_summaries: null,
    legacy_conflict: false,
    ...overrides,
  };
}

export function fakeEnrichEvidence(overrides: Partial<EnrichMediaEvidence> = {}): EnrichMediaEvidence {
  return {
    presence: 'MISSING',
    requested: null,
    processed: null,
    updated: null,
    unchanged: null,
    failed: null,
    clean_text_count: null,
    body_count: null,
    dry_run: null,
    content_persistence: null,
    raw_summary_event_count: 0,
    ambiguous_summary_events: false,
    mixed_dry_run: false,
    invalid_event_count: 0,
    expectation_basis: null,
    conflicting_summaries: null,
    ...overrides,
  };
}

export function fakeMediaEvidence(medioId: string, overrides: Partial<MediaEvidence> = {}): MediaEvidence {
  return {
    medio_id: medioId,
    unsupported_event_count: 0,
    requested: true,
    crawl: fakeCrawlEvidence(),
    enrich: fakeEnrichEvidence(),
    chunk_index: null,
    evidence_status: 'MISSING',
    ...overrides,
  };
}

export function fakeUnattributedEnrich(
  overrides: Partial<UnattributedEnrichEvidence> = {},
): UnattributedEnrichEvidence {
  return {
    processed: null,
    updated: null,
    unchanged: null,
    failed: null,
    clean_text_count: null,
    body_count: null,
    dry_run: null,
    content_persistence: null,
    raw_summary_event_count: 0,
    ambiguous_summary_events: false,
    mixed_dry_run: false,
    conflicting_summaries: null,
    ...overrides,
  };
}

export function fakeRunEvidence(overrides: Partial<RunEvidence> = {}): RunEvidence {
  return {
    schema_version: 1,
    run: {
      run_id: null,
      requested_media_ids: null,
      requested_media_ids_source: 'unavailable',
      requested_media_ids_coverage: 'UNKNOWN',
    },
    media: [],
    unattributed_enrich: null,
    unattributed_enrich_invalid_event_count: 0,
    unattributable_invalid_enrich_event_count: 0,
    unattributable_invalid_crawl_event_count: 0,
    unattributable_invalid_legacy_event_count: 0,
    unattributed_unsupported_event_count: 0,
    invalid_chunk_plan_event_count: 0,
    observed_chunks: [],
    ignored_lines: 0,
    warnings: [],
    ...overrides,
  };
}
