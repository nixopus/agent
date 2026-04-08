import { Agent } from '@mastra/core/agent';
import type { MastraMemory } from '@mastra/core/memory';
import { ToolSearchProcessor } from '@mastra/core/processors';
import { Memory } from '@mastra/memory';
import { config } from '../../config';
import { unicodeNormalizer, tokenLimiter, openrouterProvider, agentDefaults, coreInstructions } from './shared';
import { createRequestWorkspace } from '../workspace-factory';
import {
  getApplicationsTool,
  getApplicationTool,
  getApplicationDeploymentsTool,
  getDeploymentLogsTool,
  getApplicationLogsTool,
  getComposeServicesTool,
  restartDeploymentTool,
  redeployApplicationTool,
} from '../tools/api/application-tools';
import { listContainersTool, getContainerTool, getContainerLogsTool } from '../tools/api/container-tools';
import { httpProbeTool } from '../tools/diagnostics/http-tools';
import { guardToolsForSchemaCompat } from '../tools/shared/schema-compat-guard';
import { withCompactOutput } from '../tools/shared/compact-output';
import { withToonOutput } from '../tools/shared/toon-output';

const diagnosticCoreTools = withToonOutput(withCompactOutput(guardToolsForSchemaCompat({
  getApplications: getApplicationsTool,
  getApplication: getApplicationTool,
  getApplicationDeployments: getApplicationDeploymentsTool,
  getDeploymentLogs: getDeploymentLogsTool,
  listContainers: listContainersTool,
})));

const diagnosticSearchableTools = withToonOutput(withCompactOutput(guardToolsForSchemaCompat({
  getApplicationLogs: getApplicationLogsTool,
  getContainerLogs: getContainerLogsTool,
  getContainer: getContainerTool,
  restartDeployment: restartDeploymentTool,
  redeployApplication: redeployApplicationTool,
  getComposeServices: getComposeServicesTool,
  httpProbe: httpProbeTool,
})));

const diagnosticToolSearch = new ToolSearchProcessor({
  tools: diagnosticSearchableTools,
  search: { topK: 5, minScore: 0.1 },
});

const diagnosticMemory = new Memory({
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

export const diagnosticAgent = new Agent({
  id: 'diagnostic-agent',
  name: 'Diagnostic Agent',
  description:
    'Application-level debugger. Investigates deployment failures, container crashes, build errors, and runtime issues layer by layer.',
  instructions: coreInstructions(
    'Application and container debugger. Discover IDs via list tools. No emojis. Plain text only.',
    [
      'diagnostic-workflow — Layer-by-layer diagnostic process: deployments, logs, containers, HTTP probes. Load first when investigating any issue.',
      'failure-diagnosis — Pattern tables for build errors, container crashes, and a diagnostic decision tree.',
      'container-resource-tuning — OOM-killed (exit 137), CPU-throttled, or slow containers due to resource limits.',
      'node-deploy, go-deploy, python-deploy, etc. — Ecosystem-specific context. Load after identifying the ecosystem.',
    ],
    `## Tool Loading
Core tools: get_applications, get_application, get_application_deployments, get_deployment_logs, list_containers.
For deeper diagnostics, use search_tools("<keyword>") then load_tool.

## Memory
Use recalled context from this thread when the parent run passes thread and resource. Prefer continuity across diagnostic steps.`,
  ),
  model: config.agentModel,
  workspace: createRequestWorkspace,
  inputProcessors: [unicodeNormalizer, diagnosticToolSearch],
  outputProcessors: [tokenLimiter(4000)],
  tools: diagnosticCoreTools,
  memory: diagnosticMemory as unknown as MastraMemory,
  defaultOptions: agentDefaults({
    maxSteps: 15,
    modelSettings: { maxOutputTokens: 4000 },
    providerOptions: openrouterProvider(4000, { cache: true, noReasoning: true }),
  }),
});
