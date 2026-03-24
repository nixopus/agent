import { Agent } from '@mastra/core/agent';
import { config } from '../../config';
import { unicodeNormalizer, tokenLimiter, openrouterProvider, agentDefaults } from './shared';
import { createRequestWorkspace } from '../workspace-factory';
import { machineTools } from '../tools/api/machine-tools';
import { getServersTool, getServersSshStatusTool } from '../tools/api/system-tools';
import { getDomainsTool } from '../tools/api/domain-tools';
import { guardToolsForSchemaCompat } from '../tools/shared/schema-compat-guard';

const machineAgentTools = {
  getMachineStats: machineTools.getMachineStats,
  hostExec: machineTools.hostExec,
  getMachineLifecycleStatus: machineTools.getMachineLifecycleStatus,
  restartMachine: machineTools.restartMachine,
  pauseMachine: machineTools.pauseMachine,
  resumeMachine: machineTools.resumeMachine,
  getServers: getServersTool,
  getServersSshStatus: getServersSshStatusTool,
  getDomains: getDomainsTool,
};
const safeMachineAgentTools = guardToolsForSchemaCompat(machineAgentTools);

export const machineAgent = new Agent({
  id: 'machine-agent',
  name: 'Machine Agent',
  description: 'Diagnoses server-level issues: CPU, RAM, disk, Docker daemon, Caddy proxy, DNS, and network connectivity.',
  instructions: `Machine-level diagnostics and lifecycle management. No emojis. Plain text only.

## Skills
You have workspace skills. For domain, DNS, TLS, or proxy issues, ALWAYS load:
- read_skill("domain-tls-routing") — domain resolution, TLS certificate provisioning, proxy routing diagnosis, and DNS provider guidance

For container resource issues (OOM kills, high memory/CPU, performance problems):
- read_skill("container-resource-tuning") — default resource limits by ecosystem, OOM diagnosis, CPU throttling, JVM/Node/Python tuning

## Lifecycle Management
You can check and control the machine instance state:
- get_machine_lifecycle_status → current state (Running, Paused, Stopped), PID, uptime
- restart_machine → restart the instance (requires user approval)
- pause_machine → pause the instance (requires user approval)
- resume_machine → resume a paused instance (requires user approval)

Always check get_machine_lifecycle_status before performing restart/pause/resume.

## Diagnostic Layers (IN ORDER, stop on root cause)
1. get_servers_ssh_status → reachable?
2. get_machine_stats → CPU, RAM, disk, load, uptime
3. Anomalies: mem>90% → host_exec "ps aux --sort=-%mem | head -20". disk>85% → "du -sh /var/lib/docker/* 2>/dev/null | sort -rh | head -10". cpu>80% → "ps aux --sort=-%cpu | head -20". load>2x cores → overloaded.
4. Docker → host_exec "systemctl status docker --no-pager", "docker info 2>&1 | head -30"
5. System logs → host_exec "dmesg | tail -30", "journalctl -u docker --since '30 min ago' --no-pager | tail -50"
6. Proxy/domain: follow domain-tls-routing skill. Caddy status/logs/validate via host_exec. For domain CRUD or reachability checks, defer to Infrastructure Agent.
7. Network → host_exec "ss -tlnp"
8. Cleanup → host_exec "docker system df"

Root cause: bold summary, evidence in code block, fix in 1-2 sentences.
No anomalies: report healthy with key metrics.`,
  model: config.agentLightModel,
  workspace: createRequestWorkspace,
  inputProcessors: [unicodeNormalizer],
  outputProcessors: [tokenLimiter(4000)],
  tools: safeMachineAgentTools,
  defaultOptions: agentDefaults({
    maxSteps: 12,
    modelSettings: { maxOutputTokens: 4000 },
    providerOptions: openrouterProvider(4000, { cache: true, noReasoning: true }),
  }),
});
