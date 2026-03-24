import {
  listExtensions,
  getExtensionById,
  getExtensionByExtensionId,
  listExtensionExecutions,
  listExtensionCategories,
  getExecution,
  listExecutionLogs,
  deleteForkedExtension,
  cancelExecution,
  forkExtension,
  runExtension,
  zListExtensionsData,
  zGetExtensionByIdData,
  zGetExtensionByExtensionIdData,
  zListExtensionExecutionsData,
  zListExtensionCategoriesData,
  zGetExecutionData,
  zListExecutionLogsData,
  zDeleteForkedExtensionData,
  zCancelExecutionData,
  zForkExtensionData,
  zRunExtensionData,
} from '@nixopus/api-client';
import { defineToolGroup } from './tool-factory';

const tools = defineToolGroup({
  listExtensions: {
    id: 'list_extensions',
    description: 'Read-only. List available extensions with optional filters.',
    schema: zListExtensionsData,
    sdkFn: listExtensions,
    params: 'query' as const,
    compact: true,
  },
  getExtension: {
    id: 'get_extension',
    description: 'Read-only. Get extension details by internal id.',
    schema: zGetExtensionByIdData,
    sdkFn: getExtensionById,
    pathKeys: ['id'],
  },
  getExtensionByExtensionId: {
    id: 'get_extension_by_extension_id',
    description: 'Read-only. Get extension details by extension_id.',
    schema: zGetExtensionByExtensionIdData,
    sdkFn: getExtensionByExtensionId,
    pathKeys: ['extension_id'],
  },
  getExtensionExecutions: {
    id: 'get_extension_executions',
    description: 'Read-only. List executions for extension_id with optional pagination.',
    schema: zListExtensionExecutionsData,
    sdkFn: listExtensionExecutions,
    pathKeys: ['extension_id'],
    params: 'query' as const,
  },
  getExtensionCategories: {
    id: 'get_extension_categories',
    description: 'Read-only. List extension categories.',
    schema: zListExtensionCategoriesData,
    sdkFn: listExtensionCategories,
    params: 'query' as const,
  },
  getExtensionExecution: {
    id: 'get_extension_execution',
    description: 'Read-only. Get one extension execution by execution_id.',
    schema: zGetExecutionData,
    sdkFn: getExecution,
    pathKeys: ['execution_id'],
  },
  getExtensionExecutionLogs: {
    id: 'get_extension_execution_logs',
    description: 'Read-only. Get logs for one extension execution by execution_id.',
    schema: zListExecutionLogsData,
    sdkFn: listExecutionLogs,
    pathKeys: ['execution_id'],
  },
  deleteExtension: {
    id: 'delete_extension',
    description: 'Mutating and destructive. Delete a forked extension by id.',
    schema: zDeleteForkedExtensionData,
    sdkFn: deleteForkedExtension,
    pathKeys: ['id'],
    requireApproval: true,
  },
  cancelExtensionExecution: {
    id: 'cancel_extension_execution',
    description: 'Mutating. Cancel a running extension execution by execution_id.',
    schema: zCancelExecutionData,
    sdkFn: cancelExecution,
    pathKeys: ['execution_id'],
  },
  forkExtension: {
    id: 'fork_extension',
    description: 'Mutating. Fork an extension to create a private editable copy.',
    schema: zForkExtensionData,
    sdkFn: forkExtension,
    pathKeys: ['extension_id'],
  },
  runExtension: {
    id: 'run_extension',
    description: 'Mutating. Execute an extension. Provide extension_id and run input.',
    schema: zRunExtensionData,
    sdkFn: runExtension,
    pathKeys: ['extension_id'],
    requireApproval: true,
  },
});

export const listExtensionsTool = tools.listExtensions;
export const getExtensionTool = tools.getExtension;
export const getExtensionByExtensionIdTool = tools.getExtensionByExtensionId;
export const getExtensionExecutionsTool = tools.getExtensionExecutions;
export const getExtensionCategoriesTool = tools.getExtensionCategories;
export const getExtensionExecutionTool = tools.getExtensionExecution;
export const getExtensionExecutionLogsTool = tools.getExtensionExecutionLogs;
export const deleteExtensionTool = tools.deleteExtension;
export const cancelExtensionExecutionTool = tools.cancelExtensionExecution;
export const forkExtensionTool = tools.forkExtension;
export const runExtensionTool = tools.runExtension;
export const extensionTools = tools;
