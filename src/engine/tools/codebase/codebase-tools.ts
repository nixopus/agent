import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { Workspace, WorkspaceFilesystem } from '@mastra/core/workspace';
import { fetchRepoFiles } from '../../../features/workspace/support';
import type { FetchedFile } from '../../../features/workspace/support';
import { analyzeFiles } from '../../../features/workspace/repo-analyzer';
import type { NixopusRequestContext } from '../shared/nixopus-client';

async function ensureInitialized(workspace: Workspace): Promise<void> {
  if (workspace.status === 'pending') {
    await workspace.init();
  }
}

async function writeFilesToWorkspace(
  fs: WorkspaceFilesystem,
  root: string,
  files: FetchedFile[],
): Promise<void> {
  const dirs = new Set<string>();
  for (const file of files) {
    const lastSlash = file.path.lastIndexOf('/');
    if (lastSlash > 0) dirs.add(file.path.substring(0, lastSlash));
  }

  for (const dir of [...dirs].sort()) {
    await fs.mkdir(`${root}/${dir}`, { recursive: true });
  }

  for (const file of files) {
    await fs.writeFile(`${root}/${file.path}`, file.content);
  }
}

async function populateWorkspace(
  workspace: Workspace,
  root: string,
  files: FetchedFile[],
): Promise<void> {
  await ensureInitialized(workspace);

  const fs = workspace.filesystem;
  if (fs) {
    await writeFilesToWorkspace(fs, root, files);
  }

  for (const file of files) {
    await workspace.index(`${root}/${file.path}`, file.content, {
      metadata: { language: file.language },
    });
  }
}

export const analyzeRepositoryTool = createTool({
  id: 'analyze_repository',
  description:
    'Fetch a GitHub repository and return deployment hints. ' +
    'Returns ecosystem, framework, port, Dockerfile presence, and more with confidence levels. ' +
    'When hints.confidence is "high", proceed directly to create/deploy. ' +
    'When "medium", verify only the flagged items. When "low", explore with workspace tools. ' +
    'Does NOT require an applicationId — call this first.',
  inputSchema: z.object({
    owner: z.string().describe('GitHub repository owner'),
    repo: z.string().describe('GitHub repository name'),
    branch: z.string().describe('Branch to analyze'),
    connectorId: z.string().uuid().optional().describe('GitHub connector UUID when user has multiple connectors'),
  }),
  execute: async ({ owner, repo, branch, connectorId }, ctx) => {
    const requestContext = ctx?.requestContext as NixopusRequestContext | undefined;
    const workspace = ctx?.workspace as Workspace | undefined;

    const { files, treeSha } = await fetchRepoFiles(owner, repo, branch, requestContext, connectorId);

    if (files.length === 0) {
      return { error: 'No files found in repository', fileCount: 0 };
    }

    const repoRoot = `repos/${owner}/${repo}/${branch}`;

    if (workspace) {
      await populateWorkspace(workspace, repoRoot, files);
    }

    const hints = analyzeFiles(files);

    return {
      repoRoot,
      fileCount: files.length,
      commit: treeSha,
      hints,
      message: hints.confidence === 'high'
        ? 'Repository analyzed with high confidence. Proceed to create/deploy.'
        : hints.confidence === 'medium'
          ? `Repository analyzed. Verify flagged items: ${hints.warnings.join('; ')}`
          : 'Repository loaded. Explore with workspace tools to confirm deployment config.',
    };
  },
});

export const prepareCodebaseTool = createTool({
  id: 'prepare_codebase',
  description:
    'Prepare an analyzed repository for a created application. ' +
    'Call after creating a project so workspace tools can access the codebase.',
  inputSchema: z.object({
    applicationId: z.string().uuid().describe('The application UUID from create_project'),
    owner: z.string().describe('GitHub repository owner'),
    repo: z.string().describe('GitHub repository name'),
    branch: z.string().describe('Branch'),
  }),
  execute: async ({ applicationId, owner, repo, branch }, ctx) => {
    const requestContext = ctx?.requestContext as NixopusRequestContext | undefined;
    const workspace = ctx?.workspace as Workspace | undefined;

    const { files, treeSha } = await fetchRepoFiles(owner, repo, branch, requestContext, undefined);

    if (files.length === 0) {
      return { ready: false, error: 'No files found.', fileCount: 0 };
    }

    if (workspace) {
      const appRoot = `apps/${applicationId}`;
      await populateWorkspace(workspace, appRoot, files);
    }

    return { ready: true, fileCount: files.length, commit: treeSha };
  },
});

import { loadLocalWorkspaceTool } from './local-workspace-tool';
import { loadRemoteRepositoryTool } from './import-remote-repository-tool';

export const codebaseTools = {
  analyzeRepository: analyzeRepositoryTool,
  prepareCodebase: prepareCodebaseTool,
  loadLocalWorkspace: loadLocalWorkspaceTool,
  loadRemoteRepository: loadRemoteRepositoryTool,
};
