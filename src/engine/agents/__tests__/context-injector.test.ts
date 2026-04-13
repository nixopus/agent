import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../logger', () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));

const mockListApplications = vi.fn();
const mockListDomains = vi.fn();
const mockListServers = vi.fn();
const mockListGitHubConnectors = vi.fn();
const mockListGitHubRepositories = vi.fn();
const mockListOrgMcpServers = vi.fn();

vi.mock('@nixopus/api-client', () => ({
  listApplications: (...args: unknown[]) => mockListApplications(...args),
  listDomains: (...args: unknown[]) => mockListDomains(...args),
  listServers: (...args: unknown[]) => mockListServers(...args),
  listGitHubConnectors: (...args: unknown[]) => mockListGitHubConnectors(...args),
  listGitHubRepositories: (...args: unknown[]) => mockListGitHubRepositories(...args),
  listOrgMcpServers: (...args: unknown[]) => mockListOrgMcpServers(...args),
}));

vi.mock('../../tools/shared/nixopus-client', () => ({
  createNixopusClient: () => ({}),
}));

import type { ProcessInputStepArgs } from '@mastra/core/processors';
import { ContextInjectorProcessor, formatContext } from '../context-injector';

function makeReqCtx(overrides: Record<string, string> = {}) {
  const store = new Map<string, unknown>(Object.entries({ authToken: 'tok', organizationId: 'org-1', ...overrides }));
  return { get: (k: string) => store.get(k), set: (k: string, v: unknown) => store.set(k, v) };
}

function makeArgs(stepNumber: number, rc: ReturnType<typeof makeReqCtx>): ProcessInputStepArgs {
  return {
    stepNumber,
    messages: [],
    systemMessages: [],
    requestContext: rc as unknown as ProcessInputStepArgs['requestContext'],
    steps: [],
    model: {} as never,
    toolChoice: 'auto' as const,
    activeTools: [],
    tools: {},
    providerOptions: {},
    modelSettings: {},
    structuredOutput: undefined,
    state: {},
    retryCount: 0,
    abort: (() => { throw new Error('abort'); }) as never,
    tracingContext: {} as never,
    messageList: {} as never,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListApplications.mockResolvedValue({ data: [] });
  mockListDomains.mockResolvedValue({ data: [] });
  mockListServers.mockResolvedValue({ data: [] });
  mockListGitHubConnectors.mockResolvedValue({ data: [] });
  mockListGitHubRepositories.mockResolvedValue({ data: [] });
  mockListOrgMcpServers.mockResolvedValue({ data: [] });
});

describe('formatContext', () => {
  it('returns empty string when all sections are empty', () => {
    expect(formatContext({ apps: [], domains: [], servers: [], connectors: [], repos: [], mcpServers: [] })).toBe('');
  });

  it('formats apps with domains', () => {
    const result = formatContext({
      apps: [{ name: 'my-api', id: 'abc', status: 'running', port: 3000, branch: 'main', domains: ['my-api.dev'] }],
      domains: [], servers: [], connectors: [], repos: [], mcpServers: [],
    });
    expect(result).toContain('[user-context]');
    expect(result).toContain('my-api(id:abc,status:running,port:3000,branch:main,domains:my-api.dev)');
    expect(result).toContain('[/user-context]');
  });

  it('formats domains with app reference', () => {
    const result = formatContext({
      apps: [],
      domains: [{ domain: 'app.dev', id: 'd1', appName: 'my-api' }],
      servers: [], connectors: [], repos: [], mcpServers: [],
    });
    expect(result).toContain('app.dev(id:d1,app:my-api)');
  });

  it('formats servers with default flag', () => {
    const result = formatContext({
      apps: [], domains: [],
      servers: [{ name: 'prod-1', id: 'sv1', ip: '10.0.0.1', status: 'active', isDefault: true }],
      connectors: [], repos: [], mcpServers: [],
    });
    expect(result).toContain('servers: prod-1(id:sv1,ip:10.0.0.1,status:active,default:true)');
  });

  it('formats connectors and repos', () => {
    const result = formatContext({
      apps: [], domains: [], servers: [],
      connectors: [{ name: 'gh-app', id: 'c1' }],
      repos: [{ name: 'my-repo', id: 12345 }],
      mcpServers: [],
    });
    expect(result).toContain('connectors: gh-app(id:c1)');
    expect(result).toContain('repos: my-repo(id:12345)');
  });

  it('formats MCP servers', () => {
    const result = formatContext({
      apps: [], domains: [], servers: [], connectors: [], repos: [],
      mcpServers: [{ name: 'supabase', id: 's1', provider: 'supabase', status: 'active' }],
    });
    expect(result).toContain('mcp_servers: supabase(id:s1,provider:supabase,status:active)');
  });

  it('renders all sections together', () => {
    const result = formatContext({
      apps: [{ name: 'a', id: '1', status: 'running', port: 80, branch: 'main', domains: [] }],
      domains: [{ domain: 'x.dev', id: '2', appName: '' }],
      servers: [{ name: 's', id: '6', ip: '1.2.3.4', status: 'active', isDefault: false }],
      connectors: [{ name: 'gh', id: '3' }],
      repos: [{ name: 'r', id: 4 }],
      mcpServers: [{ name: 'mc', id: '5', provider: 'p', status: 'active' }],
    });
    expect(result).toContain('apps:');
    expect(result).toContain('domains:');
    expect(result).toContain('servers:');
    expect(result).toContain('connectors:');
    expect(result).toContain('repos:');
    expect(result).toContain('mcp_servers:');
  });
});

describe('ContextInjectorProcessor', () => {
  it('fetches and injects context on step 0', async () => {
    mockListApplications.mockResolvedValue({
      data: [{ id: 'app-1', name: 'web', status: 'running', port: 3000, branch: 'main', domains: [] }],
    });
    mockListGitHubConnectors.mockResolvedValue({
      data: [{ id: 'c1', name: 'gh-conn' }],
    });
    mockListGitHubRepositories.mockResolvedValue({
      data: [{ id: 999, name: 'my-repo' }],
    });
    mockListOrgMcpServers.mockResolvedValue({
      data: [{ id: 'm1', name: 'supa', provider: 'supabase', status: 'active' }],
    });

    const processor = new ContextInjectorProcessor();
    const rc = makeReqCtx();
    const result = await processor.processInputStep(makeArgs(0, rc));

    expect(mockListApplications).toHaveBeenCalledTimes(1);
    expect(mockListDomains).toHaveBeenCalledTimes(1);
    expect(mockListServers).toHaveBeenCalledTimes(1);
    expect(mockListGitHubConnectors).toHaveBeenCalledTimes(1);
    expect(mockListOrgMcpServers).toHaveBeenCalledTimes(1);
    expect(mockListGitHubRepositories).toHaveBeenCalledTimes(1);

    const sysMsg = (result as { systemMessages?: Array<{ content: string }> }).systemMessages;
    expect(sysMsg).toBeDefined();
    expect(sysMsg!.length).toBe(1);
    expect(sysMsg![0].content).toContain('[user-context]');
    expect(sysMsg![0].content).toContain('web(id:app-1');
    expect(sysMsg![0].content).toContain('my-repo(id:999)');
    expect(sysMsg![0].content).toContain('supa(id:m1');
  });

  it('returns cached context on step 1+ without re-fetching', async () => {
    mockListApplications.mockResolvedValue({
      data: [{ id: 'app-1', name: 'web', status: 'running', port: 3000, branch: 'main', domains: [] }],
    });

    const processor = new ContextInjectorProcessor();
    const rc = makeReqCtx();

    await processor.processInputStep(makeArgs(0, rc));
    vi.clearAllMocks();

    const result = await processor.processInputStep(makeArgs(1, rc));

    expect(mockListApplications).not.toHaveBeenCalled();
    const sysMsg = (result as { systemMessages?: Array<{ content: string }> }).systemMessages;
    expect(sysMsg).toBeDefined();
    expect(sysMsg![0].content).toContain('[user-context]');
  });

  it('skips injection when no auth credentials', async () => {
    const processor = new ContextInjectorProcessor();
    const rc = makeReqCtx({ authToken: '' });
    rc.set('authToken', undefined as unknown as string);

    const result = await processor.processInputStep(makeArgs(0, rc));

    expect(mockListApplications).not.toHaveBeenCalled();
    expect(result).toEqual({});
  });

  it('degrades gracefully when fetches fail', async () => {
    mockListApplications.mockRejectedValue(new Error('network error'));
    mockListDomains.mockRejectedValue(new Error('timeout'));
    mockListServers.mockRejectedValue(new Error('server error'));
    mockListGitHubConnectors.mockRejectedValue(new Error('auth failed'));
    mockListOrgMcpServers.mockRejectedValue(new Error('500'));

    const processor = new ContextInjectorProcessor();
    const rc = makeReqCtx();
    const result = await processor.processInputStep(makeArgs(0, rc));

    expect(result).toEqual({});
  });

  it('skips repos when no connectors exist', async () => {
    mockListGitHubConnectors.mockResolvedValue({ data: [] });

    const processor = new ContextInjectorProcessor();
    const rc = makeReqCtx();
    await processor.processInputStep(makeArgs(0, rc));

    expect(mockListGitHubRepositories).not.toHaveBeenCalled();
  });

  it('does not fetch on step > 0 when no cache exists', async () => {
    const processor = new ContextInjectorProcessor();
    const rc = makeReqCtx();
    const result = await processor.processInputStep(makeArgs(5, rc));

    expect(mockListApplications).not.toHaveBeenCalled();
    expect(result).toEqual({});
  });
});
