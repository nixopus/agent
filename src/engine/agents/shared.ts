import {
  UnicodeNormalizer,
  TokenLimiterProcessor,
} from '@mastra/core/processors';
import { withCreditTracking } from '../../features/credits/agent-tracking';
import { withToolStepLogging } from '../../features/credits/agent-tool-step-logging';
import { config } from '../../config';

export const MAX_DELEGATION_ITERATIONS = 20;
export const MAX_TEXT_MESSAGES_FOR_CONTEXT = 3;
export const DEFAULT_MAX_STEPS = 8;

export const CONTEXT_AWARE_AGENTS = new Set(['diagnostic-agent', 'pre-deploy-agent', 'github-agent', 'infrastructure-agent']);

export const PROMPT_ONLY_AGENTS = new Set([
  'billing-agent',
  'notification-agent',
  'infrastructure-agent',
  'machine-agent',
]);

export const AGENT_STEP_LIMITS: Record<string, number> = {
  'billing-agent': 3,
  'notification-agent': 3,
  'machine-agent': 5,
  'infrastructure-agent': 5,
  'github-agent': 6,
  'diagnostic-agent': 10,
  'pre-deploy-agent': 8,
};

export function coreInstructions(identity: string, skillCatalog: string[], rules?: string): string {
  const catalog = skillCatalog.map(s => `- ${s}`).join('\n');
  return `${identity}

## Available Skills
Load task-specific instructions with skill("<name>"). Available:
${catalog}

## Tools
Core tools are always available. For others, use search_tools("<keyword>") then load_tool("<name>").
${rules ? `\n${rules}` : ''}`.trim();
}

export const DEPLOY_INSTRUCTIONS = coreInstructions(
  'You are Nixopus, a deploy orchestrator. Plain text only, no emojis.',
  [
    'deploy-flow — Full deploy pipeline: source detection, codebase analysis, project creation, deployment, monitoring, live URL delivery. Load when user wants to deploy.',
    'self-heal — Self-healing loop for failed deployments (max 3 attempts) and rollback. Load when a deployment fails.',
    'mcp-integrations — MCP server discovery, tool invocation, provider catalog. Load when task involves external services or user asks about MCP.',
    'deploy-delegation — Sub-agent routing: diagnostics, machine, infra, github, billing, notifications. Load when the task is not a direct deploy.',
    'domain-attachment — Domain generation and DNS/TLS setup.',
    'dockerfile-generation — Dockerfile creation when none exists.',
    'dockerignore-generation — .dockerignore creation when none exists.',
    'caddyfile-generation — Caddy config for static sites.',
    'monorepo-strategy — Service discovery and build context for monorepos.',
    'database-migration — Migration commands during deployment.',
    'post-deploy-verification — Post-deploy verification checklist.',
    'nixopus-docs — Product documentation lookup.',
  ],
  `## Rules — NON-NEGOTIABLE
The ONLY acceptable end state is a live URL or a clear blocker with escalation.
NEVER fabricate tool results. Every fact must come from an actual tool call.
Read the [deploy-state] block to see completed steps. Resume from where you left off.
NEVER reveal internal details: file paths, tool names, S3, BM25, workspace, build_pack.
Keep the user continuously informed. Acknowledge requests immediately. Every update must include a completed action, current step, latest blocker, or live link.
Do not ask for permission for obvious fixes. Just do them.
Only ask the user for input when you literally cannot proceed: missing secrets, missing GitHub access, or a business decision.

## Domain Rule — ALWAYS FOLLOW
generate_random_subdomain and createProject are core tools — always available, no search/load needed.
ALWAYS call generate_random_subdomain BEFORE createProject. Pass the subdomain in the domains array when calling createProject. This attaches the domain at creation time and avoids extra tool calls.
Only use add_application_domain for post-creation attachment or custom domains.

## Monitoring Rule — LEAN
After deploy_project, call getApplicationDeployments(limit=1) once to get the deployment ID. Then poll getDeploymentById only. Do NOT call getDeploymentLogs unless status is failed/error or user asks. Do NOT call getApplication after deploy.

## Nixopus Documentation
When the user asks about Nixopus features, configuration, or product-level questions: read_skill("nixopus-docs") and follow the lookup workflow.`,
);

export const unicodeNormalizer = new UnicodeNormalizer({
  stripControlChars: true,
  collapseWhitespace: true,
});

export function tokenLimiter(limit: number) {
  return new TokenLimiterProcessor({
    limit,
    strategy: 'truncate' as const,
    countMode: 'cumulative' as const,
  });
}

const usesOpenRouter =
  config.agentModel.startsWith('openrouter/') || config.agentLightModel.startsWith('openrouter/');

export function openrouterProvider(
  maxTokens: number,
  opts?: { cache?: boolean; reasoning?: 'none' | 'low' | 'medium' | 'high'; noReasoning?: boolean },
) {
  if (!usesOpenRouter) return {};

  const result: Record<string, unknown> = { max_tokens: maxTokens, usage: { include: true } };
  if (opts?.cache) result.cache_control = { type: 'ephemeral' };
  if (opts?.reasoning) {
    result.reasoning = { effort: opts.reasoning };
  } else if (opts?.noReasoning) {
    result.reasoning = { effort: 'none' };
  }
  return { openrouter: result };
}

export function agentDefaults(base: Record<string, unknown>): (ctx: { requestContext: unknown }) => Record<string, unknown> {
  const tracked = withCreditTracking(base);
  if (process.env.NODE_ENV === 'development') {
    return withToolStepLogging(tracked);
  }
  return tracked;
}
