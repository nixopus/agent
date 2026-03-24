import type { ApiRoute } from '@mastra/core/server';
import { getPool } from '../db/pool';
import { config } from '../config';
import { getMetrics } from './metrics';

async function checkDatabase(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const dbUrl = process.env.DATABASE_URL || config.databaseUrl;
  if (!dbUrl) {
    return { ok: false, latencyMs: 0, error: 'DATABASE_URL not configured' };
  }

  const start = performance.now();
  try {
    const pool = getPool(dbUrl);
    await pool.query('SELECT 1');
    return { ok: true, latencyMs: Math.round(performance.now() - start) };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - start),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export const observabilityRoutes: ApiRoute[] = [
  {
    path: '/healthz',
    method: 'GET',
    createHandler: async () => async (c) => {
      return c.json({
        status: 'ok',
        uptimeSeconds: Math.floor(process.uptime()),
      });
    },
  },

  {
    path: '/readyz',
    method: 'GET',
    createHandler: async () => async (c) => {
      const db = await checkDatabase();

      const ready = db.ok;
      const payload: Record<string, unknown> = {
        status: ready ? 'ready' : 'not_ready',
        checks: { database: db },
      };

      return c.json(payload, ready ? 200 : 503);
    },
  },

  {
    path: '/metrics',
    method: 'GET',
    createHandler: async () => async (c) => {
      return c.json(getMetrics().snapshot());
    },
  },

];
