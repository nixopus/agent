---
name: code-conventions
description: Use when writing new code, renaming files, adding imports, creating error classes, or reviewing code style. Covers file naming, export naming, import patterns, validation helpers, and error handling conventions for this project.
metadata:
  version: "1.0"
---

# Code Conventions

## File & Directory Naming

All source files use **kebab-case**: `deploy-agent.ts`, `app-middleware.ts`, `credit-gate.ts`.

Directories also use kebab-case and are organized by responsibility:

```
src/
├── engine/              # Mastra entry point, agents, tools
│   ├── agents/          # Agent definitions
│   ├── tools/           # Tool implementations (grouped by domain)
│   │   ├── api/         # Nixopus API wrappers
│   │   ├── codebase/    # Codebase analysis tools
│   │   ├── deploy/      # Deployment tools
│   │   ├── diagnostics/ # HTTP probes, debug tools
│   │   ├── github/      # GitHub operations
│   │   └── shared/      # Tool wrappers (compact output, schema guard)
│   └── workspace-factory.ts
├── features/            # Vertical slices (routes + domain logic)
│   ├── credits/         # Credit wallet, tracking, routes
│   ├── workspace/       # S3 workspace, routes
│   ├── incidents/       # Incident management
│   └── inference/       # LLM inference
├── middleware/           # HTTP pipeline (CORS, auth, rate limit, etc.)
├── db/                  # Drizzle + PostgreSQL pool, schema
├── cache/               # Redis/Postgres cache factory, pub/sub
├── observability/       # Metrics and routes
├── util/                # Orchestrators, GitHub client, SSH helpers
├── logger/              # Pino logger factory
├── errors/              # AppError hierarchy
├── types/               # Shared TypeScript types
├── validation/          # Zod schemas and parse helpers
├── config.ts            # Environment-based configuration
├── secrets.ts           # Secret definitions
├── init-secrets.ts      # Secret bootstrap
└── container.ts         # rsdi DI container
```

## Export Naming

- **Exported values**: camelCase — `deployAgent`, `creditRoutes`, `getContainer`
- **Agent string IDs**: kebab-case — `'deploy-agent'`, `'diagnostic-agent'`
- **Classes**: PascalCase — `AppError`, `ValidationError`, `RateLimitError`
- **Types/Interfaces**: PascalCase — `AppConfig`, `AppContainer`, `DbInstance`
- **Constants**: camelCase or UPPER_SNAKE — `MAX_DELEGATION_ITERATIONS`, `diagnosticCoreTools`

## Module System

- ESM: `"type": "module"` in `package.json`
- TypeScript: `strict: true`, `module: "ES2022"`, `target: "ES2022"`, `moduleResolution: "bundler"`
- `noEmit: true` — Mastra handles bundling, TypeScript only typechecks
- No explicit `.ts` extensions in import paths (bundler resolution)

## Import Conventions

- **Relative imports** between features and shared layers: `../../config`, `../../errors`
- **SDK imports**: `@mastra/core/agent`, `@mastra/core/mastra`, `@mastra/memory`, `@mastra/pg`
- **Third-party**: `zod`, `drizzle-orm`, `rsdi`, `ai`, `@ai-sdk/*`
- **Type-only imports**: use `import type { ... }` for types not needed at runtime

## Validation with Zod

All request validation uses Zod schemas with three helpers in `src/validation/index.ts`:

```typescript
// Returns { ok: true, data: T } or { ok: false, response: Response }
const body = parseBody(MySchema, rawBody);
if (!body.ok) return body.response;
// body.data is typed as T

const query = parseQuery(QuerySchema, params);
const params = parseParams(ParamsSchema, routeParams);
```

Define schemas alongside their consumers. Shared schemas live in `src/validation/index.ts`.

## Error Handling

Custom error hierarchy in `src/errors/index.ts` — all extend `AppError`:

| Error Class | HTTP Status | Code |
|---|---|---|
| `ValidationError` | 400 | `VALIDATION_ERROR` |
| `AuthenticationError` | 401 | `AUTH_REQUIRED` |
| `CreditsExhaustedError` | 402 | `CREDITS_EXHAUSTED` |
| `NotFoundError` | 404 | `NOT_FOUND` |
| `ConflictError` | 409 | `CONFLICT` |
| `RateLimitError` | 429 | `RATE_LIMITED` |
| `ConcurrencyLimitError` | 429 | `CONCURRENCY_LIMITED` |
| `ConfigError` | 500 | `CONFIG_ERROR` |
| `ExternalServiceError` | 502 | `EXTERNAL_SERVICE_ERROR` |

Convert errors to HTTP responses:

```typescript
import { errorResponse, toErrorResponse, NotFoundError } from '../errors';

// In route handlers — returns a Response object
return errorResponse(new NotFoundError('Application', appId));

// In middleware — structured { body, status } for flexibility
const { body, status } = toErrorResponse(err);
```

## Gotchas

- No ESLint or Prettier config in the repo — formatting is convention-based, not enforced by tooling
- `tsconfig.json` includes only `src/**/*` — config files at root are not typechecked
- Dual lockfiles exist (`yarn.lock` + `package-lock.json`) — always use **Yarn** for installs
- Agent IDs in code are kebab-case strings, but the exported variable names are camelCase
