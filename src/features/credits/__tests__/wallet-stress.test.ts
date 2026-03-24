import { describe, it, expect } from 'vitest';
import { createTestWallet, seedBalance, orgId, createMockDb } from './helpers';
import { MemoryCacheStoreFactory, type CacheStore } from '../../../cache';
import { createWalletService } from '../wallet';

describe('wallet stress', () => {
  it('rapid-fire alternating credit/debit — 1000 random-amount ops', async () => {
    const { service, db } = createTestWallet();
    seedBalance(db, orgId(), 50_000);
    let expected = 50_000;

    for (let i = 0; i < 1000; i++) {
      const amount = Math.floor(Math.random() * 100) + 1;
      if (i % 2 === 0) {
        await service.debitWallet(orgId(), amount, `stress-debit-${i}`);
        expected = Math.max(expected - amount, 0);
      } else {
        await service.creditWallet(orgId(), amount, `stress-credit-${i}`);
        expected += amount;
      }
    }

    await service.invalidateBalanceCache(orgId());
    const balance = await service.getWalletBalance(orgId());
    expect(balance).toBe(expected);
  });

  it('DB insert failure mid-debit — returns null, does not corrupt balance', async () => {
    const db = createMockDb();
    seedBalance(db, orgId(), 5000);
    let callCount = 0;

    const originalInsert = db.insert.bind(db);
    const failingDb: any = {
      select: db.select.bind(db),
      insert: (schema: any) => {
        const chain = originalInsert(schema);
        const originalValues = chain.values.bind(chain);
        return {
          values: async (data: any) => {
            callCount++;
            if (callCount === 2) throw new Error('disk full');
            return originalValues(data);
          },
        };
      },
      _tables: db._tables,
      _getTable: db._getTable,
      _nextSeq: db._nextSeq,
    };

    const service = createWalletService({
      db: failingDb,
      cacheFactory: new MemoryCacheStoreFactory(),
    });

    const r1 = await service.debitWallet(orgId(), 100, 'before-fail');
    expect(r1!.balance).toBe(4900);

    const r2 = await service.debitWallet(orgId(), 100, 'will-fail');
    expect(r2).toBeNull();

    await service.invalidateBalanceCache(orgId());
    const balance = await service.getWalletBalance(orgId());
    expect(balance).toBe(4900);
  });

  it('cache get failure — getWalletBalance falls through to DB', async () => {
    const db = createMockDb();
    seedBalance(db, orgId(), 3333);

    const fallibleCache: CacheStore = {
      get: async () => { throw new Error('cache down'); },
      set: async () => {},
      delete: async () => false,
      atomicIncrement: async () => ({ count: 0, resetAt: 0 }),
      clear: async () => {},
    };

    const cacheFactory: any = { create: () => fallibleCache };

    const service = createWalletService({ db, cacheFactory });

    const balance = await service.getWalletBalance(orgId());
    expect(balance).toBe(3333);
  });

  it('integer precision — cent amounts accumulate correctly', async () => {
    const { service } = createTestWallet();

    for (let i = 0; i < 100; i++) {
      await service.creditWallet(orgId(), 1, `penny-${i}`);
    }

    await service.invalidateBalanceCache(orgId());
    const balance = await service.getWalletBalance(orgId());
    expect(balance).toBe(100);
    expect(Number.isInteger(balance)).toBe(true);
  });

  it('large amounts — MAX_SAFE_INTEGER boundary', async () => {
    const { service, db } = createTestWallet();
    const huge = Number.MAX_SAFE_INTEGER - 1000;
    seedBalance(db, orgId(), huge);

    const result = await service.creditWallet(orgId(), 500, 'big');
    expect(result!.balance).toBe(huge + 500);
    expect(Number.isSafeInteger(result!.balance)).toBe(true);
  });

  it('debit larger than MAX_SAFE_INTEGER floors at 0', async () => {
    const { service, db } = createTestWallet();
    seedBalance(db, orgId(), 1000);

    const result = await service.debitWallet(orgId(), Number.MAX_SAFE_INTEGER, 'mega-drain');
    expect(result!.balance).toBe(0);
  });

  it('zero-amount ops are rejected not silently processed', async () => {
    const { service, db } = createTestWallet();

    expect(await service.creditWallet(orgId(), 0, 'zero')).toBeNull();
    expect(await service.debitWallet(orgId(), 0, 'zero')).toBeNull();

    const txns = db._getTable('wallet_transactions');
    expect(txns.length).toBe(0);
  });

  it('negative amounts are rejected', async () => {
    const { service, db } = createTestWallet();

    expect(await service.creditWallet(orgId(), -1, 'neg')).toBeNull();
    expect(await service.debitWallet(orgId(), -1, 'neg')).toBeNull();
    expect(await service.creditWallet(orgId(), -999, 'neg')).toBeNull();

    const txns = db._getTable('wallet_transactions');
    expect(txns.length).toBe(0);
  });

  it('interleaved sequential operations across 50 orgs with random amounts', async () => {
    const { service, db } = createTestWallet();
    const ORG_COUNT = 50;
    const expected = new Map<string, number>();

    for (let i = 1; i <= ORG_COUNT; i++) {
      seedBalance(db, orgId(i), 10_000);
      expected.set(orgId(i), 10_000);
    }

    for (let round = 0; round < 20; round++) {
      for (let i = 1; i <= ORG_COUNT; i++) {
        const id = orgId(i);
        const creditAmt = Math.floor(Math.random() * 50) + 1;
        const debitAmt = Math.floor(Math.random() * 30) + 1;

        await service.creditWallet(id, creditAmt, `r${round}-c${i}`);
        expected.set(id, expected.get(id)! + creditAmt);

        await service.debitWallet(id, debitAmt, `r${round}-d${i}`);
        expected.set(id, Math.max(expected.get(id)! - debitAmt, 0));
      }
    }

    for (let i = 1; i <= ORG_COUNT; i++) {
      await service.invalidateBalanceCache(orgId(i));
      const bal = await service.getWalletBalance(orgId(i));
      expect(bal).toBe(expected.get(orgId(i)));
    }
  });

  it('concurrent referenceId dedup — same ref from 10 parallel calls', async () => {
    const { service } = createTestWallet();

    const promises = Array.from({ length: 10 }, () =>
      service.creditWallet(orgId(), 1000, 'dup-purchase', 'same-ref-id'),
    );

    const results = await Promise.all(promises);
    const nonNull = results.filter((r) => r !== null);
    expect(nonNull.length).toBe(10);

    await service.invalidateBalanceCache(orgId());
    const balance = await service.getWalletBalance(orgId());
    expect(balance).toBe(1000);
  });

  it('logUsage does not throw even with extreme token counts', async () => {
    const { service } = createTestWallet();

    await expect(
      service.logUsage({
        orgId: orgId(),
        modelId: 'test-model',
        promptTokens: Number.MAX_SAFE_INTEGER,
        completionTokens: Number.MAX_SAFE_INTEGER,
        costUsd: 999999.999999,
      }),
    ).resolves.not.toThrow();
  });

  it('balance check throughput — 10000 reads in under 2 seconds', async () => {
    const { service, db } = createTestWallet();
    seedBalance(db, orgId(), 1234);

    await service.getWalletBalance(orgId());

    const start = performance.now();

    const promises = Array.from({ length: 10_000 }, () =>
      service.getWalletBalance(orgId()),
    );
    await Promise.all(promises);

    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(2000);
  });

  it('DB failure on getWalletBalance returns 0, not error', async () => {
    const failingDb: any = {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: () => ({
                then: (_resolve: any, reject: any) => {
                  if (reject) reject(new Error('connection refused'));
                },
              }),
            }),
          }),
        }),
      }),
      insert: () => ({ values: async () => {} }),
    };

    const service = createWalletService({
      db: failingDb,
      cacheFactory: new MemoryCacheStoreFactory(),
    });

    const balance = await service.getWalletBalance(orgId());
    expect(balance).toBe(0);
  });

  it('sustained load — 500 concurrent mixed ops do not deadlock', async () => {
    const { service, db } = createTestWallet();
    seedBalance(db, orgId(), 100_000);

    const start = performance.now();

    const ops = Array.from({ length: 500 }, (_, i) => {
      if (i % 3 === 0) return service.creditWallet(orgId(), 10, `load-c-${i}`);
      if (i % 3 === 1) return service.debitWallet(orgId(), 5, `load-d-${i}`);
      return service.getWalletBalance(orgId());
    });

    await Promise.all(ops);

    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(5000);
  });
});
