import { Agent } from '@mastra/core/agent';
import type { MastraDBMessage } from '@mastra/core/agent';
import type { MastraMemory } from '@mastra/core/memory';
import { Memory } from '@mastra/memory';
import { config } from '../../config';
import { createLogger } from '../../logger';
import { applicationTools } from '../tools/api/application-tools';
import { projectTools } from '../tools/api/project-tools';
import { githubConnectorTools } from '../tools/api/github-connector-tools';
import { codebaseTools } from '../tools/codebase/codebase-tools';
import { resolveContextTool } from '../tools/api/context-tools';
import { askUserTool } from '../tools/shared/ask-user-tool';
import { deployGenTools } from '../tools/deploy/deploy-gen-tools';
import { githubTools } from '../tools/github/github-tools';
import { diagnosticAgent } from './diagnostic-agent';
import { machineAgent } from './machine-agent';
import { preDeployAgent } from './pre-deploy-agent';
import { notificationAgent } from './notification-agent';
import { billingAgent } from './billing-agent';
import { githubAgent } from './github-agent';
import { infrastructureAgent } from './infrastructure-agent';
import { nixopusDocsTools } from '../tools/docs/nixopus-docs-tool';
import { guardToolsForSchemaCompat } from '../tools/shared/schema-compat-guard';
import { withCompactOutput } from '../tools/shared/compact-output';
import { withToonOutput } from '../tools/shared/toon-output';
import { withSourceGuard } from '../tools/shared/source-guard';
import {
  unicodeNormalizer,
  openrouterProvider,
  agentDefaults,
  MAX_DELEGATION_ITERATIONS,
  MAX_TEXT_MESSAGES_FOR_CONTEXT,
  DEFAULT_MAX_STEPS,
  CONTEXT_AWARE_AGENTS,
  PROMPT_ONLY_AGENTS,
  AGENT_STEP_LIMITS,
  DEPLOY_INSTRUCTIONS,
  TRIAL_MACHINE_NOTICE,
} from './shared';
import { DeployStateProcessor } from './deploy-state-processor';
import { createRequestWorkspace } from '../workspace-factory';

const logger = createLogger('deploy-agent');
const deployStateProcessor = new DeployStateProcessor();

const deployMemory = new Memory({
  options: {
    lastMessages: 12,
    semanticRecall: false,
    observationalMemory: {
      model: config.observationalMemory.model,
      scope: 'thread',
      observation: {
        messageTokens: config.observationalMemory.messageTokens,
      },
      reflection: {
        observationTokens: config.observationalMemory.observationTokens,
      },
    },
  },
});

const rawDeployTools = {
  getApplications: applicationTools.getApplications,
  getApplication: applicationTools.getApplication,
  getApplicationDeployments: applicationTools.getApplicationDeployments,
  getDeploymentById: applicationTools.getDeploymentById,
  getDeploymentLogs: applicationTools.getDeploymentLogs,
  updateApplication: applicationTools.updateApplication,
  updateApplicationLabels: applicationTools.updateApplicationLabels,
  restartDeployment: applicationTools.restartDeployment,
  rollbackDeployment: applicationTools.rollbackDeployment,
  redeployApplication: applicationTools.redeployApplication,
  recoverApplication: applicationTools.recoverApplication,
  previewCompose: applicationTools.previewCompose,
  getComposeServices: applicationTools.getComposeServices,
  deleteApplication: applicationTools.deleteApplication,
  ...projectTools,
  ...codebaseTools,
  ...githubConnectorTools,
  writeWorkspaceFiles: deployGenTools.writeWorkspaceFiles,
  githubGetRepoFile: githubTools.githubGetRepoFile,
  githubGetBranch: githubTools.githubGetBranch,
  githubCreateBranch: githubTools.githubCreateBranch,
  githubCreateOrUpdateFile: githubTools.githubCreateOrUpdateFile,
  githubCreatePullRequest: githubTools.githubCreatePullRequest,
  resolveContext: resolveContextTool,
  askUser: askUserTool,
  ...nixopusDocsTools,
};

const deployTools = withToonOutput(withCompactOutput(withSourceGuard(guardToolsForSchemaCompat(rawDeployTools))));

function hasToolInvocations(msg: MastraDBMessage): boolean {
  const parts = msg.content?.parts;
  if (!Array.isArray(parts)) return false;
  return parts.some((p) => p.type === 'tool-invocation' || p.type === 'tool-result');
}

function filterDelegationMessages({ messages, primitiveId }: { messages: MastraDBMessage[]; primitiveId: string }): MastraDBMessage[] {
  if (PROMPT_ONLY_AGENTS.has(primitiveId)) {
    return [];
  }

  return messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && !hasToolInvocations(m))
    .slice(-MAX_TEXT_MESSAGES_FOR_CONTEXT);
}

function extractContextFromPrompt(prompt: string): string | undefined {
  const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const appIdMatch = prompt.match(/(?:applicationId|application_id)=([0-9a-f-]{36})/i) ?? prompt.match(uuidRe);
  const appId = appIdMatch?.[1] ?? appIdMatch?.[0];
  if (!appId) return undefined;

  const ownerMatch = prompt.match(/(?:owner|owner\/repo)=["']?([a-zA-Z0-9_-]+)/i);
  const repoMatch = prompt.match(/(?:repo(?:sitory)?|repo)=["']?([a-zA-Z0-9_.-]+)/i)
    ?? (ownerMatch ? prompt.match(/\/([a-zA-Z0-9_.-]+)(?:\s|$|\)|,)/) : null);
  const branchMatch = prompt.match(/(?:branch)=["']?([a-zA-Z0-9_/-]+)/i);

  const parts = [`applicationId=${appId}`];
  if (ownerMatch?.[1]) parts.push(`owner=${ownerMatch[1]}`);
  if (repoMatch?.[1]) parts.push(`repo=${repoMatch[1]}`);
  parts.push(`branch=${branchMatch?.[1] ?? 'main'}`);

  return `${prompt}\n\n[context: ${parts.join(', ')}]`;
}

async function handleDelegationStart(context: { primitiveId: string; prompt: string; iteration: number }) {
  if (context.iteration > MAX_DELEGATION_ITERATIONS) {
    logger.warn(
      { primitiveId: context.primitiveId, iteration: context.iteration },
      'Delegation rejected: max iterations',
    );
    return { proceed: false, rejectionReason: 'Too many iterations. Synthesize current findings and report to user.' };
  }

  const shouldInjectContext = CONTEXT_AWARE_AGENTS.has(context.primitiveId)
    && !context.prompt.includes('[context: applicationId=');

  const modifiedPrompt = shouldInjectContext
    ? extractContextFromPrompt(context.prompt)
    : undefined;

  const modifiedMaxSteps = AGENT_STEP_LIMITS[context.primitiveId] ?? DEFAULT_MAX_STEPS;
  logger.info(
    {
      primitiveId: context.primitiveId,
      iteration: context.iteration,
      modifiedMaxSteps,
      contextInjected: Boolean(modifiedPrompt),
    },
    'Delegation start',
  );
  return { proceed: true, modifiedMaxSteps, ...(modifiedPrompt && { modifiedPrompt }) };
}

async function handleDelegationComplete(context: { primitiveId: string; result?: unknown; error?: unknown; bail: () => void }) {
  if (!context.error) {
    logger.info({ primitiveId: context.primitiveId }, 'Delegation complete');
    return {};
  }

  logger.error({ primitiveId: context.primitiveId, error: context.error }, 'delegation failed');
  context.bail();
  return { feedback: `Delegation to ${context.primitiveId} failed: ${context.error}. Try using direct tools instead.` };
}

export const deployAgent = new Agent({
  id: 'deploy-agent',
  name: 'Deploy Agent',
  instructions: ({ requestContext }) => {
    if (config.selfHosted) return DEPLOY_INSTRUCTIONS;
    const warning = requestContext?.get?.('machineWarning') as { status?: string } | undefined;
    return warning?.status === 'upgrade_required'
      ? DEPLOY_INSTRUCTIONS + TRIAL_MACHINE_NOTICE
      : DEPLOY_INSTRUCTIONS;
  },
  model: ({ requestContext }) => requestContext?.get?.('modelId') || config.agentModel,
  inputProcessors: [unicodeNormalizer, deployStateProcessor],
  workspace: createRequestWorkspace,
  tools: deployTools,
  agents: {
    diagnostics: diagnosticAgent,
    machine: machineAgent,
    infrastructure: infrastructureAgent,
    github: githubAgent,
    preDeploy: preDeployAgent,
    notification: notificationAgent,
    billing: billingAgent,
  },
  memory: deployMemory as unknown as MastraMemory,
  defaultOptions: agentDefaults({
    maxSteps: 40,
    modelSettings: { maxOutputTokens: 4000 },
    providerOptions: openrouterProvider(4000, { cache: true, reasoning: 'low' }),
    delegation: {
      messageFilter: filterDelegationMessages,
      onDelegationStart: handleDelegationStart,
      onDelegationComplete: handleDelegationComplete,
    },
  }),
});
