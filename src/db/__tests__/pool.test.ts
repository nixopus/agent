import { describe, it, expect, afterEach } from 'vitest';
import { getPool, getMemoryPool, closeAllPools } from '../pool';

const FAKE_URL = 'postgresql://localhost:5432/testdb';

afterEach(async () => {
  await closeAllPools();
});

describe('getMemoryPool', () => {
  it('returns a separate instance from getPool', () => {
    const mainPool = getPool(FAKE_URL);
    const memPool = getMemoryPool(FAKE_URL);

    expect(memPool).not.toBe(mainPool);
  });

  it('has a higher max connection count than the main pool', () => {
    const mainPool = getPool(FAKE_URL);
    const memPool = getMemoryPool(FAKE_URL);

    expect((memPool as any).options.max).toBeGreaterThan((mainPool as any).options.max);
  });

  it('returns the same instance on subsequent calls', () => {
    const first = getMemoryPool(FAKE_URL);
    const second = getMemoryPool(FAKE_URL);

    expect(first).toBe(second);
  });

  it('is closed by closeAllPools', async () => {
    const memPool = getMemoryPool(FAKE_URL);
    expect(memPool).toBeDefined();

    await closeAllPools();

    const fresh = getMemoryPool(FAKE_URL);
    expect(fresh).not.toBe(memPool);
  });
});
