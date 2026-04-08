import { Workspace, LocalFilesystem, LocalSandbox, WORKSPACE_TOOLS } from '@mastra/core/workspace';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { cpSync, existsSync, mkdirSync } from 'fs';
import { createLogger } from '../logger';

const logger = createLogger('workspace-factory');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SKILLS_SOURCE = join(__dirname, '..', '..', 'skills');

const TOOL_NAMES = {
  [WORKSPACE_TOOLS.FILESYSTEM.READ_FILE]: { name: 'read_file' },
  [WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE]: { name: 'write_file' },
  [WORKSPACE_TOOLS.FILESYSTEM.EDIT_FILE]: { name: 'edit_file' },
  [WORKSPACE_TOOLS.FILESYSTEM.LIST_FILES]: { name: 'list_directory' },
  [WORKSPACE_TOOLS.FILESYSTEM.GREP]: { name: 'grep' },
  [WORKSPACE_TOOLS.SANDBOX.EXECUTE_COMMAND]: { name: 'execute_command' },
  [WORKSPACE_TOOLS.SANDBOX.GET_PROCESS_OUTPUT]: { name: 'get_process_output' },

  [WORKSPACE_TOOLS.FILESYSTEM.DELETE]: { name: 'delete_file', enabled: false },
  [WORKSPACE_TOOLS.FILESYSTEM.FILE_STAT]: { name: 'stat_file', enabled: false },
  [WORKSPACE_TOOLS.FILESYSTEM.MKDIR]: { name: 'mkdir', enabled: false },
  [WORKSPACE_TOOLS.SEARCH.SEARCH]: { name: 'search', enabled: false },
  [WORKSPACE_TOOLS.SEARCH.INDEX]: { name: 'index_content', enabled: false },
  [WORKSPACE_TOOLS.FILESYSTEM.AST_EDIT]: { name: 'ast_edit', enabled: false },
  [WORKSPACE_TOOLS.SANDBOX.KILL_PROCESS]: { name: 'kill_process', enabled: false },
} as const;

const WORKSPACE_CTX_KEY = '__workspace';

export function createRequestWorkspace({ requestContext }: { requestContext: { get?: (key: string) => unknown; set?: (key: string, value: unknown) => void } }): Workspace {
  const cached = requestContext?.get?.(WORKSPACE_CTX_KEY) as Workspace | undefined;
  if (cached) return cached;

  const rawUserId = requestContext?.get?.('userId');
  const userId = typeof rawUserId === 'string' ? rawUserId : 'anon';
  const sessionId = randomUUID().slice(0, 8);
  const basePath = join(tmpdir(), `octodel-ws-${userId.slice(0, 8)}-${sessionId}`);

  mkdirSync(basePath, { recursive: true });

  const hasSkills = existsSync(SKILLS_SOURCE);
  if (hasSkills) {
    cpSync(SKILLS_SOURCE, join(basePath, 'skills'), { recursive: true });
  }

  const workspace = new Workspace({
    id: `ws-${userId.slice(0, 8)}-${sessionId}`,
    filesystem: new LocalFilesystem({ basePath }),
    sandbox: new LocalSandbox({ workingDirectory: basePath }),
    bm25: true,
    ...(hasSkills && { skills: ['skills'] }),
    tools: TOOL_NAMES,
  });

  requestContext?.set?.(WORKSPACE_CTX_KEY, workspace);
  logger.debug({ workspaceId: workspace.id, basePath, hasSkills }, 'Workspace created');
  return workspace;
}
