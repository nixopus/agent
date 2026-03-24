import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

vi.mock('../../../engine/tools/shared/nixopus-client', () => ({
  createNixopusClient: () => ({}),
}));

vi.mock('@nixopus/api-client', () => ({
  listGitHubConnectors: vi.fn().mockResolvedValue({
    data: {
      data: [{ id: 'c1', app_id: 'a', pem: 'p', installation_id: 'i' }],
    },
  }),
}));

vi.mock('../../../util/github-client', () => ({
  getInstallationToken: vi.fn().mockResolvedValue('mock-token'),
  githubFetch: vi.fn(),
}));

vi.mock('../../../errors', () => ({
  ExternalServiceError: class extends Error { constructor(_s: string, m: string) { super(m); } },
  NotFoundError: class extends Error { constructor(t: string, id: string) { super(`${t} ${id}`); } },
  ConfigError: class extends Error {},
}));

import {
  isBinaryPath,
  isSkippedPath,
  languageFromPath,
  clearBlobCache,
  getBlobCacheStats,
  fetchRepoFiles,
} from '../support';
import { githubFetch } from '../../../util/github-client';

const mockGithubFetch = vi.mocked(githubFetch);

beforeEach(() => {
  clearBlobCache();
  mockGithubFetch.mockReset();
});

afterEach(() => {
  clearBlobCache();
});

describe('support perf — isBinaryPath throughput', () => {
  const paths = [
    'src/index.ts', 'assets/logo.png', 'README.md', 'lib/utils.wasm',
    'public/favicon.ico', 'package.json', 'Dockerfile', 'src/deep/nested/file.tsx',
  ];

  it('500K isBinaryPath calls in under 500ms', () => {
    const start = performance.now();
    for (let i = 0; i < 500_000; i++) {
      isBinaryPath(paths[i & 7]);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);
  });
});

describe('support perf — isSkippedPath throughput', () => {
  const paths = [
    'src/components/Button.tsx',
    'node_modules/react/index.js',
    'dist/bundle.js',
    'src/deep/nested/module/file.ts',
    '.next/static/chunks/main.js',
    'lib/utils/helper.ts',
    'coverage/lcov-report/index.html',
    'src/index.ts',
  ];

  it('500K isSkippedPath calls in under 500ms', () => {
    const start = performance.now();
    for (let i = 0; i < 500_000; i++) {
      isSkippedPath(paths[i & 7]);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);
  });

  it('deep paths (20 segments) — 100K calls in under 500ms', () => {
    const deep = Array.from({ length: 20 }, (_, i) => `dir${i}`).join('/') + '/file.ts';
    const start = performance.now();
    for (let i = 0; i < 100_000; i++) {
      isSkippedPath(deep);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);
  });

  it('lock files detected at any depth — 100K calls in under 300ms', () => {
    const lockPaths = [
      'composer.lock',
      'packages/web/shrinkwrap.lock',
      'deep/nested/Gemfile.lock',
    ];
    let hits = 0;
    const start = performance.now();
    for (let i = 0; i < 100_000; i++) {
      if (isSkippedPath(lockPaths[i % 3])) hits++;
    }
    const elapsed = performance.now() - start;
    expect(hits).toBe(100_000);
    expect(elapsed).toBeLessThan(300);
  });
});

describe('support perf — languageFromPath throughput', () => {
  const paths = [
    'src/index.ts', 'lib/app.py', 'cmd/main.go', 'src/mod.rs',
    'styles/app.css', 'config/db.yaml', 'Makefile', 'Dockerfile',
  ];

  it('500K languageFromPath calls in under 500ms', () => {
    const start = performance.now();
    for (let i = 0; i < 500_000; i++) {
      languageFromPath(paths[i & 7]);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);
  });
});

describe('support perf — blob cache operations', () => {
  function makeTreeResponse(count: number, duplicateFraction = 0) {
    const uniqueCount = Math.max(1, Math.floor(count * (1 - duplicateFraction)));
    const tree = Array.from({ length: count }, (_, i) => ({
      path: `src/file${i}.ts`,
      type: 'blob' as const,
      sha: `sha-${i % uniqueCount}`,
      size: 100,
    }));
    return { sha: 'tree-sha-1', tree, truncated: false };
  }

  function setupMockFetch(treeResponse: ReturnType<typeof makeTreeResponse>) {
    let callCount = 0;
    mockGithubFetch.mockImplementation(async (_token: string, path: string) => {
      if (path.includes('/git/trees/')) return treeResponse;
      callCount++;
      const sha = path.split('/').pop()!;
      return { content: Buffer.from(`content-${sha}`).toString('base64'), encoding: 'base64', size: 100 };
    });
    return () => callCount;
  }

  it('SHA dedup — 1000 blobs with 50% duplicates makes ~500 fetch calls', async () => {
    const tree = makeTreeResponse(1000, 0.5);
    const getCallCount = setupMockFetch(tree);

    await fetchRepoFiles('owner', 'repo', 'main');

    expect(getCallCount()).toBe(500);
  });

  it('cache hit — second fetch of same repo makes 0 blob fetches', async () => {
    const tree = makeTreeResponse(100);
    const getCallCount = setupMockFetch(tree);

    await fetchRepoFiles('owner', 'repo', 'main');
    const firstCallCount = getCallCount();
    expect(firstCallCount).toBe(100);

    await fetchRepoFiles('owner', 'repo', 'main');
    expect(getCallCount()).toBe(100);
  });

  it('partial cache — 10% changed blobs only fetches the delta', async () => {
    const tree1 = makeTreeResponse(100);
    setupMockFetch(tree1);
    await fetchRepoFiles('owner', 'repo', 'main');

    const tree2Entries = tree1.tree.map((e, i) =>
      i < 10 ? { ...e, sha: `new-sha-${i}` } : e,
    );
    const tree2 = { sha: 'tree-sha-2', tree: tree2Entries, truncated: false };
    const getCallCount = setupMockFetch(tree2);

    await fetchRepoFiles('owner', 'repo', 'main');

    expect(getCallCount()).toBe(10);
  });

  it('blob cache stats reflect stored entries', async () => {
    const tree = makeTreeResponse(50);
    setupMockFetch(tree);
    await fetchRepoFiles('owner', 'repo', 'main');

    const stats = getBlobCacheStats();
    expect(stats.size).toBe(50);
    expect(stats.maxSize).toBe(5000);
  });

  it('clearBlobCache resets cache to empty', async () => {
    const tree = makeTreeResponse(50);
    setupMockFetch(tree);
    await fetchRepoFiles('owner', 'repo', 'main');

    expect(getBlobCacheStats().size).toBe(50);
    clearBlobCache();
    expect(getBlobCacheStats().size).toBe(0);
  });
});

describe('support perf — fetchRepoFiles throughput with cache', () => {
  function makeTreeResponse(count: number) {
    const tree = Array.from({ length: count }, (_, i) => ({
      path: `src/file${i}.ts`,
      type: 'blob' as const,
      sha: `sha-${i}`,
      size: 100,
    }));
    return { sha: 'tree-sha-perf', tree, truncated: false };
  }

  it('1000 blobs — cold fetch completes in under 500ms', async () => {
    const tree = makeTreeResponse(1000);
    mockGithubFetch.mockImplementation(async (_token: string, path: string) => {
      if (path.includes('/git/trees/')) return tree;
      return { content: Buffer.from('x'.repeat(80)).toString('base64'), encoding: 'base64', size: 80 };
    });

    const start = performance.now();
    const result = await fetchRepoFiles('owner', 'repo', 'main');
    const elapsed = performance.now() - start;

    expect(result.files.length).toBe(1000);
    expect(elapsed).toBeLessThan(500);
  });

  it('1000 blobs — warm fetch (all cached) completes in under 50ms', async () => {
    const tree = makeTreeResponse(1000);
    mockGithubFetch.mockImplementation(async (_token: string, path: string) => {
      if (path.includes('/git/trees/')) return tree;
      return { content: Buffer.from('x'.repeat(80)).toString('base64'), encoding: 'base64', size: 80 };
    });

    await fetchRepoFiles('owner', 'repo', 'main');

    const start = performance.now();
    const result = await fetchRepoFiles('owner', 'repo', 'main');
    const elapsed = performance.now() - start;

    expect(result.files.length).toBe(1000);
    expect(elapsed).toBeLessThan(50);
  });

  it('filtering — isBinaryPath + isSkippedPath on 10K tree entries in under 50ms', () => {
    const entries = Array.from({ length: 10_000 }, (_, i) => {
      const variants = [
        `src/components/file${i}.tsx`,
        `node_modules/pkg/index.js`,
        `assets/image${i}.png`,
        `lib/deep/nested/util${i}.ts`,
        `dist/bundle${i}.js`,
      ];
      return variants[i % 5];
    });

    const start = performance.now();
    let skipped = 0;
    for (const e of entries) {
      if (isBinaryPath(e) || isSkippedPath(e)) skipped++;
    }
    const elapsed = performance.now() - start;

    expect(skipped).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(50);
  });
});
