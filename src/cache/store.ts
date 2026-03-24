import type { Pool } from 'pg';
import Redis from 'ioredis';

export interface CacheStore {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<boolean>;
  atomicIncrement(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>;
  atomicDecrement(key: string): Promise<{ count: number }>;
  clear(): Promise<void>;
}

const DEFAULT_MAX_ENTRIES = 10_000;

export class MemoryCacheStore implements CacheStore {
  private data = new Map<string, { value: unknown; expiresAt?: number }>();
  private counters = new Map<string, { count: number; resetAt: number }>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private maxEntries: number;

  constructor(cleanupIntervalMs = 60_000, maxEntries = DEFAULT_MAX_ENTRIES) {
    this.maxEntries = maxEntries;
    this.cleanupTimer = setInterval(() => this.evictExpired(), cleanupIntervalMs);
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const entry = this.data.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() >= entry.expiresAt) {
      this.data.delete(key);
      return null;
    }
    this.data.delete(key);
    this.data.set(key, entry);
    return entry.value as T;
  }

  async set(key: string, value: unknown, ttlMs?: number): Promise<void> {
    if (this.data.has(key)) this.data.delete(key);

    while (this.data.size >= this.maxEntries) {
      const oldest = this.data.keys().next().value;
      if (oldest === undefined) break;
      this.data.delete(oldest);
    }

    this.data.set(key, {
      value,
      expiresAt: ttlMs ? Date.now() + ttlMs : Date.now() + 3_600_000,
    });
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(key) || this.counters.delete(key);
  }

  async atomicIncrement(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
    const now = Date.now();
    const existing = this.counters.get(key);

    if (!existing || now >= existing.resetAt) {
      const entry = { count: 1, resetAt: now + windowMs };
      this.counters.set(key, entry);
      return entry;
    }

    existing.count++;
    return { count: existing.count, resetAt: existing.resetAt };
  }

  async atomicDecrement(key: string): Promise<{ count: number }> {
    const existing = this.counters.get(key);
    if (!existing || existing.count <= 0) return { count: 0 };
    existing.count = Math.max(0, existing.count - 1);
    return { count: existing.count };
  }

  async clear(): Promise<void> {
    this.data.clear();
    this.counters.clear();
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.data) {
      if (entry.expiresAt && now >= entry.expiresAt) this.data.delete(key);
    }
    for (const [key, entry] of this.counters) {
      if (now >= entry.resetAt) this.counters.delete(key);
    }
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}

const INIT_SQL = `
CREATE TABLE IF NOT EXISTS _cache_entries (
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  value JSONB NOT NULL DEFAULT '{}',
  counter INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ,
  reset_at TIMESTAMPTZ,
  PRIMARY KEY (namespace, key)
);
CREATE INDEX IF NOT EXISTS idx_cache_entries_expires
  ON _cache_entries(expires_at) WHERE expires_at IS NOT NULL;
`;

let ddlInitialized: Promise<void> | null = null;

function ensureDdl(pool: Pool): Promise<void> {
  if (!ddlInitialized) {
    ddlInitialized = pool.query(INIT_SQL).then(() => {});
  }
  return ddlInitialized;
}

export class PostgresCacheStore implements CacheStore {
  private pool: Pool;
  private namespace: string;
  private ready: Promise<void>;

  constructor(pool: Pool, namespace: string) {
    this.pool = pool;
    this.namespace = namespace;
    this.ready = ensureDdl(pool);
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    await this.ready;
    const { rows } = await this.pool.query(
      `SELECT value FROM _cache_entries
       WHERE namespace = $1 AND key = $2
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [this.namespace, key],
    );
    if (rows.length === 0) return null;
    return rows[0].value as T;
  }

  async set(key: string, value: unknown, ttlMs?: number): Promise<void> {
    await this.ready;
    const expiresAt = ttlMs
      ? new Date(Date.now() + ttlMs).toISOString()
      : null;
    await this.pool.query(
      `INSERT INTO _cache_entries (namespace, key, value, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (namespace, key) DO UPDATE
         SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at`,
      [this.namespace, key, JSON.stringify(value), expiresAt],
    );
  }

  async delete(key: string): Promise<boolean> {
    await this.ready;
    const result = await this.pool.query(
      `DELETE FROM _cache_entries WHERE namespace = $1 AND key = $2`,
      [this.namespace, key],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async atomicIncrement(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
    await this.ready;
    const resetAtTs = new Date(Date.now() + windowMs).toISOString();
    const { rows } = await this.pool.query(
      `INSERT INTO _cache_entries (namespace, key, value, counter, reset_at, expires_at)
       VALUES ($1, $2, '{}', 1, $3::timestamptz, $3::timestamptz)
       ON CONFLICT (namespace, key) DO UPDATE SET
         counter = CASE
           WHEN _cache_entries.reset_at <= NOW() THEN 1
           ELSE _cache_entries.counter + 1
         END,
         reset_at = CASE
           WHEN _cache_entries.reset_at <= NOW() THEN $3::timestamptz
           ELSE _cache_entries.reset_at
         END,
         expires_at = CASE
           WHEN _cache_entries.reset_at <= NOW() THEN $3::timestamptz
           ELSE _cache_entries.expires_at
         END
       RETURNING counter, extract(epoch from reset_at) * 1000 as reset_at_ms`,
      [this.namespace, key, resetAtTs],
    );

    return {
      count: rows[0].counter,
      resetAt: Math.floor(rows[0].reset_at_ms),
    };
  }

  async atomicDecrement(key: string): Promise<{ count: number }> {
    await this.ready;
    const { rows } = await this.pool.query(
      `UPDATE _cache_entries
       SET counter = GREATEST(counter - 1, 0)
       WHERE namespace = $1 AND key = $2
       RETURNING counter`,
      [this.namespace, key],
    );
    if (rows.length === 0) return { count: 0 };
    return { count: rows[0].counter };
  }

  async clear(): Promise<void> {
    await this.ready;
    await this.pool.query(
      `DELETE FROM _cache_entries WHERE namespace = $1`,
      [this.namespace],
    );
  }
}

let defaultFactory: CacheStoreFactory | null = null;

export interface CacheStoreFactory {
  create(namespace: string): CacheStore;
}

export class MemoryCacheStoreFactory implements CacheStoreFactory {
  private stores = new Map<string, MemoryCacheStore>();

  create(namespace: string): CacheStore {
    const existing = this.stores.get(namespace);
    if (existing) return existing;
    const store = new MemoryCacheStore();
    this.stores.set(namespace, store);
    return store;
  }
}

export class PostgresCacheStoreFactory implements CacheStoreFactory {
  private pool: Pool;
  private stores = new Map<string, PostgresCacheStore>();

  constructor(pool: Pool) {
    this.pool = pool;
  }

  create(namespace: string): CacheStore {
    const existing = this.stores.get(namespace);
    if (existing) return existing;
    const store = new PostgresCacheStore(this.pool, namespace);
    this.stores.set(namespace, store);
    return store;
  }
}

const REDIS_DECREMENT_SCRIPT = `
local key = KEYS[1]
local data = redis.call('GET', key)
if data then
  local entry = cjson.decode(data)
  if entry.count > 0 then
    entry.count = entry.count - 1
  end
  local ttl = redis.call('TTL', key)
  if ttl < 1 then ttl = 1 end
  redis.call('SET', key, cjson.encode(entry), 'EX', ttl)
  return cjson.encode(entry)
else
  return cjson.encode({ count = 0, resetAt = 0 })
end
`;

const REDIS_INCREMENT_SCRIPT = `
local key = KEYS[1]
local window_ms = tonumber(ARGV[1])
local now = tonumber(ARGV[2])

local data = redis.call('GET', key)
if data then
  local entry = cjson.decode(data)
  if now >= entry.resetAt then
    entry = { count = 1, resetAt = now + window_ms }
  else
    entry.count = entry.count + 1
  end
  local ttl = math.ceil((entry.resetAt - now) / 1000)
  if ttl < 1 then ttl = 1 end
  redis.call('SET', key, cjson.encode(entry), 'EX', ttl)
  return cjson.encode(entry)
else
  local entry = { count = 1, resetAt = now + window_ms }
  local ttl = math.ceil(window_ms / 1000)
  if ttl < 1 then ttl = 1 end
  redis.call('SET', key, cjson.encode(entry), 'EX', ttl)
  return cjson.encode(entry)
end
`;

export class RedisCacheStore implements CacheStore {
  private client: Redis;
  private prefix: string;

  constructor(client: Redis, namespace: string) {
    this.client = client;
    this.prefix = `cache:${namespace}:`;
  }

  private key(k: string): string {
    return `${this.prefix}${k}`;
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const raw = await this.client.get(this.key(key));
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async set(key: string, value: unknown, ttlMs?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    const ttlSec = Math.ceil((ttlMs ?? 3_600_000) / 1000);
    await this.client.set(this.key(key), serialized, 'EX', ttlSec);
  }

  async delete(key: string): Promise<boolean> {
    const deleted = await this.client.del(this.key(key));
    return deleted > 0;
  }

  async atomicIncrement(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
    const result = await this.client.eval(
      REDIS_INCREMENT_SCRIPT,
      1,
      this.key(key),
      String(windowMs),
      String(Date.now()),
    ) as string;
    const parsed = JSON.parse(result);
    return { count: parsed.count, resetAt: parsed.resetAt };
  }

  async atomicDecrement(key: string): Promise<{ count: number }> {
    const result = await this.client.eval(
      REDIS_DECREMENT_SCRIPT,
      1,
      this.key(key),
    ) as string;
    const parsed = JSON.parse(result);
    return { count: parsed.count };
  }

  async clear(): Promise<void> {
    let cursor = '0';
    do {
      const [next, keys] = await this.client.scan(cursor, 'MATCH', `${this.prefix}*`, 'COUNT', 200);
      cursor = next;
      if (keys.length > 0) await this.client.del(...keys);
    } while (cursor !== '0');
  }
}

export class RedisCacheStoreFactory implements CacheStoreFactory {
  private client: Redis;
  private stores = new Map<string, RedisCacheStore>();

  constructor(client: Redis) {
    this.client = client;
  }

  create(namespace: string): CacheStore {
    const existing = this.stores.get(namespace);
    if (existing) return existing;
    const store = new RedisCacheStore(this.client, namespace);
    this.stores.set(namespace, store);
    return store;
  }
}

export function getCacheStoreFactory(): CacheStoreFactory {
  if (defaultFactory) return defaultFactory;
  defaultFactory = new MemoryCacheStoreFactory();
  return defaultFactory;
}

let sharedRedisClient: Redis | null = null;

export function getRedisClient(): Redis | null {
  return sharedRedisClient;
}

export function initCacheStoreFactory(opts?: { pool?: Pool; redisUrl?: string }): CacheStoreFactory {
  if (opts?.redisUrl) {
    const client = new Redis(opts.redisUrl, {
      maxRetriesPerRequest: 3,
      lazyConnect: false,
    });
    sharedRedisClient = client;
    defaultFactory = new RedisCacheStoreFactory(client);
  } else if (opts?.pool) {
    defaultFactory = new PostgresCacheStoreFactory(opts.pool);
  } else {
    defaultFactory = new MemoryCacheStoreFactory();
  }
  return defaultFactory;
}
