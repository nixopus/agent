import { Agent } from '@mastra/core/agent';
import type { MastraMemory } from '@mastra/core/memory';
import { Memory } from '@mastra/memory';
import { PostgresStore } from '@mastra/pg';
import { getMemoryPool } from '../../db/pool';
import { config } from '../../config';
import { unicodeNormalizer, tokenLimiter, agentDefaults } from './shared';
import { createRequestWorkspace } from '../workspace-factory';
import {
  getApplicationsTool,
  getApplicationTool,
  getApplicationDeploymentsTool,
  getDeploymentLogsTool,
  getApplicationLogsTool,
  redeployApplicationTool,
  restartDeploymentTool,
} from '../tools/api/application-tools';
import { getGithubConnectorsTool, getGithubRepositoriesTool, getGithubRepositoryBranchesTool } from '../tools/api/github-connector-tools';
import { githubTools } from '../tools/github/github-tools';
import { notificationTools } from '../tools/api/notification-tools';
import { listContainersTool, getContainerTool, getContainerLogsTool } from '../tools/api/container-tools';
import { diagnosticAgent } from './diagnostic-agent';
import { githubAgent } from './github-agent';
import { notificationAgent } from './notification-agent';
import { guardToolsForSchemaCompat } from '../tools/shared/schema-compat-guard';
import { withCompactOutput } from '../tools/shared/compact-output';
import { withToonOutput } from '../tools/shared/toon-output';

const INCIDENT_INSTRUCTIONS = `You are an autonomous incident response agent. You receive structured failure events from various sources and attempt to diagnose, fix, and notify. Plain text only, no emojis.

## Skills
You have workspace skills. ALWAYS load the incident response skill first:
- read_skill("incident-response") — severity classification, structured workflow, auto-fix decision matrix, notification templates
- read_skill("rollback-strategy") — use when deciding whether to rollback vs fix forward after repeated failures

Follow the workflow defined in the incident-response skill. It provides severity classification, decision matrices, and notification templates.

## Event Context
Your prompt contains the full incident context formatted by the event pipeline. This includes the event type, source details, error information, and any relevant identifiers (application, deployment, repository, etc.). Use all provided context to drive your investigation.

## Rules
- Never merge PRs. Always return the PR URL for user approval.
- Never push to main/master. Always create a fix branch.
- If you cannot determine the root cause, notify the user with what you found and stop.
- Do not retry the same fix more than once. Maximum 3 auto-fix attempts per incident before escalating.
- Include all relevant context identifiers when delegating to diagnostics or github.
- After delegation returns, immediately process the result. Never say work is "underway".
- Every response must end with concrete information or a completed action.

## Memory
Use recalled context from past incidents for this thread when helpful. Prefer continuity across steps in the same incident.`;

export const incidentMemoryStore = new PostgresStore({
  id: 'incident-agent-memory',
  pool: getMemoryPool(config.databaseUrl),
});

const incidentMemory = new Memory({
  storage: incidentMemoryStore,
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

const rawIncidentTools = {
  getApplications: getApplicationsTool,
  getApplication: getApplicationTool,
  getApplicationDeployments: getApplicationDeploymentsTool,
  getDeploymentLogs: getDeploymentLogsTool,
  getApplicationLogs: getApplicationLogsTool,
  redeployApplication: redeployApplicationTool,
  restartDeployment: restartDeploymentTool,
  getGithubConnectors: getGithubConnectorsTool,
  getGithubRepositories: getGithubRepositoriesTool,
  getGithubRepositoryBranches: getGithubRepositoryBranchesTool,
  ...githubTools,
  ...notificationTools,
  listContainers: listContainersTool,
  getContainer: getContainerTool,
  getContainerLogs: getContainerLogsTool,
};

const incidentTools = withToonOutput(withCompactOutput(guardToolsForSchemaCompat(rawIncidentTools)));

export const incidentAgent = new Agent({
  id: 'incident-agent',
  name: 'Incident Response Agent',
  description: 'Autonomous incident handler. Diagnoses failures, creates fix PRs, and notifies users.',
  instructions: INCIDENT_INSTRUCTIONS,
  model: config.agentModel,
  workspace: createRequestWorkspace,
  inputProcessors: [unicodeNormalizer],
  outputProcessors: [tokenLimiter(4000)],
  tools: incidentTools,
  agents: {
    diagnostics: diagnosticAgent,
    github: githubAgent,
    notification: notificationAgent,
  },
  memory: incidentMemory as unknown as MastraMemory,
  defaultOptions: agentDefaults({
    maxSteps: 30,
    modelSettings: { maxOutputTokens: 4000 },
  }),
});
