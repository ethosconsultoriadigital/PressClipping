/**
 * Run Evidence Aggregator — Media Validation & Certification, FASE 1B.
 * HARDENING PASS 1 (truthfulness + contract validation) + HARDENING PASS 2
 * (atomic crawl evidence + terminal error + attempt safety) + HARDENING
 * PASS 3 (conflict closure + input hardening + unattributed truthfulness)
 * aplicados sobre la versión inicial (auditada con NO-GO por un segundo
 * modelo arquitectónico, y re-auditada tras Pass 2 con NO-GO-PARA-COMMIT).
 *
 * Pass 3 cierra los caminos restantes hacia un `COMPLETE` falso detectados
 * por la re-auditoría (Astra): (Q1A) evidencia LEGACY que contradice
 * materialmente un `crawl_media_summary` STRUCTURED_V1 ya no permite
 * COMPLETE (el structured sigue sin sobrescribirse); (Q1B) múltiples
 * `enrich_media_summary` válidos CONTRADICTORIOS (no solo duplicados) ya no
 * eligen "el último" silenciosamente; (Q1B/Q1A extra) evidencia inválida
 * ADICIONAL atribuible al mismo medio (crawl o enrich) ya bloquea COMPLETE;
 * (Q2A) un `event` explícito SIEMPRE se clasifica por su propio validador
 * antes de poder "caer" a un shape legacy por coincidencia de campos;
 * (Q2B/Q2C) `medio_id`/`source_method` en blanco o desconocidos se
 * rechazan en la validación de eventos estructurados; (Q2D) el chunk-plan
 * exige `index`/`total` enteros finitos >= 1 con `index<=total` antes de
 * alimentar cualquier cálculo de cobertura; (Q3) el bucket
 * `unattributed_enrich` (medio_id=null) ahora preserva `dry_run`/
 * `mixed_dry_run`/`content_persistence`/`conflicting_summaries` con la
 * misma política conservadora que un medio identificado.
 *
 * Ver `docs/MEDIA_VALIDATION_AND_CERTIFICATION.md`. Este módulo es SOLO
 * LECTURA y EVIDENCE-ONLY: no clasifica PASS/REVIEW/FAIL, no decide
 * promoción, no persiste nada. Toma texto de logs estructurados (líneas
 * pino JSON, con o sin prefijo de GitHub Actions) de UNA corrida de
 * `news-lake-capture.ts` y reconstruye, por `medio_id`, un registro técnico
 * unificado con evidencia de CRAWL + ENRICH.
 *
 * Principio (§2 del prompt de Fase 1B): separar EVIDENCE COLLECTION de
 * VALIDATION DECISION. Este módulo solo resuelve la primera.
 *
 * PRINCIPIO DE HARDENING (Pass 1 y Pass 2): cuando no podamos demostrar
 * algo, NO LO AFIRMAMOS. Preferir MISSING/PARTIAL/INVALID/UNKNOWN/ambiguo
 * antes que inventar COMPLETE/NOT_EXPECTED/0/SUCCESS/una-verdad-elegida.
 * Nunca convertir ausencia de información en cero, ausencia de evidencia en
 * éxito, ni una CONTRADICCIÓN entre observaciones en una elección silenciosa
 * de cuál es "la real" (Pass 2, B3 — ver `resolveCandidates`).
 *
 * PRECONDICIÓN FORMAL (Pass 2, §22 del prompt): ONE AGGREGATION INPUT = ONE
 * RUN. Este módulo asume que `input.logLines` contiene los logs de UNA sola
 * ejecución de `news-lake-capture.ts` (o equivalente). NO intenta detectar
 * ni separar múltiples corridas concatenadas en el mismo input (no hay
 * parser multi-run, no se infieren límites de corrida por timestamps). Si el
 * input mezclara logs de más de una corrida, la evidencia por medio_id
 * podría mezclar observaciones de corridas distintas SIN que este módulo lo
 * detecte. Garantizar "un input = una corrida" es responsabilidad de la capa
 * que arma `input.logLines` (el futuro Collector, o quien invoque este
 * módulo). `run.run_id` es metadata puramente informativa suministrada por
 * el llamador (p.ej. `process.env.GITHUB_RUN_ID`): NO autentica ni demuestra
 * que las líneas realmente pertenezcan a esa corrida.
 *
 * Fuentes de evidencia reutilizadas (NO se inventa una segunda fuente de
 * verdad; Pass 2 SÍ añade un evento nuevo en el emisor — ver más abajo):
 *
 * - CRAWL_MEDIA_SUMMARY (Pass 2, evento terminal ATÓMICO y versionado, uno
 *   por medio_id por corrida — fuente PREFERIDA para runs nuevos):
 *   `event: 'crawl_media_summary'` (`src/crawlers/index.ts` define el
 *   contrato/constructor puro; `scripts/crawl.ts` emite con
 *   `logger.info(buildCrawlMediaSummaryLogPayload(...), ...)` una vez por
 *   medio, con todos los campos calculados de forma síncrona y coherente en
 *   el mismo punto del loop — nunca mezcla intentos). VALIDADO contra el
 *   contrato real antes de tratarse como evidencia (ver
 *   `validateCrawlSummaryEvent`). Ver `CrawlProvenance = 'STRUCTURED_V1'`.
 * - CRAWL_MEDIA_RESULT (legacy, terminal, uno por medio_id por corrida de
 *   `scripts/crawl.ts` — sigue emitiéndose sin cambios, ver §12 del prompt
 *   de Pass 2): línea `logger.info({medio_id, estado, insertadas,
 *   duplicados, promovidas_diagnostico}, 'Medio procesado: ...')`. NUNCA
 *   incluyó `source_method`/`terminal_error` — esa es precisamente la
 *   limitación que Pass 2 corrige en el emisor. Identificado por SHAPE
 *   (medio_id + estado string + insertadas/duplicados numéricos, sin campo
 *   `event`), nunca por `msg`. Solo se usa para reconstrucción
 *   `LEGACY_RECONSTRUCTED` cuando NO hay CRAWL_MEDIA_SUMMARY válido.
 * - CRAWL_SOURCE_RESULT (intermedio, éxito de una fuente rss/sitemap):
 *   `log.info({fuente, detectadas, items}, 'Fuente con resultados')`
 *   (`src/crawlers/index.ts`, sin cambios). Con CRAWL_MEDIA_SUMMARY válido
 *   presente, NUNCA se usa para "rellenar" ni sobrescribir sus campos
 *   (evita Frankenstein, §17 del prompt de Pass 2) — solo se usa para
 *   reconstrucción legacy.
 * - CRAWL_SOURCE_FAILURE (intermedio, fallo de una fuente antes de probar la
 *   siguiente en la cascada): `log.warn({fuente, err}, 'Fallo en fuente,
 *   probando siguiente')` (`src/crawlers/index.ts`, sin cambios). SIEMPRE se
 *   recoge como `attempt_errors`, independientemente de la procedencia
 *   (STRUCTURED_V1 o LEGACY_RECONSTRUCTED) — es evidencia de intento, nunca
 *   terminal (§8/§20 del prompt de Pass 2).
 * - ENRICH_MEDIA_SUMMARY (evento estable de Fase 1A, sin cambios en Pass 2):
 *   `event: 'enrich_media_summary'` (`src/enrichers/enrichNews.ts`,
 *   `scripts/enrich-news.ts`). Identificado por el campo `event`, VALIDADO
 *   contra el contrato real de Fase 1A antes de tratarse como evidencia
 *   (Hardening Pass 1, B2 — ver `validateEnrichSummaryEvent`).
 * - CHUNK_PLAN (metadata de correlación, ya emitida por
 *   `scripts/news-lake-capture.ts`): `logger.info({chunk, index, total},
 *   '[chunk i/n] ...')`. `index`/`total` son 1-based (`index: i + 1` en el
 *   emisor real). Se usa como metadata informativa (`observed_chunks`) y,
 *   opcionalmente, como fuente de `requested_media_ids` si se activa
 *   `deriveRequestedFromChunkPlan` — en ese caso se analiza consistencia
 *   (Hardening Pass 1, B6) para no presentar cobertura parcial como completa.
 *   Nota (Pass 2, §23 del prompt): `chunk_index` NUNCA se trata como
 *   identidad de intento (`attempt_id`) — dos observaciones conflictivas del
 *   mismo medio_id en el mismo chunk_index no se asumen duplicados.
 *
 * `medio_id` sigue siendo la unidad primaria de agregación (§7). Workflow
 * success / chunk success NUNCA sustituyen evidencia por medio.
 */
import {
  CRAWL_MEDIA_SUMMARY_EVENT,
  CRAWL_MEDIA_SUMMARY_SCHEMA_VERSION,
} from '../crawlers/index.js';
import {
  ENRICH_MEDIA_SUMMARY_EVENT,
  ENRICH_MEDIA_SUMMARY_SCHEMA_VERSION,
} from '../enrichers/enrichNews.js';

export const RUN_EVIDENCE_SCHEMA_VERSION = 1;

// ─────────────────────────────────────────────────────────────────────────────
// Tipos — Run Evidence Contract
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Procedencia de la evidencia de CRAWL para un medio_id (Hardening Pass 2,
 * hallazgos B3/B5). NO decide calidad ni éxito del medio — solo indica de
 * dónde viene la evidencia y, por tanto, cuánta confianza estructural
 * merece:
 *
 * - `'STRUCTURED_V1'`: se observó ≥1 evento `crawl_media_summary` VÁLIDO
 *   (atómico, versionado) para este medio_id. Fuente preferida (§13).
 * - `'LEGACY_RECONSTRUCTED'`: no hay `crawl_media_summary` válido, pero sí
 *   evidencia legacy (CRAWL_MEDIA_RESULT terminal y/o CRAWL_SOURCE_RESULT
 *   y/o CRAWL_SOURCE_FAILURE) a partir de la cual se reconstruye de forma
 *   conservadora (§19).
 * - `'INVALID'`: se observaron eventos crawl structured/legacy inválidos,
 *   sin evidencia crawl válida que reconstruir.
 * - `'NONE'`: no se observó evidencia crawl bajo un formato soportado.
 *   Los eventos de dominio no soportados se cuentan aparte en MediaEvidence.
 */
export type CrawlProvenance = 'STRUCTURED_V1' | 'LEGACY_RECONSTRUCTED' | 'INVALID' | 'NONE';

export interface CrawlTerminalErrorInfo {
  message: string;
}

/**
 * Candidato de resultado terminal de crawl — TODOS sus campos describen
 * (o deberían describir) el MISMO resultado terminal coherente (§6 del
 * prompt de Pass 2). Se usa tanto para candidatos `crawl_media_summary`
 * (STRUCTURED_V1, con todos los campos genuinamente atómicos) como para
 * candidatos legacy reconstruidos (LEGACY_RECONSTRUCTED, donde
 * `source_method`/`detected`/`items`/`terminal_error` pueden ser `null`
 * porque el shape legacy nunca los transportó juntos con el terminal).
 */
export interface CrawlSummaryCandidate {
  status: string;
  source_method: string | null;
  detected: number | null;
  items: number | null;
  inserted: number | null;
  duplicates: number | null;
  promoted_diagnostic: number | null;
  terminal_error: CrawlTerminalErrorInfo | null;
}

/** Evidencia de CRAWL reconstruida para un medio_id a partir de logs (Hardening Pass 2). */
export interface CrawlMediaEvidence {
  provenance: CrawlProvenance;
  /**
   * `status` (== `estado` de crawl.ts: `ok|sin_fuente|omitido|error`), o
   * `null` si no se pudo resolver con confianza (sin evidencia, evidencia
   * solo inválida, o evidencia terminal CONTRADICTORIA sin attempt_id para
   * desambiguar — ver `ambiguous_terminal_events`).
   */
  status: string | null;
  source_method: string | null;
  detected: number | null;
  items: number | null;
  inserted: number | null;
  duplicates: number | null;
  /**
   * Solo disponible cuando `provenance === 'STRUCTURED_V1'` (el shape legacy
   * nunca lo transportó). `null` en caso contrario — nunca se infiere ni se
   * fabrica un 0.
   */
  promoted_diagnostic: number | null;
  /**
   * Causa TERMINAL del resultado (Hardening Pass 2, B5) — nunca un error de
   * intento/fuente intermedio (ver `attempt_errors`). Solo disponible con
   * `provenance === 'STRUCTURED_V1'`: el shape legacy nunca transportó esta
   * información junto al terminal, así que para `LEGACY_RECONSTRUCTED`
   * siempre es `null` (no se inventa una causa que el emisor no conocía;
   * §9 del prompt de Pass 2), incluso si `status === 'error'`.
   */
  terminal_error: CrawlTerminalErrorInfo | null;
  /**
   * Mensajes de error de INTENTO/FUENTE (cascada rss→sitemap) crudos,
   * deduplicados, en orden de aparición — SIEMPRE distintos de
   * `terminal_error` (Hardening Pass 2, §8/§20). Un fallo de RSS seguido de
   * éxito de sitemap aparece aquí, NUNCA como `terminal_error`.
   */
  attempt_errors: string[];
  /**
   * Cuántos eventos terminales se observaron para este medio_id: eventos
   * `crawl_media_summary` VÁLIDOS si `provenance === 'STRUCTURED_V1'`,
   * líneas CRAWL_MEDIA_RESULT legacy si `provenance === 'LEGACY_RECONSTRUCTED'`,
   * 0 en otro caso. Normalmente 1.
   */
  raw_terminal_event_count: number;
  /**
   * true si se observó más de un resultado terminal GENUINAMENTE distinto
   * (no una repetición equivalente — p.ej. un retry de logging con el mismo
   * contenido) para este medio_id, sin `attempt_id` fiable para
   * desambiguar (Hardening Pass 2, B3/§16-18). Cuando es `true`, `status`/
   * `source_method`/`detected`/`items`/`inserted`/`duplicates`/
   * `promoted_diagnostic`/`terminal_error` quedan en `null` — NINGÚN
   * candidato se elige silenciosamente como "la verdad" — y
   * `conflicting_summaries` conserva los candidatos únicos observados para
   * auditoría. Bloquea `evidence_status='COMPLETE'`.
   */
  ambiguous_terminal_events: boolean;
  /**
   * true si, en reconstrucción `LEGACY_RECONSTRUCTED`, se observó más de un
   * CRAWL_SOURCE_RESULT genuinamente distinto (misma naturaleza de riesgo
   * que `ambiguous_terminal_events`, aplicada a la fuente). Siempre `false`
   * cuando `provenance === 'STRUCTURED_V1'` (la fuente ya viene atómica
   * dentro del summary, nunca se reconstruye por separado). Bloquea
   * `evidence_status='COMPLETE'`.
   */
  ambiguous_source_events: boolean;
  /**
   * Cuántos eventos crawl structured o legacy para este medio_id
   * fueron rechazados por inválidos (schema_version no soportado, status
   * desconocido, métricas ausentes/negativas/no numéricas, etc. — ver
   * `validateCrawlSummaryEvent`). Nunca se cuentan como evidencia ni se
   * fabrican ceros a partir de ellos, aunque coexistan con eventos válidos
   * o con evidencia legacy.
   */
  invalid_event_count: number;
  /** Subconjunto de invalid_event_count procedente de shapes legacy reconocibles. */
  invalid_legacy_event_count: number;
  /**
   * Candidatos terminales ÚNICOS observados cuando `ambiguous_terminal_events
   * === true` (Hardening Pass 2, §16-18) — para auditoría, NUNCA para elegir
   * automáticamente uno como autoritativo. `null` cuando no hay conflicto
   * genuino (incluye el caso sin evidencia en absoluto).
   */
  conflicting_summaries: CrawlSummaryCandidate[] | null;
  /**
   * true si, con `provenance === 'STRUCTURED_V1'`, se observó evidencia
   * LEGACY adicional (CRAWL_SOURCE_RESULT y/o CRAWL_MEDIA_RESULT) que
   * CONTRADICE materialmente los campos comparables del `crawl_media_summary`
   * ya resuelto (Hardening Pass 3, Q1A — p.ej. structured dice
   * `source_method=rss,items=2` y aparece un CRAWL_SOURCE_RESULT legacy con
   * `source_method=sitemap,items=9`; o structured dice `status=ok` y
   * aparece un CRAWL_MEDIA_RESULT legacy con `estado=error`).
   *
   * El structured summary NUNCA se sobrescribe por esto (`status`/
   * `source_method`/etc. siguen siendo los del structured — sigue
   * conservando autoridad sobre sus propios campos), pero la contradicción
   * queda registrada aquí y en `warnings`, y BLOQUEA
   * `evidence_status='COMPLETE'` — "structured gana pero aun así hay una
   * contradicción sin resolver" no es evidencia suficientemente completa.
   * Siempre `false` cuando `provenance !== 'STRUCTURED_V1'` (los conflictos
   * legacy-vs-legacy se cubren por `ambiguous_terminal_events`/
   * `ambiguous_source_events`, no por este campo).
   */
  legacy_conflict: boolean;
}

/**
 * `NOT_EXPECTED` se conserva en el tipo por compatibilidad futura, pero esta
 * implementación (Hardening Pass 1, hallazgo B1) NUNCA lo emite: hoy no
 * existe ninguna fuente de evidencia que demuestre de forma explícita que
 * enrich fue deliberadamente omitido para un medio_id (crawl individual
 * `!= 'ok'` NO es prueba de eso — `news-lake-capture.ts` invoca enrich a
 * nivel de CHUNK con TODOS los medio_ids del chunk, y enrich puede trabajar
 * sobre noticias previamente existentes en News Lake, no solo las insertadas
 * en esta corrida). Se reevaluará en Hardening Pass 2 si el nuevo evento
 * `crawl_media_summary` (o equivalente) aporta evidencia explícita de scope.
 *
 * `INVALID` (Hardening Pass 1, hallazgo B2): se observó un evento con shape
 * `enrich_media_summary` para este medio_id, pero falló la validación del
 * contrato (schema_version no soportado y/o métricas ausentes/inválidas) —
 * NUNCA se trata como evidencia válida ni produce `COMPLETE`.
 */
export type EnrichPresence = 'PRESENT' | 'MISSING' | 'INVALID' | 'NOT_EXPECTED';

/**
 * Candidato de un evento `enrich_media_summary` válido — todos los campos
 * semánticamente relevantes de UN evento (sin `medio_id`, que ya es la
 * clave de agrupación). Se usa para decidir equivalencia/conflicto entre
 * múltiples eventos válidos del mismo medio (o del bucket no atribuible) —
 * Hardening Pass 3, Q1B.
 */
export interface EnrichSummaryCandidate {
  requested: boolean;
  processed: number;
  updated: number;
  unchanged: number;
  failed: number;
  clean_text_count: number;
  body_count: number;
  dry_run: boolean;
}

/** Evidencia de ENRICH reconstruida para un medio_id a partir del evento `enrich_media_summary`, validado (Hardening Pass 1, B2; Hardening Pass 3, Q1B/Q3). */
export interface EnrichMediaEvidence {
  presence: EnrichPresence;
  /** `requested` del propio evento enrich_media_summary (Fase 1A) — distinto de `run.requested_media_ids` del Aggregator. `null` si no hay evento válido. */
  requested: boolean | null;
  processed: number | null;
  updated: number | null;
  unchanged: number | null;
  failed: number | null;
  clean_text_count: number | null;
  body_count: number | null;
  /**
   * `dry_run` del evento válido autoritativo (Hardening Pass 1, B4). `null`
   * si no hay evento válido. Nunca se pierde ni se ignora: un summary
   * dry-run y uno real NUNCA deben quedar indistinguibles.
   */
  dry_run: boolean | null;
  /**
   * Señala explícitamente que `clean_text_count`/`body_count` son
   * observaciones de PROCESAMIENTO, no prueba de persistencia en Supabase
   * (Hardening Pass 1, hallazgo B7). `'UNVERIFIED'` cuando hay evidencia
   * válida de enrich; `null` cuando no la hay. Este módulo NUNCA consulta
   * Supabase — la verificación real de persistencia (before/after)
   * corresponde a una fase futura.
   */
  content_persistence: 'UNVERIFIED' | null;
  /** Cuántos eventos enrich_media_summary VÁLIDOS se observaron para este medio_id. Normalmente 0 o 1. */
  raw_summary_event_count: number;
  /**
   * true si se observó más de 1 evento válido y NO todos son equivalentes
   * entre sí (Hardening Pass 3, Q1B: se compara `requested`/`processed`/
   * `updated`/`unchanged`/`failed`/`clean_text_count`/`body_count`/
   * `dry_run` — cualquier evento con shape `enrich_media_summary` que
   * agregue una `medio_id` nueva pero mismos valores es una repetición
   * compatible, no ambigüedad). Cuando es `true`, `requested`/`processed`/
   * `updated`/`unchanged`/`failed`/`clean_text_count`/`body_count`/
   * `dry_run` quedan en `null` (ningún candidato se elige como verdad
   * única) y `conflicting_summaries` conserva los candidatos únicos.
   * Bloquea `evidence_status='COMPLETE'`.
   */
  ambiguous_summary_events: boolean;
  /**
   * true si, entre los eventos válidos observados para este medio_id, hay
   * tanto `dry_run=true` como `dry_run=false` (Hardening Pass 1, B4/§11).
   * Una contradicción así impide afirmar si el resultado es real o
   * simulado — nunca se elige uno silenciosamente, y esto impide `COMPLETE`.
   */
  mixed_dry_run: boolean;
  /**
   * Cuántos eventos con shape `enrich_media_summary` para este medio_id
   * fueron rechazados por inválidos (schema_version no soportado, métricas
   * ausentes/NaN/negativas/strings, `requested`/`dry_run` no booleanos,
   * etc.) — Hardening Pass 1, B2. Nunca se cuentan como evidencia ni se
   * fabrican ceros a partir de ellos, aunque coexistan con eventos válidos.
   */
  invalid_event_count: number;
  /** Motivo por el que `presence === 'NOT_EXPECTED'`. Siempre `null` en esta revisión porque `presence` nunca vale `NOT_EXPECTED` (ver JSDoc de `EnrichPresence`). */
  expectation_basis: 'crawl_status_not_ok' | null;
  /**
   * Candidatos ÚNICOS observados cuando `ambiguous_summary_events === true`
   * (Hardening Pass 3, Q1B) — para auditoría, NUNCA para elegir
   * automáticamente uno como autoritativo. `null` cuando no hay conflicto
   * genuino (incluye el caso sin evidencia en absoluto).
   */
  conflicting_summaries: EnrichSummaryCandidate[] | null;
}

export type EvidenceStatus = 'COMPLETE' | 'PARTIAL' | 'MISSING';

export interface MediaEvidence {
  medio_id: string;
  /** Eventos crawl/enrich de una familia reconocida pero no soportados: bloquean COMPLETE y MISSING. */
  unsupported_event_count: number;
  /**
   * true si medio_id ∈ requested_media_ids (cuando esa lista fue provista).
   *
   * NOTA (Hardening Pass 1, §17): "requested"/"planned" NO implica que el
   * procesamiento individual de este medio_id haya sido efectivamente
   * intentado. Un chunk anunciado (`observed_chunks`) no prueba que todos
   * sus medios hayan llegado al punto de procesamiento — esa dimensión
   * (ATTEMPTED) no está implementada todavía (queda para Hardening Pass 2).
   */
  requested: boolean;
  crawl: CrawlMediaEvidence;
  enrich: EnrichMediaEvidence;
  /**
   * Índice 1-based del chunk observado que contiene este medio_id (mismo
   * `index` 1-based que emite `news-lake-capture.ts`), o `null` si no se
   * pudo determinar de forma inequívoca (no observado, o visto en más de un
   * chunk distinto). Solo metadata de correlación — no afecta
   * `evidence_status`.
   */
  chunk_index: number | null;
  /** Describe COMPLETITUD de la evidencia, NUNCA calidad del medio. Ver reglas en `aggregateRunEvidence`. */
  evidence_status: EvidenceStatus;
}

export interface ObservedChunk {
  /** 1-based, igual que el campo `index` real emitido por `news-lake-capture.ts` (`index: i + 1`). */
  index: number;
  total: number;
  medio_ids: string[];
}

/** Cobertura de `requested_media_ids` (Hardening Pass 1, hallazgo B6). Describe si la lista representa el universo completo conocido o una observación parcial/desconocida — NUNCA se presenta una lista parcial como si fuera exhaustiva. */
export type RequestedMediaIdsCoverage = 'COMPLETE' | 'PARTIAL' | 'UNKNOWN';

/**
 * Evidencia de ENRICH no atribuible (`medio_id: null`, ver `sinMedioId` de
 * Fase 1A) — Hardening Pass 3, Q3/Q19-23. Antes de Pass 3 este bucket solo
 * exponía los 6 contadores (`MedioEnrichCounts`), perdiendo `dry_run`/
 * `mixed_dry_run`/`content_persistence`: un summary no atribuible dry-run y
 * uno real podían producir el mismo output. Ahora sigue la MISMA política
 * conservadora que un medio identificado (equivalentes → repetición
 * compatible; contradictorios → ambigüedad conservada, nunca "el último
 * gana"), pero permanece SEPARADA de cualquier medio_id conocido — nunca se
 * fabrica un medio_id ni un pseudo-medio para representarla.
 */
export interface UnattributedEnrichEvidence {
  processed: number | null;
  updated: number | null;
  unchanged: number | null;
  failed: number | null;
  clean_text_count: number | null;
  body_count: number | null;
  /** Igual semántica que `EnrichMediaEvidence.dry_run` (Hardening Pass 1, B4; Pass 3, Q19). */
  dry_run: boolean | null;
  /** Igual semántica que `EnrichMediaEvidence.content_persistence` (Hardening Pass 1, B7; Pass 3, Q22): SIEMPRE `'UNVERIFIED'` cuando hay evidencia válida, nunca prueba persistencia aunque medio_id sea null. */
  content_persistence: 'UNVERIFIED' | null;
  /** Cuántos eventos enrich_media_summary VÁLIDOS con medio_id=null se observaron. Normalmente 0 o 1. */
  raw_summary_event_count: number;
  /** Igual semántica que `EnrichMediaEvidence.ambiguous_summary_events` (Hardening Pass 3, Q1B/Q21), aplicada al bucket no atribuible. */
  ambiguous_summary_events: boolean;
  /** Igual semántica que `EnrichMediaEvidence.mixed_dry_run` (Hardening Pass 1, B4; Pass 3, Q21c). */
  mixed_dry_run: boolean;
  /** Igual semántica que `EnrichMediaEvidence.conflicting_summaries` (Hardening Pass 3, Q1B/Q21). */
  conflicting_summaries: EnrichSummaryCandidate[] | null;
}

export interface RunEvidence {
  schema_version: number;
  run: {
    /** Metadata externa, suministrada por el llamador (p.ej. GITHUB_RUN_ID). NUNCA se infiere de los logs. */
    run_id: string | null;
    /** Lista final de medio_ids esperados usada por el Aggregator, o null si no había ninguna disponible. Puede ser `[]` si el llamador declaró explícitamente cero medios (ver `requested_media_ids_source`). */
    requested_media_ids: string[] | null;
    /** De dónde vino `requested_media_ids`. */
    requested_media_ids_source: 'explicit_input' | 'chunk_plan_logs' | 'unavailable';
    /**
     * Completitud de `requested_media_ids` (Hardening Pass 1, B6):
     * - `'COMPLETE'`: input explícito del llamador (incluso `[]`), o
     *   chunk-plan con todos los índices 1..total observados sin conflictos.
     * - `'PARTIAL'`: derivado de chunk-plan pero con índices faltantes,
     *   fuera de rango, `total` inconsistente, o declaraciones conflictivas
     *   para el mismo índice.
     * - `'UNKNOWN'`: no hay ni input explícito ni chunk-plan suficiente.
     */
    requested_media_ids_coverage: RequestedMediaIdsCoverage;
  };
  media: MediaEvidence[];
  /**
   * Noticias de enrich VÁLIDAS con `medio_id: null` (no atribuibles — ver
   * `sinMedioId` de Fase 1A). No se fuerza a ningún medio_id ni se descarta.
   * `null` si no se observó evidencia VÁLIDA de este tipo (puede haber
   * evidencia inválida — ver `unattributed_enrich_invalid_event_count`).
   * Desde Hardening Pass 3 (Q3) conserva `dry_run`/`mixed_dry_run`/
   * `content_persistence`/`conflicting_summaries` con la misma política
   * conservadora que un medio identificado — ver `UnattributedEnrichEvidence`.
   */
  unattributed_enrich: UnattributedEnrichEvidence | null;
  /** Eventos con shape `enrich_media_summary` y `medio_id: null` que fallaron la validación del contrato (Hardening Pass 1, B2/B9). Nunca se fabrican datos a partir de ellos. */
  unattributed_enrich_invalid_event_count: number;
  /** Eventos con shape `enrich_media_summary` cuyo `medio_id` no es ni string ni `null` (no atribuible ni siquiera al bucket "sin atribuir"). */
  unattributable_invalid_enrich_event_count: number;
  /**
   * Eventos con shape `crawl_media_summary` cuyo `medio_id` no es una string
   * no vacía (Hardening Pass 2). A diferencia de enrich, crawl NO tiene un
   * bucket "sin atribuir" válido (todo `crawl_media_summary` real siempre
   * conoce su `medio_id`), así que esto solo puede ocurrir con evidencia
   * malformada/adversarial — nunca se fabrica un medio_id para contarlo.
   */
  unattributable_invalid_crawl_event_count: number;
  /** Legacy crawl inválido sin ID atribuible; no se fabrica un medio. */
  unattributable_invalid_legacy_event_count: number;
  /** Variantes de eventos del dominio sin ID atribuible (incluye null); no invalida otros medios. */
  unattributed_unsupported_event_count: number;
  /** Declaraciones reconocibles de chunk-plan rechazadas; no aportan IDs al universo. */
  invalid_chunk_plan_event_count: number;
  /** Metadata de correlación RUN → CHUNK → medio_id, leída de logs de plan de chunk ya existentes en news-lake-capture.ts (índices 1-based). Puramente informativa. */
  observed_chunks: ObservedChunk[];
  /** Líneas de input que parecían tener JSON pero no pudieron parsearse, o no tenían `{` en absoluto. Solo cuenta, no aborta el parseo (§13). */
  ignored_lines: number;
  /** Advertencias de agregación: ambigüedades, eventos inválidos, cobertura parcial, dry-run mixto, evidencia incompleta. Nunca se traduce en una suma o dato inventado. */
  warnings: string[];
}

export interface RunEvidenceAggregatorInput {
  /** Texto crudo de logs (una corrida) o array de líneas ya separadas. Tolera prefijos de GitHub Actions y ruido no-JSON. */
  logLines: string | string[];
  /** Identificador de la corrida — SIEMPRE input externo (p.ej. `process.env.GITHUB_RUN_ID`). Nunca se parsea de los logs porque hoy no aparece en ellos. */
  runId?: string | null;
  /**
   * medio_ids esperados para esta corrida/chunk, suministrados
   * explícitamente por el llamador (p.ej. `plan.medioIds` de
   * `news-lake-capture.ts`, o `--medio-ids`).
   *
   * IMPORTANTE (Hardening Pass 1, §15): distinguir "no se proveyó ninguna
   * lista" (`undefined`, el default) de "se proveyó una lista explícita
   * vacía" (`[]`, que sigue siendo `requested_media_ids_source:
   * 'explicit_input'` con cobertura `'COMPLETE'` — el llamador declaró
   * explícitamente cero medios esperados). Sin ninguno de los dos,
   * `MISSING` no puede calcularse con confianza.
   *
   * Se normaliza recortando whitespace accidental y deduplicando (§25) —
   * nunca se rechaza la lista completa por eso, solo se sanea de forma
   * conservadora.
   */
  requestedMediaIds?: string[];
  /**
   * Si es `true` y no se proveyó `requestedMediaIds` explícito (ver nota de
   * arriba: incluir `[]` cuenta como "sí se proveyó"), se reconstruye la
   * lista esperada a partir de las líneas de plan de chunk que
   * `news-lake-capture.ts` YA emite hoy (`{chunk:[...], index, total}`,
   * 1-based), si aparecen en el input. Es opt-in y por defecto `false`.
   *
   * La cobertura resultante se marca `'PARTIAL'` (Hardening Pass 1, B6) si
   * faltan índices 1..total, si `total` es inconsistente entre líneas, o si
   * hay declaraciones conflictivas para el mismo índice — nunca se presenta
   * una observación parcial (p.ej. solo el chunk 1 de un total de 4) como
   * si fuera el universo completo.
   */
  deriveRequestedFromChunkPlan?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Parsing tolerante de líneas (§13) — sin regex sobre frases humanas
// ─────────────────────────────────────────────────────────────────────────────

interface ParsedLine {
  json: Record<string, unknown>;
  /** Índice de orden de aparición en el input (0-based). Único desambiguador cuando no hay `time`. */
  order: number;
  /** `time` de pino (epoch ms) si el campo existe y es numérico; si no, `null`. */
  time: number | null;
}

/**
 * Extrae el primer objeto JSON de una línea de texto, tolerando prefijos no
 * estructurados (p.ej. `<job>\t<step>\t<timestamp> {...}` de `gh run view
 * --log`) y sufijos de línea (`\r`). No usa regex sobre el contenido
 * semántico del mensaje: busca estructuralmente la primera `{` y prueba
 * `JSON.parse` desde ahí. Si falla, la línea se descarta silenciosamente
 * (se cuenta en `ignored_lines`, nunca tumba el resto del parseo).
 */
function parseLine(line: string): Record<string, unknown> | null {
  const trimmed = line.replace(/\r$/, '');
  const idx = trimmed.indexOf('{');
  if (idx === -1) return null;
  try {
    const value = JSON.parse(trimmed.slice(idx));
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function parseAllLines(input: string | string[]): { parsed: ParsedLine[]; ignored: number } {
  const rawLines = Array.isArray(input) ? input : input.split(/\r?\n/);
  const parsed: ParsedLine[] = [];
  let ignored = 0;
  let order = 0;
  for (const raw of rawLines) {
    if (raw.trim().length === 0) continue; // línea vacía: no es "ruido a reportar", simplemente se omite
    const json = parseLine(raw);
    if (json === null) {
      ignored += 1;
      continue;
    }
    const time = typeof json.time === 'number' ? json.time : null;
    parsed.push({ json, order, time });
    order += 1;
  }
  return { parsed, ignored };
}

// ─────────────────────────────────────────────────────────────────────────────
// Predicados de shape — identificación SIN depender de `msg`
// ─────────────────────────────────────────────────────────────────────────────

function isMedioId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

// Reconocer primero permite conservar un terminal/fuente incompleto como
// evidencia inválida. No dependemos de msg ni de la validez del propio ID.
function looksLikeLegacyCrawlTerminal(l: Record<string, unknown>): boolean {
  return ('estado' in l && ('insertadas' in l || 'duplicados' in l || 'promovidas_diagnostico' in l)) ||
    ('insertadas' in l && 'duplicados' in l);
}

function looksLikeLegacyCrawlSource(l: Record<string, unknown>): boolean {
  return ('fuente' in l && ('detectadas' in l || 'items' in l)) ||
    ('detectadas' in l && 'items' in l);
}

function looksLikeLegacyCrawlFailure(l: Record<string, unknown>): boolean {
  return 'fuente' in l && 'err' in l;
}

function validateLegacyCounts(l: Record<string, unknown>, fields: readonly string[]): string[] {
  return fields.filter((field) => {
    const v = l[field];
    return typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v) || v < 0;
  }).map((field) => `${field} debe ser un entero finito >= 0`);
}

function validateLegacyCrawlTerminal(l: Record<string, unknown>): string[] {
  const reasons = validateLegacyCounts(l, ['insertadas', 'duplicados']);
  if (!isMedioId(l.medio_id)) reasons.push('medio_id inválido');
  if (typeof l.estado !== 'string' || !CRAWL_STATUS_VALUES.has(l.estado)) reasons.push('estado desconocido/inválido');
  if ('promovidas_diagnostico' in l) reasons.push(...validateLegacyCounts(l, ['promovidas_diagnostico']));
  return reasons;
}

function validateLegacyCrawlSource(l: Record<string, unknown>): string[] {
  const reasons = validateLegacyCounts(l, ['detectadas', 'items']);
  if (!isMedioId(l.medio_id)) reasons.push('medio_id inválido');
  if (typeof l.fuente !== 'string' || !CRAWL_SOURCE_METHOD_VALUES.has(l.fuente)) reasons.push('fuente desconocida/inválida');
  return reasons;
}

function validateLegacyCrawlFailure(l: Record<string, unknown>): string[] {
  const reasons: string[] = [];
  if (!isMedioId(l.medio_id)) reasons.push('medio_id inválido');
  if (typeof l.fuente !== 'string' || !CRAWL_SOURCE_METHOD_VALUES.has(l.fuente)) reasons.push('fuente desconocida/inválida');
  if (typeof l.err !== 'string') reasons.push('err debe ser string');
  return reasons;
}

/** Convención acotada: solo extensiones con '_' de las dos familias conocidas. */
function isUnsupportedDomainEvent(event: unknown): event is string {
  return typeof event === 'string' &&
    (event.startsWith(`${CRAWL_MEDIA_SUMMARY_EVENT}_`) || event.startsWith(`${ENRICH_MEDIA_SUMMARY_EVENT}_`));
}

/**
 * Detección de SHAPE (Hardening Pass 3, Q2D): "esto parece una línea de
 * plan de chunk" — deliberadamente NO valida `index`/`total` todavía, para
 * poder distinguir "no es una línea de plan de chunk en absoluto" (se
 * ignora sin más) de "ES una línea de plan de chunk pero con index/total
 * corruptos" (debe generar una advertencia explícita y NUNCA alimentar
 * `observed_chunks`/cobertura — ver `isValidChunkIndexTotal`).
 */
function looksLikeChunkPlanLine(l: Record<string, unknown>): boolean {
  // El emisor también tiene logs {chunk, code/error} que NO son planes.
  return ('chunk' in l && ('index' in l || 'total' in l)) || ('index' in l && 'total' in l);
}

function validateChunkPlanLine(l: Record<string, unknown>): string[] {
  const reasons: string[] = [];
  if (!isValidChunkIndexTotal(l.index, l.total)) reasons.push('index/total inválido: se requieren enteros seguros >= 1, index<=total');
  if (!Array.isArray(l.chunk) || !l.chunk.every(isMedioId)) reasons.push('chunk inválido: se requiere un array de medio_ids no vacíos');
  return reasons;
}

/**
 * Validación numérica estricta de `index`/`total` de una línea de plan de
 * chunk (Hardening Pass 3, Q2D/§16-18). Ambos deben ser `number` finitos,
 * enteros seguros, >= 1, con `index <= total`. Rechaza explícitamente NaN,
 * Infinity/-Infinity, fracciones, 0, negativos y strings numéricos (un
 * string nunca pasa `typeof === 'number'`).
 *
 * No impone un máximo de catálogo. La cobertura recorre solo observaciones,
 * nunca el rango 1..total, incluso cuando total es un entero seguro enorme.
 */
export function isValidChunkIndexTotal(index: unknown, total: unknown): boolean {
  return (
    typeof index === 'number' &&
    Number.isFinite(index) &&
    Number.isSafeInteger(index) &&
    index >= 1 &&
    typeof total === 'number' &&
    Number.isFinite(total) &&
    Number.isSafeInteger(total) &&
    total >= 1 &&
    index <= total
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Validación del evento enrich_media_summary (Hardening Pass 1, B2/B4/B9)
// ─────────────────────────────────────────────────────────────────────────────

/** Shape de datos ya validados de un evento `enrich_media_summary` (Fase 1A). */
interface ValidEnrichSummaryData {
  medio_id: string | null;
  requested: boolean;
  processed: number;
  updated: number;
  unchanged: number;
  failed: number;
  clean_text_count: number;
  body_count: number;
  dry_run: boolean;
}

const ENRICH_COUNT_FIELDS = [
  'processed',
  'updated',
  'unchanged',
  'failed',
  'clean_text_count',
  'body_count',
] as const;

/**
 * Valida un objeto con `event === 'enrich_media_summary'` contra el
 * contrato REAL emitido por Fase 1A (`buildEnrichMediaSummaryLogPayload` /
 * `buildEnrichUnattributedLogPayload` en `src/enrichers/enrichNews.ts`).
 *
 * Rechaza explícitamente (Hardening Pass 1, B2/B6):
 * - `schema_version` distinto del soportado (`ENRICH_MEDIA_SUMMARY_SCHEMA_VERSION`);
 * - `medio_id` que no sea string no vacía o `null`;
 * - `requested`/`dry_run` que no sean booleanos;
 * - cualquier contador (`processed`, `updated`, `unchanged`, `failed`,
 *   `clean_text_count`, `body_count`) que no sea un número finito >= 0
 *   (rechaza NaN, Infinity, strings numéricos, negativos, ausentes).
 *
 * NUNCA usa coerción permisiva (`Number(value) || 0`): un valor inválido o
 * ausente hace inválido el evento completo, nunca se sustituye por 0.
 */
function validateEnrichSummaryEvent(
  l: Record<string, unknown>,
): { valid: true; data: ValidEnrichSummaryData } | { valid: false; reasons: string[] } {
  const reasons: string[] = [];

  if (l.schema_version !== ENRICH_MEDIA_SUMMARY_SCHEMA_VERSION) {
    reasons.push(
      `schema_version no soportado (esperado ${ENRICH_MEDIA_SUMMARY_SCHEMA_VERSION}, recibido ${JSON.stringify(l.schema_version)})`,
    );
  }

  // Hardening Pass 3, Q2B: "   " (solo whitespace) NO es un medio_id válido
  // — se valida con `.trim().length > 0`, nunca se normaliza silenciosamente.
  const medioIdOk = typeof l.medio_id === 'string' ? l.medio_id.trim().length > 0 : l.medio_id === null;
  if (!medioIdOk) {
    reasons.push(`medio_id inválido (debe ser string no vacía/no-blank o null): ${JSON.stringify(l.medio_id)}`);
  }

  if (typeof l.requested !== 'boolean') {
    reasons.push(`requested ausente o no booleano: ${JSON.stringify(l.requested)}`);
  }

  for (const field of ENRICH_COUNT_FIELDS) {
    const v = l[field];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      reasons.push(`${field} inválido (se esperaba número finito >= 0): ${JSON.stringify(v)}`);
    }
  }

  if (typeof l.dry_run !== 'boolean') {
    reasons.push(`dry_run ausente o no booleano: ${JSON.stringify(l.dry_run)}`);
  }

  if (reasons.length > 0) return { valid: false, reasons };

  return {
    valid: true,
    data: {
      medio_id: l.medio_id as string | null,
      requested: l.requested as boolean,
      processed: l.processed as number,
      updated: l.updated as number,
      unchanged: l.unchanged as number,
      failed: l.failed as number,
      clean_text_count: l.clean_text_count as number,
      body_count: l.body_count as number,
      dry_run: l.dry_run as boolean,
    },
  };
}

interface EnrichObservation {
  order: number;
  time: number | null;
  data: ValidEnrichSummaryData;
}

interface InvalidEnrichObservation {
  order: number;
  time: number | null;
  reasons: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Validación del evento crawl_media_summary (Hardening Pass 2, B2-símil para
// crawl). Deriva el conjunto de `status` válidos del código REAL
// (`CrawlResult['estado']` en src/crawlers/index.ts): 'ok'|'sin_fuente'|
// 'omitido'|'error'. Un status desconocido bajo schema_version=1 NO se
// considera válido automáticamente (§15 del prompt de Pass 2).
// ─────────────────────────────────────────────────────────────────────────────

const CRAWL_STATUS_VALUES = new Set(['ok', 'sin_fuente', 'omitido', 'error']);
// Hardening Pass 3, Q2C: conjunto REAL de fuentes soportadas por el
// crawler (`METODOS_MVP` en src/crawlers/index.ts: solo rss/sitemap pueden
// aparecer en `CrawlResult.fuente`/`crawl_media_summary.source_method`
// cuando no es null). No se cambia el tipo exportado (string | null) para
// no reabrir el emisor (§29/§15 del prompt de Pass 3) — solo se endurece la
// validación runtime.
const CRAWL_SOURCE_METHOD_VALUES = new Set(['rss', 'sitemap']);
const CRAWL_SUMMARY_NUMERIC_FIELDS = [
  'detected',
  'items',
  'inserted',
  'duplicates',
  'promoted_diagnostic',
] as const;

interface ValidCrawlSummaryData extends CrawlSummaryCandidate {
  medio_id: string;
}

/**
 * Valida un objeto con `event === 'crawl_media_summary'` contra el contrato
 * REAL emitido por Pass 2 (`buildCrawlMediaSummaryLogPayload` en
 * `src/crawlers/index.ts`). Rechaza explícitamente, sin coerción permisiva:
 * `schema_version` no soportado; `medio_id` que no sea string no vacía;
 * `status` fuera del conjunto conocido; `source_method` que no sea string o
 * null; cualquier contador que no sea un número finito >= 0; `terminal_error`
 * que no sea `null` o `{message: string}`.
 */
function validateCrawlSummaryEvent(
  l: Record<string, unknown>,
): { valid: true; data: ValidCrawlSummaryData } | { valid: false; reasons: string[] } {
  const reasons: string[] = [];

  if (l.schema_version !== CRAWL_MEDIA_SUMMARY_SCHEMA_VERSION) {
    reasons.push(
      `schema_version no soportado (esperado ${CRAWL_MEDIA_SUMMARY_SCHEMA_VERSION}, recibido ${JSON.stringify(l.schema_version)})`,
    );
  }

  // Hardening Pass 3, Q2B: "   " (solo whitespace) NO es un medio_id válido.
  if (typeof l.medio_id !== 'string' || l.medio_id.trim().length === 0) {
    reasons.push(`medio_id inválido (debe ser string no vacía/no-blank): ${JSON.stringify(l.medio_id)}`);
  }

  if (typeof l.status !== 'string' || !CRAWL_STATUS_VALUES.has(l.status)) {
    reasons.push(
      `status desconocido/no soportado bajo schema_version=${CRAWL_MEDIA_SUMMARY_SCHEMA_VERSION}: ${JSON.stringify(l.status)}`,
    );
  }

  // Hardening Pass 3, Q2C: null sigue siendo legítimo (p.ej. sin_fuente),
  // pero una string debe identificar una fuente REAL — nunca "", "   " ni
  // "bogus".
  if (!(l.source_method === null || (typeof l.source_method === 'string' && CRAWL_SOURCE_METHOD_VALUES.has(l.source_method)))) {
    reasons.push(
      `source_method inválido (debe ser null o uno de [${[...CRAWL_SOURCE_METHOD_VALUES].join(', ')}]): ${JSON.stringify(l.source_method)}`,
    );
  }

  for (const field of CRAWL_SUMMARY_NUMERIC_FIELDS) {
    const v = l[field];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      reasons.push(`${field} inválido (se esperaba número finito >= 0): ${JSON.stringify(v)}`);
    }
  }

  const te = l.terminal_error;
  const terminalErrorOk =
    te === null ||
    (typeof te === 'object' && te !== null && !Array.isArray(te) && typeof (te as Record<string, unknown>).message === 'string');
  if (!terminalErrorOk) {
    reasons.push(`terminal_error inválido (debe ser null o {message: string}): ${JSON.stringify(te)}`);
  }

  if (reasons.length > 0) return { valid: false, reasons };

  return {
    valid: true,
    data: {
      medio_id: l.medio_id as string,
      status: l.status as string,
      source_method: l.source_method as string | null,
      detected: l.detected as number,
      items: l.items as number,
      inserted: l.inserted as number,
      duplicates: l.duplicates as number,
      promoted_diagnostic: l.promoted_diagnostic as number,
      terminal_error: te === null ? null : { message: (te as Record<string, unknown>).message as string },
    },
  };
}

interface CrawlSummaryObservation {
  order: number;
  time: number | null;
  data: ValidCrawlSummaryData;
}

interface InvalidCrawlSummaryObservation {
  order: number;
  time: number | null;
  reasons: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolución conservadora de candidatos terminales de crawl (Hardening Pass
// 2, B3/§16-18; generalizada en Pass 3 para enrich también, ver
// `resolveEnrichGroup` más abajo). NUNCA se elige silenciosamente un
// candidato como "la verdad" cuando los candidatos observados son
// genuinamente distintos entre sí: eso sería fabricar una correlación que
// el emisor no puede demostrar (no existe `attempt_id`, y no se inventa uno
// — §23/L). Solo cuando TODOS los candidatos son equivalentes entre sí se
// tratan como repeticiones compatibles (p.ej. reintento de logging) y se
// expone uno con seguridad.
// ─────────────────────────────────────────────────────────────────────────────

function resolveCandidates<T>(
  items: T[],
  equal: (a: T, b: T) => boolean,
): { resolved: T | null; ambiguous: boolean; conflicting: T[] | null } {
  if (items.length === 0) return { resolved: null, ambiguous: false, conflicting: null };
  const first = items[0]!;
  const allEquivalent = items.every((c) => equal(c, first));
  if (allEquivalent) return { resolved: first, ambiguous: false, conflicting: null };
  const uniques: T[] = [];
  for (const c of items) {
    if (!uniques.some((u) => equal(u, c))) uniques.push(c);
  }
  return { resolved: null, ambiguous: true, conflicting: uniques };
}

/** Igualdad de candidatos terminales STRUCTURED_V1 — compara TODOS los campos del resultado terminal. */
function structuredCandidatesEqual(a: CrawlSummaryCandidate, b: CrawlSummaryCandidate): boolean {
  return (
    a.status === b.status &&
    a.source_method === b.source_method &&
    a.detected === b.detected &&
    a.items === b.items &&
    a.inserted === b.inserted &&
    a.duplicates === b.duplicates &&
    a.promoted_diagnostic === b.promoted_diagnostic &&
    (a.terminal_error?.message ?? null) === (b.terminal_error?.message ?? null)
  );
}

interface LegacyTerminalCandidate {
  status: string;
  inserted: number;
  duplicates: number;
  promoted_diagnostic: number | null;
}

function legacyTerminalCandidatesEqual(a: LegacyTerminalCandidate, b: LegacyTerminalCandidate): boolean {
  return (
    a.status === b.status &&
    a.inserted === b.inserted &&
    a.duplicates === b.duplicates &&
    a.promoted_diagnostic === b.promoted_diagnostic
  );
}

interface LegacySourceCandidate {
  source_method: string;
  detected: number;
  items: number;
}

function legacySourceCandidatesEqual(a: LegacySourceCandidate, b: LegacySourceCandidate): boolean {
  return a.source_method === b.source_method && a.detected === b.detected && a.items === b.items;
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolución conservadora de candidatos enrich_media_summary (Hardening
// Pass 3, Q1B). Mismo principio que `resolveCandidates` para crawl: dos o
// más eventos válidos para el mismo medio_id (o para el bucket no
// atribuible) solo se tratan como repetición compatible si son
// EQUIVALENTES en todos los campos semánticamente relevantes. Si difieren
// en cualquiera de ellos, es una CONTRADICCIÓN — no se elige "el más
// reciente" como verdad, se conserva la ambigüedad explícitamente.
// ─────────────────────────────────────────────────────────────────────────────

function enrichCandidatesEqual(a: ValidEnrichSummaryData, b: ValidEnrichSummaryData): boolean {
  return (
    a.requested === b.requested &&
    a.processed === b.processed &&
    a.updated === b.updated &&
    a.unchanged === b.unchanged &&
    a.failed === b.failed &&
    a.clean_text_count === b.clean_text_count &&
    a.body_count === b.body_count &&
    a.dry_run === b.dry_run
  );
}

function toEnrichSummaryCandidate(d: ValidEnrichSummaryData): EnrichSummaryCandidate {
  return {
    requested: d.requested,
    processed: d.processed,
    updated: d.updated,
    unchanged: d.unchanged,
    failed: d.failed,
    clean_text_count: d.clean_text_count,
    body_count: d.body_count,
    dry_run: d.dry_run,
  };
}

interface ResolvedEnrichGroup {
  resolved: ValidEnrichSummaryData | null;
  ambiguous: boolean;
  conflicting: EnrichSummaryCandidate[] | null;
  mixedDryRun: boolean;
}

/**
 * Resuelve un grupo de observaciones `enrich_media_summary` VÁLIDAS (todas
 * del mismo medio_id, o todas del bucket no atribuible) aplicando la misma
 * política conservadora en ambos casos (Hardening Pass 3, Q1B/Q3): sin
 * observaciones → nada; equivalentes entre sí → repetición compatible
 * (se expone 1 resultado con seguridad); genuinamente distintas → ninguna
 * se elige como verdad, se exponen como `conflicting`. `mixedDryRun` es una
 * señal más específica (solo mira `dry_run`) que coexiste con `ambiguous`
 * (si hay mixed dry_run, por construcción también hay `ambiguous=true`,
 * porque `dry_run` es uno de los campos comparados).
 */
function resolveEnrichGroup(validRaw: EnrichObservation[]): ResolvedEnrichGroup {
  if (validRaw.length === 0) return { resolved: null, ambiguous: false, conflicting: null, mixedDryRun: false };
  const candidates = validRaw.map((r) => r.data);
  const mixedDryRun = new Set(candidates.map((c) => c.dry_run)).size > 1;
  const { resolved, ambiguous, conflicting } = resolveCandidates(candidates, enrichCandidatesEqual);
  return {
    resolved,
    ambiguous,
    conflicting: conflicting ? conflicting.map(toEnrichSummaryCandidate) : null,
    mixedDryRun,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cobertura de chunk-plan (Hardening Pass 1, B6) — NUNCA presenta una
// observación parcial (p.ej. solo chunk 1 de un total de 4) como completa.
// ─────────────────────────────────────────────────────────────────────────────

function analyzeChunkPlanCoverage(
  observedChunks: ObservedChunk[],
  conflicts: string[],
): { coverage: 'COMPLETE' | 'PARTIAL'; issues: string[] } {
  const issues = [...conflicts];

  if (observedChunks.length === 0) {
    return { coverage: 'PARTIAL', issues: ['no se observó ninguna línea de plan de chunk (chunk_plan) en el input'] };
  }

  const totals = new Set(observedChunks.map((c) => c.total));
  if (totals.size > 1) {
    issues.push(
      `valores de "total" inconsistentes entre líneas de plan de chunk observadas: ${[...totals].join(', ')}`,
    );
  }

  // Índices son 1-based (ver `index: i + 1` en news-lake-capture.ts).
  const total = observedChunks[0]!.total;
  for (const c of observedChunks) {
    if (c.index < 1 || c.index > total) {
      issues.push(`chunk index=${c.index} fuera de rango esperado (1..${total}, 1-based)`);
    }
  }

  const seenIndices = new Set(observedChunks.map((c) => c.index));
  // Con índices enteros únicos dentro de 1..total, cardinalidad == total
  // demuestra cobertura. O(observaciones), sin expandir ni reservar 1..total.
  if (seenIndices.size !== total) {
    issues.push(`cobertura de índices incompleta: ${seenIndices.size} índices únicos observados, total declarado=${total} (1-based)`);
  }

  return { coverage: issues.length === 0 ? 'COMPLETE' : 'PARTIAL', issues };
}

// ─────────────────────────────────────────────────────────────────────────────
// Aggregator principal
// ─────────────────────────────────────────────────────────────────────────────

export function aggregateRunEvidence(input: RunEvidenceAggregatorInput): RunEvidence {
  const { parsed, ignored } = parseAllLines(input.logLines);
  const warnings: string[] = [];

  // ── Agrupar líneas crudas por medio_id, por tipo de evento ───────────────
  const crawlTerminal = new Map<string, ParsedLine[]>();
  const crawlSourceResult = new Map<string, ParsedLine[]>();
  const crawlSourceFailure = new Map<string, ParsedLine[]>();
  const crawlStructuredValidByMedio = new Map<string, CrawlSummaryObservation[]>();
  const crawlStructuredInvalidByMedio = new Map<string, InvalidCrawlSummaryObservation[]>();
  const crawlLegacyInvalidByMedio = new Map<string, InvalidCrawlSummaryObservation[]>();
  const unsupportedByMedio = new Map<string, number>();
  let unattributableInvalidLegacyCount = 0;
  let unattributedUnsupportedCount = 0;
  let invalidChunkPlanCount = 0;
  let unattributableInvalidCrawlCount = 0; // event=crawl_media_summary pero medio_id no es string no vacía
  const enrichValidByMedio = new Map<string, EnrichObservation[]>();
  const enrichInvalidByMedio = new Map<string, InvalidEnrichObservation[]>();
  const unattributedValid: EnrichObservation[] = [];
  const unattributedInvalid: InvalidEnrichObservation[] = [];
  let unattributableInvalidCount = 0; // event=enrich_media_summary pero medio_id ni string ni null
  const observedChunksByIndex = new Map<number, ObservedChunk>();
  const chunkPlanConflicts: string[] = [];

  const pushTo = <T,>(map: Map<string, T[]>, key: string, item: T) => {
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  };

  const recordInvalidLegacy = (pl: ParsedLine, reasons: string[]) => {
    const id = pl.json.medio_id;
    if (isMedioId(id)) {
      pushTo(crawlLegacyInvalidByMedio, id, { order: pl.order, time: pl.time, reasons });
    } else {
      unattributableInvalidLegacyCount += 1;
    }
    warnings.push(`crawl legacy INVÁLIDO (${isMedioId(id) ? `medio_id=${id}` : 'sin medio_id atribuible'}): ${reasons.join('; ')}`);
  };

  for (const pl of parsed) {
    const l = pl.json;

    // ── EVENT-FIRST DISPATCH (Hardening Pass 3, Q2A/§11-12) ─────────────
    // Si una línea declara explícitamente un `event` conocido, SIEMPRE se
    // clasifica primero por su propio validador — NUNCA puede "caer"
    // posteriormente a un shape legacy solo porque coincide con sus campos
    // (p.ej. `{event:'crawl_media_summary', schema_version:99, medio_id,
    // estado, insertadas, duplicados}` tiene el shape legacy completo, pero
    // como declara `event` explícitamente debe quedar INVALID structured,
    // nunca reclasificarse como LEGACY_RECONSTRUCTED). Un `event` explícito
    // desconocido tampoco se reclasifica por shape. Las variantes de las
    // familias conocidas se conservan como unsupported; los ajenos se ignoran.
    // La presencia del campo basta: event null/vacío tampoco habilita legacy.
    if ('event' in l) {
      if (l.event === CRAWL_MEDIA_SUMMARY_EVENT) {
        const result = validateCrawlSummaryEvent(l);
        if (result.valid) {
          pushTo(crawlStructuredValidByMedio, result.data.medio_id, { order: pl.order, time: pl.time, data: result.data });
        } else {
          const rawMedioId = l.medio_id;
          if (typeof rawMedioId === 'string' && rawMedioId.trim().length > 0) {
            pushTo(crawlStructuredInvalidByMedio, rawMedioId, { order: pl.order, time: pl.time, reasons: result.reasons });
          } else {
            unattributableInvalidCrawlCount += 1;
          }
        }
        continue;
      }

      if (l.event === ENRICH_MEDIA_SUMMARY_EVENT) {
        const result = validateEnrichSummaryEvent(l);
        if (result.valid) {
          const obs: EnrichObservation = { order: pl.order, time: pl.time, data: result.data };
          if (result.data.medio_id !== null) {
            pushTo(enrichValidByMedio, result.data.medio_id, obs);
          } else {
            unattributedValid.push(obs);
          }
        } else {
          const rawMedioId = l.medio_id;
          const invalidObs: InvalidEnrichObservation = { order: pl.order, time: pl.time, reasons: result.reasons };
          if (typeof rawMedioId === 'string' && rawMedioId.trim().length > 0) {
            pushTo(enrichInvalidByMedio, rawMedioId, invalidObs);
          } else if (rawMedioId === null) {
            unattributedInvalid.push(invalidObs);
          } else {
            unattributableInvalidCount += 1;
          }
        }
        continue;
      }

      if (isUnsupportedDomainEvent(l.event)) {
        if (isMedioId(l.medio_id)) {
          unsupportedByMedio.set(l.medio_id, (unsupportedByMedio.get(l.medio_id) ?? 0) + 1);
        } else {
          unattributedUnsupportedCount += 1;
        }
        warnings.push(`evento de dominio no soportado: ${l.event} (${isMedioId(l.medio_id) ? `medio_id=${l.medio_id}` : 'sin medio_id atribuible'})`);
      }
      // Nunca se interpreta un evento no soportado/ajeno como legacy.
      continue;
    }

    // A partir de aquí, la línea NO declaró ningún `event` explícito —
    // recién ahora es seguro evaluar los shapes legacy (sin `event`) y el
    // shape de plan de chunk.
    if (looksLikeLegacyCrawlTerminal(l)) {
      const reasons = validateLegacyCrawlTerminal(l);
      if (reasons.length > 0) recordInvalidLegacy(pl, reasons);
      else pushTo(crawlTerminal, l.medio_id as string, pl);
      continue;
    }
    if (looksLikeLegacyCrawlSource(l)) {
      const reasons = validateLegacyCrawlSource(l);
      if (reasons.length > 0) recordInvalidLegacy(pl, reasons);
      else pushTo(crawlSourceResult, l.medio_id as string, pl);
      continue;
    }
    if (looksLikeLegacyCrawlFailure(l)) {
      const reasons = validateLegacyCrawlFailure(l);
      if (reasons.length > 0) recordInvalidLegacy(pl, reasons);
      else pushTo(crawlSourceFailure, l.medio_id as string, pl);
      continue;
    }

    if (looksLikeChunkPlanLine(l)) {
      const reasons = validateChunkPlanLine(l);
      if (reasons.length > 0) {
        // Hardening Pass 3, Q2D/§17-18: index/total corruptos (fracción,
        // NaN/Infinity, 0, negativo, index>total, string numérico, etc.) —
        // NUNCA se construye un ObservedChunk a partir de esto (evita que
        // un `total` corrupto controle un recorrido no acotado en
        // `analyzeChunkPlanCoverage`) y NUNCA fabrica requested_media_ids.
        // Se advierte SIEMPRE en `warnings` (no solo en `chunkPlanConflicts`,
        // que `analyzeChunkPlanCoverage` descarta cuando no se observó
        // ningún chunk VÁLIDO en absoluto) y, además, se añade a
        // `chunkPlanConflicts` para que, si coexisten líneas válidas, la
        // cobertura resultante nunca se presente como COMPLETE (§18: una
        // corrupción observada en el plan nunca permite afirmar que la
        // cobertura derivada es fielmente completa).
        invalidChunkPlanCount += 1;
        const invalidChunkPlanMsg = `plan de chunk INVÁLIDO: ${reasons.join('; ')} — no aporta observed_chunks ni requested_media_ids.`;
        warnings.push(invalidChunkPlanMsg);
        chunkPlanConflicts.push(invalidChunkPlanMsg);
        continue;
      }
      const index = l.index as number;
      const total = l.total as number;
      const medioIds = [...(l.chunk as string[])];
      const existing = observedChunksByIndex.get(index);
      if (!existing) {
        observedChunksByIndex.set(index, { index, total, medio_ids: medioIds });
      } else {
        const sameTotal = existing.total === total;
        const sameMedios =
          existing.medio_ids.length === medioIds.length && existing.medio_ids.every((id, i) => id === medioIds[i]);
        if (!sameTotal || !sameMedios) {
          chunkPlanConflicts.push(
            `chunk index=${index}: declaraciones de plan de chunk conflictivas (total=${existing.total} vs ${total}, ` +
              `medio_ids=${JSON.stringify(existing.medio_ids)} vs ${JSON.stringify(medioIds)})`,
          );
        }
      }
      continue;
    }

    // Cualquier otra línea JSON estructurada reconocida pero no relevante
    // para Fase 1B (p.ej. resúmenes globales de crawl/enrich) se ignora sin
    // penalizar `ignored_lines` — no es ruido, es evidencia de otro nivel
    // (agregado del run) que Fase 1B no consume.
  }

  // ── Enrich no atribuible (medio_id: null) — validado, sin coerción (§9), ──
  // con la MISMA política conservadora equivalente/contradictorio que un
  // medio identificado (Hardening Pass 3, Q3/§19-23): nunca "el más
  // reciente gana" ante contradicción, y dry_run/mixed_dry_run/
  // content_persistence se preservan igual que para un medio_id conocido.
  let unattributedEnrich: UnattributedEnrichEvidence | null = null;
  if (unattributedValid.length > 0) {
    const { resolved, ambiguous, conflicting, mixedDryRun } = resolveEnrichGroup(unattributedValid);
    if (ambiguous) {
      warnings.push(
        `enrich: se observaron ${unattributedValid.length} eventos enrich_media_summary VÁLIDOS con medio_id=null ` +
          '(no atribuibles) pero CONTRADICTORIOS entre sí (Hardening Pass 3, Q3) — no se elige ninguno como verdad ' +
          'única, se conserva como ambigüedad explícita (ver conflicting_summaries).',
      );
    } else if (unattributedValid.length > 1) {
      warnings.push(
        `enrich: se observaron ${unattributedValid.length} eventos enrich_media_summary VÁLIDOS con medio_id=null ` +
          '(no atribuibles); son equivalentes entre sí, se conserva 1 resultado.',
      );
    }
    if (mixedDryRun) {
      warnings.push(
        'enrich: eventos enrich_media_summary con medio_id=null (no atribuibles) con dry_run contradictorio ' +
          '(real y dry-run mezclados) — se conserva como ambigüedad explícita, no se elige uno silenciosamente.',
      );
    }
    unattributedEnrich = {
      processed: resolved?.processed ?? null,
      updated: resolved?.updated ?? null,
      unchanged: resolved?.unchanged ?? null,
      failed: resolved?.failed ?? null,
      clean_text_count: resolved?.clean_text_count ?? null,
      body_count: resolved?.body_count ?? null,
      dry_run: resolved?.dry_run ?? null,
      content_persistence: 'UNVERIFIED',
      raw_summary_event_count: unattributedValid.length,
      ambiguous_summary_events: ambiguous,
      mixed_dry_run: mixedDryRun,
      conflicting_summaries: conflicting,
    };
  }
  const unattributedEnrichInvalidEventCount = unattributedInvalid.length;
  if (unattributedEnrichInvalidEventCount > 0) {
    const reasonsFlat = [...new Set(unattributedInvalid.flatMap((r) => r.reasons))].slice(0, 10);
    warnings.push(
      `enrich: se observaron ${unattributedEnrichInvalidEventCount} evento(s) enrich_media_summary con medio_id=null INVÁLIDO(s) ` +
        `— no se fabrican datos a partir de ellos. Motivos: ${reasonsFlat.join('; ')}`,
    );
  }
  if (unattributableInvalidCount > 0) {
    warnings.push(
      `enrich: se observaron ${unattributableInvalidCount} evento(s) con event='enrich_media_summary' cuyo medio_id no es ` +
        'string ni null (no atribuible ni siquiera al bucket "sin atribuir") — descartados como evidencia inválida.',
    );
  }

  const observedChunks = [...observedChunksByIndex.values()].sort((a, b) => a.index - b.index);
  const chunkCoverageAnalysis = analyzeChunkPlanCoverage(observedChunks, chunkPlanConflicts);
  // Diagnóstico independiente del universo explícito; el análisis es acotado
  // por las declaraciones observadas incluso si no se deriva requested.
  if (observedChunks.length > 0 && chunkCoverageAnalysis.coverage === 'PARTIAL' &&
      (input.requestedMediaIds !== undefined || !input.deriveRequestedFromChunkPlan)) {
    warnings.push(`plan de chunks observado incompleto/conflictivo: ${chunkCoverageAnalysis.issues.join('; ')}`);
  }

  // ── requested_media_ids: input explícito (incluido []) > derivación opt-in ──
  let requestedMediaIds: string[] | null = null;
  let requestedSource: RunEvidence['run']['requested_media_ids_source'] = 'unavailable';
  let requestedCoverage: RequestedMediaIdsCoverage = 'UNKNOWN';

  if (input.requestedMediaIds !== undefined) {
    // §15: una lista explícita vacía sigue siendo EXPLICIT INPUT — se
    // distingue por `!== undefined`, nunca por `.length > 0`.
    const normalized = [...new Set(input.requestedMediaIds.map((id) => id.trim()).filter((id) => id.length > 0))];
    if (normalized.length !== input.requestedMediaIds.length) {
      warnings.push(
        'requested_media_ids explícito normalizado (whitespace recortado y/o duplicados/strings vacíos eliminados) respecto al input original.',
      );
    }
    requestedMediaIds = normalized;
    requestedSource = 'explicit_input';
    requestedCoverage = 'COMPLETE'; // el llamador declaró el universo completo, incluso si es []
  } else if (input.deriveRequestedFromChunkPlan && observedChunks.length > 0) {
    const set = new Set<string>();
    for (const c of observedChunks) for (const id of c.medio_ids) set.add(id);
    requestedMediaIds = [...set];
    requestedSource = 'chunk_plan_logs';
    requestedCoverage = chunkCoverageAnalysis.coverage;
    warnings.push(
      'requested_media_ids derivado de logs de plan de chunk (deriveRequestedFromChunkPlan=true), no de un input explícito.',
    );
    if (requestedCoverage === 'PARTIAL') {
      warnings.push(
        `cobertura de requested_media_ids derivada de chunk-plan es PARCIAL (no representa necesariamente el universo ` +
          `completo solicitado): ${chunkCoverageAnalysis.issues.join('; ')}`,
      );
    }
  }

  // ── Universo de medio_id a reportar: requested ∪ observados en evidencia ──
  const universe = new Set<string>();
  if (requestedMediaIds) for (const id of requestedMediaIds) universe.add(id);
  for (const id of crawlTerminal.keys()) universe.add(id);
  for (const id of crawlSourceResult.keys()) universe.add(id);
  for (const id of crawlSourceFailure.keys()) universe.add(id);
  for (const id of crawlStructuredValidByMedio.keys()) universe.add(id);
  for (const id of crawlStructuredInvalidByMedio.keys()) universe.add(id);
  for (const id of crawlLegacyInvalidByMedio.keys()) universe.add(id);
  for (const id of unsupportedByMedio.keys()) universe.add(id);
  for (const id of enrichValidByMedio.keys()) universe.add(id);
  for (const id of enrichInvalidByMedio.keys()) universe.add(id);

  const requestedSet = new Set(requestedMediaIds ?? []);

  // Índice medio_id → chunk_index (1-based; solo si aparece en exactamente un chunk observado).
  const chunkIndexByMedio = new Map<string, number>();
  const medioSeenInMultipleChunks = new Set<string>();
  for (const c of observedChunks) {
    for (const id of c.medio_ids) {
      if (chunkIndexByMedio.has(id) && chunkIndexByMedio.get(id) !== c.index) {
        medioSeenInMultipleChunks.add(id);
      } else {
        chunkIndexByMedio.set(id, c.index);
      }
    }
  }
  for (const id of medioSeenInMultipleChunks) {
    chunkIndexByMedio.delete(id);
    warnings.push(`medio_id=${id}: observado en más de un chunk en el input; chunk_index se deja en null.`);
  }

  const media: MediaEvidence[] = [];

  for (const medioId of universe) {
    // ── CRAWL (Hardening Pass 2: STRUCTURED_V1 > LEGACY_RECONSTRUCTED, ────
    // conflictos genuinos conservan ambigüedad en lugar de fabricar una
    // combinación autoritativa — ver `resolveCandidates`) ───────────────
    const terminalRaw = crawlTerminal.get(medioId) ?? [];
    const sourceResultRaw = crawlSourceResult.get(medioId) ?? [];
    const sourceFailureRaw = crawlSourceFailure.get(medioId) ?? [];
    const structuredValidRaw = crawlStructuredValidByMedio.get(medioId) ?? [];
    const structuredInvalidRaw = crawlStructuredInvalidByMedio.get(medioId) ?? [];
    const legacyInvalidRaw = crawlLegacyInvalidByMedio.get(medioId) ?? [];
    const invalidCrawlCount = structuredInvalidRaw.length + legacyInvalidRaw.length;
    const unsupportedCount = unsupportedByMedio.get(medioId) ?? 0;

    if (structuredInvalidRaw.length > 0) {
      const reasonsFlat = [...new Set(structuredInvalidRaw.flatMap((r) => r.reasons))].slice(0, 10);
      warnings.push(
        `medio_id=${medioId}: se observaron ${structuredInvalidRaw.length} evento(s) crawl_media_summary INVÁLIDO(s) ` +
          `— no se cuentan como evidencia estructurada. Motivos: ${reasonsFlat.join('; ')}`,
      );
    }

    const attemptErrors = [
      ...new Set(sourceFailureRaw.map((pl) => String(pl.json.err ?? '')).filter((e) => e.length > 0)),
    ].slice(0, 20);

    let crawl: CrawlMediaEvidence;

    if (structuredValidRaw.length > 0) {
      // ── STRUCTURED_V1: fuente preferida (§13). NUNCA se usa evidencia
      // legacy (CRAWL_SOURCE_RESULT / CRAWL_MEDIA_RESULT) para "rellenar"
      // campos — el summary ya es atómico por construcción (§12/§17).
      const candidates: CrawlSummaryCandidate[] = structuredValidRaw.map((r) => ({
        status: r.data.status,
        source_method: r.data.source_method,
        detected: r.data.detected,
        items: r.data.items,
        inserted: r.data.inserted,
        duplicates: r.data.duplicates,
        promoted_diagnostic: r.data.promoted_diagnostic,
        terminal_error: r.data.terminal_error,
      }));
      const { resolved, ambiguous, conflicting } = resolveCandidates(candidates, structuredCandidatesEqual);

      if (ambiguous) {
        warnings.push(
          `medio_id=${medioId}: se observaron ${structuredValidRaw.length} eventos crawl_media_summary VÁLIDOS pero ` +
            'CONTRADICTORIOS entre sí (no existe attempt_id para desambiguar, Hardening Pass 2 B3) — no se elige ' +
            'ninguno como verdad única, se conserva como ambigüedad explícita (ver conflicting_summaries).',
        );
      } else if (structuredValidRaw.length > 1) {
        warnings.push(
          `medio_id=${medioId}: se observaron ${structuredValidRaw.length} eventos crawl_media_summary equivalentes ` +
            '(repetición compatible, p.ej. retry de logging) — no se suman, se conserva 1 resultado.',
        );
      }

      // ── Q1A (Hardening Pass 3): evidencia LEGACY adicional que CONTRADICE
      // materialmente el structured summary resuelto. El structured NUNCA
      // se sobrescribe por esto (se sigue construyendo `crawl` exclusivamente
      // a partir de `resolved` más abajo) — pero la contradicción bloquea
      // COMPLETE (ver `crawlFullyValid`) y queda visible en `warnings`.
      // Solo se evalúa cuando `resolved` no es null (si el structured ya es
      // ambiguo entre sí, COMPLETE ya está bloqueado por
      // `ambiguous_terminal_events`, sin necesidad de esta comprobación).
      //
      // Compatible (no dispara conflicto): un CRAWL_SOURCE_RESULT/
      // CRAWL_MEDIA_RESULT legacy que coincide en los campos comparables
      // (típico en runs reales, donde ambos shapes se emiten desde el MISMO
      // valor en la MISMA iteración de scripts/crawl.ts).
      // Contradictorio (dispara conflicto): source_method/detected/items
      // distintos en un CRAWL_SOURCE_RESULT legacy, o status/inserted/
      // duplicates/promoted_diagnostic distintos en un CRAWL_MEDIA_RESULT
      // legacy, respecto al structured summary resuelto.
      let legacyConflict = false;
      if (resolved) {
        const sourceConflict = sourceResultRaw.some(
          (pl) =>
            (pl.json.fuente as string) !== resolved.source_method ||
            (pl.json.detectadas as number) !== resolved.detected ||
            (pl.json.items as number) !== resolved.items,
        );
        const terminalConflict = terminalRaw.some((pl) => {
          if ((pl.json.estado as string) !== resolved.status) return true;
          if ((pl.json.insertadas as number) !== resolved.inserted) return true;
          if ((pl.json.duplicados as number) !== resolved.duplicates) return true;
          const promo = pl.json.promovidas_diagnostico;
          if (typeof promo === 'number' && resolved.promoted_diagnostic !== null && promo !== resolved.promoted_diagnostic) {
            return true;
          }
          return false;
        });
        legacyConflict = sourceConflict || terminalConflict;
        if (legacyConflict) {
          warnings.push(
            `medio_id=${medioId}: se observó evidencia LEGACY (CRAWL_SOURCE_RESULT y/o CRAWL_MEDIA_RESULT) que ` +
              'CONTRADICE materialmente el crawl_media_summary resuelto (Hardening Pass 3, Q1A) — el structured ' +
              'summary conserva sus propios campos (nunca se sobrescriben), pero esta contradicción NO permite ' +
              "afirmar evidence_status='COMPLETE'.",
          );
        }
      }

      crawl = {
        provenance: 'STRUCTURED_V1',
        status: resolved?.status ?? null,
        source_method: resolved?.source_method ?? null,
        detected: resolved?.detected ?? null,
        items: resolved?.items ?? null,
        inserted: resolved?.inserted ?? null,
        duplicates: resolved?.duplicates ?? null,
        promoted_diagnostic: resolved?.promoted_diagnostic ?? null,
        terminal_error: resolved?.terminal_error ?? null,
        attempt_errors: attemptErrors,
        raw_terminal_event_count: structuredValidRaw.length,
        ambiguous_terminal_events: ambiguous,
        ambiguous_source_events: false, // no aplica: la fuente legacy no se usa para construir STRUCTURED_V1
        invalid_event_count: invalidCrawlCount,
        invalid_legacy_event_count: legacyInvalidRaw.length,
        conflicting_summaries: conflicting,
        legacy_conflict: legacyConflict,
      };
    } else if (terminalRaw.length > 0 || sourceResultRaw.length > 0 || sourceFailureRaw.length > 0) {
      // ── LEGACY_RECONSTRUCTED: sin crawl_media_summary válido. Terminal y
      // fuente se resuelven POR SEPARADO, cada uno con su propia
      // comprobación de ambigüedad — nunca se combina un terminal con una
      // fuente que no pueda demostrarse correspondiente al mismo intento
      // cuando hay más de una observación distinta de cualquiera de los dos
      // lados (§19 del prompt de Pass 2).
      const terminalCandidates: LegacyTerminalCandidate[] = terminalRaw.map((pl) => ({
        status: pl.json.estado as string,
        inserted: pl.json.insertadas as number,
        duplicates: pl.json.duplicados as number,
        promoted_diagnostic:
          typeof pl.json.promovidas_diagnostico === 'number' ? (pl.json.promovidas_diagnostico as number) : null,
      }));
      const terminalResolution = resolveCandidates(terminalCandidates, legacyTerminalCandidatesEqual);
      if (terminalResolution.ambiguous) {
        warnings.push(
          `medio_id=${medioId}: se observaron ${terminalRaw.length} eventos terminales legacy de crawl ` +
            '(CRAWL_MEDIA_RESULT) CONTRADICTORIOS entre sí — no se elige ninguno como verdad única ' +
            '(Hardening Pass 2, B3).',
        );
      } else if (terminalRaw.length > 1) {
        warnings.push(
          `medio_id=${medioId}: se observaron ${terminalRaw.length} eventos terminales legacy de crawl ` +
            'equivalentes; se conserva 1 resultado.',
        );
      }

      const sourceCandidates: LegacySourceCandidate[] = sourceResultRaw.map((pl) => ({
        source_method: pl.json.fuente as string,
        detected: pl.json.detectadas as number,
        items: pl.json.items as number,
      }));
      const sourceResolution = resolveCandidates(sourceCandidates, legacySourceCandidatesEqual);
      if (sourceResolution.ambiguous) {
        warnings.push(
          `medio_id=${medioId}: se observó más de un CRAWL_SOURCE_RESULT legacy con contenido distinto ` +
            '(posible mezcla de intentos, Hardening Pass 2 §17) — no se elige ninguno como verdad única.',
        );
      } else if (sourceResultRaw.length > 1) {
        warnings.push(
          `medio_id=${medioId}: se observó más de un CRAWL_SOURCE_RESULT legacy equivalente; se conserva 1 resultado.`,
        );
      }

      const t = terminalResolution.resolved;
      const s = sourceResolution.resolved;
      const conflictingLegacy = terminalResolution.ambiguous
        ? (terminalResolution.conflicting ?? []).map(
            (c): CrawlSummaryCandidate => ({
              status: c.status,
              source_method: null,
              detected: null,
              items: null,
              inserted: c.inserted,
              duplicates: c.duplicates,
              promoted_diagnostic: c.promoted_diagnostic,
              terminal_error: null,
            }),
          )
        : null;

      crawl = {
        provenance: 'LEGACY_RECONSTRUCTED',
        status: t?.status ?? null,
        source_method: s?.source_method ?? null,
        detected: s?.detected ?? null,
        items: s?.items ?? null,
        inserted: t?.inserted ?? null,
        duplicates: t?.duplicates ?? null,
        promoted_diagnostic: t?.promoted_diagnostic ?? null,
        terminal_error: null, // legacy nunca transportó esta información — nunca se inventa (§9)
        attempt_errors: attemptErrors,
        raw_terminal_event_count: terminalRaw.length,
        ambiguous_terminal_events: terminalResolution.ambiguous,
        ambiguous_source_events: sourceResolution.ambiguous,
        invalid_event_count: invalidCrawlCount,
        invalid_legacy_event_count: legacyInvalidRaw.length,
        conflicting_summaries: conflictingLegacy,
        legacy_conflict: false, // Q1A solo aplica a STRUCTURED_V1 vs legacy; aquí no hay structured
      };
    } else if (invalidCrawlCount > 0) {
      // Solo evidencia crawl inválida (structured o legacy): hubo observación,
      // pero no datos válidos. INVALID + PARTIAL, nunca ausencia/MISSING.
      crawl = {
        provenance: 'INVALID',
        status: null,
        source_method: null,
        detected: null,
        items: null,
        inserted: null,
        duplicates: null,
        promoted_diagnostic: null,
        terminal_error: null,
        attempt_errors: attemptErrors,
        raw_terminal_event_count: 0,
        ambiguous_terminal_events: false,
        ambiguous_source_events: false,
        invalid_event_count: invalidCrawlCount,
        invalid_legacy_event_count: legacyInvalidRaw.length,
        conflicting_summaries: null,
        legacy_conflict: false,
      };
    } else {
      crawl = {
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
      };
    }

    // ── ENRICH (Hardening Pass 1: B1 elimina NOT_EXPECTED; B2 valida; B4/B7 explícitos; Pass 3: Q1B/Q1) ──
    const validRaw = enrichValidByMedio.get(medioId) ?? [];
    const invalidRaw = enrichInvalidByMedio.get(medioId) ?? [];

    if (invalidRaw.length > 0) {
      const reasonsFlat = [...new Set(invalidRaw.flatMap((r) => r.reasons))].slice(0, 10);
      warnings.push(
        `medio_id=${medioId}: se observaron ${invalidRaw.length} evento(s) enrich_media_summary INVÁLIDO(s) ` +
          `— no se cuentan como evidencia. Motivos: ${reasonsFlat.join('; ')}`,
      );
    }

    let enrich: EnrichMediaEvidence;
    if (validRaw.length > 0) {
      // Hardening Pass 3, Q1B: distinguir EQUIVALENTES (repetición
      // compatible, p.ej. retry de logging con el mismo contenido) de
      // CONTRADICTORIOS (difieren en processed/updated/unchanged/failed/
      // clean_text_count/body_count/dry_run) — nunca "el más reciente gana"
      // ante una contradicción genuina.
      const { resolved, ambiguous, conflicting, mixedDryRun } = resolveEnrichGroup(validRaw);
      if (ambiguous) {
        warnings.push(
          `medio_id=${medioId}: se observaron ${validRaw.length} eventos enrich_media_summary VÁLIDOS pero ` +
            'CONTRADICTORIOS entre sí (no existe attempt_id para desambiguar, Hardening Pass 3 Q1B) — no se elige ' +
            'ninguno como verdad única, se conserva como ambigüedad explícita (ver conflicting_summaries).',
        );
      } else if (validRaw.length > 1) {
        warnings.push(
          `medio_id=${medioId}: se observaron ${validRaw.length} eventos enrich_media_summary equivalentes ` +
            '(repetición compatible, p.ej. retry de logging) — no se suman, se conserva 1 resultado.',
        );
      }
      if (mixedDryRun) {
        warnings.push(
          `medio_id=${medioId}: eventos enrich_media_summary válidos con dry_run contradictorio (real y dry-run mezclados) ` +
            '— se conserva como ambigüedad explícita, no se elige uno silenciosamente.',
        );
      }
      enrich = {
        presence: 'PRESENT',
        requested: resolved?.requested ?? null,
        processed: resolved?.processed ?? null,
        updated: resolved?.updated ?? null,
        unchanged: resolved?.unchanged ?? null,
        failed: resolved?.failed ?? null,
        clean_text_count: resolved?.clean_text_count ?? null,
        body_count: resolved?.body_count ?? null,
        dry_run: resolved?.dry_run ?? null,
        content_persistence: 'UNVERIFIED',
        raw_summary_event_count: validRaw.length,
        ambiguous_summary_events: ambiguous,
        mixed_dry_run: mixedDryRun,
        invalid_event_count: invalidRaw.length,
        expectation_basis: null,
        conflicting_summaries: conflicting,
      };
    } else if (invalidRaw.length > 0) {
      // Solo evidencia inválida observada: NUNCA se trata como PRESENT/COMPLETE (§7/§22).
      enrich = {
        presence: 'INVALID',
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
        invalid_event_count: invalidRaw.length,
        expectation_basis: null,
        conflicting_summaries: null,
      };
    } else {
      // Sin evidencia de enrich (ni válida ni inválida) para este medio.
      // B1: ya NO se infiere NOT_EXPECTED a partir de crawl.status — sin
      // evidencia explícita de scope, la ausencia se conserva como MISSING.
      enrich = {
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
      };
    }

    // ── evidence_status (describe COMPLETITUD DE EVIDENCIA VÁLIDA, no calidad — §9/§22) ──
    // Hardening Pass 2: `provenance !== 'NONE'` ya cubre STRUCTURED_V1,
    // LEGACY_RECONSTRUCTED e INVALID (en los tres casos "algo se observó",
    // aunque en INVALID/ambiguo los campos queden en null).
    const hasAnyCrawlSignal = crawl.provenance !== 'NONE';
    const hasAnyEnrichSignal = enrich.presence !== 'MISSING'; // PRESENT o INVALID cuentan como "algo se observó"
    // §23: cuando crawl.status==='ok', el propio pipeline garantiza que existió
    // una fuente que produjo resultados justo antes del terminal (ver
    // src/crawlers/index.ts: 'ok' solo se retorna inmediatamente después de
    // loguear 'Fuente con resultados'). Si no la observamos (source_method
    // sigue null), la evidencia de crawl está incompleta para este medio —
    // no se afirma COMPLETE. Para estados terminales distintos de 'ok' no
    // existe tal garantía (no se exige source_method). Hardening Pass 2
    // añade además: cualquier ambigüedad de intento (terminal o fuente,
    // structured o legacy) bloquea COMPLETE — COMPLETE exige un resultado
    // terminal COHERENTE, no solo "algo se observó" (§21 del prompt de Pass 2).
    // Hardening Pass 3 añade dos condiciones más: (Q1A) evidencia legacy que
    // contradice materialmente un structured summary ya resuelto
    // (`legacy_conflict`) bloquea COMPLETE aunque el structured en sí no sea
    // ambiguo; (Q1/§10) CUALQUIER evento adicional inválido atribuible a
    // este medio_id (`invalid_event_count > 0`) también bloquea COMPLETE —
    // no hay attempt_id para demostrar objetivamente que es un duplicado
    // irrelevante, así que se conserva la incertidumbre.
    const crawlSourceRequirementMet = crawl.status !== 'ok' || crawl.source_method !== null;
    const crawlFullyValid =
      crawl.status !== null &&
      !crawl.ambiguous_terminal_events &&
      !crawl.ambiguous_source_events &&
      !crawl.legacy_conflict &&
      crawl.invalid_event_count === 0 &&
      crawlSourceRequirementMet;
    // Hardening Pass 3, Q1B/§9: `ambiguous_summary_events` (contradicción
    // genuina entre summaries válidos) y `invalid_event_count > 0` (evento
    // enrich adicional inválido atribuible al mismo medio, operación sin
    // resolver) también bloquean COMPLETE — antes solo `mixed_dry_run` lo hacía.
    const enrichFullyValid =
      enrich.presence === 'PRESENT' &&
      !enrich.mixed_dry_run &&
      !enrich.ambiguous_summary_events &&
      enrich.invalid_event_count === 0;

    let evidenceStatus: EvidenceStatus;
    if (!hasAnyCrawlSignal && !hasAnyEnrichSignal && unsupportedCount === 0) {
      // Caso D: sin evidencia de ninguna fase.
      evidenceStatus = 'MISSING';
    } else if (crawlFullyValid && enrichFullyValid && unsupportedCount === 0) {
      // COMPLETE exige evidencia VÁLIDA de ambas piezas — nunca "existe una
      // línea que parece enrich" (§22): schema_version soportado, métricas
      // válidas, sin dry_run contradictorio, y source evidence cuando
      // crawl.status==='ok' lo exige estructuralmente (§23).
      evidenceStatus = 'COMPLETE';
    } else {
      evidenceStatus = 'PARTIAL';
      if (crawl.status === 'ok' && crawl.source_method === null) {
        warnings.push(
          `medio_id=${medioId}: crawl.status='ok' pero no se observó evidencia de CRAWL_SOURCE_RESULT — evidencia de crawl incompleta (§23).`,
        );
      }
      if (!hasAnyCrawlSignal && hasAnyEnrichSignal) {
        warnings.push(`medio_id=${medioId}: hay evidencia de enrich pero no hay evidencia de crawl — evidencia incompleta/ambigua.`);
      }
      if (hasAnyCrawlSignal && enrich.presence === 'MISSING') {
        warnings.push(
          `medio_id=${medioId}: hay evidencia de crawl pero no hay evidencia válida de enrich — NO se asume que enrich no era necesario (B1).`,
        );
      }
    }

    media.push({
      medio_id: medioId,
      unsupported_event_count: unsupportedCount,
      requested: requestedSet.has(medioId),
      crawl,
      enrich,
      chunk_index: chunkIndexByMedio.get(medioId) ?? null,
      evidence_status: evidenceStatus,
    });
  }

  media.sort((a, b) => a.medio_id.localeCompare(b.medio_id));

  return {
    schema_version: RUN_EVIDENCE_SCHEMA_VERSION,
    run: {
      run_id: input.runId ?? null,
      requested_media_ids: requestedMediaIds,
      requested_media_ids_source: requestedSource,
      requested_media_ids_coverage: requestedCoverage,
    },
    media,
    unattributed_enrich: unattributedEnrich,
    unattributed_enrich_invalid_event_count: unattributedEnrichInvalidEventCount,
    unattributable_invalid_enrich_event_count: unattributableInvalidCount,
    unattributable_invalid_crawl_event_count: unattributableInvalidCrawlCount,
    unattributable_invalid_legacy_event_count: unattributableInvalidLegacyCount,
    unattributed_unsupported_event_count: unattributedUnsupportedCount,
    invalid_chunk_plan_event_count: invalidChunkPlanCount,
    observed_chunks: observedChunks,
    ignored_lines: ignored,
    warnings,
  };
}
