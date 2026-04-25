import { Agent } from '@mastra/core/agent';
import { ToolSearchProcessor } from '@mastra/core/processors';
import { config } from '../../config';
import { unicodeNormalizer, tokenLimiter, agentDefaults, coreInstructions } from './shared';
import { nixopusApiTool } from '../tools/api/nixopus-api-tool';
import { githubTools } from '../tools/github/github-tools';
import { guardToolsForSchemaCompat } from '../tools/shared/schema-compat-guard';
import { ApiCatalogInjector } from './api-catalog-injector';

const apiCatalogInjector = new ApiCatalogInjector();

export const rawGithubCoreTools = {
  nixopusApi: nixopusApiTool,
  githubGetRepoFile: githubTools.githubGetRepoFile,
  githubGetBranch: githubTools.githubGetBranch,
  githubCreateBranch: githubTools.githubCreateBranch,
  githubCreateOrUpdateFile: githubTools.githubCreateOrUpdateFile,
  githubCreatePullRequest: githubTools.githubCreatePullRequest,
};

export const rawGithubSearchableTools = {
  githubListPullRequests: githubTools.githubListPullRequests,
  githubListIssues: githubTools.githubListIssues,
  githubCommentOnPr: githubTools.githubCommentOnPr,
  githubCommentOnIssue: githubTools.githubCommentOnIssue,
  githubCreateIssue: githubTools.githubCreateIssue,
  githubSetCommitStatus: githubTools.githubSetCommitStatus,
  githubCreateDeploymentStatus: githubTools.githubCreateDeploymentStatus,
  githubSearchRepoContent: githubTools.githubSearchRepoContent,
  githubMergePullRequest: githubTools.githubMergePullRequest,
};

const githubCoreTools = guardToolsForSchemaCompat(rawGithubCoreTools);
const githubSearchableTools = guardToolsForSchemaCompat(rawGithubSearchableTools);

const githubToolSearch = new ToolSearchProcessor({
  tools: githubSearchableTools,
  search: { topK: 5, minScore: 0.1 },
});

export const githubAgent = new Agent({
  id: 'github-agent',
  name: 'GitHub Agent',
  description: 'Resolves GitHub repo IDs, manages PRs, branches, and file operations via GitHub App. Use for repo ID resolution and fix-via-PR workflows.',
  instructions: coreInstructions(
    `Interact with GitHub repos, PRs, issues, and deployment statuses via the connected GitHub App. Use nixopus_api('get_github_repositories') to resolve numeric repo IDs for create_project. Never use emojis. Plain text only.`,
    [
      'github-workflow — Fix-via-PR flow, file operations, connector resolution, and safety rules. Load when performing any GitHub operation.',
    ],
    `## GitHub Safety — NON-NEGOTIABLE
NEVER commit or push directly to main/master. For ANY file change: create a feature branch → commit to that branch → open a PR. No exceptions.
NEVER merge PRs unless the user explicitly asks. Always return the PR URL.
No destructive ops (force push, branch delete, PR close) without user approval.

## API Access
Use nixopus_api(operation, params) for Nixopus API calls (e.g. get_github_connectors, get_github_repositories, get_github_repository_branches). See [api-catalog] in context.
For direct GitHub file/PR/issue operations, use the dedicated github tools (github_get_repo_file, github_create_branch, etc.).
For issues, comments, statuses, search, and merge, use search_tools("<keyword>") then load_tool.`,
  ),
  model: config.agentLightModel,
  inputProcessors: [unicodeNormalizer, apiCatalogInjector, githubToolSearch],
  outputProcessors: [tokenLimiter(config.agentMaxOutputTokens)],
  tools: githubCoreTools,
  defaultOptions: agentDefaults({
    maxSteps: 12,
    modelSettings: { maxOutputTokens: config.agentMaxOutputTokens },
  }),
});
