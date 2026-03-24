import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../logger', () => ({
  createLogger: () => mockLogger,
}));

const {
  mockCacheGetOrSet,
  mockCacheInvalidateByPrefix,
  mockSshOrchestrator,
  mockDbRows,
} = vi.hoisted(() => ({
  mockCacheGetOrSet: vi.fn(),
  mockCacheInvalidateByPrefix: vi.fn(),
  mockSshOrchestrator: { type: 'ssh', close: vi.fn() },
  mockDbRows: { value: [] as any[] },
}));

vi.mock('../local-orchestrator', () => ({
  createLocalOrchestrator: vi.fn(() => ({ type: 'local' })),
}));

vi.mock('../ssh-orchestrator', () => ({
  createSshOrchestrator: vi.fn(() => mockSshOrchestrator),
}));

vi.mock('../orchestrator-cache', () => ({
  createOrchestratorCache: () => ({
    getOrSet: mockCacheGetOrSet,
    invalidate: vi.fn(),
    invalidateByPrefix: mockCacheInvalidateByPrefix,
    evictAll: vi.fn(),
  }),
}));

vi.mock('../../db', () => ({
  getDb: () => ({
    select: () => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn(() => Promise.resolve(mockDbRows.value)),
        }),
      }),
    }),
  }),
  schema: {
    sshKeys: {
      organizationId: 'organizationId',
      isActive: 'isActive',
    },
  },
}));

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  mockDbRows.value = [];
  process.env.DATABASE_URL = 'postgres://localhost/test';
  mockCacheGetOrSet.mockImplementation(async (_key: string, factory: () => Promise<any>) => factory());
});

afterEach(() => {
  process.env.DATABASE_URL = originalEnv.DATABASE_URL;
});

vi.mock('../../config', () => ({
  config: {
    databaseUrl: 'postgres://localhost/test',
  },
}));

import { getOrchestratorForSource, invalidateSshOrchestratorCache } from '../orchestrator-resolver';

describe('orchestrator-resolver — local fallback', () => {
  it('returns local orchestrator for relative path', async () => {
    const { orchestrator, debug } = await getOrchestratorForSource('./my-repo', 'org-1');

    expect((orchestrator as any).type).toBe('local');
    expect(debug.usedSsh).toBe(false);
    expect(debug.reason).toBe('source_not_remote_path');
  });

  it('returns local when source is a URL-like path', async () => {
    const { debug } = await getOrchestratorForSource('https://github.com/owner/repo', 'org-1');
    expect(debug.usedSsh).toBe(false);
  });

  it('returns local when no organization ID', async () => {
    const { debug } = await getOrchestratorForSource('/home/user/repo', null);
    expect(debug.usedSsh).toBe(false);
    expect(debug.reason).toBe('no_organization_id');
  });

  it('returns local when organization is undefined', async () => {
    const { debug } = await getOrchestratorForSource('/home/user/repo', undefined);
    expect(debug.usedSsh).toBe(false);
  });

  it('returns local for // prefixed paths (not remote)', async () => {
    const { debug } = await getOrchestratorForSource('//network/share', 'org-1');
    expect(debug.usedSsh).toBe(false);
  });

  it('returns local for empty string source', async () => {
    const { debug } = await getOrchestratorForSource('', 'org-1');
    expect(debug.usedSsh).toBe(false);
  });

  it('returns local for whitespace-only source', async () => {
    const { debug } = await getOrchestratorForSource('   ', 'org-1');
    expect(debug.usedSsh).toBe(false);
  });
});

describe('orchestrator-resolver — SSH resolution', () => {
  it('returns SSH orchestrator for remote path with org and DB', async () => {
    mockDbRows.value = [{
      host: '10.0.0.1',
      user: 'deploy',
      port: 22,
      privateKeyEncrypted: 'key-data',
      authMethod: 'key',
    }];

    const { debug } = await getOrchestratorForSource('/home/deploy/app', 'org-123');

    expect(debug.usedSsh).toBe(true);
    expect(debug.reason).toBe('ssh_orchestrator');
    expect(debug.sshHost).toBe('10.0.0.1');
    expect(debug.sshUser).toBe('deploy');
  });

  it('throws when no SSH key found for org', async () => {
    mockDbRows.value = [];

    await expect(
      getOrchestratorForSource('/home/deploy/app', 'org-no-key'),
    ).rejects.toThrow(/SSH orchestrator required/);
  });

  it('throws when SSH key has no host', async () => {
    mockDbRows.value = [{ host: null, user: 'deploy' }];

    await expect(
      getOrchestratorForSource('/home/deploy/app', 'org-bad-key'),
    ).rejects.toThrow(/SSH orchestrator required/);
  });

  it('throws when SSH key has no user', async () => {
    mockDbRows.value = [{ host: '10.0.0.1', user: null }];

    await expect(
      getOrchestratorForSource('/home/deploy/app', 'org-bad-key'),
    ).rejects.toThrow(/SSH orchestrator required/);
  });
});

describe('orchestrator-resolver — debug info', () => {
  it('includes remotePath flag in debug', async () => {
    const { debug: localDebug } = await getOrchestratorForSource('./relative', 'org-1');
    expect(localDebug.remotePath).toBe(false);
  });

  it('includes hasOrg and hasDb flags', async () => {
    const { debug } = await getOrchestratorForSource('./repo', null);
    expect(debug.hasOrg).toBe(false);
    expect(debug.hasDb).toBe(true);
  });

  it('includes SSH row count and host for SSH resolution', async () => {
    mockDbRows.value = [{
      host: 'server.example.com',
      user: 'root',
      port: 2222,
      privateKeyEncrypted: 'key',
      authMethod: 'key',
    }];

    const { debug } = await getOrchestratorForSource('/srv/app', 'org-1');
    expect(debug.sshRows).toBe(1);
    expect(debug.sshHost).toBe('server.example.com');
    expect(debug.sshUser).toBe('root');
  });
});

describe('orchestrator-resolver — cache invalidation', () => {
  it('invalidateByPrefix is called with correct prefix', () => {
    invalidateSshOrchestratorCache('org-abc');
    expect(mockCacheInvalidateByPrefix).toHaveBeenCalledWith('ssh:org-abc:');
  });

  it('does not throw when invalidating non-cached org', () => {
    expect(() => invalidateSshOrchestratorCache('org-nope')).not.toThrow();
  });
});

describe('orchestrator-resolver — edge cases', () => {
  it('trailing whitespace on absolute path is still detected as remote', async () => {
    mockDbRows.value = [{
      host: '10.0.0.1',
      user: 'deploy',
      port: 22,
      privateKeyEncrypted: 'key',
      authMethod: 'key',
    }];

    const { debug } = await getOrchestratorForSource('/home/user/repo  ', 'org-1');
    expect(debug.remotePath).toBe(true);
    expect(debug.usedSsh).toBe(true);
  });

  it('handles source with leading whitespace before absolute path', async () => {
    mockDbRows.value = [{
      host: '10.0.0.1',
      user: 'deploy',
      port: null,
      privateKeyEncrypted: 'key',
      authMethod: 'key',
    }];

    const { debug } = await getOrchestratorForSource('  /home/deploy/app', 'org-1');
    expect(debug.remotePath).toBe(true);
    expect(debug.usedSsh).toBe(true);
  });

  it('SSH config uses default port when row port is null', async () => {
    mockDbRows.value = [{
      host: '10.0.0.1',
      user: 'deploy',
      port: null,
      privateKeyEncrypted: 'key',
      authMethod: 'key',
    }];

    const { debug } = await getOrchestratorForSource('/remote/path', 'org-port');
    expect(debug.usedSsh).toBe(true);
  });

  it('handles password auth method', async () => {
    mockDbRows.value = [{
      host: '10.0.0.1',
      user: 'deploy',
      port: 22,
      passwordEncrypted: 'enc-pass',
      authMethod: 'password',
    }];

    const { debug } = await getOrchestratorForSource('/remote/path', 'org-pw');
    expect(debug.usedSsh).toBe(true);
  });
});
