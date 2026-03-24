---
name: building-and-deploying
description: Use when building the project, creating Docker images, understanding CI pipelines, writing commit messages, or working with git hooks. Covers build commands, Docker workflow, GitHub Actions CI, commitlint conventions, and pre-commit hooks.
metadata:
  version: "1.0"
---

# Building & Deploying

## Build

```bash
yarn build    # runs: mastra build --dir src/engine
```

This uses the Mastra bundler to compile `src/engine/` into `.mastra/output/`. TypeScript only typechecks (`noEmit: true` in tsconfig) — Mastra handles the actual bundling.

The `bundler.externals` in the engine config excludes native/heavy packages from the bundle:

```
ssh2, bullmq, bufferutil, utf-8-validate, @tanstack/react-query, react
```

## Docker

Multi-stage Node 22 Alpine image:

```bash
docker build -t nixopus-agent .
docker run -p 9090:9090 --env-file .env nixopus-agent
```

The Dockerfile copies: `src/`, `node_modules/`, `tsconfig.json`, `.mastra/`, `skills/`.

Production image is pushed to `ghcr.io` on merge to `main` (see CI below).

## Git Hooks (Husky)

### Pre-commit (`.husky/pre-commit`)

Runs **both** build and tests before allowing a commit:

```bash
npm run build   # must pass
npm test        # must pass
```

If either fails, the commit is rejected.

### Commit Message (`.husky/commit-msg`)

Validates commit messages against **Conventional Commits** via commitlint:

```bash
npx commitlint --edit
```

Config: `commitlint.config.cjs` extends `@commitlint/config-conventional`.

## Commit Message Format

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

### Types

| Type | When to use |
|---|---|
| `feat` | New feature or capability |
| `fix` | Bug fix |
| `refactor` | Code restructuring without behavior change |
| `docs` | Documentation only |
| `test` | Adding or updating tests |
| `chore` | Maintenance (deps, config, CI) |
| `perf` | Performance improvement |
| `ci` | CI/CD changes |
| `style` | Formatting, whitespace (no logic change) |

### Scopes (common)

Use the area of the codebase affected: `agents`, `tools`, `middleware`, `credits`, `engine`, `skills`, `docker`, `ci`.

### Examples

```
feat(agents): add incident response agent with memory

fix(middleware): handle expired workflow snapshots in resume endpoint

refactor(tools): extract shared schema compat guard

chore(deps): bump @mastra/core to 1.13.2

test(credits): add wallet deduction edge cases
```

## CI Pipeline

### Tests (`.github/workflows/test.yml`)

Triggers on push/PR to `main`:

1. Checkout
2. Setup Node 22 with Yarn cache
3. `yarn install --frozen-lockfile`
4. `yarn test`

Concurrency: cancel-in-progress per workflow+ref.

### Container Build (`.github/workflows/build-and-push-container.yml`)

Triggers on push to `main` or manual dispatch:

1. Build Docker image from `Dockerfile`
2. Push to `ghcr.io`
3. Tags: `latest` and `main-<sha>`

## Production

```bash
yarn start    # runs: mastra start
```

Serves from the `.mastra/output/` build artifacts. Requires all env vars configured (especially `DATABASE_URL`).

Health check: `GET /healthz`
Readiness check: `GET /readyz`

## Gotchas

- The pre-commit hook uses `npm run` while CI uses `yarn` — both resolve to the same scripts, but be aware of the inconsistency
- `yarn build` must succeed before `yarn start` — the `.mastra/` directory must exist
- The `.mastra/` and `dist/` directories are gitignored — never commit build artifacts
- Container images are only pushed on merge to `main`, not on PRs
