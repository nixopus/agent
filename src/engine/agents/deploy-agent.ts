import { Agent } from '@mastra/core/agent';
import type { MastraMemory } from '@mastra/core/memory';
import { Memory } from '@mastra/memory';
import { config } from '../../config';
import { applicationTools } from '../tools/api/application-tools';
import { projectTools } from '../tools/api/project-tools';
import { githubConnectorTools } from '../tools/api/github-connector-tools';
import { getDomainsTool, generateRandomSubdomainTool, createDomainTool, updateDomainTool } from '../tools/api/domain-tools';
import { addApplicationDomainTool } from '../tools/api/application-tools';
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
import { delegateTool, registerDelegateAgents } from '../tools/shared/delegate-tool';
import { nixopusDocsTools } from '../tools/docs/nixopus-docs-tool';
import { mcpServerTools } from '../tools/api/mcp-server-tools';
import { guardToolsForSchemaCompat } from '../tools/shared/schema-compat-guard';
import { withCompactOutput } from '../tools/shared/compact-output';
import { withToonOutput } from '../tools/shared/toon-output';
import { withSourceGuard } from '../tools/shared/source-guard';
import { ToolSearchProcessor } from '@mastra/core/processors';
import {
  unicodeNormalizer,
  tokenLimiter,
  openrouterProvider,
  agentDefaults,
  DEPLOY_INSTRUCTIONS,
} from './shared';
import { DeployStateProcessor } from './deploy-state-processor';
import { ToolResultPruner } from './tool-result-pruner';
import { createRequestWorkspace } from '../workspace-factory';

const deployStateProcessor = new DeployStateProcessor();
const toolResultPruner = new ToolResultPruner();

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

export const rawDeployCoreTools = {
  getApplications: applicationTools.getApplications,
  getApplication: applicationTools.getApplication,
  getApplicationDeployments: applicationTools.getApplicationDeployments,
  getDeploymentById: applicationTools.getDeploymentById,
  getDeploymentLogs: applicationTools.getDeploymentLogs,
  deployProject: projectTools.deployProject,
  createProject: projectTools.createProject,
  generateRandomSubdomain: generateRandomSubdomainTool,
  resolveContext: resolveContextTool,
  askUser: askUserTool,
};

export const rawDeploySearchableTools = {
  getGithubConnectors: githubConnectorTools.getGithubConnectors,
  getGithubRepositories: githubConnectorTools.getGithubRepositories,
  analyzeRepository: codebaseTools.analyzeRepository,
  prepareCodebase: codebaseTools.prepareCodebase,
  loadLocalWorkspace: codebaseTools.loadLocalWorkspace,
  writeWorkspaceFiles: deployGenTools.writeWorkspaceFiles,
  getDomains: getDomainsTool,
  addApplicationDomain: addApplicationDomainTool,
  updateApplication: applicationTools.updateApplication,
  updateApplicationLabels: applicationTools.updateApplicationLabels,
  restartDeployment: applicationTools.restartDeployment,
  rollbackDeployment: applicationTools.rollbackDeployment,
  redeployApplication: applicationTools.redeployApplication,
  recoverApplication: applicationTools.recoverApplication,
  deleteApplication: applicationTools.deleteApplication,
  previewCompose: applicationTools.previewCompose,
  getComposeServices: applicationTools.getComposeServices,
  duplicateProject: projectTools.duplicateProject,
  getProjectFamily: projectTools.getProjectFamily,
  getEnvironmentsInFamily: projectTools.getEnvironmentsInFamily,
  addProjectToFamily: projectTools.addProjectToFamily,
  createGithubConnector: githubConnectorTools.createGithubConnector,
  updateGithubConnector: githubConnectorTools.updateGithubConnector,
  deleteGithubConnector: githubConnectorTools.deleteGithubConnector,
  getGithubRepositoryBranches: githubConnectorTools.getGithubRepositoryBranches,
  githubGetRepoFile: githubTools.githubGetRepoFile,
  githubGetBranch: githubTools.githubGetBranch,
  githubCreateBranch: githubTools.githubCreateBranch,
  githubCreateOrUpdateFile: githubTools.githubCreateOrUpdateFile,
  githubCreatePullRequest: githubTools.githubCreatePullRequest,
  createDomain: createDomainTool,
  updateDomain: updateDomainTool,
  fetchNixopusDocsIndex: nixopusDocsTools.fetchNixopusDocsIndex,
  fetchNixopusDocsPage: nixopusDocsTools.fetchNixopusDocsPage,
  listMcpProviderCatalog: mcpServerTools.listMcpProviderCatalog,
  listOrgMcpServers: mcpServerTools.listOrgMcpServers,
  addMcpServer: mcpServerTools.addMcpServer,
  updateMcpServer: mcpServerTools.updateMcpServer,
  deleteMcpServer: mcpServerTools.deleteMcpServer,
  testMcpServerConnection: mcpServerTools.testMcpServerConnection,
  discoverMcpTools: mcpServerTools.discoverMcpTools,
  listEnabledMcpServers: mcpServerTools.listEnabledMcpServers,
  callMcpTool: mcpServerTools.callMcpTool,
};

const deployCoreTools = withToonOutput(withCompactOutput(withSourceGuard(guardToolsForSchemaCompat(rawDeployCoreTools))));
const deploySearchableTools = withToonOutput(withCompactOutput(withSourceGuard(guardToolsForSchemaCompat(rawDeploySearchableTools))));

const deployToolSearch = new ToolSearchProcessor({
  tools: deploySearchableTools,
  search: { topK: 6, minScore: 0.1 },
});

registerDelegateAgents({
  diagnostics: diagnosticAgent,
  machine: machineAgent,
  infrastructure: infrastructureAgent,
  github: githubAgent,
  preDeploy: preDeployAgent,
  notification: notificationAgent,
  billing: billingAgent,
});

export const deployAgent = new Agent({
  id: 'deploy-agent',
  name: 'Deploy Agent',
  instructions: DEPLOY_INSTRUCTIONS,
  model: ({ requestContext }) => requestContext?.get?.('modelId') || config.agentModel,
  inputProcessors: [unicodeNormalizer, deployStateProcessor, toolResultPruner, deployToolSearch, tokenLimiter(128_000)],
  workspace: createRequestWorkspace,
  tools: { ...deployCoreTools, delegate: delegateTool },
  memory: deployMemory as unknown as MastraMemory,
  defaultOptions: agentDefaults({
    maxSteps: 100,
    modelSettings: { maxOutputTokens: 4000 },
    providerOptions: openrouterProvider(4000, { cache: true, reasoning: 'low' }),
  }),
});
