import { createSign, createPrivateKey } from 'crypto';
import { ExternalServiceError } from '../errors';
import { getCacheStoreFactory, type CacheStore } from '../cache';

const GITHUB_API = 'https://api.github.com';
const TOKEN_TTL_MS = 55 * 60 * 1000;

let tokenStore: CacheStore | null = null;

function getTokenStore(): CacheStore {
  if (!tokenStore) tokenStore = getCacheStoreFactory().create('github_tokens');
  return tokenStore;
}

function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function createJwt(appId: string, pem: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({ iat: now - 60, exp: now + 600, iss: appId }),
  );
  const unsigned = `${header}.${payload}`;
  const key = createPrivateKey(pem);
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  const signature = base64url(signer.sign(key));
  return `${unsigned}.${signature}`;
}

export async function getInstallationToken(
  appId: string,
  pem: string,
  installationId: string,
): Promise<string> {
  const cacheKey = `${appId}:${installationId}`;
  const cached = await getTokenStore().get<string>(cacheKey);
  if (cached) return cached;

  const jwt = createJwt(appId, pem);
  const res = await fetch(
    `${GITHUB_API}/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ExternalServiceError('github', `GitHub token exchange failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { token: string };
  void getTokenStore().set(cacheKey, data.token, TOKEN_TTL_MS);
  return data.token;
}

interface GitHubFetchOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
}

export async function githubFetch<T = unknown>(
  token: string,
  path: string,
  options?: GitHubFetchOptions,
): Promise<T> {
  const { method = 'GET', body, query } = options ?? {};

  let url = `${GITHUB_API}${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const headers: Record<string, string> = {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (body) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ExternalServiceError('github', `GitHub API ${method} ${path} failed (${res.status}): ${text.slice(0, 300)}`);
  }

  if (res.status === 204) return {} as T;
  return (await res.json()) as T;
}
