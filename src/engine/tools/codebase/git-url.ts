const GIT_HOST_RE = /^https:\/\/[^/\s]+\/[^/\s]+\/[^/\s#]+(?:\.git)?$/i;
const BRANCH_RE = /\bbranch\s+([A-Za-z0-9._/-]+)\b/i;

/** Trailing punctuation often glued from prose (e.g. "branch main."). */
const BRANCH_TRAILING_JUNK_RE = /[.,;:!?)]+$/u;

/**
 * Strips prose / markdown wrappers glued to the tail of a matched https URL
 * (e.g. `<https://...>`, `[...]`, `...;`) so the result is safe for `git clone`.
 */
const URL_TRAILING_WRAPPER_RE = /[.,;:!?)>\]'"\]]+$/u;

function normalizeRepoPath(url: URL): string {
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 2) return '';
  return `/${parts[0]}/${parts[1]}`;
}

function hasHttpsCredentials(url: URL): boolean {
  return url.username !== '' || url.password !== '';
}

/** Returns an https URL string with no query or fragment (safe for git clone). */
export function toCloneSafeHttpsUrl(value: string): string | null {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'https:') return null;
    if (hasHttpsCredentials(parsed)) return null;
    parsed.search = '';
    parsed.hash = '';
    return parsed.href;
  } catch {
    return null;
  }
}

export function isPublicGitUrl(value: string): boolean {
  const normalized = toCloneSafeHttpsUrl(value);
  if (!normalized || !GIT_HOST_RE.test(normalized)) return false;
  try {
    const parsed = new URL(normalized);
    return normalizeRepoPath(parsed).length > 0;
  } catch {
    return false;
  }
}

export function extractGitUrlAndBranch(message: string): { url: string; branch?: string } | null {
  const urlMatch = message.match(/https:\/\/[^\s)]+/i);
  if (!urlMatch) return null;

  const candidate = urlMatch[0].replace(URL_TRAILING_WRAPPER_RE, '');
  const url = toCloneSafeHttpsUrl(candidate);
  if (!url || !isPublicGitUrl(url)) return null;

  const branchMatch = message.match(BRANCH_RE);
  const rawBranch = branchMatch?.[1];
  const branch =
    rawBranch !== undefined ? rawBranch.replace(BRANCH_TRAILING_JUNK_RE, '') : undefined;

  return {
    url,
    ...(branch !== undefined && branch.length > 0 ? { branch } : {}),
  };
}
