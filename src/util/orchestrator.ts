export interface StatResult {
  isDirectory: boolean;
  size: number;
  mtime: number;
}

export interface ListEntry {
  name: string;
  isDirectory: boolean;
}

export interface ExecOpts {
  cwd?: string;
  input?: string;
  timeout?: number;
}

export interface SpawnOpts {
  cwd?: string;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export interface Orchestrator {
  readFile(basePath: string, relativePath: string, encoding?: 'utf-8' | 'buffer'): Promise<string | Buffer>;
  readFileSync?(basePath: string, relativePath: string): string;
  existsSync?(path: string): boolean;
  writeFile(basePath: string, relativePath: string, content: string | Buffer): Promise<void>;
  exists(basePath: string, relativePath: string): Promise<boolean>;
  stat(basePath: string, relativePath: string): Promise<StatResult>;
  listDir(basePath: string, relativePath: string): Promise<ListEntry[]>;
  mkdtemp(prefix: string): Promise<string>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  rm(path: string, options?: { recursive?: boolean }): Promise<void>;
  exec(command: string, opts?: ExecOpts): Promise<{ stdout: string; stderr: string; code: number }>;
  spawn(
    command: string,
    args: string[],
    opts?: SpawnOpts,
  ): { promise: Promise<{ code: number; stdout: string; stderr: string }>; kill: () => void };
  close?(): void;
}
