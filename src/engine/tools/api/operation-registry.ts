import { applicationTools } from './application-tools';
import { projectTools, quickDeployTool } from './project-tools';
import { domainTools } from './domain-tools';
import { githubConnectorTools } from './github-connector-tools';
import { containerTools } from './container-tools';
import { machineTools } from './machine-tools';
import { systemTools } from './system-tools';
import { extensionTools } from './extension-tools';
import { backupTools } from './backup-tools';
import { healthcheckTools } from './healthcheck-tools';
import { mcpServerTools } from './mcp-server-tools';
import { notificationTools } from './notification-tools';
import { notificationConfigTools } from './notification-config-tools';
import { fileTools } from './file-tools';
import { resolveContextTool } from './context-tools';

export interface RegistryEntry {
  tool: {
    id?: string;
    description?: string;
    inputSchema?: unknown;
    execute: (...args: unknown[]) => Promise<unknown>;
    _rawExecute?: (...args: unknown[]) => Promise<unknown>;
    requireApproval?: boolean;
    [key: string]: unknown;
  };
  operationId: string;
  description: string;
  dedicated: boolean;
  requireApproval: boolean;
}

const DEDICATED_OPERATIONS = new Set([
  'quick_deploy',
  'create_project',
  'resolve_context',
]);

const registry = new Map<string, RegistryEntry>();

function registerTool(tool: Record<string, unknown>, overrides?: { dedicated?: boolean }) {
  const id = (tool.id as string) ?? '';
  if (!id || typeof tool.execute !== 'function') return;

  registry.set(id, {
    tool: tool as RegistryEntry['tool'],
    operationId: id,
    description: (tool.description as string) ?? '',
    dedicated: overrides?.dedicated ?? DEDICATED_OPERATIONS.has(id),
    requireApproval: !!(tool.requireApproval),
  });
}

function registerGroup(tools: Record<string, unknown>) {
  for (const tool of Object.values(tools)) {
    if (tool && typeof tool === 'object') registerTool(tool as Record<string, unknown>);
  }
}

registerGroup(applicationTools);
registerGroup(projectTools);
registerTool(quickDeployTool as unknown as Record<string, unknown>, { dedicated: true });
registerGroup(domainTools);
registerGroup(githubConnectorTools);
registerGroup(containerTools);
registerGroup(machineTools);
registerGroup(systemTools);
registerGroup(extensionTools);
registerGroup(backupTools);
registerGroup(healthcheckTools);
registerGroup(mcpServerTools);
registerGroup(notificationTools);
registerGroup(notificationConfigTools);
registerGroup(fileTools);
registerTool(resolveContextTool as unknown as Record<string, unknown>, { dedicated: true });

export function getOperation(operationId: string): RegistryEntry | undefined {
  return registry.get(operationId);
}

export function listOperations(): RegistryEntry[] {
  return Array.from(registry.values());
}

export function listOperationIds(): string[] {
  return Array.from(registry.keys());
}

export { registry };
