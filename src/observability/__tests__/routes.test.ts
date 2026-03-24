import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPoolQuery = vi.fn();

vi.mock('../../db/pool', () => ({
  getPool: () => ({ query: mockPoolQuery }),
}));

vi.mock('../../config', () => ({
  config: {
    databaseUrl: 'postgres://localhost:5432/test',
  },
}));

const mockMetricsSnapshot = vi.fn();

vi.mock('../metrics', () => ({
  getMetrics: () => ({
    snapshot: mockMetricsSnapshot,
  }),
}));

import { observabilityRoutes } from '../routes';

function findRoute(path: string, method = 'GET') {
  return observabilityRoutes.find((r) => r.path === path && r.method === method);
}

function mockHonoContext(overrides?: { status?: number }) {
  const responseHeaders = new Map<string, string>();
  let responseBody: any = null;
  let responseStatus = overrides?.status ?? 200;

  return {
    json: (data: any, status?: number) => {
      responseBody = data;
      if (status !== undefined) responseStatus = status;
      return new Response(JSON.stringify(data), { status: responseStatus });
    },
    header: (name: string, value: string) => responseHeaders.set(name, value),
    _getBody: () => responseBody,
    _getStatus: () => responseStatus,
    _getHeaders: () => responseHeaders,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('observability routes — structure', () => {
  it('exposes /healthz, /readyz, and /metrics', () => {
    expect(findRoute('/healthz')).toBeDefined();
    expect(findRoute('/readyz')).toBeDefined();
    expect(findRoute('/metrics')).toBeDefined();
  });

  it('all routes are GET', () => {
    for (const route of observabilityRoutes) {
      expect(route.method).toBe('GET');
    }
  });

  it('all routes have createHandler functions', () => {
    for (const route of observabilityRoutes) {
      expect(typeof route.createHandler).toBe('function');
    }
  });
});

describe('/healthz', () => {
  it('returns status ok', async () => {
    const route = findRoute('/healthz')!;
    const handler = await route.createHandler({} as any);
    const ctx = mockHonoContext();
    const res = await handler(ctx as any);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  it('includes uptimeSeconds', async () => {
    const route = findRoute('/healthz')!;
    const handler = await route.createHandler({} as any);
    const ctx = mockHonoContext();
    const res = await handler(ctx as any);

    const body = await res.json();
    expect(typeof body.uptimeSeconds).toBe('number');
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('does not require database access', async () => {
    const route = findRoute('/healthz')!;
    const handler = await route.createHandler({} as any);
    await handler(mockHonoContext() as any);
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });
});

describe('/readyz', () => {
  it('returns ready when database is healthy', async () => {
    mockPoolQuery.mockResolvedValue({ rows: [{ '?column?': 1 }] });

    const route = findRoute('/readyz')!;
    const handler = await route.createHandler({} as any);
    const ctx = mockHonoContext();
    const res = await handler(ctx as any);

    const body = await res.json();
    expect(body.status).toBe('ready');
    expect(body.checks.database.ok).toBe(true);
    expect(typeof body.checks.database.latencyMs).toBe('number');
  });

  it('returns 503 when database is down', async () => {
    mockPoolQuery.mockRejectedValue(new Error('connection refused'));

    const route = findRoute('/readyz')!;
    const handler = await route.createHandler({} as any);
    const ctx = mockHonoContext();
    const res = await handler(ctx as any);

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('not_ready');
    expect(body.checks.database.ok).toBe(false);
    expect(body.checks.database.error).toBe('connection refused');
  });

  it('includes latency even on failure', async () => {
    mockPoolQuery.mockRejectedValue(new Error('timeout'));

    const route = findRoute('/readyz')!;
    const handler = await route.createHandler({} as any);
    const ctx = mockHonoContext();
    const res = await handler(ctx as any);

    const body = await res.json();
    expect(typeof body.checks.database.latencyMs).toBe('number');
  });
});

describe('/metrics', () => {
  it('returns metrics snapshot', async () => {
    const fakeSnapshot = {
      uptimeSeconds: 120,
      activeRequests: 5,
      totalRequests: 1000,
      totalErrors: 10,
      errorRate: 0.01,
      statusClasses: { '2xx': 980, '5xx': 10, '4xx': 10 },
      routes: [],
    };
    mockMetricsSnapshot.mockReturnValue(fakeSnapshot);

    const route = findRoute('/metrics')!;
    const handler = await route.createHandler({} as any);
    const ctx = mockHonoContext();
    const res = await handler(ctx as any);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.uptimeSeconds).toBe(120);
    expect(body.activeRequests).toBe(5);
    expect(body.totalRequests).toBe(1000);
    expect(body.totalErrors).toBe(10);
    expect(body.errorRate).toBe(0.01);
    expect(body.statusClasses['2xx']).toBe(980);
  });

  it('includes route-level stats', async () => {
    mockMetricsSnapshot.mockReturnValue({
      uptimeSeconds: 60,
      activeRequests: 0,
      totalRequests: 50,
      totalErrors: 5,
      errorRate: 0.1,
      statusClasses: { '2xx': 45, '5xx': 5 },
      routes: [
        {
          method: 'GET',
          route: '/api/test',
          count: 50,
          errorCount: 5,
          errorRate: 0.1,
          latencyMs: { avg: 120, p50: 100, p95: 500, p99: 1000 },
        },
      ],
    });

    const route = findRoute('/metrics')!;
    const handler = await route.createHandler({} as any);
    const ctx = mockHonoContext();
    const res = await handler(ctx as any);

    const body = await res.json();
    expect(body.routes).toHaveLength(1);
    expect(body.routes[0].latencyMs.p95).toBe(500);
  });
});

describe('observability routes — edge cases', () => {
  it('/readyz handles non-Error exceptions from pool', async () => {
    mockPoolQuery.mockRejectedValue('string error');

    const route = findRoute('/readyz')!;
    const handler = await route.createHandler({} as any);
    const ctx = mockHonoContext();
    const res = await handler(ctx as any);

    const body = await res.json();
    expect(body.status).toBe('not_ready');
    expect(body.checks.database.error).toBe('string error');
  });

  it('/readyz handles slow database', async () => {
    mockPoolQuery.mockImplementation(() =>
      new Promise((resolve) => setTimeout(() => resolve({ rows: [] }), 50)),
    );

    const route = findRoute('/readyz')!;
    const handler = await route.createHandler({} as any);
    const ctx = mockHonoContext();
    const res = await handler(ctx as any);

    const body = await res.json();
    expect(body.checks.database.ok).toBe(true);
    expect(body.checks.database.latencyMs).toBeGreaterThanOrEqual(40);
  });

  it('/metrics returns empty routes array when no traffic', async () => {
    mockMetricsSnapshot.mockReturnValue({
      uptimeSeconds: 0,
      activeRequests: 0,
      totalRequests: 0,
      totalErrors: 0,
      errorRate: 0,
      statusClasses: {},
      routes: [],
    });

    const route = findRoute('/metrics')!;
    const handler = await route.createHandler({} as any);
    const ctx = mockHonoContext();
    const res = await handler(ctx as any);

    const body = await res.json();
    expect(body.routes).toEqual([]);
    expect(body.totalRequests).toBe(0);
  });
});

describe('observability routes — security', () => {
  it('/healthz does not leak sensitive info', async () => {
    const route = findRoute('/healthz')!;
    const handler = await route.createHandler({} as any);
    const res = await handler(mockHonoContext() as any);
    const body = await res.json();

    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain('password');
    expect(bodyStr).not.toContain('DATABASE_URL');
    expect(bodyStr).not.toContain('secret');
  });

  it('/readyz does not leak connection string on error', async () => {
    mockPoolQuery.mockRejectedValue(new Error('connection refused'));

    const route = findRoute('/readyz')!;
    const handler = await route.createHandler({} as any);
    const res = await handler(mockHonoContext() as any);
    const body = await res.json();

    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain('postgres://');
    expect(bodyStr).not.toContain('DATABASE_URL');
  });
});

describe('observability routes — performance', () => {
  it('/healthz handles 1000 requests quickly', async () => {
    const route = findRoute('/healthz')!;
    const handler = await route.createHandler({} as any);

    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      await handler(mockHonoContext() as any);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(1000);
  });
});
