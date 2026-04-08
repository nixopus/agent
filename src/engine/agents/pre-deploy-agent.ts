import { Agent } from '@mastra/core/agent';
import { config } from '../../config';
import { openrouterProvider, agentDefaults, coreInstructions } from './shared';
import { codebaseTools } from '../tools/codebase/codebase-tools';
import { createRequestWorkspace } from '../workspace-factory';
import { getApplicationsTool, getApplicationTool } from '../tools/api/application-tools';
import { getDomainsTool } from '../tools/api/domain-tools';
import { getServersTool, getServersSshStatusTool } from '../tools/api/system-tools';
import { guardToolsForSchemaCompat } from '../tools/shared/schema-compat-guard';

const preDeployAgentTools = {
  analyzeRepository: codebaseTools.analyzeRepository,
  prepareCodebase: codebaseTools.prepareCodebase,
  loadLocalWorkspace: codebaseTools.loadLocalWorkspace,
  getApplications: getApplicationsTool,
  getApplication: getApplicationTool,
  getDomains: getDomainsTool,
  getServers: getServersTool,
  getServersSshStatus: getServersSshStatusTool,
};
const safePreDeployAgentTools = guardToolsForSchemaCompat(preDeployAgentTools);

export const preDeployAgent = new Agent({
  id: 'pre-deploy-agent',
  name: 'Pre-Deploy Agent',
  description:
    'Pre-deployment readiness checker. Scans codebase for env issues, secrets, vulnerabilities, and structure before deploying.',
  instructions: coreInstructions(
    `Pre-deployment readiness analyst. Discover IDs via get_applications — never ask users. Never use emojis. Plain text only.
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
  ),
  model: config.agentLightModel,
  workspace: createRequestWorkspace,
  tools: safePreDeployAgentTools,
  defaultOptions: agentDefaults({
    maxSteps: 12,
    modelSettings: { maxOutputTokens: 4000 },
    providerOptions: openrouterProvider(4000),
  }),
});
