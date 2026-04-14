import { applicationTools } from '../tools/api/application-tools';
import { projectTools } from '../tools/api/project-tools';
import { githubConnectorTools } from '../tools/api/github-connector-tools';
import { getDomainsTool, createDomainTool, updateDomainTool } from '../tools/api/domain-tools';
import { addApplicationDomainTool } from '../tools/api/application-tools';
import { codebaseTools } from '../tools/codebase/codebase-tools';
import { deployGenTools } from '../tools/deploy/deploy-gen-tools';
import { githubTools } from '../tools/github/github-tools';
import { nixopusDocsTools } from '../tools/docs/nixopus-docs-tool';
import { mcpServerTools } from '../tools/api/mcp-server-tools';

/** Raw tool objects for deploy-agent tool search (no agent wiring or config side effects). */
export const rawDeploySearchableTools = {
  getGithubConnectors: githubConnectorTools.getGithubConnectors,
  getGithubRepositories: githubConnectorTools.getGithubRepositories,
  analyzeRepository: codebaseTools.analyzeRepository,
  prepareCodebase: codebaseTools.prepareCodebase,
  loadLocalWorkspace: codebaseTools.loadLocalWorkspace,
  loadRemoteRepository: codebaseTools.loadRemoteRepository,
  writeWorkspaceFiles: deployGenTools.writeWorkspaceFiles,
  getDomains: getDomainsTool,
  addApplicationDomain: addApplicationDomainTool,
  updateApplication: applicationTools.updateApplication,
  updateApplicationLabels: applicationTools.updateApplicationLabels,
  restartDeployment: applicationTools.restartDeployment,
  rollbackDeployment: applicationTools.rollbackDeployment,
  redeployApplication: applicationTools.redeployApplication,
  recoverApplication: applicationTools.recoverApplication,
  deleteApplication: applicationTools.deleteApplication,
  previewCompose: applicationTools.previewCompose,
  getComposeServices: applicationTools.getComposeServices,
  duplicateProject: projectTools.duplicateProject,
  getProjectFamily: projectTools.getProjectFamily,
  getEnvironmentsInFamily: projectTools.getEnvironmentsInFamily,
  addProjectToFamily: projectTools.addProjectToFamily,
  createGithubConnector: githubConnectorTools.createGithubConnector,
  updateGithubConnector: githubConnectorTools.updateGithubConnector,
  deleteGithubConnector: githubConnectorTools.deleteGithubConnector,
  getGithubRepositoryBranches: githubConnectorTools.getGithubRepositoryBranches,
  githubGetRepoFile: githubTools.githubGetRepoFile,
  githubGetBranch: githubTools.githubGetBranch,
  githubCreateBranch: githubTools.githubCreateBranch,
  githubCreateOrUpdateFile: githubTools.githubCreateOrUpdateFile,
  githubCreatePullRequest: githubTools.githubCreatePullRequest,
  createDomain: createDomainTool,
  updateDomain: updateDomainTool,
  fetchNixopusDocsIndex: nixopusDocsTools.fetchNixopusDocsIndex,
  fetchNixopusDocsPage: nixopusDocsTools.fetchNixopusDocsPage,
  listMcpProviderCatalog: mcpServerTools.listMcpProviderCatalog,
  listOrgMcpServers: mcpServerTools.listOrgMcpServers,
  addMcpServer: mcpServerTools.addMcpServer,
  updateMcpServer: mcpServerTools.updateMcpServer,
  deleteMcpServer: mcpServerTools.deleteMcpServer,
  testMcpServerConnection: mcpServerTools.testMcpServerConnection,
  discoverMcpTools: mcpServerTools.discoverMcpTools,
  listEnabledMcpServers: mcpServerTools.listEnabledMcpServers,
  callMcpTool: mcpServerTools.callMcpTool,
};
