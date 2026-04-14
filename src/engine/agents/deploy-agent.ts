import { Agent } from '@mastra/core/agent';
import type { MastraMemory } from '@mastra/core/memory';
import { Memory } from '@mastra/memory';
import { config } from '../../config';
import { applicationTools } from '../tools/api/application-tools';
import { projectTools } from '../tools/api/project-tools';
import { generateRandomSubdomainTool } from '../tools/api/domain-tools';
import { resolveContextTool } from '../tools/api/context-tools';
import { askUserTool } from '../tools/shared/ask-user-tool';
import { diagnosticAgent } from './diagnostic-agent';
import { machineAgent } from './machine-agent';
import { preDeployAgent } from './pre-deploy-agent';
import { notificationAgent } from './notification-agent';
import { billingAgent } from './billing-agent';
import { githubAgent } from './github-agent';
import { infrastructureAgent } from './infrastructure-agent';
import { delegateTool, registerDelegateAgents } from '../tools/shared/delegate-tool';
import { rawDeploySearchableTools } from './raw-deploy-searchable-tools';
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
import { ContextInjectorProcessor } from './context-injector';
import { DeployPatternProcessor } from './deploy-pattern-processor';
import { DeployOutcomeProcessor } from './deploy-outcome-processor';
import { PatternStore } from './pattern-store';
import { createRequestWorkspace } from '../workspace-factory';
import { getDb } from '../../db';

const contextInjector = new ContextInjectorProcessor();
const deployStateProcessor = new DeployStateProcessor();
const toolResultPruner = new ToolResultPruner();
const deployPatternProcessor = new DeployPatternProcessor();
const deployOutcomeProcessor = new DeployOutcomeProcessor();

if (config.databaseUrl) {
  const patternStore = new PatternStore(getDb(config.databaseUrl) as any);
  deployPatternProcessor.setPatternStore(patternStore);
  deployOutcomeProcessor.setPatternStore(patternStore);
}

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

export { rawDeploySearchableTools };

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
  inputProcessors: [unicodeNormalizer, contextInjector, deployStateProcessor, deployPatternProcessor, toolResultPruner, deployToolSearch, tokenLimiter(128_000)],
  outputProcessors: [deployOutcomeProcessor],
  workspace: createRequestWorkspace,
  tools: { ...deployCoreTools, delegate: delegateTool },
  memory: deployMemory as unknown as MastraMemory,
  defaultOptions: agentDefaults({
    maxSteps: 100,
    modelSettings: { maxOutputTokens: 4000 },
    providerOptions: openrouterProvider(4000, { cache: true, reasoning: 'low' }),
  }),
});
