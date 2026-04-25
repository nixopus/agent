import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  listApplications as getApiV1DeployApplications,
  listApplicationDeployments as getApiV1DeployApplicationDeployments,
  listMachines as getApiV1Servers,
  listDomains as getApiV1Domains,
  listGitHubConnectors as getApiV1GithubConnectorAll,
  listGitHubRepositories as getApiV1GithubConnectorRepositories,
} from '@nixopus/api-client';
import { getClient, toQueryParams, shouldReturnVerbose, compactResult, getReadControls, emitToolProgress } from './shared';

export const resolveContextTool = createTool({
  id: 'resolve_context',
  description: 'Read-only. Resolve canonical IDs before mutating actions. Returns applications, servers, domains, connectors, and optional deployments/repositories.',
  inputSchema: z.object({
    include: z.array(z.enum(['applications', 'servers', 'domains', 'connectors', 'deployments', 'repositories'])).optional(),
    application_id: z.string().optional(),
    connector_id: z.string().optional(),
    page: z.number().optional(),
    limit: z.number().optional(),
    fields: z.array(z.string()).optional(),
    verbose: z.boolean().optional(),
  }),
  execute: async (inputData, ctx) => {
    await emitToolProgress(ctx, 'resolve_context', 'start', {
      include: inputData.include ?? ['applications', 'servers', 'domains', 'connectors'],
    });
    const include = inputData.include ?? ['applications', 'servers', 'domains', 'connectors'];
    const includeSet = new Set(include);
    const tasks: Promise<[string, unknown]>[] = [];

    if (includeSet.has('applications')) {
      tasks.push(
        getApiV1DeployApplications({
          client: getClient(ctx),
          query: toQueryParams({ page: inputData.page, limit: inputData.limit }),
        } as unknown as Parameters<typeof getApiV1DeployApplications>[0])
        .then((data) => ['applications', shouldReturnVerbose(inputData) ? data : compactResult(data, 'resolve_context.applications', getReadControls(inputData))]),
      );
    }
    if (includeSet.has('servers')) {
      tasks.push(
        getApiV1Servers({ client: getClient(ctx) } as unknown as Parameters<typeof getApiV1Servers>[0])
        .then((data) => ['servers', shouldReturnVerbose(inputData) ? data : compactResult(data, 'resolve_context.servers', getReadControls(inputData))]),
      );
    }
    if (includeSet.has('domains')) {
      tasks.push(
        getApiV1Domains({
          client: getClient(ctx),
          query: toQueryParams({ page: inputData.page, limit: inputData.limit }),
        } as unknown as Parameters<typeof getApiV1Domains>[0])
        .then((data) => ['domains', shouldReturnVerbose(inputData) ? data : compactResult(data, 'resolve_context.domains', getReadControls(inputData))]),
      );
    }
    if (includeSet.has('connectors')) {
      tasks.push(
        getApiV1GithubConnectorAll({
          client: getClient(ctx),
          query: toQueryParams({ page: inputData.page, limit: inputData.limit }),
        } as unknown as Parameters<typeof getApiV1GithubConnectorAll>[0])
        .then((data) => ['connectors', shouldReturnVerbose(inputData) ? data : compactResult(data, 'resolve_context.connectors', getReadControls(inputData))]),
      );
    }
    if (includeSet.has('deployments')) {
      if (!inputData.application_id) {
        tasks.push(Promise.resolve(['deployments', { error: 'application_id is required for deployments' }]));
      } else {
        tasks.push(
          getApiV1DeployApplicationDeployments({
            client: getClient(ctx),
            query: toQueryParams({ application_id: inputData.application_id, page: inputData.page, limit: inputData.limit }),
          } as unknown as Parameters<typeof getApiV1DeployApplicationDeployments>[0])
          .then((data) => ['deployments', shouldReturnVerbose(inputData) ? data : compactResult(data, 'resolve_context.deployments', getReadControls(inputData))]),
        );
      }
    }
    if (includeSet.has('repositories')) {
      if (!inputData.connector_id) {
        tasks.push(Promise.resolve(['repositories', { error: 'connector_id is required for repositories' }]));
      } else {
        tasks.push(
          getApiV1GithubConnectorRepositories({
            client: getClient(ctx),
            query: toQueryParams({ connector_id: inputData.connector_id, page: inputData.page, page_size: inputData.limit }),
          } as unknown as Parameters<typeof getApiV1GithubConnectorRepositories>[0])
          .then((data) => ['repositories', shouldReturnVerbose(inputData) ? data : compactResult(data, 'resolve_context.repositories', getReadControls(inputData))]),
        );
      }
    }

    const settled = await Promise.all(tasks);
    await emitToolProgress(ctx, 'resolve_context', 'completed', { sections: settled.length });
    return {
      context: Object.fromEntries(settled),
      usage: { recommendation: 'Use IDs from this output in mutating tools; do not invent IDs.' },
    };
  },
});
