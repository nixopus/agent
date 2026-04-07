---
name: architecture-patterns
description: Use when understanding how the system is structured, how agents/tools/middleware compose, or when making architectural decisions. Covers Mastra engine, agent composition, DI container, tool factories, middleware pipeline, and feature folder patterns.
metadata:
  version: "1.0"
---

# Architecture Patterns

## Mastra Engine

The single entry point is `src/engine/index.ts`. It creates one `Mastra` instance that registers:

- **Agents** — all agents in a single `agents` object
- **Storage** — `PostgresStore` for workflow snapshots and agent state
- **Observability** — `DefaultExporter` with `SensitiveDataFilter`
- **Logger** — Pino via `@mastra/loggers`
- **Server** — port/host, API routes, middleware stack

```typescript
export const mastra = new Mastra({
  agents,
  storage: getPostgresStore(),
  server: {
    port: config.port,
    host: config.host,
    apiRoutes: [...observabilityRoutes, ...creditRoutes, ...incidentRoutes, ...workspaceRoutes],
    middleware: [
      createRequestTracing(),
      securityHeaders(),
      rateLimiter,
      createAppMiddleware(getPostgresStore),
    ],
  },
});
```

Memory stores are pre-initialized at startup via `Promise.all`.

## Agent Composition

Each agent file in `src/engine/agents/` follows a consistent structure:

1. **Import tools** from `engine/tools/` (grouped by domain)
2. **Wrap tools** with composable wrappers:
   - `guardToolsForSchemaCompat()` — schema compatibility guard
   - `withCompactOutput()` — compress tool output
   - `withToonOutput()` — format output with toon-format
3. **Configure memory** (optional) — `@mastra/memory` + `PostgresStore`
4. **Define the agent** with `new Agent({ id, name, description, instructions, model, tools, ... })`
5. **Apply shared defaults** via `agentDefaults()` which adds credit tracking (and tool step logging in dev)

### Agent Configuration Constants (in `shared.ts`)

| Constant | Purpose |
|---|---|
| `CONTEXT_AWARE_AGENTS` | Agents that receive codebase/deploy context |
| `PROMPT_ONLY_AGENTS` | Agents that only get prompt, no context |
| `AGENT_STEP_LIMITS` | Per-agent max step overrides |
| `DEFAULT_MAX_STEPS` | Fallback step limit (8) |
| `MAX_DELEGATION_ITERATIONS` | Max sub-agent delegation depth (20) |

### Model Selection

Agents use either `config.agentModel` (full model) or `config.agentLightModel` (lighter/cheaper). Use `openrouterProvider()` for OpenRouter-specific settings (max tokens, caching, reasoning effort).

### Input/Output Processors

- `unicodeNormalizer` — strips control chars, collapses whitespace
- `tokenLimiter(n)` — truncates output to `n` tokens
- `ToolSearchProcessor` — enables dynamic tool discovery via `search_tools`/`load_tool`

## Tool Patterns

Tools live in `src/engine/tools/` organized by domain:

- `api/` — `createTool`/`createApiTool` wraps Nixopus API SDK calls with Zod input/output schemas
- `codebase/` — workspace analysis tools (read_file, list_directory, grep, search)
- `deploy/` — deployment orchestration
- `diagnostics/` — HTTP probes, health checks
- `github/` — repository operations, PR creation
- `shared/` — composable tool wrappers

Tool wrappers are applied as a pipeline: `withToonOutput(withCompactOutput(guardToolsForSchemaCompat(tools)))`.

## Runtime Skills

Operational knowledge lives in `skills/<name>/SKILL.md` with YAML frontmatter (`name`, `description`, `metadata.version`). Agents load skills dynamically via `read_skill("skill-name")` in their instructions.

Skills are reference material for agents — not code. They guide decision-making during deployments, diagnostics, and infrastructure operations.

## Dependency Injection

Lightweight DI via `rsdi` in `src/container.ts`:

```typescript
const container = new DIContainer()
  .add('config', () => cfg)
  .add('db', ({ config }) => getDb(config.databaseUrl))
  .add('cacheFactory', () => getCacheStoreFactory());
```

Singleton lifecycle: `initContainer()` creates once, `getContainer()` returns it, `resetContainer()` for testing.

## Middleware Pipeline

Middleware functions in `src/middleware/` are **factory functions** that return Hono-style handlers:

```typescript
export function createAppMiddleware(getPostgresStore: () => PostgresStore) {
  return async (c: { req: ..., header: ..., get: ..., res: ... }, next: () => Promise<void>) => {
    // middleware logic
    await next();
  };
}
```

Pipeline order in the engine:
1. `createRequestTracing()` — request ID, timing
2. `securityHeaders()` — security response headers
3. `rateLimiter` — rate limiting per path
4. `createAppMiddleware()` — auth, credits, org context, agent stream logging

## Feature Folders

Vertical slices in `src/features/` group related routes and domain logic:

- `credits/` — wallet management, agent credit tracking, routes
- `workspace/` — S3 workspace support, routes
- `incidents/` — incident management
- `inference/` — LLM inference configuration

Each feature exports its routes, which are composed into `server.apiRoutes` in the engine.

## Shutdown

Graceful shutdown in `src/engine/index.ts` handles SIGTERM/SIGINT:
1. Shutdown pub/sub bus
2. Evict SSH orchestrators
3. Close DB pools
4. Exit
