# Coding Conventions

**Analysis Date:** 2026-07-28

## Naming Patterns

**Files:**
- TypeScript modules: `kebab-case.ts` (e.g., `shadow-guard.ts`, `date-window.ts`)
- Test files: `{subject}.test.ts` in `/test` directory (e.g., `chunk.test.ts`, `validation.test.ts`)
- Configuration and utility files: `kebab-case.ts` or simple names (e.g., `env.ts`, `logger.ts`)
- Directory names: `kebab-case` or `camelCase` depending on module (e.g., `src/ai`, `src/comparators`, `src/shadow-alerts`)

**Functions:**
- camelCase with Spanish naming (e.g., `ejecutarPorLotes`, `normalizeTituloFuerte`, `chunkArray`)
- Internal helper functions: simple, descriptive camelCase (e.g., `buscarTermino`, `snippet`)
- Factory/factory functions in tests: lowercase, simple names (e.g., `input()`, `medio()`, `probe()`, `envFull()`)
- Public exported functions: camelCase with clear intent (e.g., `matchKeyword`, `clusterizar`, `estadoDiagnostico`)

**Variables:**
- Local variables: camelCase with Spanish or English (e.g., `procesados`, `foldedFull`, `usarGateTequilaCli0002`)
- Constants: UPPERCASE_SNAKE_CASE (e.g., `UMBRAL_CLUSTER`, `MIN_MEDIOS_SINDICADO`, `PREFIJOS_COLUMNA`, `TOKENS_RELEVANTES`)
- Loop counters: simple `i`, `j` (e.g., `for (let i = 0; i < lotes.length; i++)`)
- Destructured objects: camelCase (e.g., `{ desde, hasta }`, `{ error }`)

**Types and Interfaces:**
- Interfaces: PascalCase (e.g., `KeywordRule`, `CampoBuscable`, `MatchResultado`, `Cluster`, `NoticiaRawRow`)
- Type aliases: PascalCase (e.g., `TipoKeyword`, `ClusterStatus`, `ClassifyInput`)
- Type unions: PascalCase variants with `|` separator (e.g., `'exacta' | 'frase_exacta' | 'contiene'`)
- Database field names in interfaces: snake_case (e.g., `noticia_id`, `fecha_publicacion`, `cliente_id`, `keyword_alerta`)
- Generic type parameters: single uppercase letter or PascalCase (e.g., `<T>`, `<RunFn>`)

## Code Style

**Formatting:**
- No automatic formatter (ESLint/Prettier not configured) — style is manual
- Indentation: 2 spaces (TypeScript default)
- Line length: ~120 characters (observe existing files)
- String quotes: single quotes `'` for strings
- Semicolons: Always use semicolons at end of statements
- Trailing commas: Use trailing commas in multiline objects/arrays for clarity

**Linting:**
- TypeScript strict mode: Enabled (`strict: true` in `tsconfig.json`)
- Strict compiler options in place:
  - `noUncheckedIndexedAccess: true` — array/object access must check bounds
  - `noImplicitOverride: true` — must explicitly mark `override` in subclasses
  - `forceConsistentCasingInFileNames: true` — case-sensitive file imports
- No ESLint or Prettier configuration — rely on TypeScript compiler

## Import Organization

**Order:**
1. External dependencies (e.g., `import pino from 'pino'`, `import { z } from 'zod'`)
2. Node modules (e.g., `import 'dotenv/config'`)
3. Internal absolute imports using `@/` alias (e.g., `import { logger } from '@/utils/logger.js'`)
4. Internal relative imports (e.g., `import { chunkArray } from '../utils/chunk.js'`)
5. Type imports (e.g., `import type { ResultadoLote } from '../types.js'`)

**Path Aliases:**
- `@/*` maps to `src/*` (defined in `tsconfig.json`)
- Use relative imports within same module; use `@/` for cross-module imports
- Always include `.js` extension in imports (ES modules)

**Example pattern from `src/config/env.ts`:**
```typescript
import 'dotenv/config';  // Side effect import
import { z } from 'zod'; // External dependency
// (no internal imports in this file)
```

**Example pattern from `src/matchers/keyword.ts`:**
```typescript
import { foldText, indexOfWord, indexOfSubstring, anyWordPresent } from './text.js';
import { evalBoolean, operandsOf } from './boolean.js';
import {
  pasaPuertaContextualClienteKeyword,
  esKeywordTequilaAmpliaCli0002,
  esKeywordJumexAmpliaCli0001,
} from '../matching/contextualKeywordRules.js';
```

## Error Handling

**Patterns:**
- Throw `Error` for general failures with clear messages
- Custom error classes extend `Error` with explicit `name` property (see `MissingEnvError` in `src/config/env.ts`)
- Use optional chaining (`?.`) and nullish coalescing (`??`) for safe property access
- Use non-null assertion (`!`) only after null checks (e.g., `lote[i]!` after `for (let i = 0; i < lotes.length; i++)`)

**Error Messages:**
- Spanish language throughout (matches codebase intent)
- Include context: what failed, why, and suggested fix
- Example from `src/utils/chunk.ts`: `"chunkArray: size debe ser un entero > 0 (recibido: ${size})."`
- Example from `src/config/env.ts`: `"Variables de entorno inválidas:\n${issues}\n..."`

**Validation:**
- Use `Zod` for schema validation (`z.object()`, `z.string()`, `z.enum()`, `safeParse()`)
- Check `.success` on parsed result: `if (!parsed.success) { throw ... }`
- Extract issues with `.error.issues` for detailed messages

## Logging

**Framework:** Pino (configured in `src/utils/logger.ts`)

**Patterns:**
- Import singleton: `import { logger } from '@/utils/logger.js'`
- Create child loggers with context: `logger.child({ run_by: 'script' })`
- Log levels: `trace`, `debug`, `info`, `warn`, `error` (configured in `LOG_LEVEL` env var)
- Format: `pretty` (development) or `json` (CI/Actions) based on `LOG_FORMAT` env var
- Never log secrets; all logging must filter environment variables

**Usage pattern:**
```typescript
import { logger } from '@/utils/logger.js';

logger.info('Processing started', { batchSize: 200 });
logger.error('Failed to process batch', { error: e.message, batch_index: 2 });
```

## Comments

**When to Comment:**
- Comment *why*, not *what* — code shows what; comments explain intent
- Use for complex business logic (e.g., keyword matching rules, clustering thresholds)
- Document non-obvious algorithms or hardcoded values
- Mark regressing behavior with context and date (e.g., `// Regresión Lote 4: ...`)

**JSDoc/TSDoc:**
- Use `/**` blocks for public functions and exports
- Include one-sentence summary on first line
- Add parameter descriptions if behavior is non-obvious
- Include example if pattern is repeated elsewhere

**Example from `src/utils/chunk.ts`:**
```typescript
/**
 * Parte `items` en sublistas de como máximo `size` elementos.
 */
export function chunkArray<T>(items: readonly T[], size: number): T[][] {
```

**Example from `src/utils/dateWindow.ts`:**
```typescript
/**
 * Ejecuta `run` sobre cada lote de `items` (tamaño `batchSize`), en orden.
 *
 * - Lista vacía → no ejecuta `run` y devuelve 0.
 * - Lista <= batchSize → un solo lote (una sola llamada a `run`).
 * - Si un lote devuelve `error`, lanza con el índice del lote...
 */
```

## Function Design

**Size:** Functions are typically 20–50 lines; longer functions are split into helpers
  - Helper functions: 5–20 lines, focused on single task
  - Public functions: 20–60 lines with clear sections
  - Example: `matchKeyword()` in `src/matchers/keyword.ts` is ~70 lines with clear nested logic

**Parameters:**
- Prefer named object parameters for functions with 3+ parameters
- Use `readonly` for array parameters to prevent accidental mutation
- Generic types for flexibility (e.g., `<T>` in `chunkArray`)
- Type your parameters; no implicit `any`

**Return Values:**
- Return early to reduce nesting
- Return `null` explicitly for "no result" cases (not `undefined`)
- Use union types for optional returns (e.g., `MatchResultado | null`)
- Async functions return `Promise<T>`; use `await` at call sites

**Example from `src/utils/chunk.ts`:**
```typescript
export function chunkArray<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error(`...`);
  }
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
```

## Module Design

**Exports:**
- Export only public API; keep helpers private
- Use `export` for functions; use `export const` for constants and singletons
- Use `export type` or `export interface` for types
- Re-export from barrel files when organizing related types (e.g., `src/types/` index)

**Barrel Files:**
- Limited use; prefer direct imports from specific files
- When used, named exports only (avoid `export *` for clarity)

**Example from `src/matchers/keyword.ts`:**
```typescript
export type TipoKeyword = 'exacta' | 'frase_exacta' | 'contiene' | 'booleana' | 'exacta_contextual';
export interface KeywordRule { ... }
export interface CampoBuscable { ... }
export interface MatchResultado { ... }
export const PESOS_CAMPO: Record<string, number> = { ... };
export function matchKeyword(...): MatchResultado | null { ... }
```

## Language Conventions

**Spanish vs. English:**
- Function names: Spanish (e.g., `ejecutarPorLotes`, `normalizaTitulo`, `contieneTokenRelevante`)
- Variable names: Spanish (e.g., `procesados`, `lotes`, `titulo`)
- Type/interface names: Mixed (Spanish for domain concepts, English for technical types)
- Comments and docstrings: Spanish
- Error messages: Spanish
- Test descriptions: Spanish (e.g., `"divide 831 IDs en 5 lotes de 200"`)

## Null Handling

**Pattern:**
- Use `?? null` to explicitly set null defaults (not `undefined`)
- Use `??` for optional chaining with fallbacks
- Use `?.` for safe property access
- Check with `if (!value)` or `if (value === null)` depending on context

**Example from `src/types/noticia.ts`:**
```typescript
export function mapNoticiaRaw(n: any): NoticiaRawRow {
  return {
    fecha_publicacion: n.fecha_publicacion ?? null,
    medio: n.medios?.nombre_medio ?? null,
    // ... more fields
  };
}
```

---

*Convention analysis: 2026-07-28*
