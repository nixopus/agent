import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execSync, spawn as nodeSpawn } from 'child_process';
import type { ExecOpts, ListEntry, Orchestrator, SpawnOpts, StatResult } from './orchestrator';

function resolvePath(basePath: string, relativePath: string): string {
  const normalized = relativePath.replace(/^\.\//, '') || '.';
  return join(basePath, normalized);
}

export function createLocalOrchestrator(): Orchestrator {
  return {
    async readFile(basePath: string, relativePath: string, encoding?: 'utf-8' | 'buffer'): Promise<string | Buffer> {
      const full = resolvePath(basePath, relativePath);
      return encoding === 'buffer' ? readFileSync(full) : readFileSync(full, 'utf-8');
    },

    readFileSync(basePath: string, relativePath: string): string {
      const full = resolvePath(basePath, relativePath);
      return readFileSync(full, 'utf-8');
    },

    existsSync(path: string): boolean {
      return existsSync(path);
    },

    async writeFile(basePath: string, relativePath: string, content: string | Buffer): Promise<void> {
      const full = resolvePath(basePath, relativePath);
      if (Buffer.isBuffer(content)) {
        writeFileSync(full, content);
      } else {
        writeFileSync(full, content, 'utf-8');
      }
    },

    async exists(basePath: string, relativePath: string): Promise<boolean> {
      const full = resolvePath(basePath, relativePath);
      return existsSync(full);
    },

    async stat(basePath: string, relativePath: string): Promise<StatResult> {
      const full = resolvePath(basePath, relativePath);
      const s = statSync(full);
      return {
        isDirectory: s.isDirectory(),
        size: s.size,
        mtime: s.mtimeMs,
      };
    },

    async listDir(basePath: string, relativePath: string): Promise<ListEntry[]> {
      const full = resolvePath(basePath, relativePath);
      const entries = readdirSync(full, { withFileTypes: true });
      return entries.map((e) => ({
        name: e.name,
        isDirectory: e.isDirectory(),
      }));
    },

    async mkdtemp(prefix: string): Promise<string> {
      return mkdtempSync(join(tmpdir(), prefix));
    },

    async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
      mkdirSync(path, { recursive: options?.recursive ?? true });
    },

    async rm(path: string, options?: { recursive?: boolean }): Promise<void> {
      rmSync(path, { recursive: options?.recursive ?? false, force: true });
    },

    async exec(
      command: string,
      opts?: ExecOpts,
    ): Promise<{ stdout: string; stderr: string; code: number }> {
      const execOpts: Record<string, unknown> = {
        encoding: 'utf-8',
        timeout: opts?.timeout,
      };
      if (opts?.cwd) execOpts.cwd = opts.cwd;
      if (opts?.input) execOpts.input = opts.input;

      try {
        const result = execSync(command, execOpts as import('child_process').ExecSyncOptions);
        return { stdout: String(result ?? ''), stderr: '', code: 0 };
      } catch (err: unknown) {
        const e = err as { stdout?: string; stderr?: string; status?: number };
        return {
          stdout: String(e?.stdout ?? ''),
          stderr: String(e?.stderr ?? ''),
          code: e?.status ?? 1,
        };
      }
    },

    spawn(command: string, args: string[], opts?: SpawnOpts) {
      const proc = nodeSpawn(command, args, {
        cwd: opts?.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      proc.stdout?.on('data', (d: Buffer) => {
        const s = d.toString();
        stdout += s;
        opts?.onStdout?.(s);
      });
      proc.stderr?.on('data', (d: Buffer) => {
        const s = d.toString();
        stderr += s;
        opts?.onStderr?.(s);
      });
      const promise = new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
        proc.on('close', (code) => {
          resolve({ code: code ?? 1, stdout, stderr });
        });
      });
      return {
        promise,
        kill: () => proc.kill('SIGKILL'),
      };
    },
  };
}
