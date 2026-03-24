import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createOrchestratorCache } from '../orchestrator-cache';

function makeCloseable(id: string) {
  return { id, close: vi.fn() };
}

describe('orchestrator-cache — normal flows', () => {
  it('creates and returns a new entry', async () => {
    const cache = createOrchestratorCache({ maxSize: 10, ttlMs: 60_000 });
    const obj = makeCloseable('a');
    const result = await cache.getOrSet('key-a', async () => obj);
    expect(result).toBe(obj);
  });

  it('returns cached entry on second call', async () => {
    const cache = createOrchestratorCache({ maxSize: 10, ttlMs: 60_000 });
    const factory = vi.fn(async () => makeCloseable('a'));

    const first = await cache.getOrSet('key-a', factory);
    const second = await cache.getOrSet('key-a', factory);

    expect(first).toBe(second);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('stores different entries for different keys', async () => {
    const cache = createOrchestratorCache({ maxSize: 10, ttlMs: 60_000 });

    const a = await cache.getOrSet('a', async () => makeCloseable('a'));
    const b = await cache.getOrSet('b', async () => makeCloseable('b'));

    expect(a.id).toBe('a');
    expect(b.id).toBe('b');
    expect(a).not.toBe(b);
  });
});

describe('orchestrator-cache — TTL expiry', () => {
  it('evicts entry after TTL expires', async () => {
    vi.useFakeTimers();
    const cache = createOrchestratorCache({ maxSize: 10, ttlMs: 1000 });
    const obj1 = makeCloseable('v1');
    const obj2 = makeCloseable('v2');

    await cache.getOrSet('key', async () => obj1);

    vi.advanceTimersByTime(1001);

    const result = await cache.getOrSet('key', async () => obj2);
    expect(result).toBe(obj2);
    expect(obj1.close).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('keeps entry within TTL', async () => {
    vi.useFakeTimers();
    const cache = createOrchestratorCache({ maxSize: 10, ttlMs: 5000 });
    const obj = makeCloseable('v1');

    await cache.getOrSet('key', async () => obj);

    vi.advanceTimersByTime(4999);

    const factory = vi.fn(async () => makeCloseable('v2'));
    const result = await cache.getOrSet('key', factory);
    expect(result).toBe(obj);
    expect(factory).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('refreshes lastUsed on access', async () => {
    vi.useFakeTimers();
    const cache = createOrchestratorCache({ maxSize: 10, ttlMs: 1000 });
    const obj = makeCloseable('v1');

    await cache.getOrSet('key', async () => obj);

    vi.advanceTimersByTime(800);
    await cache.getOrSet('key', async () => makeCloseable('v2'));

    vi.advanceTimersByTime(800);

    const factory = vi.fn(async () => makeCloseable('v3'));
    const result = await cache.getOrSet('key', factory);
    expect(result).toBe(obj);
    expect(factory).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe('orchestrator-cache — LRU eviction', () => {
  it('evicts least recently used when maxSize reached', async () => {
    const cache = createOrchestratorCache({ maxSize: 3, ttlMs: 60_000 });

    const a = makeCloseable('a');
    const b = makeCloseable('b');
    const c = makeCloseable('c');
    const d = makeCloseable('d');

    await cache.getOrSet('a', async () => a);
    await cache.getOrSet('b', async () => b);
    await cache.getOrSet('c', async () => c);

    await cache.getOrSet('d', async () => d);

    expect(a.close).toHaveBeenCalled();

    const factoryA = vi.fn(async () => makeCloseable('a-new'));
    const resultA = await cache.getOrSet('a', factoryA);
    expect(factoryA).toHaveBeenCalled();
    expect(resultA.id).toBe('a-new');
  });

  it('promotes recently accessed entries', async () => {
    const cache = createOrchestratorCache({ maxSize: 3, ttlMs: 60_000 });

    const a = makeCloseable('a');
    const b = makeCloseable('b');
    const c = makeCloseable('c');

    await cache.getOrSet('a', async () => a);
    await cache.getOrSet('b', async () => b);
    await cache.getOrSet('c', async () => c);

    await cache.getOrSet('a', async () => makeCloseable('x'));

    await cache.getOrSet('d', async () => makeCloseable('d'));

    expect(b.close).toHaveBeenCalled();
    expect(a.close).not.toHaveBeenCalled();
  });

  it('calls close on evicted entries', async () => {
    const cache = createOrchestratorCache({ maxSize: 1, ttlMs: 60_000 });

    const first = makeCloseable('first');
    await cache.getOrSet('a', async () => first);
    await cache.getOrSet('b', async () => makeCloseable('second'));

    expect(first.close).toHaveBeenCalledTimes(1);
  });
});

describe('orchestrator-cache — invalidation', () => {
  it('invalidate removes specific key', async () => {
    const cache = createOrchestratorCache({ maxSize: 10, ttlMs: 60_000 });
    const obj = makeCloseable('a');

    await cache.getOrSet('key-a', async () => obj);
    cache.invalidate('key-a');

    expect(obj.close).toHaveBeenCalled();

    const factory = vi.fn(async () => makeCloseable('new'));
    await cache.getOrSet('key-a', factory);
    expect(factory).toHaveBeenCalled();
  });

  it('invalidateByPrefix removes matching keys', async () => {
    const cache = createOrchestratorCache({ maxSize: 10, ttlMs: 60_000 });

    const a1 = makeCloseable('a1');
    const a2 = makeCloseable('a2');
    const b1 = makeCloseable('b1');

    await cache.getOrSet('ssh:org1:host1', async () => a1);
    await cache.getOrSet('ssh:org1:host2', async () => a2);
    await cache.getOrSet('ssh:org2:host1', async () => b1);

    cache.invalidateByPrefix('ssh:org1:');

    expect(a1.close).toHaveBeenCalled();
    expect(a2.close).toHaveBeenCalled();
    expect(b1.close).not.toHaveBeenCalled();
  });

  it('evictAll removes everything', async () => {
    const cache = createOrchestratorCache({ maxSize: 10, ttlMs: 60_000 });

    const entries = await Promise.all(
      ['a', 'b', 'c'].map((k) => cache.getOrSet(k, async () => makeCloseable(k))),
    );

    cache.evictAll();

    for (const entry of entries) {
      expect(entry.close).toHaveBeenCalled();
    }
  });

  it('invalidating non-existent key does not throw', () => {
    const cache = createOrchestratorCache();
    expect(() => cache.invalidate('nope')).not.toThrow();
  });

  it('invalidateByPrefix with no matches does not throw', () => {
    const cache = createOrchestratorCache();
    expect(() => cache.invalidateByPrefix('nope:')).not.toThrow();
  });
});

describe('orchestrator-cache — entries without close()', () => {
  it('handles entries that have no close method', async () => {
    const cache = createOrchestratorCache({ maxSize: 1, ttlMs: 60_000 });

    const noClose = { id: 'no-close' } as any;
    await cache.getOrSet('a', async () => noClose);

    await expect(cache.getOrSet('b', async () => makeCloseable('b'))).resolves.toBeDefined();
  });

  it('handles entries where close throws', async () => {
    const cache = createOrchestratorCache({ maxSize: 1, ttlMs: 60_000 });

    const badClose = { close: vi.fn(() => { throw new Error('close failed'); }) };
    await cache.getOrSet('a', async () => badClose);

    await expect(cache.getOrSet('b', async () => makeCloseable('b'))).resolves.toBeDefined();
    expect(badClose.close).toHaveBeenCalled();
  });
});

describe('orchestrator-cache — scale', () => {
  it('handles 1000 entries with maxSize 100', async () => {
    const cache = createOrchestratorCache({ maxSize: 100, ttlMs: 60_000 });
    const closeCount = { n: 0 };

    for (let i = 0; i < 1000; i++) {
      await cache.getOrSet(`key-${i}`, async () => ({
        close: () => { closeCount.n++; },
      }));
    }

    expect(closeCount.n).toBe(900);
  });

  it('handles rapid getOrSet cycles for same key', async () => {
    const cache = createOrchestratorCache({ maxSize: 10, ttlMs: 60_000 });
    const factory = vi.fn(async () => makeCloseable('v'));

    const results = await Promise.all(
      Array.from({ length: 100 }, () => cache.getOrSet('same-key', factory)),
    );

    for (const r of results) {
      expect(r.id).toBe('v');
    }
  });
});

describe('orchestrator-cache — performance', () => {
  it('processes 10,000 getOrSet calls in under 500ms', async () => {
    const cache = createOrchestratorCache({ maxSize: 500, ttlMs: 60_000 });
    const start = performance.now();

    for (let i = 0; i < 10_000; i++) {
      await cache.getOrSet(`key-${i % 500}`, async () => makeCloseable(`v-${i}`));
    }

    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);
  });
});

describe('orchestrator-cache — edge cases', () => {
  it('uses defaults when no options provided', async () => {
    const cache = createOrchestratorCache();
    const result = await cache.getOrSet('key', async () => makeCloseable('a'));
    expect(result.id).toBe('a');
  });

  it('handles empty string keys', async () => {
    const cache = createOrchestratorCache({ maxSize: 10, ttlMs: 60_000 });
    const result = await cache.getOrSet('', async () => makeCloseable('empty'));
    expect(result.id).toBe('empty');
  });

  it('handles very long keys', async () => {
    const cache = createOrchestratorCache({ maxSize: 10, ttlMs: 60_000 });
    const longKey = 'k'.repeat(10_000);
    const result = await cache.getOrSet(longKey, async () => makeCloseable('long'));
    expect(result.id).toBe('long');
  });

  it('factory error does not poison cache', async () => {
    const cache = createOrchestratorCache({ maxSize: 10, ttlMs: 60_000 });

    await expect(cache.getOrSet('key', async () => { throw new Error('factory fail'); })).rejects.toThrow('factory fail');

    const result = await cache.getOrSet('key', async () => makeCloseable('retry'));
    expect(result.id).toBe('retry');
  });

  it('maxSize of 1 keeps only the latest entry', async () => {
    const cache = createOrchestratorCache({ maxSize: 1, ttlMs: 60_000 });

    const a = makeCloseable('a');
    const b = makeCloseable('b');
    const c = makeCloseable('c');

    await cache.getOrSet('a', async () => a);
    await cache.getOrSet('b', async () => b);
    await cache.getOrSet('c', async () => c);

    expect(a.close).toHaveBeenCalled();
    expect(b.close).toHaveBeenCalled();
    expect(c.close).not.toHaveBeenCalled();
  });

  it('evictAll on empty cache does not throw', () => {
    const cache = createOrchestratorCache();
    expect(() => cache.evictAll()).not.toThrow();
  });
});
