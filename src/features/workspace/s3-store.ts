import { S3Filesystem } from '@mastra/s3';
import { config } from '../../config';
import { languageFromPath, isBinaryPath } from './support';
import type { FetchedFile } from './support';
import { createLogger } from '../../logger';

const logger = createLogger('s3-store');

const WORKSPACE_PREFIX = 'workspaces';
const BATCH_CONCURRENCY = 20;

export interface IndexStatus {
  indexed: boolean;
  indexingStatus?: string;
  indexingError?: string;
  fileCount?: number;
  indexedAt?: number;
}

interface SyncFile {
  path: string;
  content: string;
  encoding?: 'base64';
}

const indexStatuses = new Map<string, IndexStatus>();

export function isS3Configured(): boolean {
  return !!(config.s3.bucket && config.s3.accessKey && config.s3.secretKey);
}

function normalizeEndpoint(raw: string): string {
  if (!raw) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

export function createS3Fs(applicationId: string): S3Filesystem {
  const prefix = `${WORKSPACE_PREFIX}/${applicationId}/`;
  const endpoint = normalizeEndpoint(config.s3.endpoint);
  return new S3Filesystem({
    bucket: config.s3.bucket,
    region: config.s3.region,
    accessKeyId: config.s3.accessKey,
    secretAccessKey: config.s3.secretKey,
    ...(endpoint && { endpoint }),
    forcePathStyle: true,
    prefix,
  });
}

function normalizePath(path: string): string {
  let p = path;
  while (p.startsWith('/')) p = p.slice(1);
  return p;
}

async function clearPrefix(fs: S3Filesystem): Promise<void> {
  try {
    const entries = await fs.readdir('/', { recursive: true });
    const filePaths = entries.filter((e) => e.type === 'file').map((e) => e.name);

    for (let i = 0; i < filePaths.length; i += BATCH_CONCURRENCY) {
      const batch = filePaths.slice(i, i + BATCH_CONCURRENCY);
      await Promise.allSettled(batch.map((p) => fs.deleteFile(p)));
    }
  } catch (err) {
    logger.debug({ err }, 'clearPrefix: readdir empty or failed (first sync for this app)');
  }
}

export async function syncFiles(
  applicationId: string,
  files: SyncFile[],
  fullSync: boolean,
  deletedPaths?: string[],
): Promise<number> {
  const fs = createS3Fs(applicationId);
  await fs.init();

  try {
    if (fullSync) {
      await clearPrefix(fs);
    }

    if (deletedPaths?.length) {
      await Promise.allSettled(
        deletedPaths.map((p) => fs.deleteFile(normalizePath(p))),
      );
    }

    let synced = 0;
    for (let i = 0; i < files.length; i += BATCH_CONCURRENCY) {
      const batch = files.slice(i, i + BATCH_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (file) => {
          const normalPath = normalizePath(file.path);
          const content = file.encoding === 'base64'
            ? Buffer.from(file.content, 'base64')
            : file.content;
          await fs.writeFile(normalPath, content);
        }),
      );

      for (const r of results) {
        if (r.status === 'fulfilled') synced++;
        else logger.warn({ err: r.reason }, 'Failed to write file to S3');
      }
    }

    return synced;
  } finally {
    await fs.destroy().catch(() => {});
  }
}

export async function listFiles(applicationId: string): Promise<FetchedFile[]> {
  const fs = createS3Fs(applicationId);
  await fs.init();

  try {
    const entries = await fs.readdir('/', { recursive: true });
    const filePaths = entries
      .filter((e) => e.type === 'file' && !isBinaryPath(e.name))
      .map((e) => e.name);

    const files: FetchedFile[] = [];

    for (let i = 0; i < filePaths.length; i += BATCH_CONCURRENCY) {
      const batch = filePaths.slice(i, i + BATCH_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (path) => {
          const content = await fs.readFile(path, { encoding: 'utf-8' });
          return {
            path,
            content: typeof content === 'string' ? content : content.toString('utf-8'),
            language: languageFromPath(path),
          };
        }),
      );

      for (const r of results) {
        if (r.status === 'fulfilled') files.push(r.value);
      }
    }

    return files;
  } finally {
    await fs.destroy().catch(() => {});
  }
}

export async function remapPrefix(fromId: string, toId: string): Promise<number> {
  const srcFs = createS3Fs(fromId);
  const dstFs = createS3Fs(toId);
  await srcFs.init();
  await dstFs.init();

  try {
    const entries = await srcFs.readdir('/', { recursive: true });
    const filePaths = entries.filter((e) => e.type === 'file').map((e) => e.name);

    if (filePaths.length === 0) return 0;

    let copied = 0;
    for (let i = 0; i < filePaths.length; i += BATCH_CONCURRENCY) {
      const batch = filePaths.slice(i, i + BATCH_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (path) => {
          const content = await srcFs.readFile(path);
          await dstFs.writeFile(path, content);
        }),
      );
      for (const r of results) {
        if (r.status === 'fulfilled') copied++;
        else logger.warn({ err: r.reason }, 'remapPrefix: copy failed');
      }
    }

    await clearPrefix(srcFs);
    logger.info({ fromId, toId, copied }, 'remapPrefix complete');
    return copied;
  } finally {
    await srcFs.destroy().catch(() => {});
    await dstFs.destroy().catch(() => {});
  }
}

export async function countFiles(applicationId: string): Promise<number> {
  const fs = createS3Fs(applicationId);
  await fs.init();

  try {
    const entries = await fs.readdir('/', { recursive: true });
    return entries.filter((e) => e.type === 'file').length;
  } finally {
    await fs.destroy().catch(() => {});
  }
}

export function setIndexStatus(
  applicationId: string,
  status: string,
  fileCount?: number,
  error?: string,
): void {
  indexStatuses.set(applicationId, {
    indexed: status === 'done',
    indexingStatus: status,
    ...(fileCount !== undefined && { fileCount }),
    ...(error && { indexingError: error }),
    ...(status === 'done' && { indexedAt: Date.now() }),
  });
}

export function getIndexStatus(applicationId: string): IndexStatus {
  return indexStatuses.get(applicationId) ?? { indexed: false };
}
