# Codebase Structure

**Analysis Date:** 2026-07-28

## Directory Layout

```
PressClipping/
├── .github/
│   └── workflows/          # CI/CD pipelines (GitHub Actions)
├── .planning/
│   └── codebase/          # GSD codebase analysis documents
├── docs/                  # Operational and design documentation
├── data/
│   └── imports/           # Downloaded data for backfill operations
├── output/                # Local export results (not committed)
├── scripts/               # Entry points — thin CLI wrappers around src logic
├── src/                   # Core motor — all business logic organized by concern
│   ├── ai/               # Claude-based mention classification
│   ├── alerts/           # Alert rule definitions and detection
│   ├── comparators/      # Comparison and diagnostic utilities
│   ├── config/           # Environment and secrets management
│   ├── crawlers/         # RSS/sitemap ingestion and fallback logic
│   ├── editorial/        # Client-specific filtering and approval rules
│   ├── enrichers/        # Mention and noticia enhancement
│   ├── exporters/        # Output formatters (XML, Sheets, raw)
│   ├── extractors/       # HTML and content extraction
│   ├── logs/             # Structured logging to Sheets
│   ├── matchers/         # Keyword matching algorithms
│   ├── matching/         # Context-aware keyword gates
│   ├── normalizers/      # Raw item → database row transformation
│   ├── notifications/    # Email and WhatsApp alerting
│   ├── parsers/          # RSS and sitemap parsing
│   ├── shadow/           # Shadow mode monitoring (parallel testing)
│   ├── sheets/           # Google Sheets client and I/O
│   ├── sim/              # Simulation and tuning utilities
│   ├── supabase/         # Database client and repositories
│   ├── types/            # Shared TypeScript interfaces and schemas
│   ├── utils/            # Reusable utilities (logging, parsing, hashing)
│   └── validation/       # Media audit and quality checks
├── supabase/
│   ├── migrations/        # SQL schema versioning (0001_, 0002_, etc.)
│   └── seed_data/         # Initial configuration (if any)
├── test/                 # Test files (colocated by feature)
│   └── fixtures/         # Test data (XML files, JSON fixtures)
├── tmp/                  # Temporary files (not committed)
├── worker/               # Cloudflare Worker for /read-xml endpoint
│   ├── src/
│   │   └── index.ts      # Worker entry point
│   ├── tsconfig.json
│   └── wrangler.toml     # Cloudflare Workers config
├── package.json          # npm dependencies and scripts
├── tsconfig.json         # TypeScript compiler options
└── .env.example          # Environment template (never commit secrets)
```

## Directory Purposes

**scripts/:**
- Purpose: CLI entry points for batch jobs
- Contains: ~70 script files named for their operation (crawl.ts, detect-mentions.ts, export-results-to-sheets.ts, etc.)
- Pattern: Each script imports from `src/` and orchestrates a single workflow
- Import pattern: `import { ... } from '../src/...'`
- No logic here; all reusable code lives in `src/`

**src/ai/:**
- Purpose: IA-powered mention classification and enrichment
- Key files:
  - `client.ts` — Anthropic SDK initialization with API key validation
  - `classifier.ts` — Zod schema and prompt building for Claude classification
- Pattern: Pure functions for prompt construction, I/O isolated in `classifyMencion()`
- Usage: Called by `scripts/classify-ia.ts` on matches with gate `usar_ia = TRUE`

**src/alerts/:**
- Purpose: Alert rule definitions for shadow monitoring and crisis detection
- Key files:
  - `shadowAlertRules.ts` — Rules for automated internal alerts (keywords, thresholds)
- Pattern: Rules as data structures or functions tested in `test/`

**src/comparators/:**
- Purpose: Diagnostic and quality assessment tools
- Key files:
  - `cluster.ts` — Clustering algorithm for cross-media duplicates
  - `mentionMatcher.ts` — Similarity matching for deduplication
  - `extractionQuality.ts` — HTML extraction quality scoring
  - `replacementReadiness.ts` — Audit tool for PressClipping replacement
- Pattern: Pure functions for analysis, results written to Sheets by calling scripts

**src/config/:**
- Purpose: Environment and configuration management
- Key files:
  - `env.ts` — Zod validation of `process.env`, `requireSupabaseEnv()`, `requireSheetsEnv()` helpers
  - `shadowMedia.ts` — Media list for shadow monitoring
- Pattern: Centralized env access; no other module reads `process.env`

**src/crawlers/:**
- Purpose: Media ingest orchestration with fallback cascading
- Key files:
  - `index.ts` — Main `crawlMedio()` function with error encapsulation
  - `selection.ts` — Filter logic for safe medium selection (validates status)
  - `promocion.ts` — Ranking and deduplication of news items per medium
- Pattern: `crawlMedio()` returns `CrawlResult` with error field (never throws)
- Output: `NoticiaInsert[]` for batch insertion

**src/editorial/:**
- Purpose: Client-specific filtering, approval workflows, and editorial rules
- Key files:
  - `jumexCriteria.ts` — Jumex brand mention filtering rules
  - `meryCriteria.ts` — Mery Pozos public figure criteria
  - `patronApproval.ts` — Multi-step approval workflow for Patron client
  - `consolidation.ts` — Consolidation of mentions into editorial reviews
- Pattern: Functions take mention data + client context, return filtered/enriched results
- Usage: Called by export and approval scripts

**src/enrichers/:**
- Purpose: Hydrate mentions with calculated fields and context
- Key files:
  - `enrichNews.ts` — Main enrichment pipeline (loads cliente context, adds fields)
- Pattern: Takes raw mención, returns enriched mención with additional fields
- Invoked: Post-detection, pre-export

**src/exporters/:**
- Purpose: Transform mentions into output formats
- Key files:
  - `xml.ts` — `generarXml()` to produce pressclipping_ethos XML with filters
  - `sheetRows.ts` — Transform menciones into Google Sheets rows
  - `rawNews.ts` — Export raw news with media joins
- Pattern: Pure functions (filters, transforms); I/O (file write, API call) done by calling script
- Filters: In-memory filtering via `aplicarFiltros()` for lightweight post-query processing

**src/extractors/:**
- Purpose: Extract content from HTML/articles
- Key files:
  - `html.ts` — Cheerio-based HTML parsing for body text, title, metadata
  - `titleFromUrl.ts` — Fallback title extraction from URL structure
- Pattern: Pure functions; handle null/invalid gracefully
- MVP scope: Limited to RSS metadata, not full content crawling

**src/logs/:**
- Purpose: Structured logging to Google Sheets
- Key files:
  - `ingestaLogger.ts` — Write ingestion results (items per medium, errors) to `05_Logs` sheet
- Pattern: Format rows, batch write to Sheets
- Usage: Called post-crawl by `scripts/crawl.ts`

**src/matchers/:**
- Purpose: Keyword matching algorithms across noticia fields
- Key files:
  - `keyword.ts` — Main matcher logic (exact, phrase, contains, boolean, contextual types)
  - `text.ts` — Text utilities (folding, word boundary detection, substring search)
  - `boolean.ts` — Boolean expression evaluation (AND/OR/NOT operators)
- Pattern: Pure functions; test-heavy (30+ test files cover edge cases)
- Output: `MatchResultado` with match type, evidence snippet, relevance score

**src/matching/:**
- Purpose: Context-aware keyword rule gates and filtering
- Key files:
  - `contextualKeywordRules.ts` — Client-specific keyword context (inclusion/exclusion)
  - `shadowDailyGate.ts` — Shadow mode quality gates and thresholds
- Pattern: Functions return boolean (pases gate) or filtered results
- Usage: Called by `src/matchers/keyword.ts` during matching

**src/normalizers/:**
- Purpose: Transform raw items into database-ready rows
- Key files:
  - `noticia.ts` — Main normalizer; RawItem → NoticiaInsert with all computed fields
  - `url.ts` — URL canonicalization and parsing
- Pattern: Pure functions; handle missing fields gracefully (return null for unpublished, etc.)
- Hash computation: `hash_url = sha256(canonical_url)`, `hash_contenido = content hash`

**src/notifications/:**
- Purpose: Alert delivery via email and WhatsApp
- Key files:
  - `notificationService.ts` — Main service orchestrating email/WhatsApp
  - `emailProvider.ts` — Email via nodemailer with template rendering
  - `whatsappProvider.ts` — WhatsApp integration (if configured)
  - `grouping.ts` — Group mentions by client/keyword for batched notifications
  - `templates.ts` — HTML email templates
  - `smtpTransport.ts` — SMTP configuration (Nodemailer transporter)
- Pattern: Async functions; batched sending to avoid rate limits
- Guard functions: `guards.ts` checks if alert should be sent (user preferences, throttling)

**src/parsers/:**
- Purpose: Extract items from RSS feeds and sitemaps
- Key files:
  - `rss.ts` — RSS-parser integration with error recovery
  - `sitemap.ts` — Recursive sitemap resolution with depth/breadth limits
- Pattern: Both return `RawItem[]`; handle 404/timeout by returning empty array
- MVP scope: RSS and sitemap only; HTML section links and search APIs not implemented

**src/shadow/:**
- Purpose: Parallel shadow mode for testing before production
- Key files:
  - `nationalPrefilter.ts` — Pre-filtering for shadow national monitoring
- Pattern: Filters mention candidates; used to test gate logic without publishing

**src/sheets/:**
- Purpose: Google Sheets client and I/O operations
- Key files:
  - `client.ts` — Service account auth and sheet/tab lookup
  - `read.ts` — Load medios, keywords, clients, config from Sheets
  - `write.ts` — Append rows to result/log tabs
  - `ensureTab.ts` — Create missing tabs before writing
  - `mergePlan.ts` — Plan how to merge updated rows (append vs. update)
  - `tabPlan.ts` — Tab layout expectations
- Pattern: Async operations; handle auth/404/permission errors
- Usage: Called by `sync-sheets` (read), `export-results-to-sheets` (write)

**src/sim/:**
- Purpose: Simulation and tuning utilities for keyword/rule discovery
- Key files:
  - `candidateSimulation.ts` — Test candidate keywords against historical news
- Pattern: Simulates what matches would have occurred with different rule sets
- Usage: Offline tuning before deploying rules to production

**src/supabase/:**
- Purpose: Database client and data access layer
- Key files:
  - `client.ts` — Singleton Supabase client with Service Role Key
  - `repositories.ts` — Repository functions for all tables (upsert, select, filter)
- Pattern: All DB queries go through repositories; scripts never call client directly
- Chunking: Upserts split into 500-row batches to avoid payload limits
- Export types: `MencionExportRow`, `NoticiaRawRow` defined here

**src/types/:**
- Purpose: Shared TypeScript interfaces and Zod schemas
- Key files:
  - `schemas.ts` — DB table types (Medio, Cliente, Keyword, ConfigRow)
  - `noticia.ts` — NoticiaInsert, NoticiaRawRow, SELECT_NOTICIA_RAW
  - `mencion.ts` — MencionExportRow, SELECT_MENCION_EXPORT with joins
- Pattern: Each type includes SELECT constant for Supabase PostgREST query
- Mappers: Functions like `mapMencionExport()` unpack nested Supabase responses

**src/utils/:**
- Purpose: Reusable utilities without domain logic
- Key files:
  - `logger.ts` — Pino logger factory with pretty/JSON formats
  - `chunk.ts` — Batching utility (`ejecutarPorLotes`)
  - `hash.ts` — SHA256 hashing, content hash generation
  - `http.ts` — HTTP fetching with retries and timeouts
  - `parse.ts` — Parsing helpers (parseIntOrNull, parseBool)
  - `dateWindow.ts` — Date range calculations
  - `shadowGuard.ts` — Shadow mode feature flag checks
- Pattern: Pure functions or stateless utilities
- No side effects except logging

**src/validation/:**
- Purpose: Media audit, quality checks, and diagnostic reporting
- Key files:
  - `mediaAudit.ts` — Check media readiness (RSS accessible, valid structure)
  - `diagnostics.ts` — Comprehensive media diagnostic (extraction quality, source health)
  - `diagnosticosSheet.ts` — Read/write diagnostics to Sheets
  - `checks.ts` — Individual check functions (reusable)
  - `pcMediaCatalog.ts` — PressClipping media catalog validation
  - `probe.ts` — Lightweight health check for a single medium
- Pattern: Async functions return structured results
- Usage: Audit scripts write results to Sheets for manual review

**test/:**
- Purpose: Unit and integration tests
- Location: Colocated with feature (e.g., `test/keyword-matcher.test.ts` tests `src/matchers/keyword.ts`)
- Framework: Vitest
- Naming: `{feature}.test.ts` or `{feature}.spec.ts`
- Fixtures: XML samples in `test/fixtures/`, data files in `test/fixtures/`
- Pattern: Pure functions extensively tested; mocked DB calls
- Coverage: ~40 test files covering matchers, exporters, normalization, editorial logic

**worker/:**
- Purpose: Cloudflare Worker for HTTP serving of XML
- Location: `worker/src/index.ts`
- Entry point: Default export with `fetch()` handler
- Endpoint: GET `/read-xml` with token auth (query param or Bearer header)
- Logic: Same as `generate-xml` script but served over HTTP
- Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, XML_SECRET_TOKEN (from Cloudflare env)
- Deployment: `npm run worker:deploy` via wrangler

**supabase/migrations/:**
- Purpose: SQL schema versioning
- Files: `0001_initial_schema.sql`, `0002_seed_configuracion.sql`, etc.
- Pattern: Chronological, numbered migrations
- Idempotent: Each includes `IF NOT EXISTS` or `IF EXISTS`
- Tables: medios, clientes, keywords, noticias, menciones, clusters, logs_ingesta, configuracion, comparativo_pressclipping, etc.
- Indices: hash_url (UNIQUE), (titulo, medio_id, fecha), cliente_id, keyword_id for query performance

## Key File Locations

**Entry Points:**
- `scripts/crawl.ts` — Main ingestion orchestrator
- `scripts/detect-mentions.ts` — Keyword matching pipeline
- `scripts/export-results-to-sheets.ts` — Write results to Sheets
- `scripts/generate-xml.ts` — XML generation
- `scripts/classify-ia.ts` — IA classification
- `worker/src/index.ts` — HTTP endpoint for XML serving

**Configuration:**
- `src/config/env.ts` — Environment variable loading and validation
- `tsconfig.json` — TypeScript compiler settings (target ES2022, path alias @/*)
- `.env.example` — Template for secrets and config

**Core Logic:**
- `src/crawlers/index.ts` — `crawlMedio()` function
- `src/matchers/keyword.ts` — Keyword matching algorithm
- `src/normalizers/noticia.ts` — Normalization pipeline
- `src/exporters/xml.ts` — XML generation
- `src/supabase/repositories.ts` — All database access

**Testing:**
- `test/keyword-matcher.test.ts` — Matcher tests
- `test/html-extractor.test.ts` — HTML extraction tests
- `test/ai.test.ts` — IA prompt building tests
- `test/fixtures/*.xml` — Sample XML for import testing

## Naming Conventions

**Files:**
- Snake case for most files (e.g., `sync-sheets.ts`, `detect-mentions.ts`)
- Descriptive names matching their primary function
- Test files: `{module}.test.ts` colocated with source or in `test/`
- Scripts: Command-like names (crawl, export, detect, classify)

**Directories:**
- Plural for collections (crawlers, exporters, parsers, matchers)
- Singular when containing a single concept (config, logs, supabase)
- Feature-focused (ai, editorial, notifications) over technical grouping (models, services)

**Functions & Exports:**
- `camelCase` for all functions and variables
- `PascalCase` for types and interfaces
- `UPPER_CASE` for constants (e.g., `CHUNK = 500`, `PESOS_CAMPO`)
- Prefix with verb: `get*()`, `fetch*()`, `normalize*()`, `match*()`, `generate*()`, `calculate*()`

**Type Definitions:**
- Suffix `Row` for database rows (NoticiaRawRow, MencionExportRow)
- Suffix `Insert` for insert operations (NoticiaInsert)
- Suffix `Result` for operation outcomes (CrawlResult)
- Suffix `Schema` for Zod validation (ClasificacionSchema)

## Where to Add New Code

**New Feature (e.g., new matcher type):**
1. Create/extend module in appropriate `src/` subdirectory
   - If it's a matching variant: `src/matchers/newType.ts`
   - If it's a client-specific rule: `src/editorial/newClient.ts`
2. Export interface/function from module
3. Add tests in `test/{module}.test.ts`
4. Import and use in calling script (e.g., `scripts/detect-mentions.ts`)

**New Script/Workflow:**
1. Create `scripts/{workflow-name}.ts`
2. Import reusable functions from `src/` modules
3. Orchestrate: load config → call business logic → write results
4. Add npm script to `package.json`
5. If async operations, use error handling pattern (try-catch or result objects)

**New Data Processing Step (e.g., post-enrichment step):**
1. Create function in appropriate module (e.g., `src/editorial/newStep.ts`)
2. Pure function: takes data, returns modified data
3. Test thoroughly in `test/{module}.test.ts`
4. Add repository function if DB query needed
5. Call from relevant script with proper error handling

**New Utility:**
1. Add to `src/utils/{name}.ts`
2. Keep pure and reusable (no side effects except logging)
3. Test with `test/utils/{name}.test.ts` if complex

**New Database Table or Migration:**
1. Create SQL in `supabase/migrations/{next-number}_{name}.sql`
2. Add idempotent CREATE TABLE or ALTER TABLE
3. Add Zod type in `src/types/schemas.ts`
4. Add repository functions in `src/supabase/repositories.ts`
5. Update SELECT constants in type files
6. Add mappers if needed

**New Sheets Integration:**
1. Define expected columns and header row
2. Add read function in `src/sheets/read.ts` or write function in `src/sheets/write.ts`
3. Call from `sync-sheets.ts` (read) or export script (write)
4. Add validation via Zod if reading user input

## Special Directories

**data/imports/:**
- Purpose: Staging area for bulk imports (e.g., PressClipping XML backfill)
- Generated: Yes (downloaded from external sources)
- Committed: No (gitignored)
- Cleanup: Manual or scripted after processing

**output/:**
- Purpose: Local output files (XML, CSV exports)
- Generated: Yes (by export scripts)
- Committed: No (gitignored)
- Cleanup: Manual or periodic

**tmp/:**
- Purpose: Temporary working files
- Generated: Yes (during script execution)
- Committed: No (gitignored)
- Cleanup: Automatic or manual

**node_modules/:**
- Purpose: npm dependencies
- Generated: Yes (`npm install`)
- Committed: No (gitignored)

**.planning/codebase/:**
- Purpose: GSD codebase analysis documents
- Generated: Yes (by GSD codebase-mapper)
- Committed: Yes (reference for future phases)
- Contents: ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, STACK.md, INTEGRATIONS.md, CONCERNS.md

---

*Structure analysis: 2026-07-28*
