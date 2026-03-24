---
name: dev-setup
description: Use when setting up local development, installing dependencies, configuring environment variables, or running the dev server. Covers prerequisites, setup steps, env config, LLM providers, and health endpoints.
metadata:
  version: "1.0"
---

# Development Setup

## Prerequisites

- **Node.js** >= 22.13.0
- **Yarn** (primary package manager — always use Yarn, not npm)
- **PostgreSQL** (required for storage, agent memory, workflow snapshots)
- **Redis** (optional — falls back to Postgres-based caching if unavailable)

## Initial Setup

```bash
git clone https://github.com/nixopus/agent.git
cd agent
yarn install
cp .env.sample .env
# Edit .env with your database URL and LLM provider config
yarn dev
```

The dev server starts at `http://localhost:9090`.

## Key Environment Variables

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | Required |
| `REDIS_URL` | Redis connection string | Optional |
| `AUTH_SERVICE_URL` | Nixopus auth service URL | `""` |
| `API_URL` | Nixopus API URL | `""` |
| `SELF_HOSTED` | Enable self-hosted mode | `false` |
| `OPENROUTER_API_KEY` | OpenRouter API key | `""` |
| `AGENT_MODEL` | Primary LLM model identifier | Auto-detected |
| `AGENT_LIGHT_MODEL` | Lightweight LLM for simple tasks | Auto-detected |
| `PORT` | HTTP server port | `9090` |
| `LOG_LEVEL` | Logging verbosity (`debug`, `info`, `warn`, `error`) | `info` |

See `.env.sample` for the full list.

## LLM Providers

Default is **Ollama** (local, no API key). Set env vars to switch:

| Provider | Setup |
|---|---|
| **Ollama** (default) | No config needed. Runs locally. |
| **OpenRouter** | Set `OPENROUTER_API_KEY` |
| **OpenAI** | `OPENAI_API_KEY` + `AGENT_MODEL=openai/gpt-4o` |
| **Anthropic** | `ANTHROPIC_API_KEY` + `AGENT_MODEL=anthropic/claude-sonnet-4` |
| **Google Gemini** | `GOOGLE_GENERATIVE_AI_API_KEY` + `AGENT_MODEL=google/gemini-2.5-flash` |

The `dev` script (`tsx scripts/dev.js`) loads `.env`, bootstraps secrets, then starts the Mastra dev server.

## Health Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /healthz` | Liveness check — server is running |
| `GET /readyz` | Readiness check — dependencies connected |
| `GET /metrics` | Observability metrics |

## Common Commands

| Command | Purpose |
|---|---|
| `yarn dev` | Start dev server with hot reload |
| `yarn build` | Build with Mastra (`mastra build --dir src/engine`) |
| `yarn start` | Start production server (`mastra start`) |
| `yarn test` | Run unit tests |
| `yarn test:watch` | Run tests in watch mode |
| `yarn test:e2e` | Run end-to-end tests |

## Gotchas

- Always use **Yarn** — the project has both `yarn.lock` and `package-lock.json`, but Yarn is the canonical package manager (CI and Dockerfile both use Yarn)
- The pre-commit hook runs `npm run build` and `npm test` — both must pass before a commit goes through
- The `.mastra/` directory is a build artifact (gitignored) — don't edit files there
- `dist/` is also gitignored — only `.mastra/output/` matters for the Mastra runtime
