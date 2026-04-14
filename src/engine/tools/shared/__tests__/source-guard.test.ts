import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../features/workspace/s3-store', () => ({
  remapPrefix: vi.fn(() => Promise.resolve(0)),
}));

import { remapPrefix } from '../../../../features/workspace/s3-store';
import { withSourceGuard } from '../source-guard';

function makeRequestContext(store: Record<string, unknown>) {
  return {
    get: (k: string) => store[k],
    set: (k: string, v: unknown) => {
      store[k] = v;
    },
  };
}

describe('withSourceGuard', () => {
  beforeEach(() => {
    vi.mocked(remapPrefix).mockClear();
  });

  it('blocks GitHub connector tools when workspaceSource is s3', async () => {
    const appId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const githubTool = {
      id: 'get_github_connectors',
      execute: vi.fn(async () => ({ ok: true })),
    };
    const wrapped = withSourceGuard({ githubTool: githubTool as never });
    const store = { workspaceSource: 's3', syncTarget: appId };
    const result = await (wrapped.githubTool as { execute: Function }).execute(
      {},
      { requestContext: makeRequestContext(store) },
    );
    expect(result).toEqual(
      expect.objectContaining({
        error:
          'This deployment is currently using synced source files, so GitHub connection actions are unavailable right now. ' +
          'Continue with the current source, or start a new deployment using your connected GitHub repositories.',
      }),
    );
    expect((result as { error: string }).error).not.toMatch(/s3|workspace|tool|applicationId|load_local_workspace/i);
    expect(githubTool.execute).not.toHaveBeenCalled();
  });

  it('blocks GitHub connector tools when workspaceSource is git_url', async () => {
    const appId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const githubTool = {
      id: 'get_github_connectors',
      execute: vi.fn(async () => ({ ok: true })),
    };
    const wrapped = withSourceGuard({ githubTool: githubTool as never });
    const store = { workspaceSource: 'git_url', syncTarget: appId };
    const result = await (wrapped.githubTool as { execute: Function }).execute(
      {},
      { requestContext: makeRequestContext(store) },
    );
    expect(result).toEqual(
      expect.objectContaining({
        error:
          'This deployment is currently using source code from a direct repository link, so GitHub connection actions are unavailable right now. ' +
          'Continue with the current source, or start a new deployment using your connected GitHub repositories.',
      }),
    );
    expect((result as { error: string }).error).not.toMatch(/s3|workspace|tool|applicationId|load_local_workspace/i);
    expect(githubTool.execute).not.toHaveBeenCalled();
  });

  it('blocks analyze_repository with git_url-specific remediation (no local/editor wording)', async () => {
    const appId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
    const analyzeTool = {
      id: 'analyze_repository',
      execute: vi.fn(async () => ({ ok: true })),
    };
    const wrapped = withSourceGuard({ analyzeTool: analyzeTool as never });
    const result = await (wrapped.analyzeTool as { execute: Function }).execute(
      {},
      {
        requestContext: makeRequestContext({
          workspaceSource: 'git_url',
          syncTarget: appId,
        }),
      },
    );
    expect(result).toEqual(
      expect.objectContaining({
        error:
          'A repository source is already loaded from a direct link for this deployment. ' +
          'Continue with the current source instead of starting a separate repository analysis.',
      }),
    );
    expect((result as { error: string }).error).not.toMatch(/s3|workspace|tool|applicationId|load_local_workspace/i);
    expect(analyzeTool.execute).not.toHaveBeenCalled();
  });

  it('blocks github_* tools when workspaceSource is git_url', async () => {
    const appId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
    const githubTool = {
      id: 'github_create_pull_request',
      execute: vi.fn(async () => ({ ok: true })),
    };
    const wrapped = withSourceGuard({ githubTool: githubTool as never });
    const result = await (wrapped.githubTool as { execute: Function }).execute(
      {},
      {
        requestContext: makeRequestContext({
          workspaceSource: 'git_url',
          syncTarget: appId,
        }),
      },
    );
    expect(result).toEqual(
      expect.objectContaining({
        error:
          'This deployment is currently using source code from a direct repository link, so GitHub connection actions are unavailable right now. ' +
          'Continue with the current source, or start a new deployment using your connected GitHub repositories.',
      }),
    );
    expect((result as { error: string }).error).not.toMatch(/s3|workspace|tool|applicationId|load_local_workspace/i);
    expect(githubTool.execute).not.toHaveBeenCalled();
  });

  it('stamps create_project payload and remaps workspace prefix for git_url workspace', async () => {
    const syncTarget = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const workspaceId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const newAppId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

    const createProjectTool = {
      id: 'create_project',
      execute: vi.fn(async (input: Record<string, unknown>) => {
        expect(input.source).toBe('s3');
        expect(input.repository).toBe('0');
        const body = input.body as Record<string, unknown>;
        expect(body.source).toBe('s3');
        expect(body.repository).toBe('0');
        expect(body.other).toBe(1);
        return { id: newAppId };
      }),
    };

    const wrapped = withSourceGuard({ createProjectTool: createProjectTool as never });
    const input: Record<string, unknown> = {
      name: 'Test',
      source: 'github',
      repository: '99',
      body: { source: 'github', repository: '99', other: 1 },
    };

    await (wrapped.createProjectTool as { execute: Function }).execute(input, {
      requestContext: makeRequestContext({
        workspaceSource: 'git_url',
        syncTarget,
        workspaceId,
        contextBranch: 'main',
      }),
    });

    expect(createProjectTool.execute).toHaveBeenCalledTimes(1);
    expect(remapPrefix).toHaveBeenCalledWith(syncTarget, newAppId);
  });
});
