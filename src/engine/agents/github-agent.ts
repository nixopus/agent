import { Agent } from '@mastra/core/agent';
import { ToolSearchProcessor } from '@mastra/core/processors';
import { config } from '../../config';
import { unicodeNormalizer, tokenLimiter, agentDefaults, coreInstructions } from './shared';
import { getGithubConnectorsTool, getGithubRepositoriesTool, getGithubRepositoryBranchesTool } from '../tools/api/github-connector-tools';
import { githubTools } from '../tools/github/github-tools';
import { guardToolsForSchemaCompat } from '../tools/shared/schema-compat-guard';

export const rawGithubCoreTools = {
  getGithubConnectors: getGithubConnectorsTool,
  getGithubRepositories: getGithubRepositoriesTool,
  getGithubRepositoryBranches: getGithubRepositoryBranchesTool,
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
    `Interact with GitHub repos, PRs, issues, and deployment statuses via the connected GitHub App. The "repository" field for create_project must be the numeric GitHub repo ID — resolve via get_github_repositories. Never use emojis. Plain text only.`,
    [
      'github-workflow — Fix-via-PR flow, file operations, connector resolution, and safety rules. Load when performing any GitHub operation.',
    ],
    `## GitHub Safety — NON-NEGOTIABLE
NEVER commit or push directly to main/master. For ANY file change: create a feature branch → commit to that branch → open a PR. No exceptions.
NEVER merge PRs unless the user explicitly asks. Always return the PR URL.
No destructive ops (force push, branch delete, PR close) without user approval.

## Tool Loading
Core tools: get_github_connectors, get_github_repositories, get_github_repository_branches, github_get_repo_file, github_get_branch, github_create_branch, github_create_or_update_file, github_create_pull_request.
For issues, comments, statuses, search, and merge, use search_tools("<keyword>") then load_tool.`,
  ),
  model: config.agentLightModel,
  inputProcessors: [unicodeNormalizer, githubToolSearch],
  outputProcessors: [tokenLimiter(config.agentMaxOutputTokens)],
  tools: githubCoreTools,
  defaultOptions: agentDefaults({
    maxSteps: 12,
    modelSettings: { maxOutputTokens: config.agentMaxOutputTokens },
  }),
});
