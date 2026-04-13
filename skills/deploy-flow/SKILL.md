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

No context block: Standard GitHub flow. Check [user-context] first — it has your connectors, repos, apps, servers, and domains pre-loaded. Use those IDs directly instead of calling get_github_connectors or get_github_repositories. Then: analyze_repository → explore → createProject → deploy_project.
If [user-context] shows no connectors (or is absent), the user has not connected GitHub yet. Do NOT continue the deploy flow. Instead: read_skill("github-onboarding") and follow the guide.

## Deploy Patterns
A [deploy-patterns] block may be injected with known fixes, pitfalls, and fast paths for the detected ecosystem. When present, check it before diagnosing issues — if a known fix matches, apply it directly instead of re-investigating from scratch.

## Deploy Steps
1. Load codebase.
2. Analyze: read_file, list_directory, grep to find ecosystem, port, Dockerfile, compose, env vars. Base conclusions on actual file contents.
3. If monorepo detected (workspaces, turbo.json, nx.json, apps/ with multiple services): read_skill("monorepo-strategy") for service discovery, dependency ordering, and build context strategy.
4. If no Dockerfile: load read_skill("dockerfile-generation") and the matching ecosystem skill (e.g. read_skill("node-deploy")). Also read_skill("dockerignore-generation") if no .dockerignore exists. For static sites needing Caddy config, read_skill("caddyfile-generation").
   - **S3 sources**: Use write_workspace_files to save generated files — they sync automatically.
   - **GitHub sources**: Do NOT use write_workspace_files (it only writes locally). Instead, use the GitHub tools directly: read_skill("github-workflow") and follow the Fix-via-PR flow (create branch → github_create_or_update_file on that branch → open PR). NEVER push directly to main/master.
5. If the app has database migrations (Prisma, TypeORM, Django, Alembic, etc.): read_skill("database-migration") to determine how to run migrations during deployment.
6. Generate domain BEFORE createProject. Call generate_random_subdomain to get a subdomain. Pass it in the `domains` array when calling createProject in the next step — this attaches the domain at creation time and avoids extra tool calls later. For custom domains, read_skill("domain-attachment").
7. createProject (if app doesn't exist) — pass `domains: ["<generated-subdomain>"]` to attach the domain at creation. Then call deploy_project. For compose: pass compose_services and compose_domains.
8. Monitor deployment — mandatory but lean. Call getApplicationDeployments(limit=1) once to get the deployment ID. Then poll getDeploymentById only — do NOT call getDeploymentLogs unless the status is failed/error or the user asks. One poll is enough if the build is fast; for slow builds, poll at most 2-3 times. Do NOT call getApplication after deploy — you already have the app details from createProject.
9. Verify: read_skill("post-deploy-verification") and run the verification checklist.
10. Share the live URL clearly and explicitly once the app is verified reachable.

## Rules
- Use createProject to create apps. create_application does not exist.
- Check [user-context] apps (or getApplications if context is stale) before creating to avoid duplicates.
- Never hardcode secrets. Use updateApplication for env vars.
- If the user asks to deploy, do not stop at planning, explanation, or diagnosis. Execute the deployment flow unless blocked by missing credentials, missing access, or required secrets.
- "Would you like me to fix this?" is a failure mode when the fix is obvious. Fix it.
- If an operation is async, keep polling and keep the user updated until there is a terminal outcome. Do not abandon the flow with promises of future follow-up.
- If you create a PR, include the URL in your reply. If it failed, say what failed.
