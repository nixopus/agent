---
name: agent-authoring
description: Use when creating a new agent, tool, or runtime skill for the Nixopus system. Step-by-step guide for agent composition, tool creation, tool wrappers, and runtime skill authoring.
metadata:
  version: "1.0"
---

# Agent & Tool Authoring

## Creating a New Agent

### 1. Create the agent file

Add `src/engine/agents/<name>-agent.ts`. Follow the established pattern:

```typescript
import { Agent } from '@mastra/core/agent';
import { config } from '../../config';
import { unicodeNormalizer, tokenLimiter, openrouterProvider, agentDefaults } from './shared';
import { createRequestWorkspace } from '../workspace-factory';
import { guardToolsForSchemaCompat } from '../tools/shared/schema-compat-guard';

const myAgentTools = guardToolsForSchemaCompat({
  // import and list tools here
});

export const myAgent = new Agent({
  id: 'my-agent',                    // kebab-case, unique
  name: 'My Agent',                  // human-readable
  description: 'What this agent does in one sentence.',
  instructions: `Agent instructions here. No emojis. Plain text only.
// ...detailed instructions...`,
  model: config.agentModel,          // or config.agentLightModel for simpler agents
  workspace: createRequestWorkspace,
  inputProcessors: [unicodeNormalizer],
  outputProcessors: [tokenLimiter(4000)],
  tools: myAgentTools,
  defaultOptions: agentDefaults({
    maxSteps: 12,
    modelSettings: { maxOutputTokens: 4000 },
    providerOptions: openrouterProvider(4000, { cache: true, noReasoning: true }),
  }),
});
```

### 2. Register in the engine

Import and add the agent to the `agents` object in `src/engine/index.ts`:

```typescript
import { myAgent } from './agents/my-agent';

const agents = {
  // ...existing agents...
  myAgent,
};
```

### 3. Configure step limits (if non-default)

Add to `AGENT_STEP_LIMITS` in `src/engine/agents/shared.ts`:

```typescript
export const AGENT_STEP_LIMITS: Record<string, number> = {
  // ...existing...
  'my-agent': 10,
};
```

Add to `CONTEXT_AWARE_AGENTS` or `PROMPT_ONLY_AGENTS` as appropriate.

### 4. Add memory (if needed)

Only agents that need conversation continuity require memory. See `diagnostic-agent.ts` or `incident-agent.ts` for the pattern:

```typescript
import { Memory } from '@mastra/memory';
import { PostgresStore } from '@mastra/pg';

export const myMemoryStore = new PostgresStore({
  id: 'my-agent-memory',
  pool: getMemoryPool(config.databaseUrl),
});

const myMemory = new Memory({
  storage: myMemoryStore,
  options: { lastMessages: 12, semanticRecall: false },
});
```

Remember to pre-initialize the memory store in `src/engine/index.ts`:

```typescript
await Promise.all([
  // ...existing...
  myMemoryStore.init(),
]);
```

## Tool Wrappers

Always apply wrappers when composing tools for an agent:

| Wrapper | Purpose | When to use |
|---|---|---|
| `guardToolsForSchemaCompat()` | Validates schema compatibility | Always — apply to all tool sets |
| `withCompactOutput()` | Compresses verbose tool output | When tools return large JSON |
| `withToonOutput()` | Formats output with toon-format | When output needs structured formatting |

Apply in order: `withToonOutput(withCompactOutput(guardToolsForSchemaCompat(tools)))`

For agents with dynamic tool loading (e.g. diagnostic agent), split tools into **core** (always available) and **searchable** (loaded on demand via `ToolSearchProcessor`).

## Creating Tools

Tools live in `src/engine/tools/` grouped by domain. API tools use the factory pattern:

```typescript
import { createApiTool } from './tool-factory';

export const getApplicationTool = createApiTool({
  id: 'get-application',
  description: 'Get application details by ID',
  inputSchema: z.object({ applicationId: z.string() }),
  outputSchema: ApplicationSchema,
  execute: async ({ applicationId }, ctx) => {
    return ctx.api.getApplication(applicationId);
  },
});
```

For non-API tools, use `createTool` from `@mastra/core`:

```typescript
import { createTool } from '@mastra/core';

export const myTool = createTool({
  id: 'my-tool',
  description: 'What this tool does',
  inputSchema: z.object({ /* ... */ }),
  outputSchema: z.object({ /* ... */ }),
  execute: async (input, ctx) => { /* ... */ },
});
```

## Creating Runtime Skills

Runtime skills are markdown reference documents loaded by agents via `read_skill()`.

### 1. Create the skill directory and file

```
skills/<skill-name>/SKILL.md
```

### 2. Add YAML frontmatter

```yaml
---
name: my-skill
description: What this skill covers and when to use it.
metadata:
  version: "1.0"
---
```

### 3. Reference from agent instructions

In the agent's `instructions` string, add a skill reference:

```
## Skills
- read_skill("my-skill") — when and why to load this skill
```

## Delegation

Agents delegate to sub-agents by referencing them in instructions. The deploy agent (`shared.ts`) defines the delegation map:

- **diagnostics**: build errors, crashes, runtime issues
- **machine**: server health, CPU/RAM, Docker, DNS
- **infrastructure**: domains, containers, healthchecks
- **github**: branches, PRs, file operations
- **preDeploy**: first-time validation, monorepo assessment
- **notification**: deploy alerts, channel config
- **billing**: credits, plans, invoices

Include context when delegating: `[context: applicationId=X, owner=Y, repo=Z, branch=W]`.
