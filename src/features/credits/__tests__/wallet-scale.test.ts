import { describe, it, expect } from 'vitest';
import { createTestWallet, seedBalance, orgId } from './helpers';

describe('wallet scale', () => {
  it('10,000 unique orgs — independent balance tracking', async () => {
    const { service, db } = createTestWallet();
    const ORG_COUNT = 10_000;

    for (let i = 1; i <= ORG_COUNT; i++) {
      seedBalance(db, orgId(i), i);
    }

    const spot = [1, 100, 1000, 5000, 9999, 10000];
    for (const n of spot) {
      const bal = await service.getWalletBalance(orgId(n));
      expect(bal).toBe(n);
    }
  });

  it('10,000 orgs — no cross-contamination after sequential debits', async () => {
    const { service, db } = createTestWallet();
    const ORG_COUNT = 10_000;

    for (let i = 1; i <= ORG_COUNT; i++) {
      seedBalance(db, orgId(i), 5000);
    }

    for (let i = 1; i <= ORG_COUNT; i++) {
      await service.debitWallet(orgId(i), i, `debit-${i}`);
    }

    const spot = [1, 500, 2500, 4999, 5000, 7500, 10000];
    for (const n of spot) {
      await service.invalidateBalanceCache(orgId(n));
      const bal = await service.getWalletBalance(orgId(n));
      const expected = Math.max(5000 - n, 0);
      expect(bal).toBe(expected);
    }
  }, 120_000);

  it('1,000 sequential ops on one org — consistent running balance', async () => {
    const { service } = createTestWallet();
    const id = orgId();
    let expected = 0;

    for (let i = 0; i < 500; i++) {
      await service.creditWallet(id, 10, `credit-${i}`);
      expected += 10;
    }

    for (let i = 0; i < 500; i++) {
      await service.debitWallet(id, 5, `debit-${i}`);
      expected -= 5;
    }

    await service.invalidateBalanceCache(id);
    const balance = await service.getWalletBalance(id);
    expect(balance).toBe(expected);
  });

  it('time growth is sub-quadratic for N operations', async () => {
    const { service: s1 } = createTestWallet();
    const { service: s2 } = createTestWallet();

    const measure = async (svc: typeof s1, count: number): Promise<number> => {
      const start = performance.now();
      for (let i = 0; i < count; i++) {
        await svc.creditWallet(orgId(), 1, `op-${i}`);
      }
      return performance.now() - start;
    };

    const t100 = await measure(s1, 100);
    const t500 = await measure(s2, 500);

    const ratio = t500 / t100;
    expect(ratio).toBeLessThan(25);
  });

  it('batch credit + balance check for 1000 orgs', async () => {
    const { service } = createTestWallet();

    for (let i = 1; i <= 1000; i++) {
      await service.creditWallet(orgId(i), i * 10, `init-${i}`);
    }

    const balancePromises = [];
    for (let i = 1; i <= 1000; i++) {
      balancePromises.push(
        (async () => {
          await service.invalidateBalanceCache(orgId(i));
          const b = await service.getWalletBalance(orgId(i));
          return { org: i, balance: b };
        })(),
      );
    }

    const results = await Promise.all(balancePromises);
    for (const { org, balance } of results) {
      expect(balance).toBe(org * 10);
    }
  });

  it('high volume logUsage — 5000 inserts', async () => {
    const { service, db } = createTestWallet();

    const promises = Array.from({ length: 5000 }, (_, i) =>
      service.logUsage({
        orgId: orgId(i % 100 + 1),
        modelId: 'gpt-4o',
        promptTokens: 100,
        completionTokens: 50,
        costUsd: 0.005,
      }),
    );

    await Promise.all(promises);

    const logs = db._getTable('ai_usage_logs');
    expect(logs.length).toBe(5000);
  });

  it('memory stays bounded — 10k ops do not leak', async () => {
    const { service } = createTestWallet();
    const id = orgId();

    const before = process.memoryUsage().heapUsed;

    for (let i = 0; i < 10_000; i++) {
      await service.creditWallet(id, 1, `leak-check-${i}`);
    }

    if (global.gc) global.gc();
    const after = process.memoryUsage().heapUsed;
    const growthMb = (after - before) / 1024 / 1024;

    expect(growthMb).toBeLessThan(200);
  });
});
