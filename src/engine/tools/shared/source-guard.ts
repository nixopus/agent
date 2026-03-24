import type { ToolWriter } from '../api/shared';
import { remapPrefix } from '../../../features/workspace/s3-store';
import { createLogger } from '../../../logger';

const logger = createLogger('source-guard');

const S3_BLOCKED_TOOLS = new Map<string, (syncTarget: string) => string>([
  [
    'get_github_connectors',
    (id) =>
      `Not available for local workspaces. The codebase is synced via the editor. ` +
      `Call load_local_workspace with applicationId="${id}" to load the codebase instead.`,
  ],
  [
    'getGithubConnectors',
    (id) =>
      `Not available for local workspaces. The codebase is synced via the editor. ` +
      `Call load_local_workspace with applicationId="${id}" to load the codebase instead.`,
  ],
  [
    'get_github_repositories',
    (id) =>
      `Not available for local workspaces. The codebase is synced via the editor. ` +
      `Call load_local_workspace with applicationId="${id}" to load the codebase instead.`,
  ],
  [
    'getGithubRepositories',
    (id) =>
      `Not available for local workspaces. The codebase is synced via the editor. ` +
      `Call load_local_workspace with applicationId="${id}" to load the codebase instead.`,
  ],
  [
    'analyze_repository',
    (id) =>
      `Not available for local workspaces. ` +
      `Call load_local_workspace with applicationId="${id}" to load the codebase instead.`,
  ],
  [
    'analyzeRepository',
    (id) =>
      `Not available for local workspaces. ` +
      `Call load_local_workspace with applicationId="${id}" to load the codebase instead.`,
  ],
]);

const S3_CREATE_PROJECT_TOOLS = new Set([
  'create_project',
  'createProject',
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

function isS3(reqCtx: RequestContext | undefined): boolean {
  return reqCtx?.get?.('workspaceSource') === 's3';
}

function syncTarget(reqCtx: RequestContext | undefined): string {
  return (reqCtx?.get?.('syncTarget') as string)
    ?? (reqCtx?.get?.('contextApplicationId') as string)
    ?? 'unknown';
}

function stampS3Fields(input: Record<string, unknown>): void {
  input.source = 's3';
  input.repository = '0';

  if (!input.body || typeof input.body !== 'object') return;
  const body = input.body as Record<string, unknown>;
  body.source = 's3';
  body.repository = '0';
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
  const blockedMessageFn = S3_BLOCKED_TOOLS.get(toolId);
  if (blockedMessageFn) {
    return async (input, ctx) => {
      const reqCtx = getReqCtx(ctx);
      if (isS3(reqCtx)) return { error: blockedMessageFn(syncTarget(reqCtx)) };
      return origExecute(input, ctx);
    };
  }

  if (!S3_CREATE_PROJECT_TOOLS.has(toolId)) return null;

  return async (input, ctx) => {
    const reqCtx = getReqCtx(ctx);
    const s3 = isS3(reqCtx);
    if (s3) stampS3Fields(input as Record<string, unknown>);
    const resultData = await origExecute(input, ctx);
    if (s3) await handlePostCreate(resultData, ctx, reqCtx);
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
