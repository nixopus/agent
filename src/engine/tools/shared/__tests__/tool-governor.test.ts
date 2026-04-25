import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withToolGovernor, type GovernorPolicy } from '../tool-governor';

function makeRequestContext(store: Record<string, unknown> = {}) {
  return {
    get: (k: string) => store[k],
    set: (k: string, v: unknown) => {
      store[k] = v;
    },
  };
}

function makeTool(id: string, executeFn?: (...args: unknown[]) => Promise<unknown>) {
  return {
    id,
    execute: executeFn ?? vi.fn(async (input: unknown) => ({ data: 'result', input })),
  };
}

const DEFAULT_POLICY: GovernorPolicy = {
  defaultLimit: 3,
  readOnlyLimit: 5,
  readOnlyTools: new Set(['getApplications', 'getApplication']),
  limits: { quickDeploy: 2 },
};

describe('withToolGovernor', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('passes through tools without execute', () => {
    const tool = { id: 'noExec', description: 'no exec fn' };
    const wrapped = withToolGovernor({ tool: tool as never }, DEFAULT_POLICY);
    expect(wrapped.tool).toBe(tool);
  });

  it('executes normally on first call', async () => {
    const tool = makeTool('getApplications');
    const wrapped = withToolGovernor({ tool: tool as never }, DEFAULT_POLICY);
    const ctx = { requestContext: makeRequestContext() };

    const result = await (wrapped.tool as { execute: Function }).execute({ page: 1 }, ctx);

    expect(result).toEqual({ data: 'result', input: { page: 1 } });
    expect(tool.execute).toHaveBeenCalledTimes(1);
  });

  it('returns cached result on duplicate call with same params', async () => {
    const tool = makeTool('getApplications');
    const wrapped = withToolGovernor({ tool: tool as never }, DEFAULT_POLICY);
    const ctx = { requestContext: makeRequestContext() };

    await (wrapped.tool as { execute: Function }).execute({ page: 1 }, ctx);
    const second = await (wrapped.tool as { execute: Function }).execute({ page: 1 }, ctx);

    expect(tool.execute).toHaveBeenCalledTimes(1);
    expect(second).toEqual(
      expect.objectContaining({ _cached: true, _note: 'Same call returned cached result.' }),
    );
  });

  it('executes again when params differ', async () => {
    const tool = makeTool('getApplications');
    const wrapped = withToolGovernor({ tool: tool as never }, DEFAULT_POLICY);
    const ctx = { requestContext: makeRequestContext() };

    await (wrapped.tool as { execute: Function }).execute({ page: 1 }, ctx);
    await (wrapped.tool as { execute: Function }).execute({ page: 2 }, ctx);

    expect(tool.execute).toHaveBeenCalledTimes(2);
  });

  it('ignores verbose/response_format/force in param hash', async () => {
    const tool = makeTool('getApplications');
    const wrapped = withToolGovernor({ tool: tool as never }, DEFAULT_POLICY);
    const ctx = { requestContext: makeRequestContext() };

    await (wrapped.tool as { execute: Function }).execute({ page: 1 }, ctx);
    const cached = await (wrapped.tool as { execute: Function }).execute(
      { page: 1, verbose: true, response_format: 'detailed' },
      ctx,
    );

    expect(tool.execute).toHaveBeenCalledTimes(1);
    expect(cached).toEqual(expect.objectContaining({ _cached: true }));
  });

  it('bypasses cache when force: true', async () => {
    const tool = makeTool('getApplications');
    const wrapped = withToolGovernor({ tool: tool as never }, DEFAULT_POLICY);
    const ctx = { requestContext: makeRequestContext() };

    await (wrapped.tool as { execute: Function }).execute({ page: 1 }, ctx);
    await (wrapped.tool as { execute: Function }).execute({ page: 1, force: true }, ctx);

    expect(tool.execute).toHaveBeenCalledTimes(2);
  });

  it('adds warning when advisory limit is exceeded', async () => {
    const tool = makeTool('quickDeploy');
    const wrapped = withToolGovernor({ tool: tool as never }, DEFAULT_POLICY);
    const store: Record<string, unknown> = {};
    const ctx = { requestContext: makeRequestContext(store) };

    await (wrapped.tool as { execute: Function }).execute({ name: 'app1' }, ctx);
    await (wrapped.tool as { execute: Function }).execute({ name: 'app2' }, ctx);
    await (wrapped.tool as { execute: Function }).execute({ name: 'app3' }, ctx);

    expect(tool.execute).toHaveBeenCalledTimes(3);

    const state = store.governorState as { warnings: string[] };
    expect(state.warnings.length).toBe(1);
    expect(state.warnings[0]).toContain('quickDeploy');
    expect(state.warnings[0]).toContain('advisory limit: 2');
  });

  it('uses readOnlyLimit for read-only tools', async () => {
    const tool = makeTool('getApplications');
    const wrapped = withToolGovernor({ tool: tool as never }, DEFAULT_POLICY);
    const store: Record<string, unknown> = {};
    const ctx = { requestContext: makeRequestContext(store) };

    for (let i = 0; i < 6; i++) {
      await (wrapped.tool as { execute: Function }).execute({ page: i }, ctx);
    }

    const state = store.governorState as { warnings: string[] };
    expect(state.warnings.length).toBe(1);
    expect(state.warnings[0]).toContain('advisory limit: 5');
  });

  it('uses per-tool limit override over readOnlyLimit', async () => {
    const policy: GovernorPolicy = {
      defaultLimit: 3,
      readOnlyLimit: 10,
      readOnlyTools: new Set(['myTool']),
      limits: { myTool: 1 },
    };
    const tool = makeTool('myTool');
    const wrapped = withToolGovernor({ tool: tool as never }, policy);
    const store: Record<string, unknown> = {};
    const ctx = { requestContext: makeRequestContext(store) };

    await (wrapped.tool as { execute: Function }).execute({ a: 1 }, ctx);
    await (wrapped.tool as { execute: Function }).execute({ a: 2 }, ctx);

    const state = store.governorState as { warnings: string[] };
    expect(state.warnings.length).toBe(1);
    expect(state.warnings[0]).toContain('advisory limit: 1');
  });

  it('uses defaultLimit for unclassified tools', async () => {
    const tool = makeTool('someTool');
    const wrapped = withToolGovernor({ tool: tool as never }, DEFAULT_POLICY);
    const store: Record<string, unknown> = {};
    const ctx = { requestContext: makeRequestContext(store) };

    for (let i = 0; i < 4; i++) {
      await (wrapped.tool as { execute: Function }).execute({ n: i }, ctx);
    }

    const state = store.governorState as { warnings: string[] };
    expect(state.warnings.length).toBe(1);
    expect(state.warnings[0]).toContain('advisory limit: 3');
  });

  it('works without requestContext (graceful fallback)', async () => {
    const tool = makeTool('getApplications');
    const wrapped = withToolGovernor({ tool: tool as never }, DEFAULT_POLICY);

    const result = await (wrapped.tool as { execute: Function }).execute({ page: 1 }, {});

    expect(result).toEqual({ data: 'result', input: { page: 1 } });
    expect(tool.execute).toHaveBeenCalledTimes(1);
  });

  it('isolates state between different requestContext instances', async () => {
    const tool = makeTool('getApplications');
    const wrapped = withToolGovernor({ tool: tool as never }, DEFAULT_POLICY);

    const ctx1 = { requestContext: makeRequestContext() };
    const ctx2 = { requestContext: makeRequestContext() };

    await (wrapped.tool as { execute: Function }).execute({ page: 1 }, ctx1);
    await (wrapped.tool as { execute: Function }).execute({ page: 1 }, ctx2);

    expect(tool.execute).toHaveBeenCalledTimes(2);
  });

  it('falls back to tool key name when tool has no id', async () => {
    const tool = { execute: vi.fn(async () => ({ ok: true })) };
    const wrapped = withToolGovernor({ myKey: tool as never }, DEFAULT_POLICY);
    const store: Record<string, unknown> = {};
    const ctx = { requestContext: makeRequestContext(store) };

    await (wrapped.myKey as { execute: Function }).execute({}, ctx);

    const state = store.governorState as { calls: Map<string, unknown> };
    expect(state.calls.has('myKey')).toBe(true);
  });
});
