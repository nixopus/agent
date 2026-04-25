import { Agent } from '@mastra/core/agent';
import { config } from '../../config';
import { unicodeNormalizer, tokenLimiter, openrouterProvider, agentDefaults, coreInstructions } from './shared';
import { createRequestWorkspace } from '../workspace-factory';
import { nixopusApiTool } from '../tools/api/nixopus-api-tool';
import { guardToolsForSchemaCompat } from '../tools/shared/schema-compat-guard';
import { ApiCatalogInjector } from './api-catalog-injector';

const apiCatalogInjector = new ApiCatalogInjector();

export const rawMachineCoreTools = {
  nixopusApi: nixopusApiTool,
};

const machineCoreTools = guardToolsForSchemaCompat(rawMachineCoreTools);

export const machineAgent = new Agent({
  id: 'machine-agent',
  name: 'Machine Agent',
  description: 'Manages server-level operations: system health (CPU, RAM, disk), Docker daemon, Caddy proxy, DNS, network connectivity, and machine backups (list, schedule, trigger).',
  instructions: coreInstructions(
    'Machine-level diagnostics and lifecycle management. No emojis. Plain text only.',
    [
      'machine-ops — Diagnostic layers, lifecycle management, metrics analysis, backup operations. Load first when investigating server health.',
      'domain-tls-routing — Domain resolution, TLS certificates, proxy routing, DNS diagnosis.',
      'container-resource-tuning — Default resource limits, OOM diagnosis, CPU throttling, JVM/Node/Python tuning.',
    ],
    `## API Access
Use nixopus_api(operation, params) for all Nixopus API calls. See [api-catalog] in context for available operations.
Key operations: get_machine_stats, host_exec, get_machine_lifecycle_status, get_servers, get_servers_ssh_status, get_domains, get_machine_metrics, get_machine_metrics_summary, get_machine_events, restart_machine, pause_machine, resume_machine, get_backup_schedule, list_machine_backups, trigger_machine_backup, update_backup_schedule.
Operations marked with approval (restart_machine, pause_machine, resume_machine, trigger_machine_backup) require user confirmation.`,
  ),
  model: config.agentLightModel,
  workspace: createRequestWorkspace,
  inputProcessors: [unicodeNormalizer, apiCatalogInjector],
  outputProcessors: [tokenLimiter(4000)],
  tools: machineCoreTools,
  defaultOptions: agentDefaults({
    maxSteps: 12,
    modelSettings: { maxOutputTokens: 4000 },
    providerOptions: openrouterProvider(4000, { cache: true, noReasoning: true }),
  }),
});
