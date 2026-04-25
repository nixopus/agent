import { Agent } from '@mastra/core/agent';
import { config } from '../../config';
import { openrouterProvider, agentDefaults, coreInstructions } from './shared';
import { codebaseTools } from '../tools/codebase/codebase-tools';
import { createRequestWorkspace } from '../workspace-factory';
import { nixopusApiTool } from '../tools/api/nixopus-api-tool';
import { guardToolsForSchemaCompat } from '../tools/shared/schema-compat-guard';
import { ApiCatalogInjector } from './api-catalog-injector';

const apiCatalogInjector = new ApiCatalogInjector();

const preDeployAgentTools = {
  analyzeRepository: codebaseTools.analyzeRepository,
  prepareCodebase: codebaseTools.prepareCodebase,
  loadLocalWorkspace: codebaseTools.loadLocalWorkspace,
  nixopusApi: nixopusApiTool,
};
const safePreDeployAgentTools = guardToolsForSchemaCompat(preDeployAgentTools);

export const preDeployAgent = new Agent({
  id: 'pre-deploy-agent',
  name: 'Pre-Deploy Agent',
  description:
    'Pre-deployment readiness checker. Scans codebase for env issues, secrets, vulnerabilities, and structure before deploying.',
  instructions: coreInstructions(
    `Pre-deployment readiness analyst. Discover IDs via nixopus_api('get_applications') — never ask users. Never use emojis. Plain text only.
NEVER reveal internal implementation details to the user: internal file paths, tool names, S3, BM25, workspace, build_pack.`,
    [
      'pre-deploy-checklist — Follow this checklist step by step. Defines exact checks and pass/fail criteria plus summary format. ALWAYS load first.',
      'env-detection — Environment variable detection patterns.',
      'deployment-analysis — Ecosystem and framework determination.',
      'database-migration — Validate migration commands in the deploy flow.',
      'dockerignore-generation — Check for missing .dockerignore.',
      'monorepo-strategy — Service discovery, dependency ordering, build context for monorepos.',
      'node-deploy, go-deploy, python-deploy, etc. — Ecosystem-specific validation after identifying the stack.',
    ],
    `## API Access
Use nixopus_api(operation, params) for all Nixopus API calls. See [api-catalog] in context for available operations.
Key operations: get_applications, get_application, get_domains, get_servers, get_servers_ssh_status.`,
  ),
  model: config.agentLightModel,
  workspace: createRequestWorkspace,
  inputProcessors: [apiCatalogInjector],
  tools: safePreDeployAgentTools,
  defaultOptions: agentDefaults({
    maxSteps: 12,
    modelSettings: { maxOutputTokens: 4000 },
    providerOptions: openrouterProvider(4000),
  }),
});
