# Codebase Concerns

**Analysis Date:** 2026-07-28

## Tech Debt

**Script Code Duplication (crawl-direct extractors):**
- Issue: Three nearly-identical direct crawl scripts (`crawl-direct-cnit.ts`, `crawl-direct-latinus.ts`, `crawl-direct-lasillarota.ts`) share 95%+ of logic: URL pattern extraction, dedup, normalization, enrichment flow.
- Files: `scripts/crawl-direct-cnit.ts` (140 lines), `scripts/crawl-direct-latinus.ts` (136 lines), `scripts/crawl-direct-lasillarota.ts` (136 lines)
- Impact: Bug fixes and feature changes must be applied to three places. Adding a new direct crawler requires copy-paste. Risk of divergence (e.g., CNIT has extra enrich step but others might be missed).
- Fix approach: Extract common pattern into shared `DirectCrawlerBase` class or utility factory. Keep media-specific parts (MEDIO_ID, URL_PATTERN, BASE_URL) as parameters.

**Large monolithic scripts without shared utilities:**
- Issue: Scripts like `import-pressclipping.ts` (812 lines), `compare-mentions.ts` (738 lines), `generate-internal-daily-shadow-report.ts` (668 lines) contain mixed concerns (parsing, logging, state management, output formatting).
- Files: Multiple scripts in `scripts/` directory
- Impact: Hard to test in isolation. Logic reuse is limited. Refactoring is risky (high blast radius).
- Fix approach: Extract business logic into domain services (`src/services/`, `src/usecases/`). Keep scripts thin: CLI parsing → service call → output.

**Pending migration 0012 for `origen_cobertura` column:**
- Issue: Code in `compare-mentions.ts` (line 166-168) has fallback logic for missing `origen_cobertura` column, treating its absence as "not yet migrated."
- Files: `scripts/compare-mentions.ts`, potentially `src/comparators/`
- Impact: If migration isn't applied to production DB, cobertura filtering silently fails (no error, just skips the check). Data quality degradation goes unnoticed.
- Fix approach: Make migration 0012 a blocker at startup (check in `healthcheck.ts`). Fail fast instead of silent fallback.

**URL normalization inconsistency:**
- Issue: `compare-mentions.ts` line 211 shows `url_norm` field read from stored data, but also fallback to `normalizeUrl()` on the fly. This suggests `url_norm` values in DB may be stale (computed with older algorithm).
- Files: `src/comparators/mentionMatcher.ts`, `scripts/debug-live-comparison-zero-match.ts` (lines 240-241 explicitly mention "NORMALIZE_URL_BUG")
- Impact: URL matching fails silently when live-computed `url_norm` differs from stored value. False negatives in comparison (Ethos sees match, PressClipping disagrees because `url_norm` mismatch).
- Fix approach: Recompute `url_norm` at comparison time (don't trust stored value). Document why. Add diagnostic logging to detect mismatches.

**Shadow client allowlist with alertas_activas=false bypass:**
- Issue: `shadowAlertRules.ts` and `run-shadow-alerts.ts` allow evaluating clients with `alertas_activas=false` when `--shadow-client-allowlist` is used (line 118 in shadowAlertRules.ts: `permitir_shadow_cliente_inactivo`).
- Files: `src/alerts/shadowAlertRules.ts`, `scripts/run-shadow-alerts.ts`, `test/matcher-mery-pozos.test.ts` (line 302 notes this must never change)
- Impact: If allowlist is misconfigured or bypass logic has a bug, shadow evaluation could accidentally trigger real alerts for inactive clients. Tests are present but this is a critical safety valve.
- Fix approach: Add audit logging whenever allowlist is used. Consider requiring a second confirmation flag or approval token.

## Known Bugs

**Sheet write mismatch detection (05_Comparativo vs 07_Metricas):**
- Symptoms: `sheetsWriteMismatch` flag in shadow metrics (see `shadowGuard.ts` line 240) indicates that data written to Sheet 05 doesn't match the read-back. Causes cycle to be marked as `shadow_warning` instead of `shadow_ok`.
- Files: `src/sheets/write.ts` (lines 93, 335, 387), `src/utils/shadowGuard.ts` (line 198, 240)
- Trigger: Likely race condition or API throttling (429 response). Google Sheets API sometimes returns success but data hasn't persisted when read-back happens immediately.
- Workaround: Retry write with exponential backoff. Implement longer polling delay before read-back. Currently there's `withSheetsRetry` but may not cover all cases.

**Statement timeout on large batch enrichment:**
- Symptoms: Pipeline halts with "statement timeout" error when enriching large batches of notes with text extraction.
- Files: `src/enrichers/enrichNews.ts` (line 304 mentions "statement timeout" in comment), `scripts/enrich-news.ts`
- Trigger: Default Supabase statement timeout is ~30s. Batching multiple UPDATE operations on 1000+ rows exceeds it.
- Workaround: Split into smaller batches (~50-100 rows). Code currently does chunking but might not be tuned for all media types.

**Dry-run with missing clean text blocks real detection:**
- Symptoms: If `enrich-news` is run with `--dry-run` and many notes lack extracted text (`sinTexto > 0`), subsequent steps like `detect-mentions` are skipped entirely with a warning (see `run-shadow-daily-validated-tier.ts` line 215, `run-shadow-crisis-tier.ts` line 215).
- Files: `scripts/run-shadow-*.ts` multiple files, `src/utils/shadowGuard.ts` (line 232, 259)
- Trigger: User runs enrichment dry-run to test, then forgets that detection is blocked. Next production cycle may miss the window if scheduler ran both in same cycle.
- Workaround: Documentation warns against mixing dry-run + real-run in same cycle. But the code doesn't enforce this.

**Crawl source selection ordering bug (MVP methods forced first):**
- Symptoms: `src/crawlers/index.ts` lines 64-117 show that if a medium declares multiple crawl sources, only "rss" and "sitemap" (the MVP methods) are tried, and they're forced to run first even if others are preferred.
- Files: `src/crawlers/index.ts` (lines 25-117)
- Trigger: Non-MVP methods (e.g., 'news-sitemap', custom extractors) declared in config but never attempted.
- Impact: Mediums that could be crawled via non-MVP methods get zero coverage.
- Fix approach: Remove MVP set restriction or make it configurable per medium.

## Security Considerations

**Multiple safety guardrails for alert sending but high complexity:**
- Risk: System has three layers of protection (SEND_ALERTS env var, `sin_envio` flag, `alertas_activas` client flag), but the interaction is complex. A bug in one layer could cascade.
- Files: `src/utils/shadowGuard.ts`, `src/notifications/guards.ts`, `src/alerts/shadowAlertRules.ts`, `scripts/run-shadow-alerts.ts`, `test/notifications.test.ts` (71 tests covering this)
- Current mitigation: Extensive test coverage. Guards refuse to proceed if flags contradict. Default is safe (dry-run, no send).
- Recommendations: 
  1. Add execution-time audit log whenever any guard rejects a send attempt (helps detect config mistakes).
  2. Require explicit `--send-real` flag to be present alongside `--allow-real-alerts` (currently can be overridden).
  3. Consider adding a "confirmation token" that's different per run (anti-accidental-rerun).

**Email/WhatsApp/Twilio not actually wired (transport layers optional):**
- Risk: Code compiles and runs even if SMTP_HOST, TWILIO_ACCOUNT_SID, WHATSAPP_ENABLED are missing. Alerts report "not_configured" status instead of failing loudly.
- Files: `src/notifications/emailProvider.ts` (line 65-71), `src/notifications/whatsappProvider.ts` (line 50, 60)
- Current mitigation: Status "not_configured" is explicit and logged. Tests verify this behavior intentionally.
- Recommendations: Make transport configuration optional *by design*, not by accident. Document which scripts actually send (currently most are simulation/dry-run). Update healthcheck to warn if production scripts are missing transports.

**API token exposure in test fixtures:**
- Risk: Test files might contain hardcoded tokens or mock credentials that could leak in diffs.
- Files: Checked `test/notifications.test.ts`, `test/matcher-mery-pozos.test.ts` — appear clean (use fake/mock data).
- Current mitigation: Zod validation in env.ts prevents runtime use of incomplete creds. Mock tokens in tests are obviously fake.
- Recommendations: Add pre-commit hook to block `*.env` files in commits (already in .gitignore but belt-and-suspenders is good).

**Client configuration permissioning (Patrón production vs Jumex staging vs Mery Pozos shadow):**
- Risk: Three parallel pipelines with different states. A script running with wrong client ID could send real alerts to wrong recipient.
- Files: Multiple `run-shadow-*.ts` scripts, `src/config/shadowMedia.ts`
- Current mitigation: Client filtering is explicit. Scripts default to shadow mode. Mery Pozos locked with `alertas_activas=false` + allowlist.
- Recommendations: Add runtime check that client_id matches expected tier (e.g., Mery Pozos script should reject non-Mery clients). Fail fast.

## Performance Bottlenecks

**Supabase PostgREST query batching limit (URL length):**
- Problem: `.in('noticia_id', [...many ids...])` can hit POST body/URL length limit and fail with "fetch failed" (see `compare-mentions.ts` line 155-157, TAM_LOTE=200 is workaround).
- Files: `scripts/compare-mentions.ts` (lines 155-176), potentially other scripts doing large `.in()` queries
- Cause: PostgREST encodes filters in URL by default. Large sets overflow.
- Improvement path: Use POST body instead of query params. Consider chunking threshold tuning (200 may be conservative).

**15-second HTTP timeout for news extraction:**
- Problem: Slow/unresponsive news sites cause long hangs. 15s is default (see `src/utils/http.ts` line 31, `src/extractors/html.ts` line 767).
- Files: `src/extractors/html.ts`, `src/utils/http.ts`, `src/parsers/rss.ts` (line 12)
- Impact: 100+ articles × 15s timeout = 25+ minutes of wall-clock time per crawl cycle.
- Improvement path: 
  1. Implement per-medium configurable timeout (trusted fast sources: 5s, slow sources: 20s).
  2. Add connection pooling and aggressive retry with exponential backoff.
  3. Profile which media are slowest and consider removing or scheduling separately.

**Caching of Google Sheets and Supabase clients (no TTL):**
- Problem: `src/sheets/client.ts` (lines 128-160) and `src/supabase/client.ts` caches clients indefinitely. If credentials rotate or connection drops, stale client is reused.
- Files: `src/sheets/client.ts` (lines 128-160), `src/supabase/client.ts` (lines 11-24), `src/ai/client.ts` (lines 10-19)
- Impact: Long-running processes (e.g., scheduler) may silently fail to refresh auth tokens or detect network changes.
- Improvement path: Add TTL-based cache invalidation (e.g., refresh every 1 hour). Or make caching optional (pass --no-cache flag for one-shot scripts).

**Large-scale comparison without incremental sync:**
- Problem: `compare-mentions.ts` and `run-live-comparison.ts` load full mention history into memory for comparison. With 50k+ mentions, memory grows unbounded.
- Files: `scripts/compare-mentions.ts`, `scripts/run-live-comparison.ts`
- Cause: No streaming/chunking of Supabase queries. Entire result set loaded before processing.
- Improvement path: Page results in chunks. Use cursors for stateful iteration. Consider a dedicated comparison table in DB instead of in-memory join.

## Fragile Areas

**Shadow scheduler tier isolation by medio_id (complex filtering):**
- Files: `scripts/run-shadow-daily-validated-tier.ts`, `scripts/run-shadow-crisis-tier.ts`, `scripts/run-shadow-national-tier.ts`, `src/config/shadowMedia.ts`
- Why fragile: Each tier filters media by priority/status/custom config. Logic is spread across files. A typo in `shadowMedia.ts` silently breaks a tier (no error, just empty results).
- Safe modification: 
  1. Add validation in `shadowMedia.ts` that tier definitions are non-empty and contain expected medios.
  2. Add unit tests for each tier's filtering logic.
  3. Add logs at startup showing which medios are assigned to which tier.
- Test coverage: Some coverage in tests, but integration tests of tier isolation are missing.

**PressClipping comparison fallback logic (migration pending):**
- Files: `scripts/compare-mentions.ts` (lines 178-215), `scripts/debug-live-comparison-zero-match.ts`
- Why fragile: The system is labeled "Emergency PressClipping Replacement" in multiple audit scripts. Comparison logic has many conditional branches for missing columns (origin_cobertura) or missing tables (comparativo_pressclipping). If a migration is pending but code assumes it's done, silent data loss occurs.
- Safe modification:
  1. Make migrations a startup blocker (enforce in CLI entry point).
  2. Add explicit checks before each fallback: log a clear error instead of silent handling.
  3. Document which parts of the codebase depend on which migrations.
- Test coverage: Tests exist but don't cover migration-missing scenarios.

**Keyword evaluation rules with many override flags:**
- Files: `src/alerts/shadowAlertRules.ts` (lines 85-119), `src/matchers/keyword.ts`
- Why fragile: Input to `evaluarAlertaSombra` has many optional boolean flags: `cliente_alertas_activas`, `keyword_activa`, `keyword_alerta`, `tema_reputacional`, `permitir_shadow_cliente_inactivo`, etc. Easy to misinterpret precedence (AND vs OR).
- Safe modification:
  1. Add a decision-tree diagram in comments showing exact evaluation order.
  2. Add explicit test cases for each flag combination (currently 71 tests exist but not all combinations covered).
  3. Consider a state machine instead of nested conditionals.
- Test coverage: Good test coverage but some edge cases (e.g., all flags true/false) may not be tested.

**XML export with incomplete data recovery:**
- Files: `scripts/generate-xml.ts`, `src/exporters/` directory
- Why fragile: Exports Patrón results to XML for client. If enrichment step (text extraction) fails for a media, that media's notes are incomplete but export continues silently. Client receives partial data without warning.
- Safe modification:
  1. Track which media have incomplete coverage (count of notes with missing text_limpio).
  2. Add a summary in XML header showing data completeness %.
  3. Consider blocking export if any critical media have <50% completeness.
- Test coverage: XML format tests exist, but not for handling missing fields.

**Multi-step pipelines without checkpoint recovery:**
- Files: `scripts/run-shadow-*.ts`, `scripts/run-live-comparison.ts`, `scripts/run-patron-no-pc-production-capture.ts`
- Why fragile: Crawl → Detect → Enrich → Export → Compare steps are sequential in a single process. If step N fails, you must restart from step 1 (no resume capability).
- Safe modification:
  1. Add explicit checkpoints and save state to a metadata table.
  2. Implement `--resume-from-step=N` flag.
  3. Or break monolithic scripts into separate CLI commands that can be retried independently.
- Test coverage: No tests for failure recovery paths.

## Scaling Limits

**Manual script orchestration (no scheduler framework):**
- Current capacity: Single machine executes scripts via cron (implicit from docs). ~10-20 parallel scripts max before resource contention.
- Limit: When adding new clients (Jumex, additional tiers), overhead of manual schedule coordination grows. No unified view of running jobs.
- Scaling path:
  1. Implement a job queue (Bull, RabbitMQ, or AWS SQS).
  2. Add a scheduler UI to visualize job dependencies and logs.
  3. Move to containerized deployment (Docker) with orchestration (Kubernetes or Docker Compose).
  4. Current: Scripts are one-off CLI, hard to monitor.

**Database connection pooling not configured:**
- Current capacity: Supabase service role client (line 15-24 in `src/supabase/client.ts`) creates a single shared client. Works for ~5-10 concurrent operations before queuing.
- Limit: High-concurrency pipelines (e.g., crawling 50 mediums in parallel) will serialize on DB connection.
- Scaling path:
  1. Use a connection pool (pgBouncer, or Supabase's native pooling).
  2. Implement request queuing with backpressure.
  3. Profile actual concurrency needs first.

**Memory growth with large mention sets:**
- Current capacity: Mention history loaded entirely into memory. Works for ~50k mentions. Beyond 100k, risk of OOM.
- Limit: As news volume grows (more mediums, more keywords), in-memory comparisons become untenable.
- Scaling path:
  1. Implement streaming/chunked processing.
  2. Consider a dedicated comparison service (microservice) or stored procedures in Supabase.
  3. Add memory monitoring and early-warning alerts.

**Sheet API throttling (429 responses):**
- Current capacity: Writing to 5-10 tabs simultaneously. Beyond that, Google Sheets API returns 429 (rate limited).
- Limit: Shadow shadow reports write to multiple tabs (05, 07, 10). High frequency (hourly) can hit limits.
- Scaling path:
  1. Implement exponential backoff (currently minimal).
  2. Use batch updates (batchUpdate instead of individual append calls).
  3. Consider splitting output across multiple spreadsheets.

## Dependencies at Risk

**@supabase/supabase-js v2.45.0 (direct Postgres dependency):**
- Risk: Supabase client abstracts Postgres. If Supabase API changes (unlikely but possible), client version mismatch could break all DB queries.
- Impact: Hard to migrate if Supabase is compromised or pricing changes. Currently pinned to a specific version.
- Migration plan: 
  1. Consider using raw Postgres driver as fallback (pg library).
  2. Add integration tests against actual Supabase (not mocks).
  3. Monitor release notes and test minor version bumps before deploying.

**google-spreadsheet v4.1.4 (Google Sheets integration):**
- Risk: Google changes API signatures (rare but happened in past). Many scripts depend on output-to-sheets for observability.
- Impact: If sheets integration breaks, no visibility into shadow execution or results.
- Migration plan:
  1. Add a no-sheets fallback (console-only output).
  2. Consider switching to Google Sheets API v4 directly (less abstraction).
  3. Test against actual Google Sheets (rate limits, auth failures).

**Anthropic API (@anthropic-ai/sdk v0.69.0) for classification:**
- Risk: Phase 7 (classify-ia) depends on Anthropic API. If API goes down or costs spike, classification halts.
- Impact: Keyword and article classification stops. Pipeline degrades gracefully (dry-run shows cost estimates).
- Migration plan:
  1. Add fallback to rule-based classifier (no IA).
  2. Implement caching of classifications (avoid re-classifying same text).
  3. Monitor API costs and add budget alerts.

**pino v9.4.0 (logging):**
- Risk: Custom logging setup with pino-pretty. If pino breaks, all log output fails.
- Impact: Loss of observability (hard to debug production issues).
- Migration plan: Pino is mature; risk is low. But ensure log output doesn't affect core logic (logs should be fire-and-forget).

## Missing Critical Features

**No automated rollback for bad migrations:**
- Problem: If migration 0012 (origen_cobertura) is applied and causes a performance regression, there's no automated rollback. Manual SQL revert is required.
- Blocks: Any attempt to auto-scale or auto-retry migrations in CI/CD.

**No experiment/feature flag system:**
- Problem: Testing new crawl sources, new matching rules, or new client configs requires branching code or creating new scripts. Can't A/B test changes.
- Blocks: Iterative improvement of keyword matching, source detection, etc. requires manual coordination.

**No centralized configuration service:**
- Problem: Client settings, media configs, keyword rules are scattered across `src/config/`, Supabase tables, and Google Sheets. Changing a setting requires multiple updates.
- Blocks: Dynamic reconfiguration of tiers, easy onboarding of new clients, and testing of config changes.

**No unified monitoring/alerting dashboard:**
- Problem: System health is spread across: script logs, Supabase data, Google Sheets tabs, and email/console output. Hard to spot failures at a glance.
- Blocks: Quick diagnosis of outages. Requires manual review of multiple data sources.

**No shadow-to-production promotion workflow:**
- Problem: Shadow results are observed manually. Decision to promote results to real production is manual and undocumented.
- Blocks: Cannot automatically promote Jumex from staging (NO-GO) to production after readiness criteria are met. Same for Mery Pozos upgrade from shadow to real.

## Test Coverage Gaps

**Integration tests for multi-step pipelines:**
- What's not tested: End-to-end flow of crawl → detect → enrich → export for a real medium with real data.
- Files: `test/` directory has 71 test files but most are unit tests. Missing integration tests in `test/integration/` (directory doesn't exist).
- Risk: A change to crawl logic might break export output (no test catches it until production).
- Priority: High

**Failure recovery and resumption:**
- What's not tested: What happens if crawl fails partway (e.g., fetch timeout). Can the script resume? Or must you restart from scratch?
- Files: `scripts/run-shadow-*.ts`, `scripts/crawl.ts`
- Risk: Long-running jobs fail silently. User reruns manually, causing duplicates.
- Priority: High

**Google Sheets edge cases (429, timeout, quota exceeded):**
- What's not tested: Sheet write behavior under rate limiting. Current code has warnings but no verification that retries actually work.
- Files: `src/sheets/write.ts`, `src/sheets/client.ts`
- Risk: Mismatch between 05 and 07 tabs goes undetected if sheet write partially succeeds.
- Priority: Medium

**Multi-client simultaneous execution:**
- What's not tested: What if Patrón production and Mery Pozos shadow run at the same time and both write to the same output sheet tab?
- Files: Multiple `run-shadow-*.ts`, `run-patron-no-pc-production-capture.ts`
- Risk: Data corruption or missed updates in Sheets.
- Priority: Medium

**Direct crawler source filtering:**
- What's not tested: crawl-direct-* scripts with `--limit=N` and dedup. Edge case: what if URL pattern changes and old URLs are already in DB?
- Files: `scripts/crawl-direct-*.ts`
- Risk: Dedup might block legitimate new URLs if URL normalization changes.
- Priority: Low

---

*Concerns audit: 2026-07-28*
