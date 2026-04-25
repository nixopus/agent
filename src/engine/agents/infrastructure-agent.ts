import { Agent } from '@mastra/core/agent';
import { config } from '../../config';
import { openrouterProvider, agentDefaults } from './shared';
import { nixopusApiTool } from '../tools/api/nixopus-api-tool';
import { httpTools } from '../tools/diagnostics/http-tools';
import { guardToolsForSchemaCompat } from '../tools/shared/schema-compat-guard';
import { withCompactOutput } from '../tools/shared/compact-output';
import { withToonOutput } from '../tools/shared/toon-output';
import { ApiCatalogInjector } from './api-catalog-injector';

const apiCatalogInjector = new ApiCatalogInjector();

const infraCoreTools = withToonOutput(withCompactOutput(guardToolsForSchemaCompat({
  nixopusApi: nixopusApiTool,
  httpProbe: httpTools.httpProbe,
})));

export const infrastructureAgent = new Agent({
  id: 'infrastructure-agent',
  name: 'Infrastructure Agent',
  description: 'Manages servers, containers, and domains. Handles container lifecycle, domain binding, and reachability checks.',
  instructions: `Manage servers, containers, domains, and healthchecks for Nixopus apps. Use nixopus_api(operation, params) for all API calls. See [api-catalog] in context for available operations. Be concise. Never use emojis in any output. Plain text only.

Key operations: get_servers, get_container, get_domains, get_servers_ssh_status, get_application_servers, set_application_servers, set_server_as_org_default, get_container_logs, start_container, stop_container, restart_container, create_domain, delete_domain, generate_random_subdomain, add_application_domain, remove_application_domain, create_health_check, get_health_check, update_health_check, delete_health_check, toggle_health_check, get_health_check_results, get_health_check_stats.

Responsibilities:
- Container lifecycle: start, stop, restart containers. View container details and logs.
- Domain management: create, delete, bind/unbind domains. Generate random subdomains. Check reachability via http_probe.
- Healthchecks: create, update, delete, toggle healthchecks. View results and stats.
- Server context: list servers, check SSH status, manage application-to-server assignments, set org default server.`,
  model: config.agentLightModel,
  inputProcessors: [apiCatalogInjector],
  tools: infraCoreTools,
  defaultOptions: agentDefaults({
    maxSteps: 15,
    modelSettings: { maxOutputTokens: 4000 },
    providerOptions: openrouterProvider(4000),
  }),
});
