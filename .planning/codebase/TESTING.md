# Testing Patterns

**Analysis Date:** 2026-07-28

## Test Framework

**Runner:**
- Vitest 4.1.8
- Config: No explicit configuration file; uses TypeScript config from `tsconfig.json`
- Works with ES modules by default (matches package.json `"type": "module"`)

**Assertion Library:**
- Vitest's built-in `expect()` API

**Run Commands:**
```bash
npm test                 # Run all tests
npm run typecheck       # Verify TypeScript compilation (no runtime)
```

**Package versions:**
- `vitest@4.1.8` — test runner and framework
- `@types/node@20.16.0` — Node.js type definitions for testing utilities
- `tsx@4.19.0` — TypeScript executor used for scripts

## Test File Organization

**Location:**
- All tests co-located in `/test` directory at project root
- Not co-located with source files (separate test directory)
- `/test/` is included in `tsconfig.json` compiler options

**Naming:**
- Pattern: `{feature-or-module}.test.ts`
- Examples: `chunk.test.ts`, `validation.test.ts`, `shadow-alerts.test.ts`, `contextual-keyword-rules.test.ts`
- 71 test files total (as of last count)

**File count by directory:**
- All `.test.ts` files live directly in `/test/` (no subdirectories)
- Test file names map directly to source modules they test
- Example: `test/chunk.test.ts` tests `src/utils/chunk.ts`

## Test Structure

**Suite Organization:**
```typescript
import { describe, it, expect } from 'vitest';
import { functionToTest } from '../src/module/path.js';

describe('Module or function name', () => {
  it('should do specific thing when condition X', () => {
    expect(result).toBe(expected);
  });

  it('should handle edge case Y', () => {
    expect(result).toEqual(expected);
  });
});
```

**Patterns:**

1. **Single responsibility per `it` block:**
   - One assertion per test (or tightly related assertions)
   - Descriptive test name explains what is being tested
   - Names are in Spanish and describe the expected behavior

2. **Setup in describe block or test helper functions:**
   - Avoid `beforeEach` / `afterEach` hooks
   - Instead, create factory functions for test data
   - Example from `test/chunk.test.ts`:
     ```typescript
     type RunFn = (lote: string[], index: number, total: number) => Promise<ResultadoLote>;
     const ok: RunFn = async () => ({ error: null });
     ```

3. **Grouped describe blocks:**
   - Group related tests with shared context
   - Each describe handles one function or behavior area
   - Example from `test/date-window.test.ts`:
     ```typescript
     describe('esSoloFecha', () => { ... });
     describe('inicio/fin de día MX', () => { ... });
     describe('normalizarVentanaTimestamp', () => { ... });
     ```

## Test Structure Examples

**Basic unit test:**
```typescript
describe('chunkArray', () => {
  it('divide 831 IDs en 5 lotes de 200 (último de 31)', () => {
    const ids = Array.from({ length: 831 }, (_, i) => `id-${i}`);
    const lotes = chunkArray(ids, 200);
    expect(lotes).toHaveLength(5);
    expect(lotes.slice(0, 4).every((l) => l.length === 200)).toBe(true);
    expect(lotes[4]).toHaveLength(31);
  });
});
```

**Error testing:**
```typescript
describe('ejecutarPorLotes', () => {
  it('si un lote falla, reporta el lote específico y no oculta parciales', async () => {
    const ids = Array.from({ length: 831 }, (_, i) => `id-${i}`);
    const run = vi.fn(async (_lote: string[], index: number): Promise<ResultadoLote> =>
      index === 2 ? { error: { message: 'URI too long' } } : { error: null },
    );
    await expect(ejecutarPorLotes(ids, 200, run)).rejects.toThrow(/lote 3\/5/);
    await expect(ejecutarPorLotes(ids, 200, run)).rejects.toThrow(/URI too long/);
  });
});
```

**Async function testing:**
```typescript
describe('createSmtpTransport', () => {
  it('entorno vacío => transport null', async () => {
    const cfg = loadNotificationConfig({}, '');
    const { transport, reason } = await createSmtpTransport(cfg, {});
    expect(transport).toBeNull();
    expect(reason).toBe('send_alerts_disabled');
  });
});
```

## Mocking

**Framework:** Vitest's `vi` module (imported from `'vitest'`)

**Patterns:**

1. **Function mocking with `vi.fn()`:**
   ```typescript
   const ok: RunFn = async () => ({ error: null });
   const run = vi.fn<RunFn>(ok);
   
   // After calling the function:
   expect(run).toHaveBeenCalledTimes(5);
   expect(run.mock.calls[0]?.[1]).toBe(0); // Check first argument of first call
   ```

2. **Mocking with type annotations:**
   ```typescript
   const run = vi.fn<RunFn>(async (lote, index) => ({ error: null }));
   ```

3. **Inspecting mock calls:**
   ```typescript
   expect(run).toHaveBeenCalledTimes(5);
   expect(run.mock.calls[0]?.[1]).toBe(0);      // Check first call, second arg
   expect(run.mock.calls[4]?.[0].length).toBe(31); // Check batch size
   ```

**What to Mock:**
- External dependencies (APIs, databases, file systems) — not mocked in tests (tests avoid network/DB)
- Callback functions passed to tested functions
- Dependencies that would slow down tests or require setup

**What NOT to Mock:**
- Pure utility functions (string manipulation, math, normalization)
- Data transformation functions
- Business logic that needs validation
- Validation and schema checking (Zod parsing is real)

**Example of what NOT to mock (from tests):**
- `normalizeTitulo()` is tested as-is, not mocked
- `Zod` schemas are tested with real validation, not mocked
- Array manipulation functions are tested without mocks

## Fixtures and Factories

**Test Data:**
Test data is created with factory functions that accept overrides:

```typescript
function input(over: Partial<ClassifyInput> = {}): ClassifyInput {
  return {
    titulo: over.titulo ?? 'Tequila premium crece en exportaciones',
    resumen: over.resumen ?? 'La marca reporta un alza.',
    medio: over.medio ?? 'El Universal',
    keyword: over.keyword ?? 'tequila',
    cliente: over.cliente ?? 'Jumex',
    // ... more fields
    ...over,  // Override with passed values
  };
}
```

**Factory patterns (from test files):**
1. Function name: lowercase, simple (e.g., `input()`, `medio()`, `probe()`, `envFull()`)
2. Parameter: `Partial<T>` to allow partial overrides
3. Return: Fully constructed test object with defaults
4. Use: `input({ titulo: 'Custom title' })` to override specific fields

**Location:**
- Factories are defined at the top of test files, before describe blocks
- Reused across multiple tests in the same file
- Not shared across multiple test files (each file is independent)

**Example from `test/contextual-keyword-rules.test.ts`:**
```typescript
function campos(parts: Partial<Record<string, string>>): CampoBuscable[] {
  return [
    { nombre: 'titulo', texto: parts.titulo ?? '', peso: PESOS_CAMPO.titulo! },
    { nombre: 'subtitulo', texto: parts.subtitulo ?? '', peso: PESOS_CAMPO.subtitulo! },
    // ... more fields
  ];
}

function reglaComercio(keyword: string, cliente_id = 'CLI-0002'): KeywordRule {
  return {
    keyword_id: 'k', cliente_id, keyword,
    terminos: [keyword], tipo: 'contiene', regla: null,
    contextoIncluir: [], contextoExcluir: [],
  };
}
```

## Coverage

**Requirements:** Not enforced (no coverage threshold configured)

**View Coverage:**
```bash
# Coverage reporting not configured in current setup
# To add: would require --coverage flag in vitest config
```

**Current state:**
- 71 test files
- 1320+ individual test cases (estimated from `npm test` output)
- No coverage threshold enforced; relies on developer discipline

## Test Types

**Unit Tests:** (Primary testing approach)
- Scope: Single function or module
- Approach: Test pure functions with various inputs and edge cases
- Isolation: No external dependencies (DB, network, file I/O)
- Speed: < 100ms per test
- Examples: `test/chunk.test.ts`, `test/date-window.test.ts`, `test/validation.test.ts`

**Integration Tests:** (Limited, focused on data transformation)
- Scope: Multiple modules working together
- Approach: Test data flows between modules without hitting real APIs
- Examples: `test/shadow-alerts.test.ts` (tests alert rule evaluation), `test/cluster.test.ts` (tests clustering logic with realistic data)
- Note: Tests avoid actual Supabase/Sheets calls

**E2E Tests:** Not used
- No E2E test framework configured
- Manual testing via scripts (e.g., `npm run test:connection`, `npm run healthcheck`)

## Common Patterns

**Async Testing:**
```typescript
// Using await with async functions
it('procesa 831 IDs en varios lotes', async () => {
  const ids = Array.from({ length: 831 }, (_, i) => `id-${i}`);
  const run = vi.fn<RunFn>(ok);
  const total = await ejecutarPorLotes(ids, 200, run);
  expect(total).toBe(831);
});

// Using expect(...).rejects.toThrow() for error cases
await expect(ejecutarPorLotes(ids, 200, run)).rejects.toThrow(/lote 3\/5/);
```

**Error Testing:**
```typescript
// Test that errors are thrown with expected messages
it('lanza si size <= 0 o no es entero', () => {
  expect(() => chunkArray([1], 0)).toThrow();
  expect(() => chunkArray([1], -5)).toThrow();
  expect(() => chunkArray([1], 1.5)).toThrow();
});

// Test error message content
it('rechaza enums fuera de dominio', () => {
  const bad = { sentimiento: 'muy positivo', /* ... */ };
  expect(ClasificacionSchema.safeParse(bad).success).toBe(false);
});
```

**Parametrized Tests with for loops:**
```typescript
describe('CLI-0002 comercio DEBE bloquear (sin bebidas)', () => {
  const casos: [string, string][] = [
    ['T-MEC', 'Trump no rompe el T-MEC, lo desgasta'],
    ['aranceles', 'Nuevos aranceles a los autos y al acero de China'],
    // ... more cases
  ];
  for (const [kw, titulo] of casos) {
    it(`bloquea "${kw}" en: ${titulo}`, () => {
      const res = matchKeyword(reglaComercio(kw), campos({ titulo }));
      expect(res).toBeNull();
    });
  }
});
```

**Null/Undefined Testing:**
```typescript
// Testing null returns
it('lista vacía → sin lotes', () => {
  expect(chunkArray([], 200)).toEqual([]);
});

// Testing null vs non-null
it('sin destinatarios internos => null', async () => {
  const { transport, reason } = await createSmtpTransport(...);
  expect(transport).toBeNull();
  expect(reason).toBe('no_internal_recipients');
});

it('con TODO habilitado construye transporte', async () => {
  const { transport, reason } = await createSmtpTransport(...);
  expect(reason).toBe('ok');
  expect(transport).not.toBeNull();
});
```

**Zod Schema Validation Testing:**
```typescript
it('valida una clasificación bien formada', () => {
  const ok: Clasificacion = { /* ... */ };
  expect(ClasificacionSchema.safeParse(ok).success).toBe(true);
});

it('rechaza enums fuera de dominio', () => {
  const bad = { sentimiento: 'muy positivo', /* ... */ };
  expect(ClasificacionSchema.safeParse(bad).success).toBe(false);
});
```

## Best Practices

1. **Name tests as complete sentences in Spanish:**
   - Good: `"bloquea 'aranceles' sin contexto de bebidas"`
   - Bad: `"test bloquea"`

2. **One assertion per test (or tightly grouped):**
   - Good: `expect(res).toBeNull(); expect(puerta.pasa).toBe(false);` (related)
   - Avoid: Mixing unrelated assertions in one test

3. **Use factory functions for test data:**
   - Consistent test setup
   - Easy to add variations
   - Example: `input({ titulo: 'Custom' })` overrides one field

4. **Test edge cases explicitly:**
   - Empty lists: `[]`
   - Boundary values: `0`, `1`, `size - 1`, `size`
   - Out-of-range: `negative`, `too large`
   - Null/undefined: `null`, `undefined`, `?.` chains

5. **Avoid logic in tests:**
   - Tests should be straightforward; push logic to source code
   - If test setup is complex, extract to a helper function

6. **Test business rules, not implementation:**
   - Example from `test/shadow-alerts.test.ts`: Test that sentiment + valuation triggers alerts, not that specific lines execute

## Common Assertions

| Assertion | Purpose | Example |
|-----------|---------|---------|
| `expect(x).toBe(y)` | Strict equality (`===`) | `expect(result).toBe(5)` |
| `expect(x).toEqual(y)` | Deep equality | `expect(array).toEqual([1, 2, 3])` |
| `expect(x).toHaveLength(n)` | Array/string length | `expect(arr).toHaveLength(5)` |
| `expect(x).toBeNull()` | Explicitly null | `expect(transport).toBeNull()` |
| `expect(x).not.toBeNull()` | Explicitly not null | `expect(transport).not.toBeNull()` |
| `expect(x).toContain(y)` | Substring/item in array | `expect(str).toContain('error')` |
| `expect(() => fn()).toThrow()` | Function throws | `expect(() => chunkArray([1], 0)).toThrow()` |
| `expect(fn).toHaveBeenCalled()` | Mock called | `expect(run).toHaveBeenCalled()` |
| `expect(fn).toHaveBeenCalledTimes(n)` | Mock call count | `expect(run).toHaveBeenCalledTimes(5)` |
| `await expect(...).rejects.toThrow()` | Async rejection | `await expect(promise).rejects.toThrow()` |

---

*Testing analysis: 2026-07-28*
