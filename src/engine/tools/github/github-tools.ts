import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { ExternalServiceError, ValidationError } from '../../../errors';
import { createNixopusClient, type NixopusRequestContext } from '../shared/nixopus-client';
import { listGitHubConnectors } from '@nixopus/api-client';
import { getInstallationToken, githubFetch } from '../../../util/github-client';
import { createLogger } from '../../../logger';

const logger = createLogger('github-tools');

type RequestContext = { requestContext?: NixopusRequestContext };

interface ConnectorData {
  app_id?: string;
  pem?: string;
  installation_id?: string;
  id?: string;
}

const connectorCache = new Map<string, { connector: ConnectorData; expiresAt: number }>();
const CONNECTOR_CACHE_TTL_MS = 5 * 60 * 1000;

export function clearConnectorCache(): void {
  connectorCache.clear();
}

export function getConnectorCacheStats(): { size: number } {
  return { size: connectorCache.size };
}

async function resolveConnector(ctx: unknown, connectorId?: string): Promise<ConnectorData> {
  const cacheKey = connectorId ?? '_default_';
  const cached = connectorCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.connector;

  const c = ctx as RequestContext;
  const client = createNixopusClient(c?.requestContext) as unknown;
  const res = (await listGitHubConnectors({
    client,
  } as Parameters<typeof listGitHubConnectors>[0])) as {
    data?: { data?: ConnectorData[] };
    error?: unknown;
  };

  if (res.error) {
    throw new ExternalServiceError('github', `Failed to fetch GitHub connectors: ${JSON.stringify(res.error)}`);
  }

  const connectors = res.data?.data ?? [];
  const isUsable = (cn: ConnectorData) => cn.app_id && cn.pem && cn.installation_id;

  const connector = connectorId
    ? connectors.find((cn) => cn.id === connectorId && isUsable(cn))
    : connectors.find(isUsable);

  if (connectorId && !connector) {
    throw new ExternalServiceError('github', `GitHub connector "${connectorId}" not found or has invalid credentials.`);
  }

  if (!connector?.app_id || !connector.pem || !connector.installation_id) {
    throw new ExternalServiceError('github', 'No GitHub connector with valid credentials found. Create a GitHub connector first.');
  }

  connectorCache.set(cacheKey, { connector, expiresAt: Date.now() + CONNECTOR_CACHE_TTL_MS });
  return connector;
}

async function resolveToken(ctx: unknown, connectorId?: string): Promise<string> {
  const connector = await resolveConnector(ctx, connectorId);
  return getInstallationToken(connector.app_id!, connector.pem!, connector.installation_id!);
}

const repoRef = {
  owner: z.string(),
  repo: z.string(),
};

const SENSITIVE_FILE_PATTERNS = [
  /^\.env($|\.)/,
  /credentials\.json$/,
  /secrets?\./,
  /\.pem$/,
  /\.key$/,
  /\.secret$/,
  /^\.npmrc$/,
  /^\.docker\/config\.json$/,
];

function isSensitiveFile(filePath: string): boolean {
  const basename = filePath.substring(filePath.lastIndexOf('/') + 1);
  return SENSITIVE_FILE_PATTERNS.some((p) => p.test(basename));
}

async function tryResolveExistingSha(
  token: string,
  owner: string,
  repo: string,
  path: string,
  branch?: string,
): Promise<string | undefined> {
  try {
    const existing = await githubFetch<{ sha: string }>(token, `/repos/${owner}/${repo}/contents/${path}`, {
      query: branch ? { ref: branch } : undefined,
    });
    if (existing && typeof existing === 'object' && 'sha' in existing) return existing.sha;
  } catch (fetchErr: unknown) {
    const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
    const is404 = msg.includes('(404)') || (fetchErr as { statusCode?: number }).statusCode === 404;
    if (!is404) throw fetchErr;
  }
  return undefined;
}

export const githubListPullRequestsTool = createTool({
  id: 'github_list_pull_requests',
  description:
    'List pull requests for a GitHub repository. Returns title, number, state, author, created_at, and head branch.',
  inputSchema: z.object({
    ...repoRef,
    state: z.enum(['open', 'closed', 'all']).optional().describe('Filter by PR state. Defaults to open.'),
    per_page: z.number().optional().describe('Results per page, max 100. Defaults to 30.'),
  }),
  execute: async ({ owner, repo, state, per_page }, ctx) => {
    const token = await resolveToken(ctx);
    const prs = await githubFetch<
      Array<{
        number: number;
        title: string;
        state: string;
        user: { login: string };
        created_at: string;
        head: { ref: string };
        html_url: string;
      }>
    >(token, `/repos/${owner}/${repo}/pulls`, {
      query: { state: state ?? 'open', per_page: per_page ?? 30 },
    });
    return prs.map((pr) => ({
      number: pr.number,
      title: pr.title,
      state: pr.state,
      author: pr.user?.login,
      created_at: pr.created_at,
      head_branch: pr.head?.ref,
      url: pr.html_url,
    }));
  },
});

export const githubListIssuesTool = createTool({
  id: 'github_list_issues',
  description:
    'List issues for a GitHub repository. Returns title, number, state, labels, and assignees.',
  inputSchema: z.object({
    ...repoRef,
    state: z.enum(['open', 'closed', 'all']).optional().describe('Filter by issue state. Defaults to open.'),
    per_page: z.number().optional().describe('Results per page, max 100. Defaults to 30.'),
  }),
  execute: async ({ owner, repo, state, per_page }, ctx) => {
    const token = await resolveToken(ctx);
    const issues = await githubFetch<
      Array<{
        number: number;
        title: string;
        state: string;
        labels: Array<{ name: string }>;
        assignees: Array<{ login: string }>;
        html_url: string;
        pull_request?: unknown;
      }>
    >(token, `/repos/${owner}/${repo}/issues`, {
      query: { state: state ?? 'open', per_page: per_page ?? 30 },
    });
    return issues
      .filter((i) => !i.pull_request)
      .map((issue) => ({
        number: issue.number,
        title: issue.title,
        state: issue.state,
        labels: issue.labels?.map((l) => l.name) ?? [],
        assignees: issue.assignees?.map((a) => a.login) ?? [],
        url: issue.html_url,
      }));
  },
});

export const githubCommentOnPrTool = createTool({
  id: 'github_comment_on_pr',
  description:
    'Add a comment to a pull request on GitHub. PRs are issues in the GitHub API so this posts an issue comment.',
  inputSchema: z.object({
    ...repoRef,
    pr_number: z.number(),
    body: z.string().describe('The comment body in Markdown.'),
  }),
  execute: async ({ owner, repo, pr_number, body }, ctx) => {
    const token = await resolveToken(ctx);
    const result = await githubFetch<{ id: number; html_url: string }>(
      token,
      `/repos/${owner}/${repo}/issues/${pr_number}/comments`,
      { method: 'POST', body: { body } },
    );
    return { comment_id: result.id, url: result.html_url };
  },
});

export const githubCommentOnIssueTool = createTool({
  id: 'github_comment_on_issue',
  description: 'Add a comment to a GitHub issue.',
  inputSchema: z.object({
    ...repoRef,
    issue_number: z.number(),
    body: z.string().describe('The comment body in Markdown.'),
  }),
  execute: async ({ owner, repo, issue_number, body }, ctx) => {
    const token = await resolveToken(ctx);
    const result = await githubFetch<{ id: number; html_url: string }>(
      token,
      `/repos/${owner}/${repo}/issues/${issue_number}/comments`,
      { method: 'POST', body: { body } },
    );
    return { comment_id: result.id, url: result.html_url };
  },
});

export const githubCreateIssueTool = createTool({
  id: 'github_create_issue',
  description:
    'Create a new issue on a GitHub repository with a title, body, and optional labels.',
  inputSchema: z.object({
    ...repoRef,
    title: z.string(),
    body: z.string().optional(),
    labels: z.array(z.string()).optional(),
  }),
  execute: async ({ owner, repo, title, body, labels }, ctx) => {
    const token = await resolveToken(ctx);
    const result = await githubFetch<{
      number: number;
      html_url: string;
      id: number;
    }>(token, `/repos/${owner}/${repo}/issues`, {
      method: 'POST',
      body: { title, body, labels },
    });
    return {
      issue_number: result.number,
      url: result.html_url,
    };
  },
});

export const githubSetCommitStatusTool = createTool({
  id: 'github_set_commit_status',
  description:
    'Set a commit status on GitHub (pending, success, failure, error). Used to mark CI/deploy results on a specific commit SHA.',
  inputSchema: z.object({
    ...repoRef,
    sha: z.string().describe('The full commit SHA to set the status on.'),
    state: z.enum(['pending', 'success', 'failure', 'error']),
    description: z.string().optional(),
    target_url: z.string().optional().describe('URL to link from the status check (e.g. deployment URL).'),
    context: z.string().optional().describe('Status context label. Defaults to nixopus/deploy.'),
  }),
  execute: async ({ owner, repo, sha, state, description, target_url, context }, ctx) => {
    const token = await resolveToken(ctx);
    const result = await githubFetch<{ id: number; state: string }>(
      token,
      `/repos/${owner}/${repo}/statuses/${sha}`,
      {
        method: 'POST',
        body: { state, description, target_url, context: context ?? 'nixopus/deploy' },
      },
    );
    return { status_id: result.id, state: result.state };
  },
});

export const githubCreateDeploymentStatusTool = createTool({
  id: 'github_create_deployment_status',
  description:
    'Create a GitHub deployment and set its status. Creates a deployment record on the repo and then posts a status update. Use after a Nixopus deploy to report results back to GitHub.',
  inputSchema: z.object({
    ...repoRef,
    ref: z.string().describe('The git ref (branch, tag, or SHA) being deployed.'),
    environment: z.string().optional().describe('Deployment environment name. Defaults to production.'),
    state: z.enum(['pending', 'success', 'failure', 'error', 'inactive', 'in_progress', 'queued']),
    description: z.string().optional(),
    environment_url: z.string().optional().describe('The URL of the deployed environment.'),
  }),
  execute: async ({ owner, repo, ref, environment, state, description, environment_url }, ctx) => {
    const token = await resolveToken(ctx);
    const deployment = await githubFetch<{ id: number }>(
      token,
      `/repos/${owner}/${repo}/deployments`,
      {
        method: 'POST',
        body: {
          ref,
          environment: environment ?? 'production',
          auto_merge: false,
          required_contexts: [],
        },
      },
    );
    const status = await githubFetch<{ id: number; state: string }>(
      token,
      `/repos/${owner}/${repo}/deployments/${deployment.id}/statuses`,
      {
        method: 'POST',
        body: { state, description, environment_url },
      },
    );
    return {
      deployment_id: deployment.id,
      status_id: status.id,
      state: status.state,
    };
  },
});

export const githubSearchRepoContentTool = createTool({
  id: 'github_search_repo_content',
  description:
    'Search for code within a GitHub repository. Useful for finding Dockerfiles, config files, error patterns, or specific code. Returns matching file paths and text fragments.',
  inputSchema: z.object({
    ...repoRef,
    query: z.string().describe('The search query (code, filename, etc.).'),
    per_page: z.number().optional().describe('Results per page, max 100. Defaults to 10.'),
  }),
  execute: async ({ owner, repo, query, per_page }, ctx) => {
    const token = await resolveToken(ctx);
    const result = await githubFetch<{
      total_count: number;
      items: Array<{
        name: string;
        path: string;
        html_url: string;
        text_matches?: Array<{ fragment: string }>;
      }>;
    }>(token, '/search/code', {
      query: {
        q: `${query} repo:${owner}/${repo}`,
        per_page: per_page ?? 10,
      },
    });
    return {
      total_count: result.total_count,
      items: result.items.map((item) => ({
        name: item.name,
        path: item.path,
        url: item.html_url,
        matches: item.text_matches?.map((m) => m.fragment).slice(0, 3) ?? [],
      })),
    };
  },
});

export const githubCreateOrUpdateFileTool = createTool({
  id: 'github_create_or_update_file',
  description:
    'Create or update a deployment config file in a GitHub repository (Dockerfile, docker-compose.yml, package.json, etc). NEVER use this for .env files, secrets, credentials, or API keys — those must be set via update_application environment variables instead. To update an existing file, you MUST provide the current sha of the file (get it from github_get_repo_file). To create a new file, omit sha.',
  inputSchema: z.object({
    ...repoRef,
    path: z.string().describe('File path within the repository (e.g. "frontend/Dockerfile"). Must NOT be a secret or .env file.'),
    content: z.string().describe('The full file content (plain text, will be base64-encoded automatically).'),
    message: z.string().describe('Git commit message for this change.'),
    branch: z.string().optional().describe('Target branch. Defaults to the repo default branch.'),
    sha: z.string().optional().describe('Current blob SHA of the file being replaced. Required when updating an existing file.'),
  }),
  execute: async ({ owner, repo, path, content, message, branch, sha }, ctx) => {
    logger.info({ owner, repo, path, branch: branch ?? 'repo default', updating: !!sha, contentLen: content.length }, 'create_or_update_file called');

    if (isSensitiveFile(path)) {
      throw new ValidationError(
        `Refused to write "${path}" — this looks like a secrets/credentials file. Use update_application to set environment variables instead of committing them to the repository.`,
      );
    }

    const token = await resolveToken(ctx);
    const resolvedSha = sha ?? await tryResolveExistingSha(token, owner, repo, path, branch);

    const encodedContent = Buffer.from(content).toString('base64');
    const body: Record<string, string> = { message, content: encodedContent };
    if (branch) body.branch = branch;
    if (resolvedSha) body.sha = resolvedSha;

    const result = await githubFetch<{
      content: { path: string; sha: string; html_url: string };
      commit: { sha: string; html_url: string };
    }>(token, `/repos/${owner}/${repo}/contents/${path}`, {
      method: 'PUT',
      body,
    });

    logger.info({ commitSha: result.commit.sha, url: result.content.html_url }, 'create_or_update_file committed');
    return {
      path: result.content.path,
      file_sha: result.content.sha,
      commit_sha: result.commit.sha,
      commit_url: result.commit.html_url,
      file_url: result.content.html_url,
    };
  },
});

export const githubGetBranchTool = createTool({
  id: 'github_get_branch',
  description:
    'Get details of a branch including its HEAD commit SHA. Use this to get the SHA needed for github_create_branch.',
  inputSchema: z.object({
    ...repoRef,
    branch: z.string().describe('Branch name (e.g. "main").'),
  }),
  execute: async ({ owner, repo, branch }, ctx) => {
    const token = await resolveToken(ctx);
    const result = await githubFetch<{
      name: string;
      commit: { sha: string; url: string };
      protected: boolean;
    }>(token, `/repos/${owner}/${repo}/branches/${branch}`);
    return {
      name: result.name,
      sha: result.commit.sha,
      protected: result.protected,
    };
  },
});

export const githubCreateBranchTool = createTool({
  id: 'github_create_branch',
  description:
    'Create a new branch in a GitHub repository from a given source SHA (typically the HEAD of the default branch). Use github_get_repo_file or the branches API to get the source SHA first.',
  inputSchema: z.object({
    ...repoRef,
    branch: z.string().describe('Name of the new branch to create.'),
    from_sha: z.string().describe('The commit SHA to branch from.'),
  }),
  execute: async ({ owner, repo, branch, from_sha }, ctx) => {
    const token = await resolveToken(ctx);
    const result = await githubFetch<{ ref: string; object: { sha: string } }>(
      token,
      `/repos/${owner}/${repo}/git/refs`,
      {
        method: 'POST',
        body: { ref: `refs/heads/${branch}`, sha: from_sha },
      },
    );
    return {
      ref: result.ref,
      sha: result.object.sha,
    };
  },
});

export const githubCreatePullRequestTool = createTool({
  id: 'github_create_pull_request',
  description:
    'Create a pull request on a GitHub repository. The head branch must already exist and contain commits ahead of the base branch.',
  inputSchema: z.object({
    ...repoRef,
    title: z.string().describe('PR title.'),
    body: z.string().optional().describe('PR description in Markdown.'),
    head: z.string().describe('The branch containing the changes.'),
    base: z.string().describe('The branch to merge into (e.g. "main").'),
  }),
  execute: async ({ owner, repo, title, body, head, base }, ctx) => {
    const token = await resolveToken(ctx);
    const result = await githubFetch<{
      number: number;
      html_url: string;
      state: string;
      head: { ref: string; sha: string };
    }>(token, `/repos/${owner}/${repo}/pulls`, {
      method: 'POST',
      body: { title, body, head, base },
    });
    return {
      pr_number: result.number,
      url: result.html_url,
      state: result.state,
      head_branch: result.head.ref,
      head_sha: result.head.sha,
    };
  },
});

export const githubMergePullRequestTool = createTool({
  id: 'github_merge_pull_request',
  description:
    'Merge a pull request on a GitHub repository. Only use when the user explicitly asks to merge. Supports merge, squash, and rebase strategies.',
  inputSchema: z.object({
    ...repoRef,
    pr_number: z.number().describe('The pull request number to merge.'),
    merge_method: z.enum(['merge', 'squash', 'rebase']).optional().describe('Merge strategy. Defaults to merge.'),
    commit_title: z.string().optional().describe('Custom merge commit title.'),
    commit_message: z.string().optional().describe('Custom merge commit message.'),
  }),
  execute: async ({ owner, repo, pr_number, merge_method, commit_title, commit_message }, ctx) => {
    const token = await resolveToken(ctx);
    const result = await githubFetch<{
      sha: string;
      merged: boolean;
      message: string;
    }>(token, `/repos/${owner}/${repo}/pulls/${pr_number}/merge`, {
      method: 'PUT',
      body: {
        merge_method: merge_method ?? 'merge',
        commit_title,
        commit_message,
      },
    });
    return {
      merged: result.merged,
      sha: result.sha,
      message: result.message,
    };
  },
});

export const githubGetRepoFileTool = createTool({
  id: 'github_get_repo_file',
  description:
    'Read a file from a GitHub repository at a specific path and branch. Returns the decoded file content.',
  inputSchema: z.object({
    ...repoRef,
    path: z.string().describe('File path within the repository.'),
    ref: z.string().optional().describe('Branch, tag, or commit SHA. Defaults to the default branch.'),
  }),
  execute: async ({ owner, repo, path, ref }, ctx) => {
    const token = await resolveToken(ctx);
    const result = await githubFetch<
      | { name: string; path: string; size: number; content: string; encoding: string; html_url: string; sha: string }
      | Array<{ name: string; path: string; type: string }>
    >(token, `/repos/${owner}/${repo}/contents/${path}`, {
      query: ref ? { ref } : undefined,
    });

    if (Array.isArray(result)) {
      return {
        error: `Path "${path}" is a directory, not a file. Use list_codebase_directory or a specific file path.`,
        entries: result.map((e) => ({ name: e.name, path: e.path, type: e.type })),
      };
    }

    let content = result.content ?? '';
    if (result.encoding === 'base64') {
      content = Buffer.from((result.content ?? '').replace(/\n/g, ''), 'base64').toString('utf-8');
    }

    if (content.length > 50000) {
      content = content.slice(0, 50000) + '\n... (truncated)';
    }

    return {
      name: result.name,
      path: result.path,
      size: result.size,
      sha: result.sha,
      content,
      url: result.html_url,
    };
  },
});

export const githubTools = {
  githubListPullRequests: githubListPullRequestsTool,
  githubListIssues: githubListIssuesTool,
  githubCommentOnPr: githubCommentOnPrTool,
  githubCommentOnIssue: githubCommentOnIssueTool,
  githubCreateIssue: githubCreateIssueTool,
  githubSetCommitStatus: githubSetCommitStatusTool,
  githubCreateDeploymentStatus: githubCreateDeploymentStatusTool,
  githubSearchRepoContent: githubSearchRepoContentTool,
  githubGetRepoFile: githubGetRepoFileTool,
  githubCreateOrUpdateFile: githubCreateOrUpdateFileTool,
  githubGetBranch: githubGetBranchTool,
  githubCreateBranch: githubCreateBranchTool,
  githubCreatePullRequest: githubCreatePullRequestTool,
  githubMergePullRequest: githubMergePullRequestTool,
};
