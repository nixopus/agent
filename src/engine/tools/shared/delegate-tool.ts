import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { Agent } from '@mastra/core/agent';
import { createLogger } from '../../../logger';
import { CONTEXT_AWARE_AGENTS, AGENT_STEP_LIMITS, DEFAULT_MAX_STEPS } from '../../agents/shared';

const logger = createLogger('delegate-tool');

const AGENT_IDS = [
  'diagnostics',
  'machine',
  'infrastructure',
  'github',
  'preDeploy',
  'notification',
  'billing',
] as const;

type AgentKey = (typeof AGENT_IDS)[number];

let agentRegistry: Record<AgentKey, Agent> | undefined;

export function registerDelegateAgents(agents: Record<AgentKey, Agent>) {
  agentRegistry = agents;
}

function injectContext(task: string): string {
  const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const appIdMatch = task.match(/(?:applicationId|application_id)=([0-9a-f-]{36})/i) ?? task.match(uuidRe);
  const appId = appIdMatch?.[1] ?? appIdMatch?.[0];
  if (!appId || task.includes('[context: applicationId=')) return task;

  const ownerMatch = task.match(/(?:owner|owner\/repo)=["']?([a-zA-Z0-9_-]+)/i);
  const repoMatch = task.match(/(?:repo(?:sitory)?|repo)=["']?([a-zA-Z0-9_.-]+)/i)
    ?? (ownerMatch ? task.match(/\/([a-zA-Z0-9_.-]+)(?:\s|$|\)|,)/) : null);
  const branchMatch = task.match(/(?:branch)=["']?([a-zA-Z0-9_/-]+)/i);

  const parts = [`applicationId=${appId}`];
  if (ownerMatch?.[1]) parts.push(`owner=${ownerMatch[1]}`);
  if (repoMatch?.[1]) parts.push(`repo=${repoMatch[1]}`);
  parts.push(`branch=${branchMatch?.[1] ?? 'main'}`);

  return `${task}\n\n[context: ${parts.join(', ')}]`;
}

export const delegateTool = createTool({
  id: 'delegate',
  description:
    'Delegate a task to a specialized sub-agent. ' +
    'Use skill("deploy-delegation") to see which agent handles what. ' +
    'Include relevant context (applicationId, owner, repo, branch) in the task.',
  inputSchema: z.object({
    agent: z.enum(AGENT_IDS).describe('Which agent to delegate to'),
    task: z.string().describe('What the agent should do — include all relevant context'),
  }),
  outputSchema: z.object({
    status: z.enum(['success', 'error']),
    result: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ agent, task }) => {
    if (!agentRegistry) {
      return { status: 'error' as const, error: 'Agent registry not initialized' };
    }

    const targetAgent = agentRegistry[agent as AgentKey];
    if (!targetAgent) {
      return { status: 'error' as const, error: `Unknown agent: ${agent}` };
    }

    const agentId = targetAgent.id;
    const maxSteps = AGENT_STEP_LIMITS[agentId] ?? DEFAULT_MAX_STEPS;
    const prompt = CONTEXT_AWARE_AGENTS.has(agentId) ? injectContext(task) : task;

    logger.info({ agent: agentId, maxSteps }, 'Delegation start');

    try {
      const result = await targetAgent.generate(prompt, { maxSteps });
      logger.info({ agent: agentId }, 'Delegation complete');
      return { status: 'success' as const, result: result.text };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ agent: agentId, error: message }, 'Delegation failed');
      return { status: 'error' as const, error: `Delegation to ${agent} failed: ${message}` };
    }
  },
});
