---
name: testing-guide
description: Use when writing tests, running the test suite, or understanding test patterns. Covers Vitest configuration, test file placement, running tests, mocking patterns, and testing conventions for this project.
metadata:
  version: "1.0"
---

# Testing Guide

## Framework

**Vitest 4.x** with Node environment and forked process pool.

## Configuration

### Unit Tests (`vitest.config.ts`)

```typescript
export default defineConfig({
  test: {
    globals: true,        // describe, it, expect available without imports
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000,  // 30 seconds
    pool: 'forks',        // forked processes for isolation
  },
});
```

### E2E Tests (`vitest.e2e.config.ts`)

- Pattern: `src/__tests__/e2e/**/*.e2e.test.ts`
- Timeout: 600 seconds (10 minutes)
- Same pool and environment settings

## Test File Placement

Tests are **colocated** with source code:

```
src/
├── features/
│   └── credits/
│       ├── wallet.ts
│       └── __tests__/
│           └── wallet.test.ts
├── middleware/
│   ├── auth.ts
│   └── __tests__/
│       └── auth.test.ts
└── validation/
    ├── index.ts
    └── __tests__/
        └── index.test.ts
```

**Convention**: Place test files in a `__tests__/` subdirectory next to the source, named `<module>.test.ts`.

E2E tests go in `src/__tests__/e2e/` with the `.e2e.test.ts` suffix.

## Running Tests

| Command | Purpose |
|---|---|
| `yarn test` | Run all unit tests once (`vitest run`) |
| `yarn test:watch` | Run tests in watch mode (`vitest`) |
| `yarn test:e2e` | Run E2E tests (`vitest run --config vitest.e2e.config.ts`) |

### Filtering

```bash
# Run tests matching a pattern
yarn test -- --reporter=verbose -t "credit"

# Run a specific file
yarn test -- src/features/credits/__tests__/wallet.test.ts
```

## Writing Tests

### Basic Test Structure

Vitest globals are enabled — no need to import `describe`, `it`, `expect`:

```typescript
describe('CreditWallet', () => {
  it('deducts credits for agent usage', () => {
    const wallet = new CreditWallet(1000);
    wallet.deduct(50);
    expect(wallet.balance).toBe(950);
  });

  it('throws when insufficient credits', () => {
    const wallet = new CreditWallet(10);
    expect(() => wallet.deduct(50)).toThrow(CreditsExhaustedError);
  });
});
```

### Testing Zod Schemas

```typescript
import { CreditUsageQuerySchema } from '../../validation';

describe('CreditUsageQuerySchema', () => {
  it('applies defaults', () => {
    const result = CreditUsageQuerySchema.parse({});
    expect(result.period).toBe('30d');
    expect(result.groupBy).toBe('day');
  });

  it('rejects invalid period', () => {
    expect(() => CreditUsageQuerySchema.parse({ period: '1y' })).toThrow();
  });
});
```

### Testing Validation Helpers

```typescript
import { parseBody } from '../../validation';

describe('parseBody', () => {
  it('returns ok with valid data', () => {
    const result = parseBody(z.object({ name: z.string() }), { name: 'test' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.name).toBe('test');
  });

  it('returns error response with invalid data', () => {
    const result = parseBody(z.object({ name: z.string() }), { name: 123 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(400);
  });
});
```

### Testing Error Classes

```typescript
import { NotFoundError, toErrorResponse } from '../../errors';

describe('NotFoundError', () => {
  it('formats with resource and id', () => {
    const err = new NotFoundError('Application', 'abc-123');
    const { body, status } = toErrorResponse(err);
    expect(status).toBe(404);
    expect(body.error).toBe('NOT_FOUND');
    expect(body.message).toContain('abc-123');
  });
});
```

### Mocking

Use Vitest's built-in mocking:

```typescript
import { vi } from 'vitest';

// Mock a module
vi.mock('../../config', () => ({
  config: { databaseUrl: 'postgres://test', port: 9090 },
}));

// Spy on a function
const spy = vi.spyOn(wallet, 'deduct');
wallet.deduct(50);
expect(spy).toHaveBeenCalledWith(50);
```

### Testing the DI Container

```typescript
import { initContainer, resetContainer } from '../../container';

describe('Container', () => {
  afterEach(() => resetContainer());

  it('provides config', () => {
    const container = initContainer(testConfig);
    expect(container.get('config')).toBe(testConfig);
  });
});
```

## CI Integration

Tests run automatically on push/PR to `main` via GitHub Actions (`.github/workflows/test.yml`):
- Node 22
- `yarn install --frozen-lockfile`
- `yarn test`

The pre-commit hook also runs `npm test` before every commit.
