import * as childProcess from 'node:child_process';

const SAMPLE_REPOS = [
  { owner: 'nixopus', repo: 'sample-app', branch: 'main' },
] as const;

export interface SampleRepoMatch {
  owner: string;
  repo: string;
  branch: string;
}

export const CACHE_MARKER = '.cache-complete';
const LS_REMOTE_TIMEOUT_MS = 15_000;

export function matchSampleRepo(repoUrl: string, branch?: string): SampleRepoMatch | null {
  let parsed: URL;
  try {
    parsed = new URL(repoUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:') return null;
  if (parsed.host.toLowerCase() !== 'github.com') return null;
  if (parsed.username || parsed.password) return null;

  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length < 2) return null;

  const owner = segments[0].toLowerCase();
  const repo = segments[1].replace(/\.git$/i, '').toLowerCase();
  const effectiveBranch = (branch ?? '').trim() || undefined;

  for (const sample of SAMPLE_REPOS) {
    if (sample.owner !== owner || sample.repo !== repo) continue;
    if (effectiveBranch && effectiveBranch !== sample.branch) continue;
    return { owner: sample.owner, repo: sample.repo, branch: sample.branch };
  }

  return null;
}


export async function resolveRemoteSha(repoUrl: string, branch: string): Promise<string | null> {
  return await new Promise((resolve) => {
    childProcess.execFile(
      'git',
      ['ls-remote', repoUrl, `refs/heads/${branch}`],
      { timeout: LS_REMOTE_TIMEOUT_MS },
      (err, stdout) => {
        if (err) {
          resolve(null);
          return;
        }
        const line = String(stdout).split('\n').find((l) => l.trim().length > 0);
        if (!line) {
          resolve(null);
          return;
        }
        const sha = line.split(/\s+/)[0]?.trim();
        resolve(sha && /^[0-9a-f]{40}$/i.test(sha) ? sha.toLowerCase() : null);
      },
    );
  });
}


const CACHE_VERSION = 'v3';

export function cachePrefixFor(match: SampleRepoMatch, sha: string): string {
  return `cache/samples/${CACHE_VERSION}/${match.owner}/${match.repo}/${sha}/`;
}
