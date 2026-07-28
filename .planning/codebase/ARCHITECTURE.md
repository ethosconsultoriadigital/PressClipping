# Architecture

**Analysis Date:** 2026-07-28

## Pattern Overview

**Overall:** Three-layer architecture with strict separation of concerns: Google Sheets (configuration/UI), Supabase/PostgreSQL (historical data), and Node.js/TypeScript motor (logic).

**Key Characteristics:**
- Batch-driven pipeline: sync → crawl → normalize → detect-mentions → export
- Event-sourcing approach to data: all news, all mentions, and deduplication history are preserved (never deleted)
- Pure functions for business logic (keyword matching, XML generation, filtering) separate from I/O
- Modular handlers per data source type (RSS, sitemap, HTML extraction)

## Layers

**Configuration Layer (Google Sheets):**
- Purpose: Editable control panel for medios (sources), keywords, clients, and operational config
- Location: External (Google Sheets via `@google-spreadsheet`)
- Clients: `src/sheets/client.ts` establishes auth connection
- Pattern: Read-only from scripts; written to via `sync-sheets.ts`

**Data Access Layer:**
- Purpose: Typed access to Supabase tables via PostgREST
- Location: `src/supabase/repositories.ts`
- Contains: Repository functions for upsert, select, filtering operations
- Pattern: All Supabase queries centralized; single entry point via `getSupabase()` in `src/supabase/client.ts`
- Uses: Service Role Key for backend-only access (private key auth)

**Historical Data Layer (Supabase/PostgreSQL):**
- Purpose: Immutable historical record of all news, mentions, and processing state
- Location: Supabase instance with schema in `supabase/migrations/`
- Core tables: `noticias`, `menciones`, `medios`, `clientes`, `keywords`, `configuracion`, `clusters`, `logs_ingesta`
- Deduplication policy: hash_url (unique), (titulo, medio_id, fecha), cluster_id (for cross-media duplicates)

**Business Logic Layer (Motor):**
- Purpose: Core pipeline for ingestion, matching, enrichment, classification, and export
- Modules:
  - `src/crawlers/` — RSS/sitemap parsing and fallback logic
  - `src/normalizers/` — raw item → database row transformation
  - `src/matchers/` — keyword matching (exact, phrase, contains, contextual, boolean)
  - `src/extractors/` — HTML content extraction
  - `src/enrichers/` — mención enrichment and enhancement
  - `src/ai/` — Claude-based mention classification
  - `src/exporters/` — XML/Sheets output formatting
  - `src/notifications/` — email/WhatsApp alerting
- Execution: Scripts in `scripts/` are thin wrappers around these modules

**Runtime Layer:**
- GitHub Actions: Batch cron jobs for sync, crawl, detection, export
- Cloudflare Worker: HTTP endpoint `/read-xml` for low-latency XML serving
- Node.js 20+: Local and CI execution

## Data Flow

**Phase 1 — Configuration:**
1. User edits Google Sheets (`01_Medios`, `02_Keywords`, `03_Clientes`, `04_Config`)
2. `npm run sync-sheets` reads and validates via Zod schemas
3. Upserts to Supabase (medios, keywords, clientes, configuracion tables)

**Phase 2 — Ingestion (Crawl):**
1. `npm run crawl` reads active medios from Supabase
2. Filters by readiness status (from `08_Validacion_Medios` sheet) via `src/crawlers/selection.ts`
3. For each medium:
   - Attempts RSS feed via `src/parsers/rss.ts`
   - Falls back to sitemap via `src/parsers/sitemap.ts`
   - Returns raw items (URL, title, summary, author, date)
4. Normalizes via `src/normalizers/noticia.ts`:
   - Canonicalizes URLs
   - Cleans HTML entities
   - Parses dates to ISO-8601 UTC
   - Computes `hash_url` for deduplication
5. Inserts new noticias to `noticias` table, skips hash_url duplicates
6. Writes ingestion log via `src/logs/ingestaLogger.ts` to Sheets

**Phase 3 — Mention Detection:**
1. `npm run detect-mentions` reads all unprocessed noticias
2. For each noticia, tests against all active keywords
3. Matcher logic (per cliente, per keyword type) via `src/matchers/keyword.ts`:
   - Loads keyword rule (type, terms, context gates)
   - Searches across all campos (title, summary, section, extracted text)
   - Extracts evidence snippet and relevance score
4. Creates mención row if match found
5. Updates `menciones_procesado = true` on noticia
6. Batches inserts in chunks of 500 (default `CHUNK` in repositories)

**Phase 4 — Enrichment & Enhancement:**
1. `npm run enrich-news` hydrates menciones with calculated fields
2. Enrichment sources:
   - Cliente context (industria, marcas, competidores, temas_sensibles)
   - Media metadata (grupo_medio, categoria, region)
   - Noticia quality signals (calidad_extraccion, chars extracted)
3. Updates `menciones` with enriched data

**Phase 5 — IA Classification (optional):**
1. `npm run classify-ia` classifies menciones with gate `usar_ia = TRUE`
2. Only processes menciones with `estado_clasificacion = pendiente`
3. Constructs prompt via `src/ai/classifier.ts`:
   - System prompt: PR analyst persona
   - User prompt: título + resumen + contexto cliente
4. Calls Claude API with Zod structured output schema
5. Stores: sentimiento, relevancia, tema, subtema, riesgo_reputacional, requiere_alerta
6. Tracks usage (input/output tokens) for cost control

**Phase 6 — Export to Sheets & XML:**
1. `npm run export-results-to-sheets` writes menciones to `06_Resultados` sheet
2. `npm run generate-xml` produces pressclipping_ethos XML:
   - Reads menciones with SELECT_MENCION_EXPORT
   - Applies optional filters (cliente, keyword, medio, region, date range)
   - Transforms to `<nota>` elements with CDATA-wrapped text
   - Validates via xmlbuilder2

**Phase 7 — HTTP Serving:**
1. Cloudflare Worker at `worker/src/index.ts` exposes `/read-xml`
2. Validates token (XML_SECRET_TOKEN via header or query param)
3. Queries Supabase with same mentioning SELECT
4. Applies same filters in-memory
5. Returns XML with cache-control: no-store

**State Management:**
- Configuration state: Sheets (source of truth) → Supabase (copy)
- News state: Supabase noticias table (hash_url uniqueness enforced)
- Mention state: Supabase menciones table + processing flags (pendiente, clasificado, exportado)
- Clusters (cross-media dedup): cluster_id tracks republished articles
- Logs: ingestaLogger writes structured logs to Sheets `05_Logs`

## Key Abstractions

**RawItem:**
- Purpose: Agnóstic input from RSS/sitemap/HTML parsers
- Location: `src/normalizers/noticia.ts`
- Pattern: Minimal required fields (url, titulo?, resumen?, fecha?, etc.)
- Usage: Normalized to `NoticiaInsert` for DB insertion

**NoticiaInsert:**
- Purpose: Validated row ready for `noticias` table
- Location: `src/normalizers/noticia.ts`
- Contains: URL variants, hashes, extraction source, quality flags
- Pattern: Immutable once inserted; updated only for enrichment

**MencionExportRow:**
- Purpose: Join of mención + noticia + cliente + keyword + media metadata for export
- Location: `src/types/mencion.ts`
- SELECT: `SELECT_MENCION_EXPORT` constant defines PostgREST query
- Mapper: `mapMencionExport(raw)` unpacks nested Supabase response
- Usage: Consumed by exporters and XML generation

**KeywordRule:**
- Purpose: Parsed keyword with type, terms, context gates
- Location: `src/matchers/keyword.ts`
- Fields: keyword_id, client_id, terminos[], tipo (exacta|frase_exacta|contiene|booleana|exacta_contextual)
- Pattern: Built once at startup from Sheets, reused for each noticia

**Clasificacion:**
- Purpose: IA output schema for mención analysis
- Location: `src/ai/classifier.ts`
- Schema: sentimiento, relevancia, tema, subtema, resumen_ejecutivo, riesgo_reputacional, recomendacion_pr, requiere_alerta
- Validation: Zod schema with structured output formatting

**CrawlResult:**
- Purpose: Encapsulates outcome of crawling one medium
- Location: `src/crawlers/index.ts`
- Fields: medio_id, fuente (rss|sitemap), urls_detectadas, items[], estado (ok|sin_fuente|omitido|error), error message
- Pattern: Never throws; always returns result so batch processing continues

**FiltrosXml:**
- Purpose: Query filters for XML generation and HTTP serving
- Location: `src/exporters/xml.ts`
- Filters: cliente, keyword, medio, region, estadoRevision, desde, hasta
- Pattern: Applied in-memory after DB fetch (lightweight filtering)

## Entry Points

**sync-sheets:**
- Location: `scripts/sync-sheets.ts`
- Triggers: Manual or GitHub Actions schedule
- Responsibilities:
  - Reads Google Sheets (`01_Medios`, `02_Keywords`, `03_Clientes`, `04_Config`)
  - Validates structure via Zod
  - Upserts to Supabase (medios, keywords, clientes, configuracion)
  - Reports success/failure

**crawl:**
- Location: `scripts/crawl.ts`
- Triggers: GitHub Actions cron or manual
- Responsibilities:
  - Fetches active medios from Supabase
  - Filters by validation status (safe default or explicit flags)
  - Calls `crawlMedio()` per medium with RSS→sitemap fallback
  - Normalizes and deduplicates
  - Inserts noticias
  - Writes ingestion log to Sheets
- Flags: --limit, --priority, --estado, --solo-validados, --dry-run, etc.

**detect-mentions:**
- Location: `scripts/detect-mentions.ts`
- Triggers: GitHub Actions cron (post-crawl)
- Responsibilities:
  - Reads all unprocessed noticias (menciones_procesado = false)
  - Loads all keywords and clients from Supabase
  - Tests each noticia against each keyword
  - Creates menciones on match
  - Marks noticia as processed

**enrich-news:**
- Location: `scripts/enrich-news.ts`
- Triggers: Post-detection
- Responsibilities: Hydrates menciones with enrichment fields

**classify-ia:**
- Location: `scripts/classify-ia.ts`
- Triggers: Manual or scheduled (costs money)
- Responsibilities:
  - Reads menciones with estado_clasificacion = pendiente
  - Constructs prompt and calls Claude
  - Stores classification results

**export-results-to-sheets:**
- Location: `scripts/export-results-to-sheets.ts`
- Triggers: Post-classification or on-demand
- Responsibilities:
  - Reads all menciones
  - Transforms to sheet rows
  - Writes to `06_Resultados` sheet

**generate-xml:**
- Location: `scripts/generate-xml.ts`
- Triggers: Manual or scheduled (generates local file)
- Responsibilities:
  - Reads menciones with optional filters
  - Generates pressclipping_ethos XML
  - Writes to file or stdout

**read-xml (Worker):**
- Location: `worker/src/index.ts`
- Triggers: HTTP GET `/read-xml`
- Responsibilities:
  - Validates token (XML_SECRET_TOKEN)
  - Parses query params as filters
  - Queries Supabase
  - Applies filters in-memory
  - Returns XML with headers

## Error Handling

**Strategy:** Fail-safe batching with encapsulation.

**Patterns:**
- `CrawlResult.error` field captures medium-level errors without aborting batch
- `try-catch` around DB operations with descriptive `Error` messages
- Environment validation at startup via `requireSupabaseEnv()` and `requireSheetsEnv()`
- Invalid input (malformed URL, bad date) logged but not thrown; item skipped
- Network errors (RSS 404, timeout) reported in CrawlResult estado = 'error' with message
- Zod validation failures logged with path and expected type

## Cross-Cutting Concerns

**Logging:** 
- Framework: `pino` via `src/utils/logger.ts`
- Levels: trace, debug, info, warn, error (configurable via LOG_LEVEL env)
- Format: JSON or pretty-print (configurable via LOG_FORMAT env)
- Child loggers: `childLogger()` adds context (medio_id, cliente_id, etc.)

**Validation:**
- Framework: Zod
- Schemas defined per domain (`src/types/schemas.ts` for DB types, inline for config)
- Usage: Google Sheets data, environment variables, API responses
- Failure: Descriptive error path and expected type

**Authentication:**
- Supabase: Service Role Key (backend only, bypasses RLS)
- Google Sheets: Service account key (email + private key in PEM format)
- XML endpoint: Bearer token or query param (XML_SECRET_TOKEN)
- Pattern: Secrets loaded via `src/config/env.ts`, never logged

**Date Handling:**
- Library: Luxon (ISO-8601, timezone-aware)
- Format: Always UTC (`.toUTC()`)
- Storage: ISO-8601 strings in DB
- Parsing: Tries multiple formats (ISO, JS Date constructor, fallback)

**Chunking:**
- Database upserts batch in 500-row chunks (configurable CHUNK constant)
- Purpose: Avoid SQL payload limits and improve transaction granularity
- Implementation: `ejecutarPorLotes()` in `src/utils/chunk.ts`

**Deduplication:**
- Primary: `hash_url` UNIQUE constraint (prevents exact duplicates)
- Secondary: `(titulo, medio_id, fecha_publicacion)` composite (catches edited republishes)
- Tertiary: `cluster_id` (groups cross-media republishes, preserved for PR value)
- Policy: Nothing is deleted; only marked as duplicate or clustered

---

*Architecture analysis: 2026-07-28*
