import { describe, it, expect, beforeEach } from 'vitest';
import { getMetrics } from '../metrics';
import type { MetricsSnapshot, RouteSnapshot } from '../metrics';

function collector() {
  const m = getMetrics();
  m.reset();
  return m;
}

describe('metrics — normal flows', () => {
  it('starts with zero counts', () => {
    const m = collector();
    const snap = m.snapshot();
    expect(snap.totalRequests).toBe(0);
    expect(snap.totalErrors).toBe(0);
    expect(snap.activeRequests).toBe(0);
    expect(snap.errorRate).toBe(0);
    expect(snap.routes).toEqual([]);
  });

  it('records a single request', () => {
    const m = collector();
    m.record('GET', '/api/test', 200, 50);
    const snap = m.snapshot();

    expect(snap.totalRequests).toBe(1);
    expect(snap.totalErrors).toBe(0);
    expect(snap.routes).toHaveLength(1);
    expect(snap.routes[0].method).toBe('GET');
    expect(snap.routes[0].route).toBe('/api/test');
    expect(snap.routes[0].count).toBe(1);
  });

  it('records multiple requests to the same route', () => {
    const m = collector();
    m.record('GET', '/api/users', 200, 10);
    m.record('GET', '/api/users', 200, 20);
    m.record('GET', '/api/users', 200, 30);

    const snap = m.snapshot();
    expect(snap.totalRequests).toBe(3);
    expect(snap.routes[0].count).toBe(3);
    expect(snap.routes[0].latencyMs.avg).toBe(20);
  });

  it('tracks different routes separately', () => {
    const m = collector();
    m.record('GET', '/api/users', 200, 10);
    m.record('POST', '/api/users', 201, 50);
    m.record('GET', '/api/posts', 200, 30);

    const snap = m.snapshot();
    expect(snap.routes).toHaveLength(3);
    expect(snap.totalRequests).toBe(3);
  });

  it('counts 5xx as errors', () => {
    const m = collector();
    m.record('GET', '/api/test', 500, 100);
    m.record('GET', '/api/test', 502, 200);
    m.record('GET', '/api/test', 503, 50);
    m.record('GET', '/api/test', 200, 10);

    const snap = m.snapshot();
    expect(snap.totalErrors).toBe(3);
    expect(snap.routes[0].errorCount).toBe(3);
    expect(snap.routes[0].errorRate).toBe(0.75);
  });

  it('does not count 4xx as errors', () => {
    const m = collector();
    m.record('GET', '/api/test', 400, 10);
    m.record('GET', '/api/test', 404, 10);
    m.record('GET', '/api/test', 429, 10);

    const snap = m.snapshot();
    expect(snap.totalErrors).toBe(0);
    expect(snap.routes[0].errorCount).toBe(0);
  });

  it('tracks status classes', () => {
    const m = collector();
    m.record('GET', '/a', 200, 10);
    m.record('GET', '/b', 201, 10);
    m.record('GET', '/c', 301, 10);
    m.record('GET', '/d', 404, 10);
    m.record('GET', '/e', 500, 10);

    const snap = m.snapshot();
    expect(snap.statusClasses['2xx']).toBe(2);
    expect(snap.statusClasses['3xx']).toBe(1);
    expect(snap.statusClasses['4xx']).toBe(1);
    expect(snap.statusClasses['5xx']).toBe(1);
  });

  it('sorts routes by count descending', () => {
    const m = collector();
    m.record('GET', '/low', 200, 10);
    for (let i = 0; i < 5; i++) m.record('GET', '/high', 200, 10);
    for (let i = 0; i < 3; i++) m.record('GET', '/mid', 200, 10);

    const snap = m.snapshot();
    expect(snap.routes[0].route).toBe('/high');
    expect(snap.routes[1].route).toBe('/mid');
    expect(snap.routes[2].route).toBe('/low');
  });
});

describe('metrics — active requests', () => {
  it('increments on enter', () => {
    const m = collector();
    const base = m.snapshot().activeRequests;
    m.enter();
    expect(m.snapshot().activeRequests).toBe(base + 1);
    m.enter();
    expect(m.snapshot().activeRequests).toBe(base + 2);
    m.exit();
    m.exit();
  });

  it('decrements on exit', () => {
    const m = collector();
    const base = m.snapshot().activeRequests;
    m.enter();
    m.enter();
    m.exit();
    expect(m.snapshot().activeRequests).toBe(base + 1);
    m.exit();
  });

  it('never goes below zero', () => {
    const m = collector();
    const base = m.snapshot().activeRequests;
    for (let i = 0; i < base + 5; i++) m.exit();
    expect(m.snapshot().activeRequests).toBe(0);
  });

  it('tracks concurrent enter/exit cycles', () => {
    const m = collector();
    const base = m.snapshot().activeRequests;
    for (let i = 0; i < 100; i++) m.enter();
    for (let i = 0; i < 100; i++) m.exit();
    expect(m.snapshot().activeRequests).toBe(base);
  });
});

describe('metrics — route normalization', () => {
  it('normalizes UUID segments to :id', () => {
    const m = collector();
    m.record('GET', '/api/users/550e8400-e29b-41d4-a716-446655440000', 200, 10);
    const snap = m.snapshot();
    expect(snap.routes[0].route).toBe('/api/users/:id');
  });

  it('normalizes numeric segments to :id', () => {
    const m = collector();
    m.record('GET', '/api/posts/12345', 200, 10);
    expect(m.snapshot().routes[0].route).toBe('/api/posts/:id');
  });

  it('normalizes prefixed IDs (thread_, run_, etc) to :id', () => {
    const m = collector();
    m.record('GET', '/api/threads/thread_abc123', 200, 10);
    m.record('GET', '/api/runs/run_xyz-456', 200, 10);
    m.record('GET', '/api/messages/msg_hello', 200, 10);
    m.record('GET', '/api/steps/step_001', 200, 10);
    m.record('GET', '/api/workflows/wf_test', 200, 10);
    m.record('GET', '/api/orgs/org_myorg', 200, 10);
    m.record('GET', '/api/users/usr_u1', 200, 10);
    m.record('GET', '/api/memory/mem_slot', 200, 10);
    m.record('GET', '/api/snapshots/snap_v1', 200, 10);

    const snap = m.snapshot();
    for (const route of snap.routes) {
      expect(route.route).toMatch(/:id$/);
    }
  });

  it('groups different IDs on same route together', () => {
    const m = collector();
    m.record('GET', '/api/users/550e8400-e29b-41d4-a716-446655440000', 200, 10);
    m.record('GET', '/api/users/660e8400-e29b-41d4-a716-446655440001', 200, 20);
    m.record('GET', '/api/users/770e8400-e29b-41d4-a716-446655440002', 200, 30);

    const snap = m.snapshot();
    expect(snap.routes).toHaveLength(1);
    expect(snap.routes[0].count).toBe(3);
  });

  it('does not normalize non-ID text segments', () => {
    const m = collector();
    m.record('GET', '/api/agents/deploy-agent/stream', 200, 10);
    expect(m.snapshot().routes[0].route).toBe('/api/agents/deploy-agent/stream');
  });

  it('normalizes mixed path with multiple IDs', () => {
    const m = collector();
    m.record('GET', '/api/orgs/org_abc/runs/run_xyz/steps/42', 200, 10);
    expect(m.snapshot().routes[0].route).toBe('/api/orgs/:id/runs/:id/steps/:id');
  });

  it('preserves empty segments (double slashes)', () => {
    const m = collector();
    m.record('GET', '/api//test', 200, 10);
    expect(m.snapshot().routes[0].route).toBe('/api//test');
  });
});

describe('metrics — latency buckets', () => {
  it('calculates p50 correctly', () => {
    const m = collector();
    for (let i = 0; i < 100; i++) {
      m.record('GET', '/api/test', 200, i < 50 ? 5 : 200);
    }
    const snap = m.snapshot();
    expect(snap.routes[0].latencyMs.p50).toBeLessThanOrEqual(250);
  });

  it('calculates p95 correctly', () => {
    const m = collector();
    for (let i = 0; i < 100; i++) {
      m.record('GET', '/api/test', 200, i < 95 ? 10 : 5000);
    }
    const snap = m.snapshot();
    expect(snap.routes[0].latencyMs.p95).toBeGreaterThanOrEqual(10);
  });

  it('calculates p99 correctly', () => {
    const m = collector();
    for (let i = 0; i < 100; i++) {
      m.record('GET', '/api/test', 200, i < 99 ? 10 : 9000);
    }
    const snap = m.snapshot();
    expect(snap.routes[0].latencyMs.p99).toBeGreaterThanOrEqual(10);
  });

  it('returns 0 for empty buckets', () => {
    const m = collector();
    const snap = m.snapshot();
    expect(snap.routes).toHaveLength(0);
  });

  it('puts very fast requests in the first bucket', () => {
    const m = collector();
    m.record('GET', '/api/fast', 200, 1);
    expect(m.snapshot().routes[0].latencyMs.p50).toBe(10);
  });

  it('puts very slow requests in the overflow bucket', () => {
    const m = collector();
    m.record('GET', '/api/slow', 200, 99999);
    expect(m.snapshot().routes[0].latencyMs.p50).toBeGreaterThanOrEqual(10000);
  });

  it('average is calculated correctly with varying durations', () => {
    const m = collector();
    m.record('GET', '/api/avg', 200, 100);
    m.record('GET', '/api/avg', 200, 200);
    m.record('GET', '/api/avg', 200, 300);
    expect(m.snapshot().routes[0].latencyMs.avg).toBe(200);
  });
});

describe('metrics — error rate', () => {
  it('computes global error rate', () => {
    const m = collector();
    m.record('GET', '/a', 200, 10);
    m.record('GET', '/b', 500, 10);

    const snap = m.snapshot();
    expect(snap.errorRate).toBe(0.5);
  });

  it('computes per-route error rate', () => {
    const m = collector();
    m.record('GET', '/api/test', 200, 10);
    m.record('GET', '/api/test', 500, 10);
    m.record('GET', '/api/test', 200, 10);

    const snap = m.snapshot();
    const route = snap.routes[0];
    expect(route.errorRate).toBeCloseTo(0.3333, 3);
  });

  it('error rate is 0 when no errors', () => {
    const m = collector();
    m.record('GET', '/api/ok', 200, 10);
    m.record('GET', '/api/ok', 201, 10);

    expect(m.snapshot().errorRate).toBe(0);
    expect(m.snapshot().routes[0].errorRate).toBe(0);
  });

  it('error rate is 1 when all errors', () => {
    const m = collector();
    m.record('GET', '/api/bad', 500, 10);
    m.record('GET', '/api/bad', 502, 10);
    m.record('GET', '/api/bad', 503, 10);

    expect(m.snapshot().errorRate).toBe(1);
    expect(m.snapshot().routes[0].errorRate).toBe(1);
  });

  it('rounds error rate to 4 decimal places', () => {
    const m = collector();
    for (let i = 0; i < 3; i++) m.record('GET', '/api/x', 500, 10);
    for (let i = 0; i < 7; i++) m.record('GET', '/api/x', 200, 10);

    const snap = m.snapshot();
    const rateStr = String(snap.routes[0].errorRate);
    const decimals = rateStr.includes('.') ? rateStr.split('.')[1].length : 0;
    expect(decimals).toBeLessThanOrEqual(4);
  });
});

describe('metrics — reset', () => {
  it('clears all data on reset', () => {
    const m = collector();
    m.record('GET', '/api/test', 200, 10);
    m.enter();
    m.reset();

    const snap = m.snapshot();
    expect(snap.totalRequests).toBe(0);
    expect(snap.totalErrors).toBe(0);
    expect(snap.routes).toHaveLength(0);
    expect(Object.keys(snap.statusClasses)).toHaveLength(0);
  });

  it('does not reset active requests counter', () => {
    const m = collector();
    const base = m.snapshot().activeRequests;
    m.enter();
    m.reset();
    expect(m.snapshot().activeRequests).toBe(base + 1);
    m.exit();
  });

  it('can record after reset', () => {
    const m = collector();
    m.record('GET', '/api/test', 200, 10);
    m.reset();
    m.record('POST', '/api/other', 201, 20);

    const snap = m.snapshot();
    expect(snap.totalRequests).toBe(1);
    expect(snap.routes).toHaveLength(1);
    expect(snap.routes[0].method).toBe('POST');
  });
});

describe('metrics — uptime', () => {
  it('uptimeSeconds is a non-negative integer', () => {
    const m = collector();
    const snap = m.snapshot();
    expect(snap.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(snap.uptimeSeconds)).toBe(true);
  });
});

describe('metrics — scale', () => {
  it('handles 100,000 requests without issue', () => {
    const m = collector();

    for (let i = 0; i < 100_000; i++) {
      const route = `/api/route-${i % 50}`;
      const status = i % 100 === 0 ? 500 : 200;
      m.record('GET', route, status, i % 1000);
    }

    const snap = m.snapshot();
    expect(snap.totalRequests).toBe(100_000);
    expect(snap.totalErrors).toBe(1000);
    expect(snap.routes).toHaveLength(50);
  });

  it('caps tracked routes at MAX_TRACKED_ROUTES (500)', () => {
    const m = collector();

    for (let i = 0; i < 600; i++) {
      m.record('GET', `/unique-route-${i}`, 200, 10);
    }

    const snap = m.snapshot();
    expect(snap.routes.length).toBeLessThanOrEqual(500);
    expect(snap.totalRequests).toBe(500);
  });

  it('still records requests for existing routes after cap', () => {
    const m = collector();

    for (let i = 0; i < 500; i++) {
      m.record('GET', `/route-${i}`, 200, 10);
    }

    m.record('GET', '/route-0', 200, 10);
    m.record('GET', '/route-0', 200, 10);

    const snap = m.snapshot();
    const route0 = snap.routes.find((r) => r.route === '/route-0');
    expect(route0!.count).toBe(3);
  });

  it('handles 50,000 enter/exit cycles', () => {
    const m = collector();
    const base = m.snapshot().activeRequests;
    for (let i = 0; i < 50_000; i++) {
      m.enter();
      m.exit();
    }
    expect(m.snapshot().activeRequests).toBe(base);
  });
});

describe('metrics — performance', () => {
  it('records 100,000 requests in under 500ms', () => {
    const m = collector();
    const start = performance.now();

    for (let i = 0; i < 100_000; i++) {
      m.record('GET', `/api/route-${i % 20}`, i % 10 === 0 ? 500 : 200, i % 5000);
    }

    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(1500);
  });

  it('snapshot generation is fast with many routes', () => {
    const m = collector();
    for (let i = 0; i < 500; i++) {
      for (let j = 0; j < 100; j++) {
        m.record('GET', `/route-${i}`, 200, j * 10);
      }
    }

    const start = performance.now();
    const snap = m.snapshot();
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(100);
    expect(snap.routes).toHaveLength(500);
  });
});

describe('metrics — edge cases', () => {
  it('handles zero duration request', () => {
    const m = collector();
    m.record('GET', '/api/instant', 200, 0);

    const snap = m.snapshot();
    expect(snap.routes[0].latencyMs.avg).toBe(0);
    expect(snap.routes[0].latencyMs.p50).toBe(10);
  });

  it('handles negative duration gracefully', () => {
    const m = collector();
    m.record('GET', '/api/neg', 200, -5);
    const snap = m.snapshot();
    expect(snap.routes).toHaveLength(1);
  });

  it('handles very large duration', () => {
    const m = collector();
    m.record('GET', '/api/hung', 200, 3_600_000);

    const snap = m.snapshot();
    expect(snap.routes[0].latencyMs.avg).toBe(3_600_000);
  });

  it('handles unusual HTTP methods', () => {
    const m = collector();
    m.record('PATCH', '/api/resource', 200, 10);
    m.record('HEAD', '/api/resource', 200, 5);

    const snap = m.snapshot();
    expect(snap.routes).toHaveLength(2);
  });

  it('handles empty path', () => {
    const m = collector();
    m.record('GET', '', 200, 10);
    expect(m.snapshot().routes).toHaveLength(1);
  });

  it('handles root path', () => {
    const m = collector();
    m.record('GET', '/', 200, 10);

    const snap = m.snapshot();
    expect(snap.routes[0].route).toBe('/');
  });

  it('handles status 599 as error', () => {
    const m = collector();
    m.record('GET', '/api/x', 599, 10);
    expect(m.snapshot().totalErrors).toBe(1);
  });

  it('handles status 499 as non-error', () => {
    const m = collector();
    m.record('GET', '/api/x', 499, 10);
    expect(m.snapshot().totalErrors).toBe(0);
  });

  it('snapshot is a consistent point-in-time view', () => {
    const m = collector();
    for (let i = 0; i < 1000; i++) {
      m.record('GET', '/api/test', i % 5 === 0 ? 500 : 200, 50);
    }

    const snap = m.snapshot();
    expect(snap.totalRequests).toBe(snap.routes.reduce((s, r) => s + r.count, 0));
    expect(snap.totalErrors).toBe(snap.routes.reduce((s, r) => s + r.errorCount, 0));
  });
});

describe('metrics — security (cardinality bomb)', () => {
  it('route cap prevents unbounded memory growth from unique paths', () => {
    const m = collector();

    for (let i = 0; i < 10_000; i++) {
      m.record('GET', `/api/user/${crypto.randomUUID()}`, 200, 10);
    }

    const snap = m.snapshot();
    expect(snap.routes.length).toBeLessThanOrEqual(500);
  });

  it('normalization collapses UUID-based paths to prevent cardinality explosion', () => {
    const m = collector();

    for (let i = 0; i < 1000; i++) {
      m.record('GET', `/api/users/${crypto.randomUUID()}/posts/${crypto.randomUUID()}`, 200, 10);
    }

    const snap = m.snapshot();
    expect(snap.routes).toHaveLength(1);
    expect(snap.routes[0].route).toBe('/api/users/:id/posts/:id');
    expect(snap.routes[0].count).toBe(1000);
  });

  it('normalization collapses numeric IDs', () => {
    const m = collector();
    for (let i = 0; i < 500; i++) {
      m.record('GET', `/api/items/${i}`, 200, 10);
    }

    const snap = m.snapshot();
    expect(snap.routes).toHaveLength(1);
    expect(snap.routes[0].route).toBe('/api/items/:id');
  });

  it('does not normalize short alphabetic segments that look like names', () => {
    const m = collector();
    m.record('GET', '/api/agents/deploy-agent', 200, 10);
    m.record('GET', '/api/agents/github-agent', 200, 10);

    const snap = m.snapshot();
    expect(snap.routes).toHaveLength(2);
  });
});

describe('metrics — singleton', () => {
  it('getMetrics returns same instance', () => {
    const a = getMetrics();
    const b = getMetrics();
    expect(a).toBe(b);
  });

  it('state persists across getMetrics calls', () => {
    const m1 = getMetrics();
    m1.reset();
    m1.record('GET', '/api/persist', 200, 10);

    const m2 = getMetrics();
    expect(m2.snapshot().totalRequests).toBe(1);
    m2.reset();
  });
});
