import { Agent } from '@mastra/core/agent';
import { ToolSearchProcessor } from '@mastra/core/processors';
import { config } from '../../config';
import { openrouterProvider, agentDefaults } from './shared';
import { getContainerTool, getContainerLogsTool, startContainerTool, stopContainerTool, restartContainerTool } from '../tools/api/container-tools';
import { getDomainsTool, createDomainTool, deleteDomainTool, generateRandomSubdomainTool } from '../tools/api/domain-tools';
import { healthcheckTools } from '../tools/api/healthcheck-tools';
import { addApplicationDomainTool, removeApplicationDomainTool } from '../tools/api/application-tools';
import { getServersTool, getServersSshStatusTool } from '../tools/api/system-tools';
import { httpTools } from '../tools/diagnostics/http-tools';
import { guardToolsForSchemaCompat } from '../tools/shared/schema-compat-guard';
import { withCompactOutput } from '../tools/shared/compact-output';
import { withToonOutput } from '../tools/shared/toon-output';

const infraCoreTools = withToonOutput(withCompactOutput(guardToolsForSchemaCompat({
  getServers: getServersTool,
  getContainer: getContainerTool,
  getDomains: getDomainsTool,
})));

const infraSearchableTools = withToonOutput(withCompactOutput(guardToolsForSchemaCompat({
  getServersSshStatus: getServersSshStatusTool,
  getContainerLogs: getContainerLogsTool,
  startContainer: startContainerTool,
  stopContainer: stopContainerTool,
  restartContainer: restartContainerTool,
  createDomain: createDomainTool,
  deleteDomain: deleteDomainTool,
  generateRandomSubdomain: generateRandomSubdomainTool,
  addApplicationDomain: addApplicationDomainTool,
  removeApplicationDomain: removeApplicationDomainTool,
  httpProbe: httpTools.httpProbe,
  ...healthcheckTools,
})));

const infraToolSearch = new ToolSearchProcessor({
  tools: infraSearchableTools,
  search: { topK: 5, minScore: 0.1 },
});

export const infrastructureAgent = new Agent({
  id: 'infrastructure-agent',
  name: 'Infrastructure Agent',
  description: 'Manages servers, containers, and domains. Handles container lifecycle, domain binding, and reachability checks.',
  instructions: `Manage servers, containers, domains, and healthchecks for Nixopus apps. Discover IDs via list tools, never ask users. Be concise. Never use emojis in any output. Plain text only.

TOOL LOADING: Core tools are available immediately (get_servers, get_container, get_domains). For mutations, diagnostics, and healthcheck management, use search_tools to find tools by keyword (e.g. "container start stop restart", "domain create delete bind", "http probe", "healthcheck create toggle results"), then load_tool to activate them.

Responsibilities:
- Container lifecycle: start, stop, restart containers. View container details and logs.
- Domain management: create, delete, bind/unbind domains. Generate random subdomains. Check reachability via http_probe.
- Healthchecks: create, update, delete, toggle healthchecks. View results and stats.
- Server context: list servers and check SSH status for infrastructure context.`,
  model: config.agentLightModel,
  inputProcessors: [infraToolSearch],
  tools: infraCoreTools,
  defaultOptions: agentDefaults({
    maxSteps: 15,
    modelSettings: { maxOutputTokens: 4000 },
    providerOptions: openrouterProvider(4000),
  }),
});

