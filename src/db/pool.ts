import { Pool } from 'pg';
import { createLogger } from '../logger';

const logger = createLogger('db-pool');

let pool: Pool | null = null;
let memoryPool: Pool | null = null;
let listenerPool: Pool | null = null;

const POOL_MAX = parseInt(process.env.DB_POOL_MAX ?? '5', 10);
const POOL_MIN = parseInt(process.env.DB_POOL_MIN ?? '1', 10);
const MEMORY_POOL_MAX = parseInt(process.env.DB_MEMORY_POOL_MAX ?? '10', 10);
const MEMORY_POOL_MIN = parseInt(process.env.DB_MEMORY_POOL_MIN ?? '2', 10);
const LISTENER_POOL_MAX = parseInt(process.env.DB_LISTENER_POOL_MAX ?? '2', 10);
const STATEMENT_TIMEOUT_MS = parseInt(process.env.DB_STATEMENT_TIMEOUT_MS ?? '30000', 10);

export function getPool(connectionString: string): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString,
      max: POOL_MAX,
      min: POOL_MIN,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: STATEMENT_TIMEOUT_MS,
    });
    pool.on('error', (err) => {
      logger.error({ err: err.message }, 'Pool connection error (will retry on next query)');
    });
  }
  return pool;
}

export function getMemoryPool(connectionString: string): Pool {
  if (!memoryPool) {
    memoryPool = new Pool({
      connectionString,
      max: MEMORY_POOL_MAX,
      min: MEMORY_POOL_MIN,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 60_000,
      statement_timeout: STATEMENT_TIMEOUT_MS,
    });
    memoryPool.on('error', (err) => {
      logger.error({ err: err.message }, 'Memory pool connection error (will retry on next query)');
    });
  }
  return memoryPool;
}

export function getListenerPool(connectionString: string): Pool {
  if (!listenerPool) {
    listenerPool = new Pool({
      connectionString,
      max: LISTENER_POOL_MAX,
      min: 0,
      connectionTimeoutMillis: 15_000,
      idleTimeoutMillis: 60_000,
    });
    listenerPool.on('error', (err) => {
      logger.error({ err: err.message }, 'Listener pool error');
    });
  }
  return listenerPool;
}

export async function closeAllPools(): Promise<void> {
  const closing: Promise<void>[] = [];
  if (pool) {
    closing.push(pool.end().catch((err) => {
      logger.error({ err: err instanceof Error ? err.message : err }, 'Error closing main pool');
    }));
    pool = null;
  }
  if (memoryPool) {
    closing.push(memoryPool.end().catch((err) => {
      logger.error({ err: err instanceof Error ? err.message : err }, 'Error closing memory pool');
    }));
    memoryPool = null;
  }
  if (listenerPool) {
    closing.push(listenerPool.end().catch((err) => {
      logger.error({ err: err instanceof Error ? err.message : err }, 'Error closing listener pool');
    }));
    listenerPool = null;
  }
  await Promise.all(closing);
}
