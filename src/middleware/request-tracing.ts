import { createLogger } from '../logger';
import { getMetrics } from '../observability/metrics';

const logger = createLogger('http');

const SKIP_TRACE_PATHS = new Set(['/healthz', '/readyz', '/metrics']);

export function createRequestTracing() {
  const metrics = getMetrics();

  return async (
    c: {
      req: {
        url: string;
        method: string;
        header: (name: string) => string | undefined;
      };
      header: (name: string, value: string) => void;
      res: { status: number };
    },
    next: () => Promise<void>,
  ): Promise<void> => {
    const startMs = performance.now();
    const method = c.req.method;
    const url = new URL(c.req.url);
    const pathname = url.pathname;

    const requestId = c.req.header('x-request-id') || crypto.randomUUID();
    c.header('X-Request-Id', requestId);

    if (SKIP_TRACE_PATHS.has(pathname)) {
      await next();
      return;
    }

    metrics.enter();

    try {
      await next();

      const durationMs = Math.round(performance.now() - startMs);
      const status = c.res.status;
      metrics.record(method, pathname, status, durationMs);

      const logData = {
        requestId,
        method,
        path: pathname,
        status,
        durationMs,
      };

      if (status >= 500) {
        logger.error(logData, 'request completed');
      } else if (status >= 400) {
        logger.warn(logData, 'request completed');
      } else if (durationMs > 5000) {
        logger.warn(logData, 'slow request');
      } else {
        logger.info(logData, 'request completed');
      }
    } catch (err) {
      const durationMs = Math.round(performance.now() - startMs);
      metrics.record(method, pathname, 500, durationMs);

      logger.error(
        {
          requestId,
          method,
          path: pathname,
          durationMs,
          error: err instanceof Error ? err.message : String(err),
        },
        'request failed',
      );

      throw err;
    } finally {
      metrics.exit();
    }
  };
}
