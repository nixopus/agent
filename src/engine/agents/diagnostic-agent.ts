import { Agent } from '@mastra/core/agent';
import type { MastraMemory } from '@mastra/core/memory';
import { Memory } from '@mastra/memory';
import { config } from '../../config';
import { unicodeNormalizer, tokenLimiter, openrouterProvider, agentDefaults, coreInstructions } from './shared';
import { createRequestWorkspace } from '../workspace-factory';
import { nixopusApiTool } from '../tools/api/nixopus-api-tool';
import { httpProbeTool } from '../tools/diagnostics/http-tools';
import { guardToolsForSchemaCompat } from '../tools/shared/schema-compat-guard';
import { withCompactOutput } from '../tools/shared/compact-output';
import { withToonOutput } from '../tools/shared/toon-output';
import { ApiCatalogInjector } from './api-catalog-injector';

const apiCatalogInjector = new ApiCatalogInjector();

const diagnosticCoreTools = withToonOutput(withCompactOutput(guardToolsForSchemaCompat({
  nixopusApi: nixopusApiTool,
  httpProbe: httpProbeTool,
})));

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
    'Application and container debugger. Discover IDs via nixopus_api. No emojis. Plain text only.',
    [
      'diagnostic-workflow — Layer-by-layer diagnostic process: deployments, logs, containers, HTTP probes. Load first when investigating any issue.',
      'failure-diagnosis — Pattern tables for build errors, container crashes, and a diagnostic decision tree.',
      'container-resource-tuning — OOM-killed (exit 137), CPU-throttled, or slow containers due to resource limits.',
      'node-deploy, go-deploy, python-deploy, etc. — Ecosystem-specific context. Load after identifying the ecosystem.',
    ],
    `## API Access
Use nixopus_api(operation, params) for all Nixopus API calls. See [api-catalog] in context for available operations.
Key operations: get_applications, get_application, get_application_deployments, get_deployment_logs, get_application_logs, list_containers, get_container, get_container_logs, get_compose_services, restart_deployment, redeploy_application.

## Memory
Use recalled context from this thread when the parent run passes thread and resource. Prefer continuity across diagnostic steps.`,
  ),
  model: config.agentModel,
  workspace: createRequestWorkspace,
  inputProcessors: [unicodeNormalizer, apiCatalogInjector],
  outputProcessors: [tokenLimiter(4000)],
  tools: diagnosticCoreTools,
  memory: diagnosticMemory as unknown as MastraMemory,
  defaultOptions: agentDefaults({
    maxSteps: 15,
    modelSettings: { maxOutputTokens: 4000 },
    providerOptions: openrouterProvider(4000, { cache: true, noReasoning: true }),
  }),
});
