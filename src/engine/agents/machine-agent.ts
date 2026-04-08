import { Agent } from '@mastra/core/agent';
import { ToolSearchProcessor } from '@mastra/core/processors';
import { config } from '../../config';
import { unicodeNormalizer, tokenLimiter, openrouterProvider, agentDefaults, coreInstructions } from './shared';
import { createRequestWorkspace } from '../workspace-factory';
import { machineTools } from '../tools/api/machine-tools';
import { backupTools } from '../tools/api/backup-tools';
import { getServersTool, getServersSshStatusTool } from '../tools/api/system-tools';
import { getDomainsTool } from '../tools/api/domain-tools';
import { guardToolsForSchemaCompat } from '../tools/shared/schema-compat-guard';

export const rawMachineCoreTools = {
  getMachineStats: machineTools.getMachineStats,
  hostExec: machineTools.hostExec,
  getMachineLifecycleStatus: machineTools.getMachineLifecycleStatus,
  getServers: getServersTool,
  getServersSshStatus: getServersSshStatusTool,
  getDomains: getDomainsTool,
  getMachineMetrics: machineTools.getMachineMetrics,
  getMachineMetricsSummary: machineTools.getMachineMetricsSummary,
};

export const rawMachineSearchableTools = {
  restartMachine: machineTools.restartMachine,
  pauseMachine: machineTools.pauseMachine,
  resumeMachine: machineTools.resumeMachine,
  getMachineEvents: machineTools.getMachineEvents,
  getBackupSchedule: backupTools.getBackupSchedule,
  listMachineBackups: backupTools.listMachineBackups,
  triggerMachineBackup: backupTools.triggerMachineBackup,
  updateBackupSchedule: backupTools.updateBackupSchedule,
};

const machineCoreTools = guardToolsForSchemaCompat(rawMachineCoreTools);
const machineSearchableTools = guardToolsForSchemaCompat(rawMachineSearchableTools);

const machineToolSearch = new ToolSearchProcessor({
  tools: machineSearchableTools,
  search: { topK: 4, minScore: 0.1 },
});

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
    `## Tool Loading
Core tools: get_machine_stats, host_exec, get_machine_lifecycle_status, get_servers, get_servers_ssh_status, get_domains, get_machine_metrics, get_machine_metrics_summary.
For lifecycle mutations and backups, use search_tools("<keyword>") then load_tool.`,
  ),
  model: config.agentLightModel,
  workspace: createRequestWorkspace,
  inputProcessors: [unicodeNormalizer, machineToolSearch],
  outputProcessors: [tokenLimiter(4000)],
  tools: machineCoreTools,
  defaultOptions: agentDefaults({
    maxSteps: 12,
    modelSettings: { maxOutputTokens: 4000 },
    providerOptions: openrouterProvider(4000, { cache: true, noReasoning: true }),
  }),
});
