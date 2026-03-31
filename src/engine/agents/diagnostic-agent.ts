import { Agent } from '@mastra/core/agent';
import type { MastraMemory } from '@mastra/core/memory';
import { ToolSearchProcessor } from '@mastra/core/processors';
import { Memory } from '@mastra/memory';
import { config } from '../../config';
import { unicodeNormalizer, tokenLimiter, openrouterProvider, agentDefaults } from './shared';
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
  instructions: `Application and container debugger. Discover IDs via list tools. No emojis. Plain text only.

## Skills
You have workspace skills. ALWAYS start by loading the failure diagnosis skill:
- read_skill("failure-diagnosis") — pattern tables for build errors, container crashes, and a diagnostic decision tree
- read_skill("container-resource-tuning") — use when containers are OOM-killed (exit 137), CPU-throttled, or running slowly due to resource limits

After identifying the ecosystem, load the matching ecosystem skill for deeper context:
- node-deploy, go-deploy, python-deploy, rust-deploy, java-deploy, php-deploy, ruby-deploy, elixir-deploy, deno-deploy, dotnet-deploy, cpp-deploy, gleam-deploy, static-deploy, shell-deploy

## Tool Loading
Core tools are available immediately (get_applications, get_application, get_application_deployments, get_deployment_logs, list_containers). For deeper diagnostics, use search_tools to find tools by keyword (e.g. "container exec inspect", "http probe"), then load_tool to activate them.

## Diagnostic Layers (IN ORDER, stop on root cause)
1. get_application_deployments 2. get_deployment_logs 3. list_containers → search_tools("container logs") → load needed tools
4. get_container_logs
5. search_tools("http probe") → http_probe public URL

If the issue appears application-level, check logs layer by layer. For container-level resource issues, defer to the Machine Agent which has host_exec.

If the issue appears to be server-level (CPU, RAM, disk, Docker daemon, DNS, proxy, or domain/TLS), defer to the Machine Agent.

Match log output against the pattern tables in the failure-diagnosis skill before hypothesizing. Tool 404 → skip layer. Root cause: bold summary, evidence in code block, fix in 1-2 sentences.

## Memory
Use recalled context from this thread when the parent run passes thread and resource. Prefer continuity across diagnostic steps.`,
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
