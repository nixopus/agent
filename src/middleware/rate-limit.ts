import { getCacheStoreFactory, type CacheStore } from '../cache';
import { RateLimitError, errorResponse } from '../errors';

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  authMaxRequests: number;
  authPaths: string[];
}

function getClientIp(req: { header: (name: string) => string | undefined }): string {
  return (
    req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.header('x-real-ip') ||
    req.header('cf-connecting-ip') ||
    'unknown'
  );
}

function isAuthPath(pathname: string, authPaths: string[]): boolean {
  return authPaths.some((p) => pathname.startsWith(p));
}

export function createRateLimiter(cfg: RateLimitConfig, store?: CacheStore) {
  const cacheStore = store ?? getCacheStoreFactory().create('rate_limit');

  return async (
    c: {
      req: { url: string; header: (name: string) => string | undefined };
      header: (name: string, value: string) => void;
    },
    next: () => Promise<void>,
  ): Promise<Response | void> => {
    const ip = getClientIp(c.req);
    const pathname = new URL(c.req.url).pathname;
    const isAuth = isAuthPath(pathname, cfg.authPaths);
    const limit = isAuth ? cfg.authMaxRequests : cfg.maxRequests;
    const storeKey = `${ip}:${isAuth ? 'auth' : 'global'}`;

    const { count, resetAt } = await cacheStore.atomicIncrement(storeKey, cfg.windowMs);

    const remaining = Math.max(0, limit - count);
    const retryAfterSec = Math.ceil((resetAt - Date.now()) / 1000);

    c.header('X-RateLimit-Limit', String(limit));
    c.header('X-RateLimit-Remaining', String(remaining));
    c.header('X-RateLimit-Reset', String(Math.ceil(resetAt / 1000)));

    if (count > limit) {
      c.header('Retry-After', String(retryAfterSec));
      return errorResponse(new RateLimitError('Too many requests', retryAfterSec));
    }

    await next();
  };
}
