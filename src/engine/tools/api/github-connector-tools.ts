import {
  createGitHubConnector,
  updateGitHubConnector,
  deleteGitHubConnector,
  listGitHubConnectors,
  listGitHubRepositories,
  listRepositoryBranches,
  zCreateGitHubConnectorData,
  zUpdateGitHubConnectorData,
  zDeleteGitHubConnectorData,
  zListGitHubConnectorsData,
  zListGitHubRepositoriesData,
  zListRepositoryBranchesData,
} from '@nixopus/api-client';
import { defineToolGroup } from './tool-factory';

const tools = defineToolGroup({
  createGithubConnector: {
    id: 'create_github_connector',
    description: '[MUTATING] Register a new GitHub App connector. All params in body: app_id, client_id, client_secret, pem, slug, webhook_secret. Admin operation — connectors are shared across the platform.',
    schema: zCreateGitHubConnectorData,
    sdkFn: createGitHubConnector,
  },
  updateGithubConnector: {
    id: 'update_github_connector',
    description: '[MUTATING] Update a GitHub connector. Required: body.connector_id (connector UUID), body.installation_id (GitHub installation ID string).',
    schema: zUpdateGitHubConnectorData,
    sdkFn: updateGitHubConnector,
  },
  deleteGithubConnector: {
    id: 'delete_github_connector',
    description: '[DESTRUCTIVE] Delete a GitHub connector. Required: body.id (connector UUID). Find via get_github_connectors.',
    schema: zDeleteGitHubConnectorData,
    sdkFn: deleteGitHubConnector,
  },
  getGithubConnectors: {
    id: 'get_github_connectors',
    description: '[READ] List all GitHub connectors. No params required. Returns connector IDs, slugs, app_ids, installation_ids.',
    schema: zListGitHubConnectorsData,
    sdkFn: listGitHubConnectors,
    params: 'query' as const,
    compact: true,
  },
  getGithubRepositories: {
    id: 'get_github_repositories',
    description: '[READ] List GitHub repositories accessible via the connector. No params required. Returns repo objects with id (STRING — use this as repository param in create_application), full_name, default_branch.',
    schema: zListGitHubRepositoriesData,
    sdkFn: listGitHubRepositories,
    params: 'query' as const,
    compact: true,
  },
  getGithubRepositoryBranches: {
    id: 'get_github_repository_branches',
    description: '[READ] List branches for a GitHub repository. Required: body.repository_name (string — the full repo name like "owner/repo", NOT the numeric ID). Returns branch names and latest commit SHAs.',
    schema: zListRepositoryBranchesData,
    sdkFn: listRepositoryBranches,
    params: 'body-and-query' as const,
  },
});

export const createGithubConnectorTool = tools.createGithubConnector;
export const updateGithubConnectorTool = tools.updateGithubConnector;
export const deleteGithubConnectorTool = tools.deleteGithubConnector;
export const getGithubConnectorsTool = tools.getGithubConnectors;
export const getGithubRepositoriesTool = tools.getGithubRepositories;
export const getGithubRepositoryBranchesTool = tools.getGithubRepositoryBranches;
export const githubConnectorTools = tools;
