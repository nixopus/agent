import { Agent } from '@mastra/core/agent';
import type { MastraMemory } from '@mastra/core/memory';
import { Memory } from '@mastra/memory';
import { config } from '../../config';
import { quickDeployTool, createProjectTool } from '../tools/api/project-tools';
import { resolveContextTool } from '../tools/api/context-tools';
import { nixopusApiTool } from '../tools/api/nixopus-api-tool';
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
import { withToolGovernor, type GovernorPolicy } from '../tools/shared/tool-governor';
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
import { DeployFlowInjector } from './deploy-flow-injector';
import { ApiCatalogInjector } from './api-catalog-injector';
import { ToolBudgetProcessor } from './tool-budget-processor';
import { PatternStore } from './pattern-store';
import { createRequestWorkspace } from '../workspace-factory';
import { getDb } from '../../db';

const contextInjector = new ContextInjectorProcessor();
const deployFlowInjector = new DeployFlowInjector();
const apiCatalogInjector = new ApiCatalogInjector();
const toolBudgetProcessor = new ToolBudgetProcessor(100);

const DEPLOY_GOVERNOR_POLICY: GovernorPolicy = {
  defaultLimit: 5,
  readOnlyLimit: 8,
  cacheTtlMs: 15_000,
  readOnlyTools: new Set([
    'resolveContext',
    'search_tools', 'load_tool',
    'nixopusApi',
  ]),
  limits: {
    resolveContext: 2,
    search_tools: 10,
    load_tool: 10,
    quickDeploy: 2,
    nixopusApi: 40,
    askUser: 5,
  },
};
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
  createProject: createProjectTool,
  quickDeploy: quickDeployTool,
  resolveContext: resolveContextTool,
  nixopusApi: nixopusApiTool,
  askUser: askUserTool,
};

export { rawDeploySearchableTools };

const deployCoreTools = withToonOutput(withCompactOutput(withToolGovernor(withSourceGuard(guardToolsForSchemaCompat(rawDeployCoreTools)), DEPLOY_GOVERNOR_POLICY)));
const deploySearchableTools = withToonOutput(withCompactOutput(withToolGovernor(withSourceGuard(guardToolsForSchemaCompat(rawDeploySearchableTools)), DEPLOY_GOVERNOR_POLICY)));

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
  inputProcessors: [unicodeNormalizer, contextInjector, apiCatalogInjector, deployFlowInjector, deployStateProcessor, toolBudgetProcessor, deployPatternProcessor, toolResultPruner, deployToolSearch, tokenLimiter(128_000)],
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
