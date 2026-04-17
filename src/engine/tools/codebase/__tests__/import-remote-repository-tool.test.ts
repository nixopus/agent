import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockExecFile } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFile: (...args: unknown[]) => mockExecFile(...args),
  };
});

function splitExecFileArgs(allArgs: unknown[]): {
  command: string;
  argv: string[];
  cb: (err: Error | null, stdout?: string | Buffer, stderr?: string | Buffer) => void;
} {
  const cb = allArgs.at(-1);
  if (typeof cb !== 'function') throw new Error('execFile mock: expected callback');
  const head = allArgs.slice(0, -1);
  const command = head[0] as string;
  const maybeArgv = head[1];
  const argv = Array.isArray(maybeArgv) ? (maybeArgv as string[]) : [];
  return { command, argv, cb: cb as (err: Error | null, stdout?: string | Buffer, stderr?: string | Buffer) => void };
}

import { importRemoteRepository, loadRemoteRepositoryTool } from '../import-remote-repository-tool';
import { codebaseTools } from '../codebase-tools';
import { rawDeploySearchableTools } from '../../../agents/raw-deploy-searchable-tools';

beforeEach(() => {
  mockExecFile.mockReset();
});

function makeRequestContext(initial: Record<string, unknown> = {}) {
  const store = { ...initial };
  return {
    store,
    requestContext: {
      get: (key: string) => store[key],
      set: (key: string, value: unknown) => {
        store[key] = value;
      },
    },
  };
}

describe('importRemoteRepository', () => {
  it('clones repository and returns fetched files', async () => {
    mockExecFile
      .mockImplementationOnce((...allArgs: unknown[]) => {
        const { argv, cb } = splitExecFileArgs(allArgs);
        const dest = argv[argv.length - 1];
        mkdirSync(join(dest, 'node_modules', 'pkg'), { recursive: true });
        writeFileSync(join(dest, 'node_modules', 'pkg', 'skip.js'), '// skipped');
        writeFileSync(join(dest, 'README.md'), '# hello\n');
        mkdirSync(join(dest, 'src'), { recursive: true });
        writeFileSync(join(dest, 'src', 'app.ts'), 'export const x = 1;\n');
        cb(null, '', '');
      })
      .mockImplementationOnce((...allArgs: unknown[]) => {
        const { cb } = splitExecFileArgs(allArgs);
        cb(null, 'abc123\n', '');
      });

    const result = await importRemoteRepository({
      repoUrl: 'https://github.com/acme/api.git',
      branch: 'main',
    });

    expect(result.commit).toBe('abc123');
    expect(result.branch).toBe('main');
    expect(result.fileCount).toBeGreaterThan(0);
    expect(result.files.length).toBe(result.fileCount);
    const paths = result.files.map((f) => f.path).sort();
    expect(paths).toContain('README.md');
    expect(paths).toContain('src/app.ts');
    expect(paths.some((p) => p.includes('node_modules'))).toBe(false);

    expect(mockExecFile).toHaveBeenCalledTimes(2);
    expect(mockExecFile.mock.calls[0]?.[0]).toBe('git');
    const cloneArgs = mockExecFile.mock.calls[0]?.[1] as string[];
    expect(cloneArgs).toContain('--branch');
    expect(cloneArgs).toContain('main');
    expect(mockExecFile.mock.calls[1]?.[0]).toBe('git');
  });

  it('resolves checked-out branch when branch is omitted', async () => {
    mockExecFile
      .mockImplementationOnce((...allArgs: unknown[]) => {
        const { argv, cb } = splitExecFileArgs(allArgs);
        const dest = argv[argv.length - 1];
        writeFileSync(join(dest, 'LICENSE'), 'MIT\n');
        cb(null, '', '');
      })
      .mockImplementationOnce((...allArgs: unknown[]) => {
        const { argv, cb } = splitExecFileArgs(allArgs);
        expect(argv).toContain('branch');
        expect(argv).toContain('--show-current');
        cb(null, 'develop\n', '');
      })
      .mockImplementationOnce((...allArgs: unknown[]) => {
        const { cb } = splitExecFileArgs(allArgs);
        cb(null, 'deadbeef\n', '');
      });

    const result = await importRemoteRepository({
      repoUrl: 'https://github.com/acme/api.git',
    });

    expect(result.branch).toBe('develop');
    expect(result.commit).toBe('deadbeef');
    expect(result.files.some((f) => f.path === 'LICENSE')).toBe(true);
    const cloneArgs = mockExecFile.mock.calls[0]?.[1] as string[];
    expect(cloneArgs).not.toContain('--branch');
    expect(mockExecFile).toHaveBeenCalledTimes(3);
  });

  it('falls back to origin/HEAD when branch --show-current is empty', async () => {
    mockExecFile
      .mockImplementationOnce((...allArgs: unknown[]) => {
        const { argv, cb } = splitExecFileArgs(allArgs);
        const dest = argv[argv.length - 1];
        writeFileSync(join(dest, 'README.md'), 'ok\n');
        cb(null, '', '');
      })
      .mockImplementationOnce((...allArgs: unknown[]) => {
        const { argv, cb } = splitExecFileArgs(allArgs);
        expect(argv).toContain('--show-current');
        cb(null, '\n', '');
      })
      .mockImplementationOnce((...allArgs: unknown[]) => {
        const { argv, cb } = splitExecFileArgs(allArgs);
        expect(argv.join(' ')).toContain('refs/remotes/origin/HEAD');
        cb(null, 'origin/main\n', '');
      })
      .mockImplementationOnce((...allArgs: unknown[]) => {
        const { cb } = splitExecFileArgs(allArgs);
        cb(null, 'cafe\n', '');
      });

    const result = await importRemoteRepository({
      repoUrl: 'https://github.com/acme/api.git',
    });

    expect(result.branch).toBe('main');
    expect(mockExecFile).toHaveBeenCalledTimes(4);
  });

  it('respects import file count guardrails', async () => {
    mockExecFile
      .mockImplementationOnce((...allArgs: unknown[]) => {
        const { argv, cb } = splitExecFileArgs(allArgs);
        const dest = argv[argv.length - 1];
        writeFileSync(join(dest, 'a.txt'), '1\n');
        writeFileSync(join(dest, 'b.txt'), '2\n');
        writeFileSync(join(dest, 'c.txt'), '3\n');
        cb(null, '', '');
      })
      .mockImplementationOnce((...allArgs: unknown[]) => {
        const { cb } = splitExecFileArgs(allArgs);
        cb(null, 'main\n', '');
      })
      .mockImplementationOnce((...allArgs: unknown[]) => {
        const { cb } = splitExecFileArgs(allArgs);
        cb(null, 'abc\n', '');
      });

    const result = await importRemoteRepository({
      repoUrl: 'https://github.com/acme/api.git',
      importLimits: { maxFiles: 2 },
    });

    expect(result.fileCount).toBe(2);
    expect(result.files).toHaveLength(2);
  });

  it('respects import total size guardrails', async () => {
    mockExecFile
      .mockImplementationOnce((...allArgs: unknown[]) => {
        const { argv, cb } = splitExecFileArgs(allArgs);
        const dest = argv[argv.length - 1];
        writeFileSync(join(dest, 'big1.txt'), 'x'.repeat(40));
        writeFileSync(join(dest, 'big2.txt'), 'y'.repeat(40));
        cb(null, '', '');
      })
      .mockImplementationOnce((...allArgs: unknown[]) => {
        const { cb } = splitExecFileArgs(allArgs);
        cb(null, 'main\n', '');
      })
      .mockImplementationOnce((...allArgs: unknown[]) => {
        const { cb } = splitExecFileArgs(allArgs);
        cb(null, 'abc\n', '');
      });

    const result = await importRemoteRepository({
      repoUrl: 'https://github.com/acme/api.git',
      importLimits: { maxTotalBytes: 50 },
    });

    expect(result.fileCount).toBe(1);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.content.length).toBe(40);
  });

  it('skips symlinks so paths outside the clone root are not imported', async () => {
    mockExecFile
      .mockImplementationOnce((...allArgs: unknown[]) => {
        const { argv, cb } = splitExecFileArgs(allArgs);
        const dest = argv[argv.length - 1] as string;
        const parent = dirname(dest);
        writeFileSync(join(parent, 'outside-secret.txt'), 'leaked\n');
        symlinkSync(join(parent, 'outside-secret.txt'), join(dest, 'via-link.txt'), 'file');
        writeFileSync(join(dest, 'legit.txt'), 'ok\n');
        cb(null, '', '');
      })
      .mockImplementationOnce((...allArgs: unknown[]) => {
        const { cb } = splitExecFileArgs(allArgs);
        cb(null, 'main\n', '');
      })
      .mockImplementationOnce((...allArgs: unknown[]) => {
        const { cb } = splitExecFileArgs(allArgs);
        cb(null, 'abc\n', '');
      });

    const result = await importRemoteRepository({
      repoUrl: 'https://github.com/acme/api.git',
    });

    const paths = result.files.map((f) => f.path);
    expect(paths).toContain('legit.txt');
    expect(paths.some((p) => p.includes('via-link') || p.includes('outside-secret'))).toBe(false);
    expect(result.files.some((f) => f.content.includes('leaked'))).toBe(false);
  });

  it('counts maxTotalBytes in UTF-8 bytes, not JavaScript string length', async () => {
    mockExecFile
      .mockImplementationOnce((...allArgs: unknown[]) => {
        const { argv, cb } = splitExecFileArgs(allArgs);
        const dest = argv[argv.length - 1] as string;
        writeFileSync(join(dest, 'utf8.txt'), '€', 'utf8');
        writeFileSync(join(dest, 'ascii.txt'), 'a', 'utf8');
        cb(null, '', '');
      })
      .mockImplementationOnce((...allArgs: unknown[]) => {
        const { cb } = splitExecFileArgs(allArgs);
        cb(null, 'main\n', '');
      })
      .mockImplementationOnce((...allArgs: unknown[]) => {
        const { cb } = splitExecFileArgs(allArgs);
        cb(null, 'abc\n', '');
      });

    const result = await importRemoteRepository({
      repoUrl: 'https://github.com/acme/api.git',
      importLimits: { maxTotalBytes: 3 },
    });

    // UTF-8: '€' is 3 bytes, 'a' is 1. String lengths are both 1, so a buggy
    // `content.length` budget would import both files (2 "units"); bytes are 4.
    expect(result.fileCount).toBe(1);
    expect(result.files).toHaveLength(1);
    const importedBytes = Buffer.byteLength(result.files[0]!.content, 'utf8');
    expect(importedBytes).toBeLessThanOrEqual(3);
    expect([1, 3]).toContain(importedBytes);
  });

  it('throws user-safe error on clone failure', async () => {
    mockExecFile.mockImplementationOnce((...allArgs: unknown[]) => {
      const { cb } = splitExecFileArgs(allArgs);
      cb(new Error('fatal: repository not found'));
    });
    await expect(
      importRemoteRepository({
        repoUrl: 'https://github.com/acme/missing.git',
      }),
    ).rejects.toThrow('Unable to clone repository');
  });

  it('maps network failures to a user-safe message for clone only', async () => {
    mockExecFile.mockImplementationOnce((...allArgs: unknown[]) => {
      const { cb } = splitExecFileArgs(allArgs);
      cb(new Error('fatal: could not resolve host github.com'));
    });
    await expect(
      importRemoteRepository({
        repoUrl: 'https://github.com/acme/api.git',
      }),
    ).rejects.toThrow('Unable to clone repository: network failure');
  });

  it("reports a dedicated error when git binary is missing (ENOENT)", async () => {
    mockExecFile.mockImplementationOnce((...allArgs: unknown[]) => {
      const { cb } = splitExecFileArgs(allArgs);
      const err = new Error('spawn git ENOENT') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      cb(err);
    });
    await expect(
      importRemoteRepository({
        repoUrl: 'https://github.com/acme/api.git',
      }),
    ).rejects.toThrow("'git' binary not found in runtime environment");
  });

  it('maps TLS certificate problems to a dedicated message and surfaces stderr', async () => {
    mockExecFile.mockImplementationOnce((...allArgs: unknown[]) => {
      const { cb } = splitExecFileArgs(allArgs);
      cb(
        new Error('Command failed: git clone …'),
        '',
        'fatal: unable to access https://github.com/acme/api.git/: SSL certificate problem: unable to get local issuer certificate',
      );
    });
    await expect(
      importRemoteRepository({
        repoUrl: 'https://github.com/acme/api.git',
      }),
    ).rejects.toThrow(/TLS\/CA certificates missing.*unable to get local issuer certificate/);
  });

  it('includes raw git stderr in the generic clone failure message', async () => {
    mockExecFile.mockImplementationOnce((...allArgs: unknown[]) => {
      const { cb } = splitExecFileArgs(allArgs);
      cb(new Error('Command failed: git clone'), '', 'fatal: unexpected disconnect from remote peer');
    });
    await expect(
      importRemoteRepository({
        repoUrl: 'https://github.com/acme/api.git',
      }),
    ).rejects.toThrow(/Unable to clone repository\..*unexpected disconnect from remote peer/);
  });

  it('maps missing remote branch to a user-safe message', async () => {
    mockExecFile.mockImplementationOnce((...allArgs: unknown[]) => {
      const { cb } = splitExecFileArgs(allArgs);
      cb(new Error("fatal: Remote branch 'nope' not found in upstream origin"));
    });
    await expect(
      importRemoteRepository({
        repoUrl: 'https://github.com/acme/api.git',
        branch: 'nope',
      }),
    ).rejects.toThrow('Unable to clone repository: branch not found');
  });

  it('does not label post-clone git failures as clone failures', async () => {
    mockExecFile
      .mockImplementationOnce((...allArgs: unknown[]) => {
        const { argv, cb } = splitExecFileArgs(allArgs);
        const dest = argv[argv.length - 1];
        writeFileSync(join(dest, 'x.txt'), 'hi\n');
        cb(null, '', '');
      })
      .mockImplementationOnce((...allArgs: unknown[]) => {
        const { cb } = splitExecFileArgs(allArgs);
        cb(null, 'main\n', '');
      })
      .mockImplementationOnce((...allArgs: unknown[]) => {
        const { cb } = splitExecFileArgs(allArgs);
        cb(new Error('fatal: could not resolve host github.com'));
      });

    try {
      await importRemoteRepository({
        repoUrl: 'https://github.com/acme/api.git',
      });
      expect.fail('expected importRemoteRepository to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe('Unable to import remote repository: failed to finalize import.');
      expect((err as Error).message).not.toContain('Unable to clone');
    }
  });

  it('maps unresolvable default branch to a dedicated import error', async () => {
    mockExecFile
      .mockImplementationOnce((...allArgs: unknown[]) => {
        const { argv, cb } = splitExecFileArgs(allArgs);
        const dest = argv[argv.length - 1];
        writeFileSync(join(dest, 'x.txt'), 'hi\n');
        cb(null, '', '');
      })
      .mockImplementationOnce((...allArgs: unknown[]) => {
        const { cb } = splitExecFileArgs(allArgs);
        cb(null, '\n', '');
      })
      .mockImplementationOnce((...allArgs: unknown[]) => {
        const { argv, cb } = splitExecFileArgs(allArgs);
        expect(argv.join(' ')).toContain('refs/remotes/origin/HEAD');
        cb(new Error('fatal: ref refs/remotes/origin/HEAD does not exist'));
      })
      .mockImplementationOnce((...allArgs: unknown[]) => {
        const { argv, cb } = splitExecFileArgs(allArgs);
        expect(argv).toContain('--abbrev-ref');
        cb(null, 'HEAD\n', '');
      });

    await expect(
      importRemoteRepository({
        repoUrl: 'https://github.com/acme/api.git',
      }),
    ).rejects.toThrow('Unable to import remote repository: could not determine the default branch.');
  });
});

describe('remote repository tool surface', () => {
  it('exposes loadRemoteRepository on codebaseTools', () => {
    expect(codebaseTools.loadRemoteRepository).toBeDefined();
    expect(codebaseTools.loadRemoteRepository.id).toBe('load_remote_repository');
  });

  it('includes loadRemoteRepository in rawDeploySearchableTools', () => {
    expect(rawDeploySearchableTools.loadRemoteRepository).toBeDefined();
    expect(rawDeploySearchableTools.loadRemoteRepository).toBe(codebaseTools.loadRemoteRepository);
  });

  it('loadRemoteRepository passes clone-safe URL (no query or fragment) to git clone', async () => {
    mockExecFile
      .mockImplementationOnce((...allArgs: unknown[]) => {
        const { argv, cb } = splitExecFileArgs(allArgs);
        expect(argv).toContain('clone');
        const urlArg = argv.find((a) => typeof a === 'string' && a.startsWith('https://'));
        expect(urlArg).toBe('https://github.com/acme/api.git');
        const dest = argv[argv.length - 1] as string;
        writeFileSync(join(dest, 'README.md'), '# x\n');
        cb(null, '', '');
      })
      .mockImplementationOnce((...allArgs: unknown[]) => {
        const { cb } = splitExecFileArgs(allArgs);
        cb(null, 'abc\n', '');
      });

    await loadRemoteRepositoryTool.execute!(
      {
        repoUrl: 'https://github.com/acme/api.git?ref=other#readme',
        branch: 'main',
        applicationId: undefined,
      },
      { workspace: undefined },
    );

    expect(mockExecFile).toHaveBeenCalledTimes(2);
  });

  it('stamps requestContext fields and emits data-write-file events with the chosen target id', async () => {
    const applicationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const { store, requestContext } = makeRequestContext();
    const writer = {
      custom: vi.fn(async () => undefined),
    };
    const workspace = {
      status: 'ready',
      filesystem: {
        mkdir: vi.fn(async () => undefined),
        writeFile: vi.fn(async () => undefined),
      },
      index: vi.fn(async () => undefined),
    };

    mockExecFile
      .mockImplementationOnce((...allArgs: unknown[]) => {
        const { argv, cb } = splitExecFileArgs(allArgs);
        const dest = argv[argv.length - 1] as string;
        writeFileSync(join(dest, 'README.md'), '# hello\n');
        mkdirSync(join(dest, 'src'), { recursive: true });
        writeFileSync(join(dest, 'src', 'app.ts'), 'export const x = 1;\n');
        cb(null, '', '');
      })
      .mockImplementationOnce((...allArgs: unknown[]) => {
        const { cb } = splitExecFileArgs(allArgs);
        cb(null, 'abc123\n', '');
      });

    const result = await loadRemoteRepositoryTool.execute!(
      {
        repoUrl: 'https://github.com/acme/api.git',
        branch: 'main',
        applicationId,
      },
      { workspace, requestContext, writer },
    );

    expect(result).toEqual(
      expect.objectContaining({
        workspaceRoot: `apps/${applicationId}`,
        fileCount: 2,
        commit: 'abc123',
        branch: 'main',
      }),
    );
    expect(store).toMatchObject({
      workspaceSource: 'git_url',
      syncTarget: applicationId,
      workspaceId: applicationId,
      contextBranch: 'main',
      contextApplicationId: applicationId,
    });
    expect(writer.custom).toHaveBeenCalledWith({
      type: 'data-write-file',
      data: { applicationId, path: 'README.md', content: '# hello\n' },
      transient: true,
    });
    expect(writer.custom).toHaveBeenCalledWith({
      type: 'data-write-file',
      data: { applicationId, path: 'src/app.ts', content: 'export const x = 1;\n' },
      transient: true,
    });
    expect(workspace.filesystem.mkdir).toHaveBeenCalledWith(`apps/${applicationId}/src`, { recursive: true });
    expect(workspace.filesystem.writeFile).toHaveBeenCalledWith(`apps/${applicationId}/README.md`, '# hello\n');
    expect(workspace.filesystem.writeFile).toHaveBeenCalledWith(`apps/${applicationId}/src/app.ts`, 'export const x = 1;\n');
    expect(workspace.index).toHaveBeenCalledWith(`apps/${applicationId}/README.md`, '# hello\n', {
      metadata: { language: 'markdown' },
    });
    expect(workspace.index).toHaveBeenCalledWith(`apps/${applicationId}/src/app.ts`, 'export const x = 1;\n', {
      metadata: { language: 'typescript' },
    });
  });
});
