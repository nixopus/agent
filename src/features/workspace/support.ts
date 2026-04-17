import { createNixopusClient, type NixopusRequestContext } from '../../engine/tools/shared/nixopus-client';
import { listGitHubConnectors } from '@nixopus/api-client';
import { getInstallationToken, githubFetch } from '../../util/github-client';
import { ExternalServiceError, NotFoundError, ConfigError } from '../../errors';

export interface FetchedFile {
  path: string;
  content: string;
  language: string;
  encoding?: 'base64';
}

interface ConnectorData {
  app_id?: string;
  pem?: string;
  installation_id?: string;
}

interface TreeEntry {
  path: string;
  type: string;
  sha: string;
  size?: number;
}

interface TreeResponse {
  sha: string;
  tree: TreeEntry[];
  truncated: boolean;
}

interface BlobResponse {
  content: string;
  encoding: string;
  size: number;
}

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.webp', '.avif',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.mp3', '.mp4', '.wav', '.webm', '.ogg',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.exe', '.dll', '.so', '.dylib', '.bin',
  '.wasm', '.map',
]);

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.output',
  'coverage', '__pycache__', '.venv', 'venv', '.turbo', '.cache', 'vendor',
]);

const SKIP_FILES = new Set<string>([]);

const MAX_FILE_SIZE = 512 * 1024;
const MAX_TOTAL_SIZE = 50 * 1024 * 1024;
const MAX_FILES = 5000;
const BATCH_CONCURRENCY = 20;

const LANG_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  py: 'python', go: 'go', rs: 'rust', rb: 'ruby', java: 'java',
  kt: 'kotlin', cs: 'csharp', cpp: 'cpp', c: 'c', h: 'c',
  php: 'php', swift: 'swift', dart: 'dart', ex: 'elixir', exs: 'elixir',
  html: 'html', css: 'css', scss: 'scss', less: 'less',
  json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml', xml: 'xml',
  md: 'markdown', sql: 'sql', sh: 'shell', bash: 'shell', zsh: 'shell',
};

const blobContentCache = new Map<string, string | null>();
const BLOB_CACHE_MAX = 5000;

function cacheBlobContent(sha: string, content: string | null): void {
  if (blobContentCache.size >= BLOB_CACHE_MAX) {
    const oldest = blobContentCache.keys().next().value;
    if (oldest !== undefined) blobContentCache.delete(oldest);
  }
  blobContentCache.set(sha, content);
}

export function clearBlobCache(): void {
  blobContentCache.clear();
}

export function getBlobCacheStats(): { size: number; maxSize: number } {
  return { size: blobContentCache.size, maxSize: BLOB_CACHE_MAX };
}

export function isBinaryPath(filePath: string): boolean {
  const dot = filePath.lastIndexOf('.');
  if (dot === -1) return false;
  return BINARY_EXTENSIONS.has(filePath.slice(dot).toLowerCase());
}

export function isSkippedPath(filePath: string): boolean {
  let start = 0;
  let idx = filePath.indexOf('/');
  while (idx !== -1) {
    if (SKIP_DIRS.has(filePath.substring(start, idx))) return true;
    start = idx + 1;
    idx = filePath.indexOf('/', start);
  }
  const fileName = filePath.substring(start);
  return SKIP_FILES.has(fileName);
}

export function languageFromPath(filePath: string): string {
  const dot = filePath.lastIndexOf('.');
  if (dot === -1) {
    const base = filePath.split('/').pop()?.toLowerCase() ?? '';
    if (base === 'dockerfile') return 'dockerfile';
    if (base === 'makefile') return 'makefile';
    return 'unknown';
  }
  return LANG_MAP[filePath.slice(dot + 1).toLowerCase()] ?? 'unknown';
}

export async function resolveGithubToken(
  requestContext?: NixopusRequestContext,
  connectorId?: string,
): Promise<string> {
  const client = createNixopusClient(requestContext) as unknown;
  const res = (await listGitHubConnectors({
    client,
  } as Parameters<typeof listGitHubConnectors>[0])) as {
    data?: { data?: (ConnectorData & { id?: string })[] };
    error?: unknown;
  };

  if (res.error) {
    throw new ExternalServiceError('github', `Failed to fetch GitHub connectors: ${JSON.stringify(res.error)}`);
  }

  const connectors = res.data?.data ?? [];

  let connector: (ConnectorData & { id?: string }) | undefined;
  if (connectorId) {
    connector = connectors.find((c) => c.id === connectorId && c.app_id && c.pem && c.installation_id);
    if (!connector) {
      throw new NotFoundError('GitHub connector', connectorId);
    }
  } else {
    connector = connectors.find((c) => c.app_id && c.pem && c.installation_id);
  }

  if (!connector?.app_id || !connector.pem || !connector.installation_id) {
    throw new ConfigError('No GitHub connector with valid credentials found.');
  }

  return getInstallationToken(connector.app_id, connector.pem, connector.installation_id);
}

export async function fetchRepoFiles(
  owner: string,
  repo: string,
  branch: string,
  requestContext?: NixopusRequestContext,
  connectorId?: string,
  filterPaths?: string[],
): Promise<{ files: FetchedFile[]; treeSha: string }> {
  const token = await resolveGithubToken(requestContext, connectorId);

  const tree = await githubFetch<TreeResponse>(
    token,
    `/repos/${owner}/${repo}/git/trees/${branch}`,
    { query: { recursive: '1' } },
  );

  const pathSet = filterPaths ? new Set(filterPaths) : null;
  const blobs: TreeEntry[] = [];
  for (const e of tree.tree) {
    if (blobs.length >= MAX_FILES) break;
    if (e.type !== 'blob') continue;
    if (isBinaryPath(e.path) || isSkippedPath(e.path)) continue;
    if (pathSet && !pathSet.has(e.path)) continue;
    if (e.size != null && e.size > MAX_FILE_SIZE) continue;
    blobs.push(e);
  }

  const shaToEntries = new Map<string, TreeEntry[]>();
  for (const b of blobs) {
    const arr = shaToEntries.get(b.sha);
    if (arr) arr.push(b);
    else shaToEntries.set(b.sha, [b]);
  }

  let totalSize = 0;
  const files: FetchedFile[] = [];

  const uncachedShas: Array<{ sha: string; entries: TreeEntry[] }> = [];
  for (const [sha, entries] of shaToEntries) {
    const cached = blobContentCache.get(sha);
    if (cached !== undefined) {
      if (cached !== null) {
        blobContentCache.delete(sha);
        blobContentCache.set(sha, cached);
        for (const entry of entries) {
          if (totalSize + cached.length > MAX_TOTAL_SIZE) break;
          totalSize += cached.length;
          files.push({ path: entry.path, content: cached, language: languageFromPath(entry.path) });
        }
      }
    } else {
      uncachedShas.push({ sha, entries });
    }
  }

  for (let i = 0; i < uncachedShas.length; i += BATCH_CONCURRENCY) {
    if (totalSize >= MAX_TOTAL_SIZE) break;

    const batch = uncachedShas.slice(i, i + BATCH_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async ({ sha, entries }) => {
        const blob = await githubFetch<BlobResponse>(
          token,
          `/repos/${owner}/${repo}/git/blobs/${sha}`,
        );

        let content: string;
        if (blob.encoding === 'base64') {
          content = Buffer.from(blob.content.replace(/\n/g, ''), 'base64').toString('utf-8');
        } else {
          content = blob.content;
        }

        if (content.includes('\0')) {
          cacheBlobContent(sha, null);
          return null;
        }

        cacheBlobContent(sha, content);
        return { content, entries };
      }),
    );

    for (const r of results) {
      if (r.status !== 'fulfilled' || !r.value) continue;
      const { content, entries } = r.value;
      for (const entry of entries) {
        if (totalSize + content.length > MAX_TOTAL_SIZE) break;
        totalSize += content.length;
        files.push({ path: entry.path, content, language: languageFromPath(entry.path) });
      }
    }
  }

  return { files, treeSha: tree.sha };
}
