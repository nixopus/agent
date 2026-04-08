import { Agent } from '@mastra/core/agent';
import type { MastraMemory } from '@mastra/core/memory';
import { ToolSearchProcessor } from '@mastra/core/processors';
import { Memory } from '@mastra/memory';
import { config } from '../../config';
import { unicodeNormalizer, tokenLimiter, agentDefaults, coreInstructions } from './shared';
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

const INCIDENT_INSTRUCTIONS = coreInstructions(
  'You are an autonomous incident response agent. You receive structured failure events and attempt to diagnose, fix, and notify. Plain text only, no emojis.',
  [
    'incident-response — Severity classification, structured workflow, auto-fix decision matrix, notification templates, safety rules. ALWAYS load first.',
    'rollback-strategy — When to rollback vs fix forward after repeated failures.',
    'failure-diagnosis — Pattern tables for build errors, container crashes.',
  ],
  `## Tool Loading
Core tools: get_applications, get_application, get_application_deployments, get_deployment_logs, list_containers, get_container, get_container_logs, get_github_connectors, get_github_repositories, send_notification, redeploy_application, restart_deployment.
For GitHub ops, channel-specific notifications, and app logs, use search_tools("<keyword>") then load_tool.

## Memory
Use recalled context from past incidents for this thread when helpful. Prefer continuity across steps in the same incident.`,
);

const incidentMemory = new Memory({
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

export const rawIncidentCoreTools = {
  getApplications: getApplicationsTool,
  getApplication: getApplicationTool,
  getApplicationDeployments: getApplicationDeploymentsTool,
  getDeploymentLogs: getDeploymentLogsTool,
  listContainers: listContainersTool,
  getContainer: getContainerTool,
  getContainerLogs: getContainerLogsTool,
  getGithubConnectors: getGithubConnectorsTool,
  getGithubRepositories: getGithubRepositoriesTool,
  sendNotification: notificationTools.sendNotification,
  redeployApplication: redeployApplicationTool,
  restartDeployment: restartDeploymentTool,
};

export const rawIncidentSearchableTools = {
  getApplicationLogs: getApplicationLogsTool,
  getGithubRepositoryBranches: getGithubRepositoryBranchesTool,
  githubListPullRequests: githubTools.githubListPullRequests,
  githubListIssues: githubTools.githubListIssues,
  githubCommentOnPr: githubTools.githubCommentOnPr,
  githubCommentOnIssue: githubTools.githubCommentOnIssue,
  githubCreateIssue: githubTools.githubCreateIssue,
  githubSetCommitStatus: githubTools.githubSetCommitStatus,
  githubCreateDeploymentStatus: githubTools.githubCreateDeploymentStatus,
  githubSearchRepoContent: githubTools.githubSearchRepoContent,
  githubGetRepoFile: githubTools.githubGetRepoFile,
  githubCreateOrUpdateFile: githubTools.githubCreateOrUpdateFile,
  githubGetBranch: githubTools.githubGetBranch,
  githubCreateBranch: githubTools.githubCreateBranch,
  githubCreatePullRequest: githubTools.githubCreatePullRequest,
  githubMergePullRequest: githubTools.githubMergePullRequest,
  sendSlackNotification: notificationTools.sendSlackNotification,
  sendDiscordNotification: notificationTools.sendDiscordNotification,
  sendEmailNotification: notificationTools.sendEmailNotification,
};

const incidentCoreTools = withToonOutput(withCompactOutput(guardToolsForSchemaCompat(rawIncidentCoreTools)));
const incidentSearchableTools = withToonOutput(withCompactOutput(guardToolsForSchemaCompat(rawIncidentSearchableTools)));

const incidentToolSearch = new ToolSearchProcessor({
  tools: incidentSearchableTools,
  search: { topK: 6, minScore: 0.1 },
});

export const incidentAgent = new Agent({
  id: 'incident-agent',
  name: 'Incident Response Agent',
  description: 'Autonomous incident handler. Diagnoses failures, creates fix PRs, and notifies users.',
  instructions: INCIDENT_INSTRUCTIONS,
  model: config.agentModel,
  workspace: createRequestWorkspace,
  inputProcessors: [unicodeNormalizer, incidentToolSearch],
  outputProcessors: [tokenLimiter(4000)],
  tools: incidentCoreTools,
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
