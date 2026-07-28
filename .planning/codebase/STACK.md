# Technology Stack

**Analysis Date:** 2026-07-28

## Languages

**Primary:**
- TypeScript 5.6 - All application code, scripts, workers (strict mode with noUncheckedIndexedAccess and noImplicitOverride)

**Secondary:**
- SQL - PostgreSQL schema and migrations in `supabase/migrations/`
- YAML - GitHub Actions workflow definitions in `.github/workflows/`

## Runtime

**Environment:**
- Node.js 20+ (required in package.json engines field)

**Package Manager:**
- npm - lockfile `package-lock.json` present

## Frameworks

**Core Data/API:**
- `@supabase/supabase-js` 2.45.0 - PostgreSQL database client with Service Role Key authentication
- `google-spreadsheet` 4.1.4 - Google Sheets API wrapper for configuration management
- `google-auth-library` 9.14.0 - JWT-based service account authentication for Sheets

**Web Scraping & Parsing:**
- `cheerio` 1.2.0 - HTML parsing and CSS selectors for web scraping
- `rss-parser` 3.13.0 - RSS/Atom feed parsing
- `fast-xml-parser` 4.5.6 - XML parsing utility

**XML Generation:**
- `xmlbuilder2` 3.1.1 - Programmatic XML document creation
- `fast-xml-parser` 4.5.6 - XML serialization

**AI Integration:**
- `@anthropic-ai/sdk` 0.69.0 - Anthropic Claude API for mention classification (Phase 7, currently optional)

**Notifications:**
- `nodemailer` 6.10.1 - SMTP email transport (dynamically imported, safe by default)

**Logging:**
- `pino` 9.4.0 - Structured JSON logging
- `pino-pretty` 11.2.2 - Human-readable console output for development

**Utilities:**
- `luxon` 3.5.0 - Date/time manipulation and formatting
- `zod` 3.23.8 - Schema validation with type inference
- `dotenv` 16.4.5 - Environment variable loading
- `ws` 8.21.0 - WebSocket client (for future integrations)

**Build & Dev:**
- `tsx` 4.19.0 - TypeScript execution runtime for scripts
- `typescript` 5.6.0 - TypeScript compiler (strict mode)
- `vitest` 4.1.8 - Test runner and framework
- `wrangler` 3.78.0 - Cloudflare Workers development and deployment CLI
- `@cloudflare/workers-types` 4.20240909.0 - TypeScript types for Cloudflare Workers

## Configuration

**Environment:**
- `.env.example` - Template with all required and optional variables
- Secrets managed via GitHub Actions secrets (Supabase, Google, Anthropic, SMTP, tokens)
- `.dev.vars` in worker directory for local Cloudflare development (in .gitignore)

**Build:**
- `tsconfig.json`:
  - Target: ES2022
  - Module resolution: Bundler
  - Path alias: `@/*` → `src/*`
  - Strict mode enabled
  - Output: `dist/` (not committed)
- `worker/tsconfig.json` - Separate config for Cloudflare Workers code
- `worker/wrangler.toml` - Worker deployment configuration with Node.js compatibility flag

**Type Checking:**
- `npm run typecheck` - Full TypeScript validation across `src/`, `scripts/`, `test/`
- `npm run worker:typecheck` - Separate validation for worker code

## Platform Requirements

**Development:**
- Node.js 20 or later
- npm 10+ (inferred from package.json format)
- TypeScript 5.6 type checking support
- Git for version control

**Production:**
- GitHub Actions: Ubuntu 20.04+ runners (node-20 setup)
- Cloudflare Workers: Compatibility date 2024-09-23, with nodejs_compat flag
- PostgreSQL database (via Supabase)
- Google Cloud: Service account with Sheets API access
- Anthropic API access (for Phase 7, optional)
- SMTP server (for email alerts, optional)

## Entry Points

**Scripts:**
- Located in `scripts/` directory
- Executed via `tsx <script-name>.ts`
- All scripts are managed as npm run commands in package.json
- Examples: `npm run crawl`, `npm run detect-mentions`, `npm run generate-xml`

**Worker:**
- `worker/src/index.ts` - HTTP endpoint `/read-xml` served by Cloudflare Workers
- Deployed via `npm run worker:deploy`
- Supports local development via `npm run worker:dev`

## Testing

**Framework:** vitest 4.1.8
- Run tests: `npm test`
- Test files: `test/**/*.ts`
- Excluded from TypeScript root config (separate validation)

---

*Stack analysis: 2026-07-28*
