import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  listServers,
  getSshConnectionStatus,
  listAuditLogs,
  listFeatureFlags,
  checkIfFeatureIsEnabled,
  updateFeatureFlag,
  healthCheck,
  checkForUpdates,
  performUpdate,
  handleGitHubWebhook,
  zGetSshConnectionStatusData,
  zListAuditLogsData,
  zListFeatureFlagsData,
  zCheckIfFeatureIsEnabledData,
  zUpdateFeatureFlagData,
  zHealthCheckData,
  zCheckForUpdatesData,
  zPerformUpdateData,
  zHandleGitHubWebhookData,
} from '@nixopus/api-client';
import { defineToolGroup } from './tool-factory';
import { getClient, shouldReturnVerbose, compactResult, getReadControls } from './shared';

export const getServersTool = createTool({
  id: 'get_servers',
  description: 'Read-only. List registered servers and host metadata.',
  inputSchema: z.object({
    limit: z.number().optional(),
    fields: z.array(z.string()).optional(),
    verbose: z.boolean().optional(),
  }),
  execute: async (inputData, ctx) => {
    const data = await listServers({ client: getClient(ctx) } as unknown as Parameters<typeof listServers>[0]);
    return shouldReturnVerbose(inputData) ? data : compactResult(data, 'get_servers', getReadControls(inputData));
  },
});

const factoryTools = defineToolGroup({
  getServersSshStatus: {
    id: 'get_servers_ssh_status',
    description: 'Read-only. Check SSH connectivity status for registered servers.',
    schema: zGetSshConnectionStatusData,
    sdkFn: getSshConnectionStatus,
    params: 'query' as const,
  },
  getAuditLogs: {
    id: 'get_audit_logs',
    description: 'Read-only. List audit logs with optional filters and pagination.',
    schema: zListAuditLogsData,
    sdkFn: listAuditLogs,
    params: 'query' as const,
    compact: true,
  },
  getFeatureFlags: {
    id: 'get_feature_flags',
    description: 'Read-only. List feature flags.',
    schema: zListFeatureFlagsData,
    sdkFn: listFeatureFlags,
    params: 'query' as const,
  },
  checkFeatureFlag: {
    id: 'check_feature_flag',
    description: 'Read-only. Check whether a feature flag is enabled by key/context.',
    schema: zCheckIfFeatureIsEnabledData,
    sdkFn: checkIfFeatureIsEnabled,
    params: 'query' as const,
  },
  updateFeatureFlags: {
    id: 'update_feature_flags',
    description: 'Mutating. Update a feature flag value.',
    schema: zUpdateFeatureFlagData,
    sdkFn: updateFeatureFlag,
    requireApproval: true,
  },
  getSystemHealth: {
    id: 'get_system_health',
    description: 'Read-only. Check system health status.',
    schema: zHealthCheckData,
    sdkFn: healthCheck,
    params: 'spread' as const,
  },
  checkForUpdates: {
    id: 'check_for_updates',
    description: 'Read-only. Check whether a system update is available.',
    schema: zCheckForUpdatesData,
    sdkFn: checkForUpdates,
    params: 'query' as const,
  },
  triggerUpdate: {
    id: 'trigger_update',
    description: 'Mutating. Trigger a system update operation.',
    schema: zPerformUpdateData,
    sdkFn: performUpdate,
    requireApproval: true,
  },
  sendWebhook: {
    id: 'send_webhook',
    description: 'Mutating. Send a webhook event payload.',
    schema: zHandleGitHubWebhookData,
    sdkFn: handleGitHubWebhook,
  },
});

export const getServersSshStatusTool = factoryTools.getServersSshStatus;
export const getAuditLogsTool = factoryTools.getAuditLogs;
export const getFeatureFlagsTool = factoryTools.getFeatureFlags;
export const checkFeatureFlagTool = factoryTools.checkFeatureFlag;
export const updateFeatureFlagsTool = factoryTools.updateFeatureFlags;
export const getSystemHealthTool = factoryTools.getSystemHealth;
export const checkForUpdatesTool = factoryTools.checkForUpdates;
export const triggerUpdateTool = factoryTools.triggerUpdate;
export const sendWebhookTool = factoryTools.sendWebhook;

export const systemTools = {
  getServers: getServersTool,
  getServersSshStatus: getServersSshStatusTool,
  getAuditLogs: getAuditLogsTool,
  getFeatureFlags: getFeatureFlagsTool,
  checkFeatureFlag: checkFeatureFlagTool,
  updateFeatureFlags: updateFeatureFlagsTool,
  getSystemHealth: getSystemHealthTool,
  checkForUpdates: checkForUpdatesTool,
  triggerUpdate: triggerUpdateTool,
  sendWebhook: sendWebhookTool,
};
