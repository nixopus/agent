import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeContext, nextOk, nextSlow, nextThrow, nextStatus } from './helpers';

const mockMetrics = {
  enter: vi.fn(),
  exit: vi.fn(),
  record: vi.fn(),
};

vi.mock('../../observability/metrics', () => ({
  getMetrics: () => mockMetrics,
}));

vi.mock('../../logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { createRequestTracing } from '../request-tracing';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('request-tracing — normal flows', () => {
  it('sets X-Request-Id header on response', async () => {
    const mw = createRequestTracing();
    const ctx = makeContext();
    await mw(ctx, nextOk());
    expect(ctx._setHeaders.get('X-Request-Id')).toBeDefined();
  });

  it('uses request-provided x-request-id when available', async () => {
    const mw = createRequestTracing();
    const ctx = makeContext({ headers: { 'x-request-id': 'custom-id-123' } });
    await mw(ctx, nextOk());
    expect(ctx._setHeaders.get('X-Request-Id')).toBe('custom-id-123');
  });

  it('generates UUID when no x-request-id provided', async () => {
    const mw = createRequestTracing();
    const ctx = makeContext();
    await mw(ctx, nextOk());
    const id = ctx._setHeaders.get('X-Request-Id')!;
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('calls next() for tracked paths', async () => {
    const mw = createRequestTracing();
    const ctx = makeContext({ url: 'http://localhost:3000/api/agents/run' });
    let called = false;
    await mw(ctx, async () => { called = true; });
    expect(called).toBe(true);
  });

  it('records metrics for normal requests', async () => {
    const mw = createRequestTracing();
    const ctx = makeContext({ url: 'http://localhost:3000/api/agents/run', method: 'POST' });
    await mw(ctx, nextOk());

    expect(mockMetrics.record).toHaveBeenCalledWith(
      'POST',
      '/api/agents/run',
      200,
      expect.any(Number),
    );
  });

  it('increments and decrements active request count', async () => {
    const mw = createRequestTracing();
    const ctx = makeContext({ url: 'http://localhost:3000/api/test' });
    await mw(ctx, nextOk());
    expect(mockMetrics.enter).toHaveBeenCalledTimes(1);
    expect(mockMetrics.exit).toHaveBeenCalledTimes(1);
  });
});

describe('request-tracing — skip paths', () => {
  it('skips tracing for /healthz', async () => {
    const mw = createRequestTracing();
    const ctx = makeContext({ url: 'http://localhost:3000/healthz' });
    await mw(ctx, nextOk());
    expect(mockMetrics.enter).not.toHaveBeenCalled();
    expect(mockMetrics.record).not.toHaveBeenCalled();
  });

  it('skips tracing for /readyz', async () => {
    const mw = createRequestTracing();
    const ctx = makeContext({ url: 'http://localhost:3000/readyz' });
    await mw(ctx, nextOk());
    expect(mockMetrics.enter).not.toHaveBeenCalled();
  });

  it('skips tracing for /metrics', async () => {
    const mw = createRequestTracing();
    const ctx = makeContext({ url: 'http://localhost:3000/metrics' });
    await mw(ctx, nextOk());
    expect(mockMetrics.enter).not.toHaveBeenCalled();
  });

  it('still sets X-Request-Id for skipped paths', async () => {
    const mw = createRequestTracing();
    const ctx = makeContext({ url: 'http://localhost:3000/healthz' });
    await mw(ctx, nextOk());
    expect(ctx._setHeaders.get('X-Request-Id')).toBeDefined();
  });

  it('still calls next() for skipped paths', async () => {
    const mw = createRequestTracing();
    const ctx = makeContext({ url: 'http://localhost:3000/healthz' });
    let called = false;
    await mw(ctx, async () => { called = true; });
    expect(called).toBe(true);
  });
});

describe('request-tracing — error handling', () => {
  it('records 500 status when next() throws', async () => {
    const mw = createRequestTracing();
    const ctx = makeContext({ url: 'http://localhost:3000/api/test' });

    await expect(mw(ctx, nextThrow(new Error('boom')))).rejects.toThrow('boom');

    expect(mockMetrics.record).toHaveBeenCalledWith(
      'GET',
      '/api/test',
      500,
      expect.any(Number),
    );
  });

  it('calls metrics.exit even when next() throws', async () => {
    const mw = createRequestTracing();
    const ctx = makeContext({ url: 'http://localhost:3000/api/test' });

    await expect(mw(ctx, nextThrow(new Error('fail')))).rejects.toThrow();
    expect(mockMetrics.exit).toHaveBeenCalledTimes(1);
  });

  it('re-throws the original error', async () => {
    const mw = createRequestTracing();
    const ctx = makeContext({ url: 'http://localhost:3000/api/test' });
    const original = new Error('specific error');

    await expect(mw(ctx, nextThrow(original))).rejects.toBe(original);
  });
});

describe('request-tracing — status codes', () => {
  it('records 4xx status codes', async () => {
    const mw = createRequestTracing();
    const ctx = makeContext({ url: 'http://localhost:3000/api/test' });
    await mw(ctx, nextStatus(ctx, 404));

    expect(mockMetrics.record).toHaveBeenCalledWith('GET', '/api/test', 404, expect.any(Number));
  });

  it('records 5xx status codes', async () => {
    const mw = createRequestTracing();
    const ctx = makeContext({ url: 'http://localhost:3000/api/test' });
    await mw(ctx, nextStatus(ctx, 503));

    expect(mockMetrics.record).toHaveBeenCalledWith('GET', '/api/test', 503, expect.any(Number));
  });
});

describe('request-tracing — performance', () => {
  it('traces 10,000 requests without significant overhead', async () => {
    const mw = createRequestTracing();
    const start = performance.now();

    for (let i = 0; i < 10_000; i++) {
      const ctx = makeContext({
        url: `http://localhost:3000/api/route-${i % 50}`,
        method: i % 2 === 0 ? 'GET' : 'POST',
      });
      await mw(ctx, nextOk());
    }

    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(3000);
    expect(mockMetrics.record).toHaveBeenCalledTimes(10_000);
  });
});

describe('request-tracing — edge cases', () => {
  it('handles URL with query parameters', async () => {
    const mw = createRequestTracing();
    const ctx = makeContext({ url: 'http://localhost:3000/api/test?foo=bar&baz=1' });
    await mw(ctx, nextOk());

    expect(mockMetrics.record).toHaveBeenCalledWith('GET', '/api/test', 200, expect.any(Number));
  });

  it('handles URL with hash fragment', async () => {
    const mw = createRequestTracing();
    const ctx = makeContext({ url: 'http://localhost:3000/api/test#section' });
    await mw(ctx, nextOk());

    expect(mockMetrics.record).toHaveBeenCalledWith('GET', '/api/test', 200, expect.any(Number));
  });

  it('unique request IDs across multiple requests', async () => {
    const mw = createRequestTracing();
    const ids = new Set<string>();

    for (let i = 0; i < 100; i++) {
      const ctx = makeContext();
      await mw(ctx, nextOk());
      ids.add(ctx._setHeaders.get('X-Request-Id')!);
    }

    expect(ids.size).toBe(100);
  });

  it('handles OPTIONS method', async () => {
    const mw = createRequestTracing();
    const ctx = makeContext({ url: 'http://localhost:3000/api/test', method: 'OPTIONS' });
    await mw(ctx, nextOk());

    expect(mockMetrics.record).toHaveBeenCalledWith('OPTIONS', '/api/test', 200, expect.any(Number));
  });
});
