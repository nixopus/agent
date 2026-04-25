import type { ToolWriter } from '../api/shared';
import { remapPrefix } from '../../../features/workspace/s3-store';
import { createLogger } from '../../../logger';

const logger = createLogger('source-guard');

type WorkspaceBackedSource = 's3' | 'git_url';

function blockedGithubConnectorToolMessage(workspaceSource: WorkspaceBackedSource): string {
  if (workspaceSource === 'git_url') {
    return (
      'This deployment is currently using source code from a direct repository link, so GitHub connection actions are unavailable right now. ' +
      'Continue with the current source, or start a new deployment using your connected GitHub repositories.'
    );
  }
  return (
    'This deployment is currently using synced source files, so GitHub connection actions are unavailable right now. ' +
    'Continue with the current source, or start a new deployment using your connected GitHub repositories.'
  );
}

function blockedAnalyzeRepositoryMessage(workspaceSource: WorkspaceBackedSource): string {
  if (workspaceSource === 'git_url') {
    return (
      'A repository source is already loaded from a direct link for this deployment. ' +
      'Continue with the current source instead of starting a separate repository analysis.'
    );
  }
  return (
    'Source files are already loaded for this deployment. ' +
    'Continue with the current source instead of starting a separate repository analysis.'
  );
}

const BLOCKED_GITHUB_TOOLS = new Set([
  'get_github_connectors',
  'getGithubConnectors',
  'get_github_repositories',
  'getGithubRepositories',
  'get_github_repository_branches',
  'getGithubRepositoryBranches',
]);

const BLOCKED_ANALYZE_TOOLS = new Set([
  'analyze_repository',
  'analyzeRepository',
]);

function isBlockedGithubTool(toolId: string): boolean {
  return BLOCKED_GITHUB_TOOLS.has(toolId) || /^github_[a-z0-9_]+$/i.test(toolId) || /^github[A-Z]/.test(toolId);
}

const SOURCE_GUARDED_PROJECT_TOOLS = new Set([
  'create_project',
  'createProject',
  'quick_deploy',
  'quickDeploy',
]);

type RequestContext = { get?: (k: string) => unknown; set?: (k: string, v: unknown) => void };
type ToolCtx = { requestContext?: RequestContext; writer?: ToolWriter; [key: string]: unknown };

const ID_FIELDS = ['id', 'applicationId', 'application_id'] as const;

function findIdField(obj: Record<string, unknown>): string | undefined {
  for (const field of ID_FIELDS) {
    if (typeof obj[field] === 'string') return obj[field] as string;
  }
  return undefined;
}

function extractAppId(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const r = result as Record<string, unknown>;

  const direct = findIdField(r);
  if (direct) return direct;

  if (r.data && typeof r.data === 'object') {
    const nested = findIdField(r.data as Record<string, unknown>);
    if (nested) return nested;
  }

  const match = JSON.stringify(r).match(/"(?:id|applicationId|application_id)":"([0-9a-f-]{36})"/i);
  return match?.[1];
}

function getReqCtx(ctx: unknown): RequestContext | undefined {
  return (ctx as ToolCtx)?.requestContext;
}

function workspaceBackedSource(reqCtx: RequestContext | undefined): WorkspaceBackedSource | undefined {
  const source = reqCtx?.get?.('workspaceSource');
  if (source === 's3' || source === 'git_url') return source;
  return undefined;
}

function stampSourceFields(
  input: Record<string, unknown>,
  wsSource: WorkspaceBackedSource,
  reqCtx: RequestContext | undefined,
): void {
  const importedUrl = reqCtx?.get?.('importedRepoUrl') as string | undefined;
  const usePublicGit = wsSource === 'git_url' && !!importedUrl;

  const source = usePublicGit ? 'public_git' : 's3';
  const repository = usePublicGit ? importedUrl : '0';

  input.source = source;
  input.repository = repository;

  if (!input.body || typeof input.body !== 'object') return;
  const body = input.body as Record<string, unknown>;
  body.source = source;
  body.repository = repository;
}

async function handlePostCreate(
  resultData: unknown,
  ctx: unknown,
  reqCtx: RequestContext | undefined,
): Promise<void> {
  if (!resultData || typeof resultData !== 'object') return;

  const newAppId = extractAppId(resultData);
  const workspaceId = reqCtx?.get?.('workspaceId') as string | undefined;
  const syncTgt = reqCtx?.get?.('syncTarget') as string | undefined;
  const branch = reqCtx?.get?.('contextBranch') as string | undefined;

  logger.info({ newAppId, workspaceId, syncTarget: syncTgt, branch }, 'createProject result for s3');

  if (!newAppId || !workspaceId) return;

  const fromId = syncTgt ?? workspaceId;
  if (fromId !== newAppId) {
    try {
      const copied = await remapPrefix(fromId, newAppId);
      logger.info({ fromId, toId: newAppId, copied }, 'remapPrefix complete');
    } catch (remapErr) {
      logger.error({ fromId, toId: newAppId, err: remapErr }, 'remapPrefix failed');
    }
  }

  const writer = (ctx as ToolCtx)?.writer;
  await writer?.custom?.({
    type: 'data-app-created',
    data: { applicationId: newAppId, workspaceId, branch: branch ?? 'main' },
    transient: true,
  });
}

export function isWrappable(tool: unknown): tool is Record<string, unknown> & { execute: Function } {
  return !!tool && typeof tool === 'object' && typeof (tool as Record<string, unknown>).execute === 'function';
}

type ExecuteFn = (input: unknown, ctx: unknown) => Promise<unknown>;

function wrapExecute(toolId: string, origExecute: ExecuteFn): ExecuteFn | null {
  if (BLOCKED_ANALYZE_TOOLS.has(toolId)) {
    return async (input, ctx) => {
      const reqCtx = getReqCtx(ctx);
      const backed = workspaceBackedSource(reqCtx);
      if (backed) return { error: blockedAnalyzeRepositoryMessage(backed) };
      return origExecute(input, ctx);
    };
  }

  if (isBlockedGithubTool(toolId)) {
    return async (input, ctx) => {
      const reqCtx = getReqCtx(ctx);
      const backed = workspaceBackedSource(reqCtx);
      if (backed) return { error: blockedGithubConnectorToolMessage(backed) };
      return origExecute(input, ctx);
    };
  }

  if (!SOURCE_GUARDED_PROJECT_TOOLS.has(toolId)) return null;

  return async (input, ctx) => {
    const reqCtx = getReqCtx(ctx);
    const wsSource = workspaceBackedSource(reqCtx);
    if (wsSource) stampSourceFields(input as Record<string, unknown>, wsSource, reqCtx);
    const resultData = await origExecute(input, ctx);
    if (wsSource) await handlePostCreate(resultData, ctx, reqCtx);
    return resultData;
  };
}

export function withSourceGuard<T extends Record<string, unknown>>(tools: T): T {
  const result: Record<string, unknown> = {};

  for (const [name, tool] of Object.entries(tools)) {
    if (!isWrappable(tool)) {
      result[name] = tool;
      continue;
    }

    const toolId = (tool.id as string) ?? name;
    const wrapped = wrapExecute(toolId, tool.execute as ExecuteFn);
    result[name] = wrapped ? { ...tool, execute: wrapped } : tool;
  }

  return result as T;
}
