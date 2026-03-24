import { MemoryCacheStore, MemoryCacheStoreFactory } from '../../cache';
import type { CacheStore } from '../../cache';

export function makeContext(overrides?: {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  requestContext?: Map<string, any>;
}) {
  const setHeaders = new Map<string, string>();
  const reqHeaders = new Map<string, string>(
    Object.entries(overrides?.headers ?? {}),
  );
  const requestContext = overrides?.requestContext ?? new Map<string, any>();

  return {
    req: {
      url: overrides?.url ?? 'http://localhost:3000/api/test',
      method: overrides?.method ?? 'GET',
      raw: new Request(overrides?.url ?? 'http://localhost:3000/api/test', {
        method: overrides?.method ?? 'GET',
      }),
      header: (name: string) => reqHeaders.get(name) ?? reqHeaders.get(name.toLowerCase()),
    },
    header: (name: string, value: string) => setHeaders.set(name, value),
    get: (key: string) => {
      if (key === 'requestContext') return requestContext;
      return undefined;
    },
    res: { status: 200 },
    _setHeaders: setHeaders,
    _requestContext: requestContext,
  };
}

export function makeContextWithBody(
  url: string,
  method: string,
  body: unknown,
  headers?: Record<string, string>,
) {
  const ctx = makeContext({ url, method, headers });
  ctx.req.raw = new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return ctx;
}

export function nextOk(): () => Promise<void> {
  return async () => {};
}

export function nextSlow(ms: number): () => Promise<void> {
  return () => new Promise((resolve) => setTimeout(resolve, ms));
}

export function nextThrow(error: Error): () => Promise<void> {
  return async () => {
    throw error;
  };
}

export function nextStatus(ctx: ReturnType<typeof makeContext>, status: number): () => Promise<void> {
  return async () => {
    ctx.res.status = status;
  };
}

export function createTestCacheStore(): CacheStore {
  return new MemoryCacheStore();
}

export function createTestCacheFactory(): MemoryCacheStoreFactory {
  return new MemoryCacheStoreFactory();
}
