import { codebaseTools } from '../tools/codebase/codebase-tools';
import { deployGenTools } from '../tools/deploy/deploy-gen-tools';
import { githubTools } from '../tools/github/github-tools';
import { nixopusDocsTools } from '../tools/docs/nixopus-docs-tool';

export const rawDeploySearchableTools = {
  analyzeRepository: codebaseTools.analyzeRepository,
  loadLocalWorkspace: codebaseTools.loadLocalWorkspace,
  loadRemoteRepository: codebaseTools.loadRemoteRepository,
  writeWorkspaceFiles: deployGenTools.writeWorkspaceFiles,
  githubGetRepoFile: githubTools.githubGetRepoFile,
  githubGetBranch: githubTools.githubGetBranch,
  githubCreateBranch: githubTools.githubCreateBranch,
  githubCreateOrUpdateFile: githubTools.githubCreateOrUpdateFile,
  githubCreatePullRequest: githubTools.githubCreatePullRequest,
  fetchNixopusDocsIndex: nixopusDocsTools.fetchNixopusDocsIndex,
  fetchNixopusDocsPage: nixopusDocsTools.fetchNixopusDocsPage,
};
