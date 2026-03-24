import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, realpathSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createLocalOrchestrator } from '../local-orchestrator';
import type { Orchestrator } from '../orchestrator';

let orch: Orchestrator;
let tempDir: string;

beforeEach(() => {
  orch = createLocalOrchestrator();
  tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'orch-test-')));
  mkdirSync(join(tempDir, 'sub'), { recursive: true });
  writeFileSync(join(tempDir, 'hello.txt'), 'hello world');
  writeFileSync(join(tempDir, 'sub', 'nested.txt'), 'nested content');
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('local-orchestrator — readFile', () => {
  it('reads a text file', async () => {
    const content = await orch.readFile(tempDir, 'hello.txt');
    expect(content).toBe('hello world');
  });

  it('reads nested file', async () => {
    const content = await orch.readFile(tempDir, 'sub/nested.txt');
    expect(content).toBe('nested content');
  });

  it('reads file as buffer', async () => {
    const buf = await orch.readFile(tempDir, 'hello.txt', 'buffer');
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.toString()).toBe('hello world');
  });

  it('throws on non-existent file', async () => {
    await expect(orch.readFile(tempDir, 'nope.txt')).rejects.toThrow();
  });

  it('reads file with ./prefix', async () => {
    const content = await orch.readFile(tempDir, './hello.txt');
    expect(content).toBe('hello world');
  });
});

describe('local-orchestrator — readFileSync', () => {
  it('reads file synchronously', () => {
    const content = orch.readFileSync!(tempDir, 'hello.txt');
    expect(content).toBe('hello world');
  });
});

describe('local-orchestrator — writeFile', () => {
  it('writes text content', async () => {
    await orch.writeFile(tempDir, 'out.txt', 'written data');
    const content = readFileSync(join(tempDir, 'out.txt'), 'utf-8');
    expect(content).toBe('written data');
  });

  it('writes buffer content', async () => {
    const buf = Buffer.from('binary data');
    await orch.writeFile(tempDir, 'bin.dat', buf);
    const content = readFileSync(join(tempDir, 'bin.dat'));
    expect(content.equals(buf)).toBe(true);
  });

  it('overwrites existing file', async () => {
    await orch.writeFile(tempDir, 'hello.txt', 'overwritten');
    const content = readFileSync(join(tempDir, 'hello.txt'), 'utf-8');
    expect(content).toBe('overwritten');
  });
});

describe('local-orchestrator — exists', () => {
  it('returns true for existing file', async () => {
    expect(await orch.exists(tempDir, 'hello.txt')).toBe(true);
  });

  it('returns false for non-existent file', async () => {
    expect(await orch.exists(tempDir, 'nope.txt')).toBe(false);
  });

  it('returns true for directory', async () => {
    expect(await orch.exists(tempDir, 'sub')).toBe(true);
  });
});

describe('local-orchestrator — existsSync', () => {
  it('returns true for existing path', () => {
    expect(orch.existsSync!(join(tempDir, 'hello.txt'))).toBe(true);
  });

  it('returns false for non-existent path', () => {
    expect(orch.existsSync!(join(tempDir, 'nope.txt'))).toBe(false);
  });
});

describe('local-orchestrator — stat', () => {
  it('returns file stats', async () => {
    const s = await orch.stat(tempDir, 'hello.txt');
    expect(s.isDirectory).toBe(false);
    expect(s.size).toBe(11);
    expect(s.mtime).toBeGreaterThan(0);
  });

  it('returns directory stats', async () => {
    const s = await orch.stat(tempDir, 'sub');
    expect(s.isDirectory).toBe(true);
  });

  it('throws on non-existent path', async () => {
    await expect(orch.stat(tempDir, 'nope')).rejects.toThrow();
  });
});

describe('local-orchestrator — listDir', () => {
  it('lists directory entries', async () => {
    const entries = await orch.listDir(tempDir, '.');
    const names = entries.map((e) => e.name);
    expect(names).toContain('hello.txt');
    expect(names).toContain('sub');
  });

  it('identifies files vs directories', async () => {
    const entries = await orch.listDir(tempDir, '.');
    const fileEntry = entries.find((e) => e.name === 'hello.txt');
    const dirEntry = entries.find((e) => e.name === 'sub');
    expect(fileEntry?.isDirectory).toBe(false);
    expect(dirEntry?.isDirectory).toBe(true);
  });

  it('lists nested directory', async () => {
    const entries = await orch.listDir(tempDir, 'sub');
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('nested.txt');
  });
});

describe('local-orchestrator — mkdtemp', () => {
  it('creates a temp directory with prefix', async () => {
    const dir = await orch.mkdtemp('test-prefix-');
    expect(dir).toContain('test-prefix-');
    const s = await orch.stat(dir, '.');
    expect(s.isDirectory).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('local-orchestrator — mkdir', () => {
  it('creates directory recursively', async () => {
    await orch.mkdir(join(tempDir, 'deep', 'nested', 'dir'), { recursive: true });
    expect(await orch.exists(tempDir, 'deep/nested/dir')).toBe(true);
  });
});

describe('local-orchestrator — rm', () => {
  it('removes a file', async () => {
    await orch.rm(join(tempDir, 'hello.txt'));
    expect(await orch.exists(tempDir, 'hello.txt')).toBe(false);
  });

  it('removes directory recursively', async () => {
    await orch.rm(join(tempDir, 'sub'), { recursive: true });
    expect(await orch.exists(tempDir, 'sub')).toBe(false);
  });

  it('does not throw on non-existent file (force)', async () => {
    await expect(orch.rm(join(tempDir, 'nope.txt'))).resolves.toBeUndefined();
  });
});

describe('local-orchestrator — exec', () => {
  it('runs a simple command', async () => {
    const result = await orch.exec('echo hello');
    expect(result.stdout.trim()).toBe('hello');
    expect(result.code).toBe(0);
  });

  it('captures stderr on non-zero exit', async () => {
    const result = await orch.exec('echo error >&2 && exit 1');
    expect(result.stderr.trim()).toBe('error');
    expect(result.code).toBe(1);
  });

  it('returns non-zero exit code on failure', async () => {
    const result = await orch.exec('exit 42');
    expect(result.code).toBe(42);
  });

  it('respects cwd option', async () => {
    const result = await orch.exec('pwd', { cwd: tempDir });
    expect(result.stdout.trim()).toBe(tempDir);
  });

  it('supports input via stdin', async () => {
    const result = await orch.exec('cat', { input: 'stdin data' });
    expect(result.stdout).toBe('stdin data');
  });

  it('handles command with special characters in output', async () => {
    const result = await orch.exec("echo 'hello \"world\"'");
    expect(result.stdout.trim()).toBe('hello "world"');
  });
});

describe('local-orchestrator — spawn', () => {
  it('runs a command and captures output', async () => {
    const { promise } = orch.spawn('echo', ['hello']);
    const result = await promise;
    expect(result.stdout.trim()).toBe('hello');
    expect(result.code).toBe(0);
  });

  it('captures stderr from spawned process', async () => {
    const { promise } = orch.spawn('sh', ['-c', 'echo err >&2']);
    const result = await promise;
    expect(result.stderr.trim()).toBe('err');
  });

  it('calls onStdout callback', async () => {
    const chunks: string[] = [];
    const { promise } = orch.spawn('echo', ['callback-test'], {
      onStdout: (chunk) => chunks.push(chunk),
    });
    await promise;
    expect(chunks.join('')).toContain('callback-test');
  });

  it('calls onStderr callback', async () => {
    const chunks: string[] = [];
    const { promise } = orch.spawn('sh', ['-c', 'echo stderr-data >&2'], {
      onStderr: (chunk) => chunks.push(chunk),
    });
    await promise;
    expect(chunks.join('')).toContain('stderr-data');
  });

  it('kill terminates the process', async () => {
    const { promise, kill } = orch.spawn('sleep', ['60']);

    setTimeout(kill, 50);

    const result = await promise;
    expect(result.code).not.toBe(0);
  });

  it('respects cwd option', async () => {
    const { promise } = orch.spawn('pwd', [], { cwd: tempDir });
    const result = await promise;
    expect(result.stdout.trim()).toBe(tempDir);
  });
});

describe('local-orchestrator — security', () => {
  it('readFile with path traversal stays within base', async () => {
    writeFileSync(join(tempDir, 'secret.txt'), 'secret');
    mkdirSync(join(tempDir, 'sub2'));

    const content = await orch.readFile(tempDir, 'sub/../secret.txt');
    expect(content).toBe('secret');
  });

  it('handles unicode filenames', async () => {
    writeFileSync(join(tempDir, 'café.txt'), 'unicode content');
    const content = await orch.readFile(tempDir, 'café.txt');
    expect(content).toBe('unicode content');
  });

  it('handles filenames with spaces', async () => {
    writeFileSync(join(tempDir, 'has spaces.txt'), 'spaced');
    const content = await orch.readFile(tempDir, 'has spaces.txt');
    expect(content).toBe('spaced');
  });

  it('exec does not execute in unexpected directory without cwd', async () => {
    const result = await orch.exec('pwd');
    expect(result.stdout.trim()).not.toBe(tempDir);
  });
});

describe('local-orchestrator — edge cases', () => {
  it('reads empty file', async () => {
    writeFileSync(join(tempDir, 'empty.txt'), '');
    const content = await orch.readFile(tempDir, 'empty.txt');
    expect(content).toBe('');
  });

  it('writes and reads large file', async () => {
    const largeContent = 'x'.repeat(1_000_000);
    await orch.writeFile(tempDir, 'large.txt', largeContent);
    const content = await orch.readFile(tempDir, 'large.txt');
    expect(content).toBe(largeContent);
  });

  it('lists empty directory', async () => {
    mkdirSync(join(tempDir, 'empty-dir'));
    const entries = await orch.listDir(tempDir, 'empty-dir');
    expect(entries).toEqual([]);
  });

  it('stat returns correct size after write', async () => {
    await orch.writeFile(tempDir, 'sized.txt', 'exactly 20 bytes!!!');
    const s = await orch.stat(tempDir, 'sized.txt');
    expect(s.size).toBe(19);
  });
});

describe('local-orchestrator — scale', () => {
  it('creates and reads 500 files', async () => {
    for (let i = 0; i < 500; i++) {
      await orch.writeFile(tempDir, `file-${i}.txt`, `content-${i}`);
    }

    for (let i = 0; i < 500; i++) {
      const content = await orch.readFile(tempDir, `file-${i}.txt`);
      expect(content).toBe(`content-${i}`);
    }
  });

  it('lists directory with 200 entries', async () => {
    for (let i = 0; i < 200; i++) {
      writeFileSync(join(tempDir, `item-${i}.txt`), 'data');
    }
    const entries = await orch.listDir(tempDir, '.');
    expect(entries.length).toBeGreaterThanOrEqual(200);
  });
});

describe('local-orchestrator — performance', () => {
  it('exec 100 simple commands in under 10 seconds', async () => {
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      await orch.exec('echo ok');
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(10_000);
  });
});
