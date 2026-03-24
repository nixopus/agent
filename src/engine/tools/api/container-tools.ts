import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  listContainers,
  getContainer,
  getContainerLogs,
  startContainer,
  stopContainer,
  restartContainer,
  removeContainer,
  updateContainerResources,
  listImages,
  pruneBuildCache,
  pruneImages,
  zGetContainerData,
  zGetContainerLogsData,
  zStartContainerData,
  zStopContainerData,
  zRestartContainerData,
  zRemoveContainerData,
  zUpdateContainerResourcesData,
  zListImagesData,
  zPruneBuildCacheData,
  zPruneImagesData,
} from '@nixopus/api-client';
import { defineToolGroup, createApiTool } from './tool-factory';
import { getClient, truncateLogs, type SdkInput } from './shared';

export const listContainersTool = createTool({
  id: 'list_containers',
  description: 'Read-only. List Docker containers. Optional filters: page, limit, status, search.',
  inputSchema: z.object({
    page: z.number().optional(),
    limit: z.number().optional(),
    status: z.string().optional(),
    search: z.string().optional(),
    fields: z.array(z.string()).optional(),
    verbose: z.boolean().optional(),
  }),
  execute: async (inputData, ctx) =>
    listContainers({
      client: getClient(ctx),
      query: {
        page: inputData.page?.toString(),
        limit: inputData.limit?.toString(),
        status: inputData.status,
        search: inputData.search,
      },
    } as unknown as Parameters<typeof listContainers>[0]),
});

export const getContainerLogsTool = createApiTool({
  id: 'get_container_logs',
  description: 'Read-only. Get logs for container_id. Optional: follow, tail, since, until, stdout, stderr.',
  schema: zGetContainerLogsData,
  sdkFn: getContainerLogs,
  execute: async (inputData: any, ctx: any) => {
    const d = (inputData ?? {}) as SdkInput;
    const result = await getContainerLogs({
      client: getClient(ctx),
      path: { container_id: d.container_id as string },
      body: {
        follow: d.follow ?? false,
        tail: d.tail ?? 0,
        since: d.since ?? '',
        until: d.until ?? '',
        stdout: d.stdout !== undefined ? d.stdout : true,
        stderr: d.stderr !== undefined ? d.stderr : true,
      },
    } as unknown as Parameters<typeof getContainerLogs>[0]);
    return truncateLogs(result);
  },
});

const factoryTools = defineToolGroup({
  getContainer: {
    id: 'get_container',
    description: 'Read-only. Get one Docker container by container_id.',
    schema: zGetContainerData,
    sdkFn: getContainer,
    pathKeys: ['container_id'],
  },
  startContainer: {
    id: 'start_container',
    description: 'Mutating. Start a Docker container by container_id.',
    schema: zStartContainerData,
    sdkFn: startContainer,
    pathKeys: ['container_id'],
  },
  stopContainer: {
    id: 'stop_container',
    description: 'Mutating. Stop a Docker container by container_id.',
    schema: zStopContainerData,
    sdkFn: stopContainer,
    pathKeys: ['container_id'],
  },
  restartContainer: {
    id: 'restart_container',
    description: 'Mutating. Restart a Docker container by container_id.',
    schema: zRestartContainerData,
    sdkFn: restartContainer,
    pathKeys: ['container_id'],
  },
  removeContainer: {
    id: 'remove_container',
    description: 'Mutating and destructive. Remove a Docker container by container_id.',
    schema: zRemoveContainerData,
    sdkFn: removeContainer,
    pathKeys: ['container_id'],
  },
  updateContainerResources: {
    id: 'update_container_resources',
    description: 'Mutating. Update container resource limits for container_id (for example cpu_shares, memory, memory_swap).',
    schema: zUpdateContainerResourcesData,
    sdkFn: updateContainerResources,
    pathKeys: ['container_id'],
  },
  listImages: {
    id: 'list_images',
    description: 'Read-only. List Docker images with optional server-side filters.',
    schema: zListImagesData,
    sdkFn: listImages,
  },
  pruneBuildCache: {
    id: 'prune_build_cache',
    description: 'Mutating and potentially destructive. Prune Docker build cache.',
    schema: zPruneBuildCacheData,
    sdkFn: pruneBuildCache,
  },
  pruneImages: {
    id: 'prune_images',
    description: 'Mutating and potentially destructive. Prune unused Docker images.',
    schema: zPruneImagesData,
    sdkFn: pruneImages,
  },
});

export const getContainerTool = factoryTools.getContainer;
export const startContainerTool = factoryTools.startContainer;
export const stopContainerTool = factoryTools.stopContainer;
export const restartContainerTool = factoryTools.restartContainer;
export const removeContainerTool = factoryTools.removeContainer;
export const updateContainerResourcesTool = factoryTools.updateContainerResources;
export const listImagesTool = factoryTools.listImages;
export const pruneBuildCacheTool = factoryTools.pruneBuildCache;
export const pruneImagesTool = factoryTools.pruneImages;

export const containerTools = {
  listContainers: listContainersTool,
  getContainer: getContainerTool,
  getContainerLogs: getContainerLogsTool,
  startContainer: startContainerTool,
  stopContainer: stopContainerTool,
  restartContainer: restartContainerTool,
  removeContainer: removeContainerTool,
  updateContainerResources: updateContainerResourcesTool,
  listImages: listImagesTool,
  pruneBuildCache: pruneBuildCacheTool,
  pruneImages: pruneImagesTool,
};
