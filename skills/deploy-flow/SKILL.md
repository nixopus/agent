---
name: deploy-flow
description: Full deploy pipeline — source detection, codebase analysis, project creation, deployment monitoring, and live URL delivery. Load when the user wants to deploy an application.
metadata:
  version: "1.0"
---

# Deploy Flow

## Source Detection — FIRST STEP
Check the user message for a [context] block before calling any tool.

source=s3: The context block contains syncTarget (the S3 storage ID for files). It may also contain applicationId if the app already exists.
- Call load_local_workspace with the syncTarget value to load the codebase.
- If applicationId is present: the app exists. Use it for deploy_project.
- If applicationId is absent: this is a first deploy. Analyze the codebase, then createProject (source and repository are set automatically for S3). Deploy the newly created app.
- GitHub connector tools are blocked for S3 sources — do not attempt them.

No context block: Check `[user-context]` first — it has connectors, repos, apps, servers, and domains pre-loaded. Route from connector access and what the user asked for; do **not** treat missing GitHub connector as a hard stop if a public git URL can be used instead.

**Behavior checklist (routing expectations):**

- **Case A:** No connector + user provides a valid public HTTPS git URL → call `load_remote_repository` (tool id `load_remote_repository`) and continue the workspace-backed deploy flow. Do **not** stop at `read_skill("github-onboarding")` as the only path.
- **Case B:** Connectors/repos available + user includes a URL in the message → default to the **standard GitHub flow** below (use connected repo access), unless the user **explicitly** asked to deploy from a pasted public URL instead of connected repos. **Explicit URL preference** means wording that clearly bypasses the connector for that deploy, for example: “deploy from this URL”, “clone `https://github.com/org/repo.git` — don’t use my connected repos”, “ignore my GitHub connection and use this public repo link”, “use the pasted HTTPS link, not my org’s connected repositories”.
- **Case C:** No connector + no valid public HTTPS git URL in the message → ask the user for a public HTTPS clone URL; you may optionally point them at `read_skill("github-onboarding")` as an alternative — onboarding is **not** a hard blocker.

**Routing (no `[context]` block):**

1. **Connectors/repos available** (per `[user-context]`, or refresh with GitHub tools only if that context is clearly stale — e.g. user says they just connected GitHub but `[user-context]` still shows no connectors; repo/app lists contradict what a fresh `get_github_repositories` / `getApplications` call returns; or the user reports an error about a resource that does not appear in context) **and** the user did **not** explicitly request deploying from a public git URL (connector bypass — see **Case B** examples above): **standard GitHub flow.** Use pre-loaded connector/repo IDs instead of redundant `get_github_connectors` / `get_github_repositories` when possible. Then: `analyze_repository` → explore → `createProject` → `deploy_project`.

   **Fallback (connector path failed, URL still viable):** If you already chose the standard GitHub flow but a required GitHub/connector step fails (auth, missing repo, permission, transient API error, etc.) **and** the user’s message still contains a **valid public HTTPS git clone URL** you can use: switch to **`load_remote_repository`** with that URL (and branch if given), then continue the **workspace-backed** deploy flow (analyze workspace → `createProject` / `deploy_project`). Prefer this over repeatedly retrying the connector when the public URL is a known-good alternative. Connector-first ordering is unchanged: attempt the connector path first when the rules above apply; only fall back after a real failure.

2. **Connector/repo access missing** and the user provided a **valid public HTTPS git clone URL** (e.g. `https://github.com/org/repo.git` or `https://…/org/repo` — not `git@…` SCP-style, not non-HTTPS schemes): call **`load_remote_repository`** with that URL (and branch if the user specified one), then continue the **workspace-backed** deploy flow: analyze the code now in the workspace, then `createProject` / `deploy_project` following the same workspace-oriented patterns as S3-backed deploys (GitHub connector tools remain inappropriate once the workspace is the source of truth).

3. **Connector/repo access missing** and **no** valid public HTTPS git URL is present: **ask** the user for a public HTTPS clone URL they can share. Optionally mention `read_skill("github-onboarding")` if they prefer to connect GitHub instead — do **not** refuse to continue the deploy solely because onboarding was skipped.

## Deploy Patterns
A [deploy-patterns] block may be injected with known fixes, pitfalls, and fast paths for the detected ecosystem. When present, check it before diagnosing issues — if a known fix matches, apply it directly instead of re-investigating from scratch.

## Deploy Steps
1. Load codebase.
2. Analyze: read_file, list_directory, grep to find ecosystem, port, Dockerfile, compose, env vars. Base conclusions on actual file contents.
3. If monorepo detected (workspaces, turbo.json, nx.json, apps/ with multiple services): read_skill("monorepo-strategy") for service discovery, dependency ordering, and build context strategy.
4. If no Dockerfile: load read_skill("dockerfile-generation") and the matching ecosystem skill (e.g. read_skill("node-deploy")). Also read_skill("dockerignore-generation") if no .dockerignore exists. For static sites needing Caddy config, read_skill("caddyfile-generation").
   - **Workspace-backed sources** (`source=s3` after `load_local_workspace`, **or** codebase loaded via **`load_remote_repository`** from a public HTTPS git URL): Use **`write_workspace_files`** to save generated Dockerfile/.dockerignore/etc. — same workspace-oriented path as S3 (remote-loaded repos live in the workspace as the source of truth; generated files belong there).
   - **GitHub connector flow** (standard GitHub flow: analyzing/updating via connected repo APIs without treating the workspace as the sole mutable copy): Do **not** use `write_workspace_files` for those changes (it only affects the local workspace). Use the GitHub tools directly: read_skill("github-workflow") and follow the Fix-via-PR flow (create branch → github_create_or_update_file on that branch → open PR). NEVER push directly to main/master.
5. If the app has database migrations (Prisma, TypeORM, Django, Alembic, etc.): read_skill("database-migration") to determine how to run migrations during deployment.
6. Generate domain BEFORE createProject. Call generate_random_subdomain to get a subdomain. Pass it in the `domains` array when calling createProject in the next step — this attaches the domain at creation time and avoids extra tool calls later. For custom domains, read_skill("domain-attachment").
7. createProject (if app doesn't exist) — pass `domains: ["<generated-subdomain>"]` to attach the domain at creation. Then call deploy_project. For compose: pass compose_services and compose_domains.
8. Monitor deployment — mandatory but lean. Call getApplicationDeployments(limit=1) once to get the deployment ID. Then poll getDeploymentById only — do NOT call getDeploymentLogs unless the status is failed/error or the user asks. One poll is enough if the build is fast; for slow builds, poll at most 2-3 times. Do NOT call getApplication after deploy — you already have the app details from createProject.
9. Verify: read_skill("post-deploy-verification") and run the verification checklist.
10. Share the live URL clearly and explicitly once the app is verified reachable.

## Rules
- Use createProject to create apps. create_application does not exist.
- Check [user-context] apps (or `getApplications` if context is stale — use the same “clearly stale” signals as **Routing** step 1) before creating to avoid duplicates.
- Never hardcode secrets. Use updateApplication for env vars.
- Keep user-facing responses product-level. Do **not** mention internal implementation details like source storage internals, sync internals, tool names/IDs, or context block fields.
- If the user asks to deploy, do not stop at planning, explanation, or diagnosis. Execute the deployment flow unless blocked by missing credentials, missing access, or required secrets.
- "Would you like me to fix this?" is a failure mode when the fix is obvious. Fix it.
- If an operation is async, keep polling and keep the user updated until there is a terminal outcome. Do not abandon the flow with promises of future follow-up.
- If you create a PR, include the URL in your reply. If it failed, say what failed.
