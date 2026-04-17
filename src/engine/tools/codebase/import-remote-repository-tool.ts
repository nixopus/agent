import * as childProcess from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { Workspace, WorkspaceFilesystem } from '@mastra/core/workspace';
import type { ToolWriter } from '../api/shared';
import {
  languageFromPath,
  isBinaryPath,
  isSkippedPath,
  type FetchedFile,
} from '../../../features/workspace/support';
import { isPublicGitUrl, toCloneSafeHttpsUrl } from './git-url';
import {
  isS3Configured,
  syncFiles as syncFilesToS3,
  prefixHas,
  writeFilesToPrefix,
  copyPrefix,
  readFilesFromPrefix,
} from '../../../features/workspace/s3-store';
import {
  CACHE_MARKER,
  cachePrefixFor,
  matchSampleRepo,
  resolveRemoteSha,
  type SampleRepoMatch,
} from './sample-repo-cache';
import { createLogger } from '../../../logger';

const importLogger = createLogger('load-remote-repository');

const CLONE_TIMEOUT_MS = 60_000;
const MAX_FILE_BYTES = 512 * 1024;
/** Mirrors `fetchRepoFiles` caps in `support.ts`. */
const MAX_IMPORT_FILES = 5000;
const MAX_IMPORT_TOTAL_SIZE = 50 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RequestContext = { get?: (k: string) => unknown; set?: (k: string, v: unknown) => void };
type ToolContext = { workspace?: Workspace; requestContext?: RequestContext; writer?: ToolWriter };

type GitExecError = NodeJS.ErrnoException & { stderr?: string };

async function runGit(
  args: string[],
  options?: { timeout?: number },
): Promise<{ stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    childProcess.execFile('git', args, options ?? {}, (err, stdout, stderr) => {
      if (err) {
        const enriched = err as GitExecError;
        enriched.stderr = String(stderr ?? '');
        reject(enriched);
      } else {
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      }
    });
  });
}

async function resolveCheckedOutBranch(dir: string): Promise<string> {
  const current = await runGit(['-C', dir, 'branch', '--show-current']);
  const fromCurrent = current.stdout.trim();
  if (fromCurrent) return fromCurrent;

  const symRef = await runGit(['-C', dir, 'symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD']).catch(
    () => null,
  );
  if (symRef) {
    const sym = symRef.stdout.trim();
    if (sym.startsWith('origin/')) return sym.slice('origin/'.length);
    if (sym) return sym;
  }

  const abbrev = await runGit(['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD']);
  const ab = abbrev.stdout.trim();
  if (ab && ab !== 'HEAD') return ab;

  throw new Error('Could not resolve checked-out branch name.');
}

async function collectFiles(
  root: string,
  limits: { maxFiles: number; maxTotalSize: number },
  acc: { totalSize: number },
  cwd = root,
  out: FetchedFile[] = [],
): Promise<FetchedFile[]> {
  if (out.length >= limits.maxFiles || acc.totalSize >= limits.maxTotalSize) return out;

  const entries = await readdir(cwd, { withFileTypes: true });
  for (const entry of entries) {
    if (out.length >= limits.maxFiles || acc.totalSize >= limits.maxTotalSize) break;

    const full = join(cwd, entry.name);
    const rel = relative(root, full).replaceAll('\\', '/');

    const info = await lstat(full);
    if (info.isSymbolicLink()) continue;

    if (info.isDirectory()) {
      if (isSkippedPath(`${rel}/.gitkeep`)) continue;
      await collectFiles(root, limits, acc, full, out);
      continue;
    }

    if (!info.isFile()) continue;
    if (isSkippedPath(rel)) continue;
    if (info.size > MAX_FILE_BYTES) continue;

    if (out.length >= limits.maxFiles) break;

    if (isBinaryPath(rel)) {
      const buf = await readFile(full);
      const contentBytes = buf.length;
      if (acc.totalSize + contentBytes > limits.maxTotalSize) break;
      acc.totalSize += contentBytes;
      out.push({
        path: rel,
        content: buf.toString('base64'),
        language: languageFromPath(rel),
        encoding: 'base64',
      });
      continue;
    }

    const content = await readFile(full, 'utf8');
    if (content.includes('\0')) continue;

    const contentBytes = Buffer.byteLength(content, 'utf8');
    if (acc.totalSize + contentBytes > limits.maxTotalSize) break;

    acc.totalSize += contentBytes;
    out.push({ path: rel, content, language: languageFromPath(rel) });
  }
  return out;
}

function mapCloneError(err: unknown): Error {
  const e = (err ?? {}) as GitExecError;
  const baseMsg = err instanceof Error ? err.message : String(err);
  const stderr = (e.stderr ?? '').trim();
  const detail = stderr ? `${baseMsg} | stderr: ${stderr}` : baseMsg;
  const haystack = `${baseMsg}\n${stderr}`;

  if (e.code === 'ENOENT' || /spawn git ENOENT/i.test(haystack)) {
    return new Error(
      `Unable to clone repository: 'git' binary not found in runtime environment. (${detail})`,
    );
  }
  if (/remote branch .* not found/i.test(haystack)) {
    return new Error(`Unable to clone repository: branch not found. (${detail})`);
  }
  if (/could not resolve host|timed out|network is unreachable|ECONNRESET|ETIMEDOUT/i.test(haystack)) {
    return new Error(`Unable to clone repository: network failure. (${detail})`);
  }
  if (/repository not found|authentication failed|access denied|403/i.test(haystack)) {
    return new Error(`Unable to clone repository: not found or private. (${detail})`);
  }
  if (/ssl certificate problem|unable to get local issuer|self.signed certificate|certificate verify failed/i.test(haystack)) {
    return new Error(`Unable to clone repository: TLS/CA certificates missing. (${detail})`);
  }
  return new Error(`Unable to clone repository. (${detail})`);
}

function mapPostCloneError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  if (/Could not resolve checked-out branch name/i.test(msg)) {
    return new Error('Unable to import remote repository: could not determine the default branch.');
  }
  if (/ENOENT|EACCES|EPERM|ENOTDIR|not a directory/i.test(msg)) {
    return new Error('Unable to import remote repository: could not read repository files.');
  }
  return new Error('Unable to import remote repository: failed to finalize import.');
}

export async function importRemoteRepository(input: {
  repoUrl: string;
  branch?: string;
  /** Optional caps (defaults match GitHub tree fetch guardrails in `support.ts`). */
  importLimits?: { maxFiles?: number; maxTotalBytes?: number };
}): Promise<{
  files: FetchedFile[];
  fileCount: number;
  commit: string;
  branch: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), 'nixopus-remote-'));
  const maxFiles = input.importLimits?.maxFiles ?? MAX_IMPORT_FILES;
  const maxTotalSize = input.importLimits?.maxTotalBytes ?? MAX_IMPORT_TOTAL_SIZE;

  try {
    const cloneArgs = ['clone', '--depth', '1'];
    if (input.branch) cloneArgs.push('--branch', input.branch);
    cloneArgs.push(input.repoUrl, dir);

    try {
      await runGit(cloneArgs, { timeout: CLONE_TIMEOUT_MS });
    } catch (err) {
      throw mapCloneError(err);
    }

    try {
      const branchName = input.branch ?? (await resolveCheckedOutBranch(dir));
      const rev = await runGit(['-C', dir, 'rev-parse', '--short', 'HEAD']);
      const files = await collectFiles(dir, { maxFiles, maxTotalSize }, { totalSize: 0 });
      return {
        files,
        fileCount: files.length,
        commit: rev.stdout.trim(),
        branch: branchName,
      };
    } catch (err) {
      throw mapPostCloneError(err);
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function ensureWorkspaceInitialized(workspace: Workspace): Promise<void> {
  if (workspace.status === 'pending') {
    await workspace.init();
  }
}

async function writeFetchedFilesToWorkspace(
  fs: WorkspaceFilesystem,
  root: string,
  files: FetchedFile[],
): Promise<void> {
  const dirs = new Set<string>();
  for (const file of files) {
    const lastSlash = file.path.lastIndexOf('/');
    if (lastSlash > 0) dirs.add(file.path.substring(0, lastSlash));
  }

  for (const dir of [...dirs].sort()) {
    await fs.mkdir(`${root}/${dir}`, { recursive: true });
  }

  for (const file of files) {
    const payload = file.encoding === 'base64' ? Buffer.from(file.content, 'base64') : file.content;
    await fs.writeFile(`${root}/${file.path}`, payload);
  }
}

async function populateWorkspaceFromFetched(
  workspace: Workspace,
  root: string,
  files: FetchedFile[],
): Promise<void> {
  await ensureWorkspaceInitialized(workspace);

  const fs = workspace.filesystem;
  if (fs) {
    await writeFetchedFilesToWorkspace(fs, root, files);
  }

  for (const file of files) {
    if (file.encoding === 'base64') continue;
    await workspace.index(`${root}/${file.path}`, file.content, {
      metadata: { language: file.language },
    });
  }
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function chooseImportTarget(applicationId: string | undefined, requestContext: RequestContext | undefined): string {
  if (isUuid(applicationId)) return applicationId;

  const existingSyncTarget = requestContext?.get?.('syncTarget');
  if (isUuid(existingSyncTarget)) return existingSyncTarget;

  const existingWorkspaceId = requestContext?.get?.('workspaceId');
  if (isUuid(existingWorkspaceId)) return existingWorkspaceId;

  return randomUUID();
}

function stampImportRequestContext(args: {
  requestContext: RequestContext | undefined;
  syncTarget: string;
  branch: string;
  applicationId?: string;
}): void {
  args.requestContext?.set?.('workspaceSource', 'git_url');
  args.requestContext?.set?.('syncTarget', args.syncTarget);
  args.requestContext?.set?.('workspaceId', args.syncTarget);
  args.requestContext?.set?.('contextBranch', args.branch);
  if (args.applicationId) {
    args.requestContext?.set?.('contextApplicationId', args.applicationId);
  }
}

async function syncFetchedFilesToS3(
  applicationId: string | undefined,
  files: FetchedFile[],
): Promise<{ attempted: boolean; synced?: number; error?: string }> {
  if (!isS3Configured() || !isUuid(applicationId)) {
    return { attempted: false };
  }

  try {
    const synced = await syncFilesToS3(
      applicationId,
      files.map((f) => ({
        path: f.path,
        content: f.content,
        ...(f.encoding && { encoding: f.encoding }),
      })),
      true,
    );
    importLogger.info({ applicationId, synced }, 'Imported repository synced to workspace');
    return { attempted: true, synced };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    importLogger.warn({ applicationId, err }, 'Failed to sync imported repository to S3');
    return { attempted: true, error: message };
  }
}

interface CacheOutcome {
  source: 'hit' | 'miss' | 'warmed' | 'unavailable';
  sha?: string;
  cachePrefix?: string;
  filesCopied?: number;
  warnings: string[];
}

interface CacheResult {
  files: FetchedFile[];
  commit: string;
  branch: string;
  outcome: CacheOutcome;
}

async function importViaCache(
  cloneRepoUrl: string,
  applicationId: string | undefined,
  match: SampleRepoMatch,
): Promise<CacheResult | null> {
  if (!isS3Configured() || !isUuid(applicationId)) return null;

  const sha = await resolveRemoteSha(cloneRepoUrl, match.branch);
  if (!sha) {
    importLogger.warn({ cloneRepoUrl, branch: match.branch }, 'cache: ls-remote failed, falling back to clone');
    return null;
  }

  const cachePrefix = cachePrefixFor(match, sha);
  const warnings: string[] = [];
  const targetPrefix = `workspaces/${applicationId}/`;

  const cacheReady = await prefixHas(cachePrefix, CACHE_MARKER);

  if (cacheReady) {
    const [files, copyResult] = await Promise.all([
      readFilesFromPrefix(cachePrefix),
      copyPrefix(cachePrefix, targetPrefix),
    ]);

    if (copyResult.failed.length > 0) {
      warnings.push(`copy from cache failed for ${copyResult.failed.length} file(s)`);
    }
    if (files.length === 0) {
      importLogger.warn({ cachePrefix }, 'cache: marker found but prefix empty, falling back to clone');
      return null;
    }

    importLogger.info(
      { cachePrefix, applicationId, copied: copyResult.copied, files: files.length },
      'cache: hit, materialised into workspace prefix',
    );

    return {
      files,
      commit: sha.slice(0, 7),
      branch: match.branch,
      outcome: { source: 'hit', sha, cachePrefix, filesCopied: copyResult.copied, warnings },
    };
  }

  const cloned = await importRemoteRepository({ repoUrl: cloneRepoUrl, branch: match.branch });

  const writeResult = await writeFilesToPrefix(
    cachePrefix,
    cloned.files.map((f) => ({
      path: f.path,
      content: f.content,
      ...(f.encoding && { encoding: f.encoding }),
    })),
    {
      fullSync: true,
      marker: { key: CACHE_MARKER, content: JSON.stringify({ sha, files: cloned.fileCount, at: Date.now() }) },
    },
  );

  if (writeResult.failed.length > 0) {
    warnings.push(
      `cache warm partial: ${writeResult.failed.length} file(s) failed; marker not written, will re-warm next time`,
    );
    importLogger.warn(
      { cachePrefix, failed: writeResult.failed.length, sample: writeResult.failed.slice(0, 3) },
      'cache: warm partial, marker withheld',
    );
  }

  const perAppSync = await syncFetchedFilesToS3(applicationId, cloned.files);
  if (perAppSync.error) {
    warnings.push(`per-app workspace sync failed: ${perAppSync.error}`);
  }

  return {
    files: cloned.files,
    commit: cloned.commit,
    branch: cloned.branch,
    outcome: {
      source: writeResult.failed.length === 0 ? 'warmed' : 'miss',
      sha,
      cachePrefix,
      filesCopied: perAppSync.synced,
      warnings,
    },
  };
}

async function emitImportedFiles(
  writer: ToolWriter | undefined,
  applicationId: string,
  files: FetchedFile[],
): Promise<void> {
  if (!writer?.custom) return;

  for (const file of files) {
    if (file.encoding === 'base64') continue;
    await writer.custom({
      type: 'data-write-file',
      data: { applicationId, path: file.path, content: file.content },
      transient: true,
    });
  }
}

const publicHttpsGitUrlSchema = z
  .string()
  .min(1)
  .refine((value) => isPublicGitUrl(value), {
    message: 'Must be a public HTTPS git repository URL (e.g. https://github.com/org/repo.git).',
  });

export const loadRemoteRepositoryTool = createTool({
  id: 'load_remote_repository',
  description:
    'Load a public remote git repository into the workspace for analysis. ' +
    'Use when the GitHub connector is unavailable and the user provides a public HTTPS git URL. ' +
    'After calling this, use read_file, grep, search, list_directory to explore.',
  inputSchema: z.object({
    repoUrl: publicHttpsGitUrlSchema.describe('Public HTTPS clone URL for the repository'),
    branch: z.string().min(1).optional().describe('Optional branch to check out (default: remote default)'),
    applicationId: z.string().uuid().optional().describe('Application UUID to place files under apps/<id>'),
  }),
  execute: async ({ repoUrl, branch, applicationId }, ctx) => {
    const toolCtx = ctx as ToolContext | undefined;
    const workspace = toolCtx?.workspace;

    const cloneRepoUrl = toCloneSafeHttpsUrl(repoUrl);
    if (!cloneRepoUrl) {
      return {
        error: 'Must be a public HTTPS git repository URL (e.g. https://github.com/org/repo.git).',
        fileCount: 0,
      };
    }

    let imported: {
      files: FetchedFile[];
      fileCount: number;
      commit: string;
      branch: string;
    };
    let cacheOutcome: CacheOutcome | undefined;

    const sampleMatch = matchSampleRepo(cloneRepoUrl, branch);

    try {
      const cached = sampleMatch ? await importViaCache(cloneRepoUrl, applicationId, sampleMatch) : null;

      if (cached) {
        imported = {
          files: cached.files,
          fileCount: cached.files.length,
          commit: cached.commit,
          branch: cached.branch,
        };
        cacheOutcome = cached.outcome;
      } else {
        const cloned = await importRemoteRepository({ repoUrl: cloneRepoUrl, branch });
        imported = cloned;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to import remote repository.';
      return { error: message, fileCount: 0 };
    }

    if (imported.fileCount === 0) {
      return { error: 'No importable text files found in repository', fileCount: 0 };
    }

    const syncTarget = chooseImportTarget(applicationId, toolCtx?.requestContext);
    stampImportRequestContext({
      requestContext: toolCtx?.requestContext,
      syncTarget,
      branch: imported.branch,
      applicationId,
    });

    const workspaceRoot = `apps/${syncTarget}`;

    if (workspace) {
      await populateWorkspaceFromFetched(workspace, workspaceRoot, imported.files);
    }

    await emitImportedFiles(toolCtx?.writer, syncTarget, imported.files);

    const s3Sync = cacheOutcome
      ? {
          attempted: true,
          ...(cacheOutcome.filesCopied !== undefined && { synced: cacheOutcome.filesCopied }),
          ...(cacheOutcome.warnings.length > 0 && { error: cacheOutcome.warnings.join('; ') }),
        }
      : await syncFetchedFilesToS3(applicationId, imported.files);

    const cacheNote = cacheOutcome
      ? ` [cache:${cacheOutcome.source} ${cacheOutcome.sha?.slice(0, 7) ?? ''}]`
      : '';

    return {
      workspaceRoot,
      fileCount: imported.fileCount,
      commit: imported.commit,
      branch: imported.branch,
      s3Sync,
      ...(cacheOutcome && { cache: cacheOutcome }),
      message: s3Sync.attempted && s3Sync.synced
        ? `Repository source loaded successfully (${s3Sync.synced} files synced to workspace)${cacheNote}. Continuing deployment with this codebase.`
        : s3Sync.attempted && s3Sync.error
          ? `Repository source loaded but workspace sync failed: ${s3Sync.error}. Deployment may report no source files.`
          : `Repository source loaded successfully${cacheNote}. Continuing deployment with this codebase.`,
    };
  },
});
