import type { ExecOpts, ListEntry, Orchestrator, SpawnOpts, StatResult } from './orchestrator';
import { ConfigError, ExternalServiceError } from '../errors';
import { createLogger } from '../logger';

const logger = createLogger('ssh-orchestrator');

export interface SshConfig {
  host: string;
  user: string;
  port?: number;
  privateKey?: string;
  password?: string;
}

function escapeForShell(path: string): string {
  return `'${path.replace(/'/g, "'\\''")}'`;
}

const CONNECT_RETRIES = 3;
const CONNECT_INITIAL_DELAY_MS = 500;

async function connect(config: SshConfig): Promise<import('ssh2').Client> {
  const { Client } = await import('ssh2');
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < CONNECT_RETRIES; attempt++) {
    try {
      const conn = await new Promise<import('ssh2').Client>((resolve, reject) => {
        const client = new Client();
        client
          .on('ready', () => resolve(client))
          .on('error', reject)
          .connect({
            host: config.host,
            port: config.port ?? 22,
            username: config.user,
            ...(config.privateKey ? { privateKey: config.privateKey } : {}),
            ...(config.password ? { password: config.password } : {}),
          });
      });
      return conn;
    } catch (err) {
      lastErr = err as Error;
      if (attempt < CONNECT_RETRIES - 1) {
        const delay = CONNECT_INITIAL_DELAY_MS * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr ?? new ExternalServiceError('ssh', 'SSH connection failed');
}

function runCommand(conn: import('ssh2').Client, cmd: string, opts?: { input?: string }): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    conn.exec(cmd, (err, stream) => {
      if (err) {
        resolve({ stdout: '', stderr: err.message, code: 1 });
        return;
      }
      let stdout = '';
      let stderr = '';
      stream
        .on('data', (d: Buffer) => {
          stdout += d.toString();
        })
        .stderr.on('data', (d: Buffer) => {
          stderr += d.toString();
        });
      if (opts?.input) {
        stream.write(opts.input);
        stream.end();
      }
      stream.on('close', (code: number) => {
        resolve({ stdout, stderr, code: code ?? 1 });
      });
    });
  });
}

function getConnectionPool(config: SshConfig) {
  let conn: import('ssh2').Client | null = null;
  let closed = false;
  const reset = () => {
    conn = null;
  };
  return {
    async get(): Promise<import('ssh2').Client> {
      if (closed) throw new ConfigError('SSH connection pool is closed');
      if (conn) return conn;
      conn = await connect(config);
      conn.on('error', reset).on('close', reset);
      return conn;
    },
    close: () => {
      closed = true;
      conn?.end();
      conn = null;
    },
  };
}

export function createSshOrchestrator(config: SshConfig): Orchestrator & { close(): void } {
  const pool = getConnectionPool(config);

  const orch: Orchestrator & { close(): void } = {
    async readFile(basePath: string, relativePath: string, encoding?: 'utf-8' | 'buffer'): Promise<string | Buffer> {
      const conn = await pool.get();
      const full = relativePath ? `${basePath.replace(/\/$/, '')}/${relativePath}` : basePath;
      if (encoding === 'buffer') {
        const { stdout, code } = await runCommand(conn, `base64 ${escapeForShell(full)}`);
        if (code !== 0) throw new ExternalServiceError('ssh', `Failed to read ${full}`);
        return Buffer.from(stdout.trim(), 'base64');
      }
      const { stdout, code } = await runCommand(conn, `cat ${escapeForShell(full)}`);
      if (code !== 0) throw new ExternalServiceError('ssh', `Failed to read ${full}`);
      return stdout;
    },

    async writeFile(basePath: string, relativePath: string, content: string | Buffer): Promise<void> {
      const conn = await pool.get();
      const full = relativePath ? `${basePath.replace(/\/$/, '')}/${relativePath}` : basePath;
      const encoded =
        typeof content === 'string'
          ? Buffer.from(content, 'utf-8').toString('base64')
          : content.toString('base64');
      const { code } = await runCommand(conn, `base64 -d > ${escapeForShell(full)}`, { input: encoded });
      if (code !== 0) throw new ExternalServiceError('ssh', `Failed to write ${full}`);
    },

    async exists(basePath: string, relativePath: string): Promise<boolean> {
      const conn = await pool.get();
      const full = relativePath ? `${basePath.replace(/\/$/, '')}/${relativePath}` : basePath;
      const cmd = `test -e ${escapeForShell(full)} && echo 1 || echo 0`;
      const { stdout, stderr, code } = await runCommand(conn, cmd);
      const result = code === 0 && stdout.trim() === '1';
      logger.debug({ cmd, code, stdout: stdout.trim(), stderr, result }, 'exists check');
      return result;
    },

    async stat(basePath: string, relativePath: string): Promise<StatResult> {
      const conn = await pool.get();
      const full = relativePath ? `${basePath.replace(/\/$/, '')}/${relativePath}` : basePath;
      const cmd = `(stat -c '%F %s %Y' ${escapeForShell(full)} 2>/dev/null) || (stat -f '%Sp %z %m' ${escapeForShell(full)} 2>/dev/null)`;
      const { stdout, stderr, code } = await runCommand(conn, cmd);
      logger.debug({ cmd, code, stdout: stdout.trim(), stderr }, 'stat check');
      if (code !== 0) throw new ExternalServiceError('ssh', `Failed to stat ${full}`);
      const parts = stdout.trim().split(/\s+/);
      const typeOrPerms = parts[0] ?? '';
      const size = parseInt(parts[1] ?? '0', 10);
      const mtimeSec = parseInt(parts[2] ?? '0', 10);
      const mtime = mtimeSec < 10000000000 ? mtimeSec * 1000 : mtimeSec;
      const isDir = typeOrPerms.includes('directory') || typeOrPerms.startsWith('d');
      return { isDirectory: isDir, size, mtime };
    },

    async listDir(basePath: string, relativePath: string): Promise<ListEntry[]> {
      const conn = await pool.get();
      const full = relativePath ? `${basePath.replace(/\/$/, '')}/${relativePath}` : basePath;
        const { stdout, code } = await runCommand(conn, `ls -la ${escapeForShell(full)} 2>/dev/null | tail -n +2`);
        if (code !== 0) return [];
        const entries: ListEntry[] = [];
        for (const line of stdout.split('\n')) {
          if (!line.trim()) continue;
          const m = line.match(/^[d\-lrwx]+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+(.+)$/);
          const name = m?.[1]?.trim();
          if (name && name !== '.' && name !== '..') {
            entries.push({ name, isDirectory: line.startsWith('d') });
          }
        }
        return entries;
    },

    async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
      const conn = await pool.get();
      const flags = options?.recursive ? '-p' : '';
      await runCommand(conn, `mkdir ${flags} ${escapeForShell(path)}`);
    },

    async mkdtemp(prefix: string): Promise<string> {
      const conn = await pool.get();
      const { stdout, code } = await runCommand(conn, `mktemp -d -t ${escapeForShell(prefix)}`);
      if (code !== 0) throw new ExternalServiceError('ssh', 'Failed to create temp dir');
      return stdout.trim();
    },

    async rm(path: string, options?: { recursive?: boolean }): Promise<void> {
      const conn = await pool.get();
      const flags = options?.recursive ? '-rf' : '-f';
      await runCommand(conn, `rm ${flags} ${escapeForShell(path)}`);
    },

    async exec(command: string, opts?: ExecOpts): Promise<{ stdout: string; stderr: string; code: number }> {
      const conn = await pool.get();
      const cwd = opts?.cwd ? `cd ${escapeForShell(opts.cwd)} && ` : '';
      return runCommand(conn, `${cwd}${command}`, { input: opts?.input });
    },

    spawn(command: string, args: string[], opts?: SpawnOpts) {
      const fullCmd = [command, ...args].map(escapeForShell).join(' ');
      const cwd = opts?.cwd ? `cd ${escapeForShell(opts.cwd)} && ` : '';
      const cmd = `${cwd}${fullCmd}`;

      let resolvePromise: (value: { code: number; stdout: string; stderr: string }) => void;
      const promise = new Promise<{ code: number; stdout: string; stderr: string }>((r) => {
        resolvePromise = r;
      });

      let killed = false;
      const connPromise = pool.get();

      connPromise.then((conn) => {
        if (killed) {
          conn.end();
          resolvePromise!({ stdout: '', stderr: 'killed', code: 1 });
          return;
        }
        conn.exec(cmd, (err, stream) => {
          if (err) {
            resolvePromise!({ stdout: '', stderr: err.message, code: 1 });
            return;
          }
          let stdout = '';
          let stderr = '';
          stream.on('data', (d: Buffer) => {
            const s = d.toString();
            stdout += s;
            if (!killed) opts?.onStdout?.(s);
          });
          stream.stderr.on('data', (d: Buffer) => {
            const s = d.toString();
            stderr += s;
            if (!killed) opts?.onStderr?.(s);
          });
          stream.on('close', (code: number) => {
            resolvePromise!({ stdout, stderr, code: code ?? 1 });
          });
        });
      });

      return {
        promise,
        kill: () => {
          killed = true;
          connPromise.then((c) => c.end()).catch(() => {});
        },
      };
    },
    close: () => pool.close(),
  };
  return orch;
}
