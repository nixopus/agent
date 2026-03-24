const LATENCY_BUCKETS_MS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_PATTERN = /^\d+$/;
const PREFIXED_ID_PATTERN = /^(thread|run|msg|step|wf|org|usr|mem|snap)_[a-zA-Z0-9_-]+$/;

const MAX_TRACKED_ROUTES = 500;

function normalizeRoute(path: string): string {
  return path
    .split('/')
    .map((seg) => {
      if (!seg) return seg;
      if (UUID_PATTERN.test(seg) || NUMERIC_PATTERN.test(seg) || PREFIXED_ID_PATTERN.test(seg)) {
        return ':id';
      }
      return seg;
    })
    .join('/');
}

function percentileFromBuckets(buckets: number[], p: number): number {
  const total = buckets.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;

  const threshold = Math.ceil(total * p);
  let cumulative = 0;

  for (let i = 0; i < buckets.length; i++) {
    cumulative += buckets[i];
    if (cumulative >= threshold) {
      if (i < LATENCY_BUCKETS_MS.length) return LATENCY_BUCKETS_MS[i];
      return LATENCY_BUCKETS_MS[LATENCY_BUCKETS_MS.length - 1] * 2;
    }
  }

  return LATENCY_BUCKETS_MS[LATENCY_BUCKETS_MS.length - 1];
}

interface RouteStats {
  buckets: number[];
  sum: number;
  count: number;
  errorCount: number;
}

export interface RouteSnapshot {
  method: string;
  route: string;
  count: number;
  errorCount: number;
  errorRate: number;
  latencyMs: {
    avg: number;
    p50: number;
    p95: number;
    p99: number;
  };
}

export interface MetricsSnapshot {
  uptimeSeconds: number;
  activeRequests: number;
  totalRequests: number;
  totalErrors: number;
  errorRate: number;
  statusClasses: Record<string, number>;
  routes: RouteSnapshot[];
}

class MetricsCollector {
  private routes = new Map<string, RouteStats>();
  private statusCounts = new Map<number, number>();
  private _activeRequests = 0;
  private _totalRequests = 0;
  private _totalErrors = 0;
  private readonly startedAt = Date.now();

  record(method: string, path: string, status: number, durationMs: number): void {
    const key = `${method} ${normalizeRoute(path)}`;

    let stats = this.routes.get(key);
    if (!stats) {
      if (this.routes.size >= MAX_TRACKED_ROUTES) return;
      stats = {
        buckets: new Array(LATENCY_BUCKETS_MS.length + 1).fill(0),
        sum: 0,
        count: 0,
        errorCount: 0,
      };
      this.routes.set(key, stats);
    }

    stats.count++;
    stats.sum += durationMs;
    this._totalRequests++;

    if (status >= 500) {
      stats.errorCount++;
      this._totalErrors++;
    }

    this.statusCounts.set(status, (this.statusCounts.get(status) ?? 0) + 1);

    for (let i = 0; i < LATENCY_BUCKETS_MS.length; i++) {
      if (durationMs <= LATENCY_BUCKETS_MS[i]) {
        stats.buckets[i]++;
        return;
      }
    }
    stats.buckets[LATENCY_BUCKETS_MS.length]++;
  }

  enter(): void {
    this._activeRequests++;
  }

  exit(): void {
    this._activeRequests = Math.max(0, this._activeRequests - 1);
  }

  snapshot(): MetricsSnapshot {
    const statusClasses: Record<string, number> = {};
    for (const [status, count] of this.statusCounts) {
      const cls = `${Math.floor(status / 100)}xx`;
      statusClasses[cls] = (statusClasses[cls] ?? 0) + count;
    }

    const routes: RouteSnapshot[] = [];
    for (const [key, stats] of this.routes) {
      const spaceIdx = key.indexOf(' ');
      routes.push({
        method: key.slice(0, spaceIdx),
        route: key.slice(spaceIdx + 1),
        count: stats.count,
        errorCount: stats.errorCount,
        errorRate: stats.count > 0 ? Math.round((stats.errorCount / stats.count) * 10000) / 10000 : 0,
        latencyMs: {
          avg: stats.count > 0 ? Math.round(stats.sum / stats.count) : 0,
          p50: percentileFromBuckets(stats.buckets, 0.5),
          p95: percentileFromBuckets(stats.buckets, 0.95),
          p99: percentileFromBuckets(stats.buckets, 0.99),
        },
      });
    }

    routes.sort((a, b) => b.count - a.count);

    return {
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      activeRequests: this._activeRequests,
      totalRequests: this._totalRequests,
      totalErrors: this._totalErrors,
      errorRate: this._totalRequests > 0 ? Math.round((this._totalErrors / this._totalRequests) * 10000) / 10000 : 0,
      statusClasses,
      routes,
    };
  }

  reset(): void {
    this.routes.clear();
    this.statusCounts.clear();
    this._totalRequests = 0;
    this._totalErrors = 0;
  }
}

let instance: MetricsCollector | null = null;

export function getMetrics(): MetricsCollector {
  if (!instance) instance = new MetricsCollector();
  return instance;
}
