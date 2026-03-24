import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { Workspace } from '@mastra/core/workspace';
import { emitToolProgress, type ToolWriter } from '../api/shared';

export const writeWorkspaceFilesTool = createTool({
  id: 'write_workspace_files',
  description:
    'Write one or more files to the workspace. Use this to save generated Dockerfiles, docker-compose files, ' +
    'config files, or any other artifacts. For S3-backed workspaces (source=s3), files are automatically ' +
    'streamed to the user\'s local editor and synced to S3 for deployment. For GitHub-backed workspaces, ' +
    'push files to GitHub via github_create_or_update_file after writing.',
  inputSchema: z.object({
    applicationId: z
      .string()
      .uuid()
      .describe('The application UUID'),
    files: z
      .array(
        z.object({
          path: z.string().describe('File path relative to workspace root (e.g. "Dockerfile", "docker-compose.yml")'),
          content: z.string().describe('File content to write'),
        }),
      )
      .min(1)
      .describe('Files to write to the workspace'),
  }),
  execute: async ({ applicationId, files }, context) => {
    const workspace = context?.workspace as Workspace | undefined;

    if (!workspace) {
      throw new Error('No workspace available in tool execution context');
    }

    if (workspace.status === 'pending') {
      await workspace.init();
    }

    await emitToolProgress(context, 'write_workspace_files', 'start', { applicationId, fileCount: files.length });

    const writer = (context as { writer?: ToolWriter })?.writer;
    const fs = workspace.filesystem;
    for (const file of files) {
      const filePath = file.path.startsWith('/') ? file.path.slice(1) : file.path;
      const lastSlash = filePath.lastIndexOf('/');
      if (lastSlash > 0 && fs) {
        await fs.mkdir(filePath.substring(0, lastSlash), { recursive: true });
      }
      if (fs) {
        await fs.writeFile(filePath, file.content);
      }
      await workspace.index(filePath, file.content, { metadata: {} });

      if (writer?.custom) {
        await writer.custom({
          type: 'data-write-file',
          data: { applicationId, path: filePath, content: file.content },
          transient: true,
        });
      }
    }

    await emitToolProgress(context, 'write_workspace_files', 'completed', { written: files.length });
    return {
      written: files.length,
      paths: files.map((f: { path: string }) => f.path),
      applicationId,
    };
  },
});

export const deployGenTools = {
  writeWorkspaceFiles: writeWorkspaceFilesTool,
};
