---
name: nixopus-docs
description: Look up Nixopus platform documentation at runtime. Use when the user asks about Nixopus features, configuration, concepts, self-hosting, API reference, guides, or anything where accurate product information is needed. Prevents hallucination by fetching the latest docs.
metadata:
  version: "1.0"
---

# Nixopus Documentation Lookup

When you need to answer questions about Nixopus — features, setup, configuration, API, guides, concepts, self-hosting, extensions, domains, deployments, or any product-level detail — **always fetch the latest documentation** instead of relying on memory.

## When to Use

- User asks "how does X work in Nixopus?"
- User asks about configuration, environment variables, or setup
- User references a Nixopus feature you're unsure about
- User asks about self-hosting, cloud, billing, teams, or extensions
- User needs API reference or endpoint details
- You need to explain a Nixopus concept (deployments, domains, organizations, auth)
- Whenever you're about to describe Nixopus behavior and aren't 100% certain from tool results

## Workflow

1. **Fetch the index** — call `fetch_nixopus_docs_index` to get the full list of doc pages with descriptions.
2. **Identify the right page** — scan the index for the page most relevant to the user's question. Pages are organized by section:
   - `getting-started/` — intro, quickstart
   - `concepts/` — deployments, domains, organizations, authentication
   - `guides/` — deploying apps, docker compose, env vars, containers, health checks, GitHub, notifications, AI chat, extensions, terminal, charts
   - `cloud/` — credits, machines, teams, custom domains, API keys
   - `self-hosting/` — installation, configuration, updating, backup, troubleshooting, management CLI
   - `extension/` — VS Code/Cursor extension (install, auth, deploying, workspace sync, chat)
   - `api-reference/` — full REST API reference
3. **Fetch the page** — call `fetch_nixopus_docs_page` with the path (e.g. `concepts/deployments.md`).
4. **Answer from the content** — base your response on the fetched documentation. Cite specific details. If the page doesn't fully answer the question, fetch additional pages.

## Rules

- Never fabricate Nixopus features, settings, or API endpoints. If you can't find it in the docs, say so.
- For API reference questions, fetch the specific endpoint page from `api-reference/`.
- If the user's question spans multiple topics, fetch multiple pages.
- Keep fetched content as context — don't re-fetch the same page in the same conversation.
