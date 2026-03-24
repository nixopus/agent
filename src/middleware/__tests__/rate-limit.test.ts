import { describe, it, expect, beforeEach } from 'vitest';
import { createRateLimiter } from '../rate-limit';
import { MemoryCacheStore } from '../../cache';
import { makeContext, nextOk } from './helpers';

const DEFAULT_CFG = {
  windowMs: 60_000,
  maxRequests: 100,
  authMaxRequests: 10,
  authPaths: ['/api/auth/'],
};

function freshLimiter(overrides?: Partial<typeof DEFAULT_CFG>) {
  const store = new MemoryCacheStore();
  const cfg = { ...DEFAULT_CFG, ...overrides };
  return { mw: createRateLimiter(cfg, store), store, cfg };
}

describe('rate-limit — normal flows', () => {
  it('allows requests under the limit', async () => {
    const { mw } = freshLimiter();
    const ctx = makeContext({ headers: { 'x-forwarded-for': '1.2.3.4' } });
    const result = await mw(ctx, nextOk());
    expect(result).toBeUndefined();
  });

  it('sets rate limit headers on every response', async () => {
    const { mw } = freshLimiter({ maxRequests: 50 });
    const ctx = makeContext({ headers: { 'x-forwarded-for': '1.2.3.4' } });
    await mw(ctx, nextOk());

    expect(ctx._setHeaders.get('X-RateLimit-Limit')).toBe('50');
    expect(ctx._setHeaders.get('X-RateLimit-Remaining')).toBeDefined();
    expect(ctx._setHeaders.get('X-RateLimit-Reset')).toBeDefined();
  });

  it('decrements remaining count on successive requests', async () => {
    const { mw } = freshLimiter({ maxRequests: 5 });
    const ip = '10.0.0.1';

    for (let i = 0; i < 3; i++) {
      const ctx = makeContext({ headers: { 'x-forwarded-for': ip } });
      await mw(ctx, nextOk());
    }

    const ctx = makeContext({ headers: { 'x-forwarded-for': ip } });
    await mw(ctx, nextOk());
    expect(Number(ctx._setHeaders.get('X-RateLimit-Remaining'))).toBe(1);
  });

  it('uses lower limit for auth paths', async () => {
    const { mw } = freshLimiter({ authMaxRequests: 3 });
    const ctx = makeContext({
      url: 'http://localhost:3000/api/auth/login',
      headers: { 'x-forwarded-for': '1.2.3.4' },
    });
    await mw(ctx, nextOk());
    expect(ctx._setHeaders.get('X-RateLimit-Limit')).toBe('3');
  });

  it('uses higher limit for non-auth paths', async () => {
    const { mw } = freshLimiter({ maxRequests: 100, authMaxRequests: 3 });
    const ctx = makeContext({
      url: 'http://localhost:3000/api/agents/run',
      headers: { 'x-forwarded-for': '1.2.3.4' },
    });
    await mw(ctx, nextOk());
    expect(ctx._setHeaders.get('X-RateLimit-Limit')).toBe('100');
  });

  it('calls next() when under limit', async () => {
    const { mw } = freshLimiter();
    let called = false;
    const ctx = makeContext({ headers: { 'x-forwarded-for': '1.2.3.4' } });
    await mw(ctx, async () => { called = true; });
    expect(called).toBe(true);
  });
});

describe('rate-limit — blocking', () => {
  it('returns 429 when limit exceeded', async () => {
    const { mw } = freshLimiter({ maxRequests: 2 });
    const ip = '10.0.0.2';

    for (let i = 0; i < 2; i++) {
      const ctx = makeContext({ headers: { 'x-forwarded-for': ip } });
      await mw(ctx, nextOk());
    }

    const ctx = makeContext({ headers: { 'x-forwarded-for': ip } });
    const response = await mw(ctx, nextOk());
    expect(response).toBeInstanceOf(Response);
    expect(response!.status).toBe(429);
  });

  it('includes Retry-After header when blocked', async () => {
    const { mw } = freshLimiter({ maxRequests: 1 });
    const ip = '10.0.0.3';

    const ctx1 = makeContext({ headers: { 'x-forwarded-for': ip } });
    await mw(ctx1, nextOk());

    const ctx2 = makeContext({ headers: { 'x-forwarded-for': ip } });
    await mw(ctx2, nextOk());

    expect(ctx2._setHeaders.get('Retry-After')).toBeDefined();
    expect(Number(ctx2._setHeaders.get('Retry-After'))).toBeGreaterThan(0);
  });

  it('returns RATE_LIMITED error code in body', async () => {
    const { mw } = freshLimiter({ maxRequests: 1 });
    const ip = '10.0.0.4';

    const ctx1 = makeContext({ headers: { 'x-forwarded-for': ip } });
    await mw(ctx1, nextOk());

    const ctx2 = makeContext({ headers: { 'x-forwarded-for': ip } });
    const response = await mw(ctx2, nextOk());
    const body = await response!.json();
    expect(body.error).toBe('RATE_LIMITED');
  });

  it('does not call next() when blocked', async () => {
    const { mw } = freshLimiter({ maxRequests: 1 });
    const ip = '10.0.0.5';

    const ctx1 = makeContext({ headers: { 'x-forwarded-for': ip } });
    await mw(ctx1, nextOk());

    let called = false;
    const ctx2 = makeContext({ headers: { 'x-forwarded-for': ip } });
    await mw(ctx2, async () => { called = true; });
    expect(called).toBe(false);
  });
});

describe('rate-limit — IP extraction', () => {
  it('uses x-forwarded-for header', async () => {
    const { mw } = freshLimiter({ maxRequests: 1 });
    const ctx1 = makeContext({ headers: { 'x-forwarded-for': '1.1.1.1' } });
    const ctx2 = makeContext({ headers: { 'x-forwarded-for': '2.2.2.2' } });
    await mw(ctx1, nextOk());
    const result = await mw(ctx2, nextOk());
    expect(result).toBeUndefined();
  });

  it('takes first IP from x-forwarded-for chain', async () => {
    const { mw } = freshLimiter({ maxRequests: 1 });
    const ctx1 = makeContext({ headers: { 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 3.3.3.3' } });
    await mw(ctx1, nextOk());

    const ctx2 = makeContext({ headers: { 'x-forwarded-for': '1.1.1.1' } });
    const result = await mw(ctx2, nextOk());
    expect(result).toBeInstanceOf(Response);
  });

  it('falls back to x-real-ip', async () => {
    const { mw } = freshLimiter({ maxRequests: 1 });
    const ctx1 = makeContext({ headers: { 'x-real-ip': '5.5.5.5' } });
    await mw(ctx1, nextOk());

    const ctx2 = makeContext({ headers: { 'x-real-ip': '5.5.5.5' } });
    const result = await mw(ctx2, nextOk());
    expect(result).toBeInstanceOf(Response);
  });

  it('falls back to cf-connecting-ip', async () => {
    const { mw } = freshLimiter({ maxRequests: 1 });
    const ctx1 = makeContext({ headers: { 'cf-connecting-ip': '6.6.6.6' } });
    await mw(ctx1, nextOk());

    const ctx2 = makeContext({ headers: { 'cf-connecting-ip': '6.6.6.6' } });
    const result = await mw(ctx2, nextOk());
    expect(result).toBeInstanceOf(Response);
  });

  it('treats missing IP headers as "unknown" (shared bucket)', async () => {
    const { mw } = freshLimiter({ maxRequests: 1 });
    const ctx1 = makeContext();
    await mw(ctx1, nextOk());

    const ctx2 = makeContext();
    const result = await mw(ctx2, nextOk());
    expect(result).toBeInstanceOf(Response);
  });
});

describe('rate-limit — isolation', () => {
  it('different IPs have independent counters', async () => {
    const { mw } = freshLimiter({ maxRequests: 2 });

    for (let i = 0; i < 2; i++) {
      await mw(makeContext({ headers: { 'x-forwarded-for': '10.0.0.1' } }), nextOk());
    }

    const ctx = makeContext({ headers: { 'x-forwarded-for': '10.0.0.2' } });
    const result = await mw(ctx, nextOk());
    expect(result).toBeUndefined();
  });

  it('auth and global paths have separate counters for same IP', async () => {
    const { mw } = freshLimiter({ maxRequests: 100, authMaxRequests: 1 });
    const ip = '10.0.0.10';

    const authCtx = makeContext({
      url: 'http://localhost:3000/api/auth/login',
      headers: { 'x-forwarded-for': ip },
    });
    await mw(authCtx, nextOk());

    const authCtx2 = makeContext({
      url: 'http://localhost:3000/api/auth/login',
      headers: { 'x-forwarded-for': ip },
    });
    const authResult = await mw(authCtx2, nextOk());
    expect(authResult).toBeInstanceOf(Response);

    const globalCtx = makeContext({
      url: 'http://localhost:3000/api/agents/run',
      headers: { 'x-forwarded-for': ip },
    });
    const globalResult = await mw(globalCtx, nextOk());
    expect(globalResult).toBeUndefined();
  });
});

describe('rate-limit — scale', () => {
  it('handles 1000 unique IPs without issues', async () => {
    const { mw } = freshLimiter({ maxRequests: 5 });

    for (let i = 0; i < 1000; i++) {
      const ip = `10.${Math.floor(i / 256) % 256}.${i % 256}.1`;
      const ctx = makeContext({ headers: { 'x-forwarded-for': ip } });
      const result = await mw(ctx, nextOk());
      expect(result).toBeUndefined();
    }
  });

  it('processes 5000 requests from single IP with correct blocking', async () => {
    const { mw } = freshLimiter({ maxRequests: 100 });
    const ip = '10.0.0.99';
    let blocked = 0;
    let allowed = 0;

    for (let i = 0; i < 5000; i++) {
      const ctx = makeContext({ headers: { 'x-forwarded-for': ip } });
      const result = await mw(ctx, nextOk());
      if (result instanceof Response) blocked++;
      else allowed++;
    }

    expect(allowed).toBe(100);
    expect(blocked).toBe(4900);
  });
});

describe('rate-limit — performance', () => {
  it('processes 10,000 rate limit checks in under 2 seconds', async () => {
    const { mw } = freshLimiter({ maxRequests: 100_000 });
    const start = performance.now();

    for (let i = 0; i < 10_000; i++) {
      const ctx = makeContext({ headers: { 'x-forwarded-for': `10.0.${Math.floor(i / 256) % 256}.${i % 256}` } });
      await mw(ctx, nextOk());
    }

    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(2000);
  });
});

describe('rate-limit — edge cases', () => {
  it('maxRequests of 0 blocks all requests', async () => {
    const { mw } = freshLimiter({ maxRequests: 0 });
    const ctx = makeContext({ headers: { 'x-forwarded-for': '1.1.1.1' } });
    const result = await mw(ctx, nextOk());
    expect(result).toBeInstanceOf(Response);
  });

  it('remaining count never goes negative', async () => {
    const { mw } = freshLimiter({ maxRequests: 1 });
    const ip = '10.0.0.50';

    for (let i = 0; i < 5; i++) {
      const ctx = makeContext({ headers: { 'x-forwarded-for': ip } });
      await mw(ctx, nextOk());
      const remaining = Number(ctx._setHeaders.get('X-RateLimit-Remaining'));
      expect(remaining).toBeGreaterThanOrEqual(0);
    }
  });

  it('reset timestamp is in the future', async () => {
    const { mw } = freshLimiter({ windowMs: 60_000 });
    const ctx = makeContext({ headers: { 'x-forwarded-for': '1.2.3.4' } });
    await mw(ctx, nextOk());

    const resetEpochSec = Number(ctx._setHeaders.get('X-RateLimit-Reset'));
    expect(resetEpochSec).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('IPv6 address is handled as key', async () => {
    const { mw } = freshLimiter({ maxRequests: 1 });
    const ipv6 = '2001:0db8:85a3:0000:0000:8a2e:0370:7334';
    const ctx = makeContext({ headers: { 'x-forwarded-for': ipv6 } });
    const result = await mw(ctx, nextOk());
    expect(result).toBeUndefined();
  });

  it('very long IP string does not crash', async () => {
    const { mw } = freshLimiter();
    const longIp = 'a'.repeat(10_000);
    const ctx = makeContext({ headers: { 'x-forwarded-for': longIp } });
    const result = await mw(ctx, nextOk());
    expect(result).toBeUndefined();
  });
});
