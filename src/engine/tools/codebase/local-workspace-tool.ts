import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { Workspace, WorkspaceFilesystem } from '@mastra/core/workspace';
import { listFiles, isS3Configured } from '../../../features/workspace/s3-store';
import type { FetchedFile } from '../../../features/workspace/support';

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

export const loadLocalWorkspaceTool = createTool({
  id: 'load_local_workspace',
  description:
    'Load a locally-synced workspace (non-GitHub) into the agent workspace for analysis. ' +
    'Use this when the user has a local workspace linked via S3 sync instead of a GitHub repository. ' +
    'Pass the syncTarget from the context block (this is the applicationId if the app exists, or workspaceId if first deploy). ' +
    'After calling this, use read_file, grep, search, list_directory to explore the codebase.',
  inputSchema: z.object({
    applicationId: z.string().min(1).describe('The syncTarget UUID from the context block'),
  }),
  execute: async ({ applicationId }, ctx) => {
    if (!isS3Configured()) {
      return { error: 'S3 storage is not configured', fileCount: 0 };
    }

    const workspace = ctx?.workspace as Workspace | undefined;

    const files = await listFiles(applicationId);

    if (files.length === 0) {
      return { error: 'No files found in workspace', fileCount: 0 };
    }

    const workspaceRoot = `apps/${applicationId}`;

    if (workspace) {
      await populateWorkspace(workspace, workspaceRoot, files);
    }

    return {
      workspaceRoot,
      fileCount: files.length,
      message: 'Local workspace loaded. Use read_file, grep, search, list_directory to explore.',
    };
  },
});
