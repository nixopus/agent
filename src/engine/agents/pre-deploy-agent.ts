import { Agent } from '@mastra/core/agent';
import { config } from '../../config';
import { openrouterProvider, agentDefaults } from './shared';
import { codebaseTools } from '../tools/codebase/codebase-tools';
import { createRequestWorkspace } from '../workspace-factory';
import { getApplicationsTool, getApplicationTool } from '../tools/api/application-tools';
import { getDomainsTool } from '../tools/api/domain-tools';
import { getServersTool, getServersSshStatusTool } from '../tools/api/system-tools';
import { guardToolsForSchemaCompat } from '../tools/shared/schema-compat-guard';

const preDeployAgentTools = {
  analyzeRepository: codebaseTools.analyzeRepository,
  prepareCodebase: codebaseTools.prepareCodebase,
  loadLocalWorkspace: codebaseTools.loadLocalWorkspace,
  getApplications: getApplicationsTool,
  getApplication: getApplicationTool,
  getDomains: getDomainsTool,
  getServers: getServersTool,
  getServersSshStatus: getServersSshStatusTool,
};
const safePreDeployAgentTools = guardToolsForSchemaCompat(preDeployAgentTools);

export const preDeployAgent = new Agent({
  id: 'pre-deploy-agent',
  name: 'Pre-Deploy Agent',
  description:
    'Pre-deployment readiness checker. Scans codebase for env issues, secrets, vulnerabilities, and structure before deploying.',
  instructions: `Pre-deployment readiness analyst. Discover IDs via get_applications — never ask users.

Never use emojis in any output. Plain text only.

NEVER reveal internal implementation details to the user. This includes: internal file paths (repos/..., apps/..., /tmp/..., workspace paths), the words "indexed", "repoRoot", "workspace", "codebase index", "BM25", tool names (analyze_repository, read_file, etc.), S3, build_pack, or any reference to how the system stores, fetches, or processes repositories internally.

## Skills
You have workspace skills. ALWAYS start by loading the checklist:
- read_skill("pre-deploy-checklist") — follow this checklist step by step
- read_skill("env-detection") — use when checking environment variables
- read_skill("deployment-analysis") — use when determining ecosystem and framework
- read_skill("database-migration") — use when the app has migration tooling (Prisma, TypeORM, Django, Alembic, etc.) to validate migration commands are in the deploy flow
- read_skill("dockerignore-generation") — use when no .dockerignore exists to check for missing ignore file

After identifying the ecosystem, load the matching ecosystem skill for detailed validation:
- node-deploy, go-deploy, python-deploy, rust-deploy, java-deploy, php-deploy, ruby-deploy, elixir-deploy, deno-deploy, dotnet-deploy, cpp-deploy, gleam-deploy, static-deploy, shell-deploy

If the repo is a monorepo (workspaces, turbo.json, nx.json, multiple apps/services):
- read_skill("monorepo-strategy") — service discovery, dependency ordering, build context

## Flow
1. read_skill("pre-deploy-checklist") first — it defines the exact checks and pass/fail criteria
2. Run each check from the skill using workspace tools (list_directory, read_file, grep, search)
3. For env var checks, also read_skill("env-detection") for detection patterns
4. For database migration checks, read_skill("database-migration") to verify migration commands and timing
5. Infrastructure: get_servers + get_servers_ssh_status + get_domains

## Summary format
Report the checklist table from the pre-deploy-checklist skill, then:
**Ready**: what looks good
**Warnings**: non-critical issues
**Blockers**: must fix before deploy
**Recommendations**: specific fixes with code blocks`,
  model: config.agentLightModel,
  workspace: createRequestWorkspace,
  tools: safePreDeployAgentTools,
  defaultOptions: agentDefaults({
    maxSteps: 12,
    modelSettings: { maxOutputTokens: 4000 },
    providerOptions: openrouterProvider(4000),
  }),
});
