# External Integrations

**Analysis Date:** 2026-07-28

## APIs & External Services

**Media Monitoring & Intelligence:**
- PressClipping (Legacy system) - Comparison baseline, import capability via scripts
  - Client: Custom parsers in `src/comparators/`
  - Purpose: Shadow monitoring and gap analysis

**Artificial Intelligence:**
- Anthropic Claude - Mention classification and contextual analysis (Phase 7)
  - SDK: `@anthropic-ai/sdk` 0.69.0
  - Implementation: `src/ai/client.ts` and `src/ai/classifier.ts`
  - Auth: `ANTHROPIC_API_KEY` environment variable
  - Default model: `claude-haiku-4-5` (configurable via `04_Configuracion` sheet)
  - Status: Optional, currently disabled in MVP workflows

## Data Storage

**Databases:**
- PostgreSQL (via Supabase)
  - Provider: Supabase
  - Connection: `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
  - Client: `@supabase/supabase-js` 2.45.0
  - Authentication: Service Role Key (server-side only, full access, bypasses RLS)
  - Implementation: `src/supabase/client.ts` with singleton pattern
  - Migrations: `supabase/migrations/` (SQL-based, sequential versioning)
  - Key tables: `configuracion`, `medios`, `clientes`, `keywords`, `noticias`, `menciones`, `clusters`, `logs_ingesta`
  - Status: Core historical database, required for all scripts

**File Storage:**
- Local filesystem only
  - `data/` directory for exports and captures
  - `output/` directory for generated XML and results
  - `tmp/` directory for temporary processing files

**Caching:**
- In-memory singleton pattern for client instances
  - Supabase client cached in `src/supabase/client.ts`
  - Google Sheets documents cached in `src/sheets/client.ts` (control, output, and external by ID)
  - Anthropic client cached in `src/ai/client.ts`

## Configuration Management

**Google Sheets - Control Panel:**
- Purpose: Central configuration, keywords, media catalog, client definitions
- Provider: Google Cloud (Service Account JWT)
- Connection: `GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_PRIVATE_KEY`
- Client: `google-spreadsheet` 4.1.4 + `google-auth-library` 9.14.0
- Sheet ID: `GOOGLE_SHEET_ID` (default: 1aPGIO5zt5b2C1sdC2lOPsmjhcpudn_NvmlCJ8OW39es)
- Implementation: `src/sheets/client.ts` with JWT auth and exponential backoff retry logic
- Canonical tabs: `00_README`, `01_Medios`, `02_Keywords`, `03_Clientes`, `04_Configuracion`, `05_Logs`, `06_Resultados`, `07_Diccionarios`
- Resilience: Automatic retry with 2s/5s/10s/20s backoff + jitter on transient errors (429, 503, connection issues)

**Google Sheets - Output Spreadsheet (Optional):**
- Purpose: Write capture results, mentions, XML exports, daily summaries, media coverage
- Connection: `GOOGLE_OUTPUT_SHEET_ID` (optional, falls back to `GOOGLE_SHEET_ID` if not set)
- Implementation: `src/sheets/client.ts` with `requireOutputSheetsEnv()` and `resolveOutputSheetId()`
- Output tabs: `01_Noticias_Raw`, `02_Menciones`, `03_XML_Export`, `04_Logs`, `05_Comparativo_PressClipping`, `06_Resumen_Diario`, `07_Metricas_Live`, `08_Cobertura_Medios`, `09_Medios_PressClipping`
- Resilience: Same retry logic as control panel

## Content Extraction

**Web Scraping:**
- RSS Feed parsing
  - Client: `rss-parser` 3.13.0
  - Usage: Fetch article lists from media RSS feeds
  - Implementation: `src/crawlers/` scripts
  - Configuration: RSS URL stored in `medios` table `rss_url` column

- HTML Parsing
  - Client: `cheerio` 1.2.0
  - Usage: Extract article text, headlines, metadata from direct crawls
  - Implementation: `src/crawlers/` for media-specific selectors
  - Proxy support: `requiere_proxy` flag in media configuration

- Sitemap-based crawling
  - Standard XML sitemap parsing
  - Fallback for RSS-unavailable sources
  - Configuration: `sitemap_url` in media catalog

**XML Export & Parsing:**
- Generation: `xmlbuilder2` 3.1.1 (`src/exporters/xml.ts`)
- Parsing: `fast-xml-parser` 4.5.6
- Format: PressClipping-compatible XML with mentions, metadata, filters
- Supported filters: `cliente`, `keyword`, `medio`, `region`, `estadoRevision`, `desde`, `hasta`

## Authentication & Identity

**Google Cloud Service Account:**
- Type: JWT-based (offline, no token refresh needed)
- Scopes: `https://www.googleapis.com/auth/spreadsheets`
- Credentials: Private key from GOOGLE_PRIVATE_KEY (normalized from escaped newlines in .env)
- Usage: All Google Sheets read/write operations
- Security: Service account email must be explicitly shared as "Editor" on each spreadsheet

**Supabase Service Role Key:**
- Purpose: Backend-only database access with full permissions
- Scope: Bypasses RLS policies (server-side, never exposed to client)
- Usage: All Supabase operations in scripts and workers
- Security: Treated as master secret, stored only in GitHub Actions secrets and local .env

**Cloudflare Worker Authentication:**
- Token-based: `XML_SECRET_TOKEN`
- Method: Query parameter `?token=...` or `Authorization: Bearer <token>` header
- Implementation: `worker/src/index.ts` validates token before returning XML
- Use case: `/read-xml` endpoint protection
- Configuration: `XML_SECRET_TOKEN` secret in Cloudflare dashboard

## Monitoring & Observability

**Error Tracking:**
- Not integrated (no Sentry, Rollbar, etc.)

**Logs:**
- Structured logging via `pino` 9.4.0 (JSON output for GitHub Actions, pretty for local)
- Destination: Console (stdout)
- Persistence: Exported to Google Sheets (`05_Logs` tab) via `export-results` script
- Implementation: `src/logs/` module with context-aware logging
- Context: `RUN_BY` env var (local | github-actions | cron) included in all logs

**Execution Tracing:**
- Log level configurable: `LOG_LEVEL` env var (trace | debug | info | warn | error)
- Format configurable: `LOG_FORMAT` env var (pretty | json)

## CI/CD & Deployment

**Version Control:**
- Git repository with GitHub Actions workflows

**Continuous Integration:**
- Workflow: `ci.yml`
- Trigger: Push to any branch, PRs
- Steps:
  1. Checkout code
  2. Setup Node.js 20 with npm cache
  3. `npm ci` (clean install)
  4. `npm run typecheck` (TypeScript validation)
  5. `npm test --if-present` (vitest)
- Status: Gating (checks must pass before merge)

**Deployment (Scripts/Manual):**
- Workflow: `ingesta.yml`
- Trigger: Manual dispatch (workflow_dispatch) only in MVP phase
- Concurrency: Single job at a time (cancel-in-progress: false)
- Steps:
  1. Validate Supabase schema (read-only test)
  2. Validate Google Sheets headers (read-only test)
  3. Run crawl with filters (`--limit=5 --solo-validados`)
  4. Detect mentions
  5. Export results to Sheets
  6. Generate XML
- Secrets passed: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_SHEET_ID`
- Disabled: Schedule-based execution (commented out)

**Worker Deployment:**
- Command: `npm run worker:deploy` (uses `wrangler deploy`)
- Configuration: `worker/wrangler.toml`
- Secrets (non-code):
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `XML_SECRET_TOKEN`
- Local dev: `npm run worker:dev` (uses `worker/.dev.vars` with non-committed secrets)
- Compatibility: Node.js v18.0.0 (nodejs_compat flag)

**Other Workflows:**
- `validacion.yml` - Data validation checks
- `live-comparison-shadow*.yml` - Shadow monitoring and gap analysis
- `patron-no-pc-capture.yml` - Client-specific capture
- `mery-no-pc-capture.yml` - Client-specific capture
- All triggered by schedule or manual dispatch with GitHub Actions secrets

## Webhooks & Callbacks

**Incoming:**
- Cloudflare Worker endpoint `/read-xml` - GET endpoint for XML export, authenticated by token
- `/health` endpoint - Unauthenticated health check

**Outgoing:**
- Email alerts: SMTP via `nodemailer` (optional, disabled by default)
  - Channels: Internal alerts to `INTERNAL_ALERT_EMAILS`
  - Configuration: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
  - Impl: `src/notifications/smtpTransport.ts` (dynamic import, safe-by-default factory)
  - Multi-layer authorization: SEND_ALERTS + ALLOW_REAL_ALERTS + EMAIL_ALERTS_ENABLED + valid token

- WhatsApp alerts: Twilio integration (optional, not configured)
  - Configuration: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`
  - Numbers: `INTERNAL_ALERT_WHATSAPP_NUMBERS`
  - Status: Placeholder support, not implemented

## Environment Configuration

**Required env vars:**
- `SUPABASE_URL` - PostgreSQL project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Master authentication key
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` - Service account email
- `GOOGLE_PRIVATE_KEY` - Service account private key (escaped newlines)
- `GOOGLE_SHEET_ID` - Control panel Sheet ID

**Optional env vars:**
- `GOOGLE_OUTPUT_SHEET_ID` - Separate output Sheet (fallback to GOOGLE_SHEET_ID)
- `ANTHROPIC_API_KEY` - Claude API key (Phase 7, currently unused)
- `XML_SECRET_TOKEN` - Worker endpoint protection
- `SEND_ALERTS` - Global alert kill-switch (default: false)
- `ALLOW_REAL_ALERTS` - Real alert authorization (default: false)
- `ALERTS_INTERNAL_ONLY` - Restrict to internal recipients (default: true)
- `ALERTS_ALLOWED_CLIENTS` - CSV of client IDs allowed to alert
- `ALERTS_ALLOWED_SEVERITIES` - CSV of severity levels (P1, P2, etc.)
- `EMAIL_ALERTS_ENABLED` - Enable SMTP channel (default: false)
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` - SMTP config
- `INTERNAL_ALERT_EMAILS` - CSV of internal recipients
- `WHATSAPP_ALERTS_ENABLED` - Enable Twilio channel (default: false)
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` - Twilio config
- `INTERNAL_ALERT_WHATSAPP_NUMBERS` - CSV of internal phone numbers
- `REAL_ALERTS_CONFIRMATION_TOKEN` - Safety token for real alerts
- `RUN_BY` - Execution context label (local | github-actions | cron)
- `LOG_LEVEL` - Logging verbosity (default: info)
- `LOG_FORMAT` - Log output format (default: pretty, json for Actions)

**Secrets location:**
- Local development: `.env` file (in .gitignore)
- GitHub Actions: Repository secrets (configured manually or via CLI)
- Cloudflare Workers: `wrangler secret put` (stored in Cloudflare)

## Integrations Security Model

**Layered Authorization (Alerts System Example):**
- Layer 1: Global kill-switch (`SEND_ALERTS=false`)
- Layer 2: Real alert approval (`ALLOW_REAL_ALERTS=false`)
- Layer 3: Token validation (`REAL_ALERTS_CONFIRMATION_TOKEN` match)
- Layer 4: Client allowlist (`ALERTS_ALLOWED_CLIENTS`)
- Layer 5: Severity allowlist (`ALERTS_ALLOWED_SEVERITIES`)
- Layer 6: Channel enablement (`EMAIL_ALERTS_ENABLED`, `WHATSAPP_ALERTS_ENABLED`)
- Layer 7: Recipient configuration (email/WhatsApp lists)
- Layer 8: Mention flag (`sin_envio=false` in database row)
- All layers must align (AND logic) before sending real alert

**Data Security:**
- Supabase Service Role Key: Never exposed in logs or HTML, strictly backend
- Google Private Key: Escaped in .env, normalized at load time, never logged
- SMTP credentials: Never logged to stdout, only host domain for troubleshooting
- Worker tokens: Compared in constant-time checks, never echoed back

---

*Integration audit: 2026-07-28*
