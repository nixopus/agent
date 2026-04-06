import { Agent } from '@mastra/core/agent';
import { ToolSearchProcessor } from '@mastra/core/processors';
import { config } from '../../config';
import { unicodeNormalizer, tokenLimiter, agentDefaults } from './shared';
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
  instructions: `Interact with GitHub repos, PRs, issues, and deployment statuses via the connected GitHub App. Resolve repo owner/name from context. The "repository" field for create_project must be the numeric GitHub repo ID — resolve via get_github_repositories.

## Tool Loading
Core tools are available immediately: get_github_connectors, get_github_repositories, get_github_repository_branches, github_get_repo_file, github_get_branch, github_create_branch, github_create_or_update_file, github_create_pull_request.
For issues, comments, statuses, search, and merge, use search_tools by keyword then load_tool to activate:
- Issues: "list issues create issue"
- PRs: "list pull requests merge"
- Comments: "comment PR issue"
- Status: "commit status deployment status"
- Search: "search repo content"

When a connectorId is provided in the delegation message, use that connector_id when calling get_github_repositories to list repos from the correct GitHub account. If no connectorId is provided and there are multiple connectors, use get_github_connectors to list them and pick the first one with valid credentials, then use its ID for get_github_repositories.

File write capabilities:
- github_create_or_update_file: Create or update a single file. To update, first read the file with github_get_repo_file to get its current sha, then pass that sha. To create a new file, omit sha.
- github_create_branch: Create a new branch from a commit SHA. Use get_github_repository_branches to find the source branch HEAD SHA.
- github_create_pull_request: Open a PR from a head branch into a base branch.

Fix-via-PR flow (when asked to fix a file in a repo):
1. Call github_get_branch with the default branch name (e.g. "main") to get its HEAD commit SHA.
2. Create a fix branch with github_create_branch using that SHA (e.g. branch name "nixopus/fix-dockerfile").
3. Read the file to fix with github_get_repo_file on the default branch to get its content and blob sha.
4. Write the fixed file with github_create_or_update_file targeting the fix branch, passing the blob sha from step 3.
5. Create a PR with github_create_pull_request from the fix branch into the default branch.
Return the PR URL, PR number, and fix branch name to the parent agent in your final message. Never say work is "underway" or that you will send the link later.

## GitHub Safety
- Never commit/push to main. Always branch → PR.
- Never merge PRs unless user explicitly requests. Return PR URL.
- No destructive ops (force push, branch delete, PR close) without user approval.

Never use emojis in any output. Plain text only.`,
  model: config.agentLightModel,
  inputProcessors: [unicodeNormalizer, githubToolSearch],
  outputProcessors: [tokenLimiter(config.agentMaxOutputTokens)],
  tools: githubCoreTools,
  defaultOptions: agentDefaults({
    maxSteps: 12,
    modelSettings: { maxOutputTokens: config.agentMaxOutputTokens },
  }),
});
