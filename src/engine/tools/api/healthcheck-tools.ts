import {
  createHealthCheck,
  getHealthChecks,
  updateHealthCheck,
  deleteHealthCheck,
  toggleHealthCheck,
  listHealthCheckResults,
  getHealthCheckStats,
  zCreateHealthCheckData,
  zGetHealthChecksData,
  zUpdateHealthCheckData,
  zDeleteHealthCheckData,
  zToggleHealthCheckData,
  zListHealthCheckResultsData,
  zGetHealthCheckStatsData,
} from '@nixopus/api-client';
import { defineToolGroup } from './tool-factory';

const tools = defineToolGroup({
  createHealthCheck: {
    id: 'create_health_check',
    description: 'Mutating. Create a health check rule for an application/service.',
    schema: zCreateHealthCheckData,
    sdkFn: createHealthCheck,
  },
  getHealthCheck: {
    id: 'get_health_check',
    description: 'Read-only. List or get health checks by provided identifiers/filters.',
    schema: zGetHealthChecksData,
    sdkFn: getHealthChecks,
    params: 'query' as const,
  },
  updateHealthCheck: {
    id: 'update_health_check',
    description: 'Mutating. Update an existing health check.',
    schema: zUpdateHealthCheckData,
    sdkFn: updateHealthCheck,
  },
  deleteHealthCheck: {
    id: 'delete_health_check',
    description: 'Mutating and destructive. Delete a health check by id.',
    schema: zDeleteHealthCheckData,
    sdkFn: deleteHealthCheck,
    params: 'query' as const,
  },
  toggleHealthCheck: {
    id: 'toggle_health_check',
    description: 'Mutating. Enable or disable a health check.',
    schema: zToggleHealthCheckData,
    sdkFn: toggleHealthCheck,
  },
  getHealthCheckResults: {
    id: 'get_health_check_results',
    description: 'Read-only. List health check execution results.',
    schema: zListHealthCheckResultsData,
    sdkFn: listHealthCheckResults,
    params: 'query' as const,
  },
  getHealthCheckStats: {
    id: 'get_health_check_stats',
    description: 'Read-only. Get aggregate health check statistics.',
    schema: zGetHealthCheckStatsData,
    sdkFn: getHealthCheckStats,
    params: 'query' as const,
  },
});

export const createHealthCheckTool = tools.createHealthCheck;
export const getHealthCheckTool = tools.getHealthCheck;
export const updateHealthCheckTool = tools.updateHealthCheck;
export const deleteHealthCheckTool = tools.deleteHealthCheck;
export const toggleHealthCheckTool = tools.toggleHealthCheck;
export const getHealthCheckResultsTool = tools.getHealthCheckResults;
export const getHealthCheckStatsTool = tools.getHealthCheckStats;
export const healthcheckTools = tools;
