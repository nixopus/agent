export interface OrchestratorCacheOptions {
  maxSize?: number;
  ttlMs?: number;
  maxAgeMs?: number;
}

interface CacheEntry<T> {
  value: T;
  lastUsed: number;
  createdAt: number;
}

export interface Closeable {
  close?(): void;
}

export function createOrchestratorCache<T extends Closeable>(
  options?: OrchestratorCacheOptions,
): {
  getOrSet(key: string, factory: () => Promise<T>): Promise<T>;
  invalidate(key: string): void;
  invalidateByPrefix(prefix: string): void;
  evictAll(): void;
} {
  const maxSize = options?.maxSize ?? 20;
  const ttlMs = options?.ttlMs ?? 5 * 60 * 1000;
  const maxAgeMs = options?.maxAgeMs ?? 30 * 60 * 1000;
  const cache = new Map<string, CacheEntry<T>>();
  const inflight = new Map<string, Promise<T>>();

  function closeEntry(entry: CacheEntry<T>): void {
    try {
      entry.value?.close?.();
    } catch {}
  }

  function evict(key: string): void {
    const entry = cache.get(key);
    if (entry) {
      closeEntry(entry);
      cache.delete(key);
    }
  }

  function touchLru(key: string): void {
    const entry = cache.get(key);
    if (!entry) return;
    cache.delete(key);
    cache.set(key, entry);
  }

  function evictLru(): void {
    while (cache.size >= maxSize) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      evict(oldest);
    }
  }

  function isExpired(entry: CacheEntry<T>, now: number): boolean {
    if (now - entry.lastUsed > ttlMs) return true;
    if (now - entry.createdAt > maxAgeMs) return true;
    return false;
  }

  async function getOrSet(key: string, factory: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const entry = cache.get(key);
    if (entry) {
      if (isExpired(entry, now)) {
        evict(key);
      } else {
        entry.lastUsed = now;
        touchLru(key);
        return entry.value;
      }
    }

    const pending = inflight.get(key);
    if (pending) return pending;

    const promise = (async (): Promise<T> => {
      try {
        evictLru();
        const value = await factory();
        cache.set(key, { value, lastUsed: Date.now(), createdAt: Date.now() });
        return value;
      } finally {
        inflight.delete(key);
      }
    })();

    inflight.set(key, promise);
    return promise;
  }

  function invalidate(key: string): void {
    evict(key);
  }

  function invalidateByPrefix(prefix: string): void {
    for (const key of [...cache.keys()]) {
      if (key.startsWith(prefix)) evict(key);
    }
  }

  function evictAll(): void {
    for (const key of [...cache.keys()]) {
      evict(key);
    }
  }

  return { getOrSet, invalidate, invalidateByPrefix, evictAll };
}
