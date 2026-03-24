# Nixopus Agent

AI-powered deployment and infrastructure agent for the [Nixopus](https://nixopus.com) platform. it provides a multi-agent system that handles application deployments, diagnostics, incident response, and infrastructure management through natural language.

## Quick Start

The agent is included in the Nixopus self-hosted installer. Run:

```bash
curl -fsSL install.nixopus.com | sudo bash
```

The installer will prompt for an optional OpenRouter API key. If left blank, the agent runs with Ollama for fully local inference.

## Local Development

### Prerequisites

- Node.js >= 22.13.0
- PostgreSQL
- Redis (optional, falls back to Postgres-based caching)

### Setup

```bash
git clone https://github.com/nixopus/agent.git
cd agent
yarn install
cp .env.sample .env
# Edit .env with your database URL and LLM provider config
yarn dev
```

The dev server starts on `http://localhost:9090`.

## LLM Providers

By default, the agent uses **Ollama** for local inference (no API key required). Set `OPENROUTER_API_KEY` to automatically switch to cloud models via OpenRouter.

You can also use any supported provider by setting `AGENT_MODEL` and `AGENT_LIGHT_MODEL` directly:

| Provider | Setup |
|----------|-------|
| **Ollama** (default) | No config needed. Runs locally. |
| **OpenRouter** | Set `OPENROUTER_API_KEY` |
| **OpenAI** | Set `OPENAI_API_KEY` + `AGENT_MODEL=openai/gpt-4o` |
| **Anthropic** | Set `ANTHROPIC_API_KEY` + `AGENT_MODEL=anthropic/claude-sonnet-4` |
| **Google Gemini** | Set `GOOGLE_GENERATIVE_AI_API_KEY` + `AGENT_MODEL=google/gemini-2.5-flash` |

See [`.env.sample`](.env.sample) for the full list.

## Configuration

Key environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | Required |
| `REDIS_URL` | Redis connection string | Optional |
| `AUTH_SERVICE_URL` | Nixopus auth service URL | `""` |
| `API_URL` | Nixopus API URL | `""` |
| `SELF_HOSTED` | Enable self-hosted mode | `false` |
| `OPENROUTER_API_KEY` | OpenRouter API key (auto-selects cloud models) | `""` |
| `AGENT_MODEL` | Primary LLM model identifier | Auto-detected |
| `AGENT_LIGHT_MODEL` | Lightweight LLM for simple tasks | Auto-detected |
| `PORT` | HTTP server port | `9090` |
| `LOG_LEVEL` | Logging verbosity | `info` |

## Docker

```bash
docker build -t nixopus-agent .
docker run -p 9090:9090 --env-file .env nixopus-agent
```

Health endpoint: `GET /healthz`
Readiness endpoint: `GET /readyz`
