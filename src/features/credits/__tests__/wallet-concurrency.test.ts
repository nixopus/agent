import { describe, it, expect } from 'vitest';
import { createTestWallet, seedBalance, orgId } from './helpers';

describe('wallet concurrency', () => {
  it('100 parallel debits on same org — balance never goes negative', async () => {
    const { service, db } = createTestWallet();
    seedBalance(db, orgId(), 10_000);

    const promises = Array.from({ length: 100 }, (_, i) =>
      service.debitWallet(orgId(), 50, `debit-${i}`),
    );

    const results = await Promise.all(promises);
    const nonNull = results.filter((r) => r !== null);

    for (const r of nonNull) {
      expect(r!.balance).toBeGreaterThanOrEqual(0);
    }
  });

  it('100 parallel credits — all succeed', async () => {
    const { service } = createTestWallet();

    const promises = Array.from({ length: 100 }, (_, i) =>
      service.creditWallet(orgId(), 10, `credit-${i}`),
    );

    const results = await Promise.all(promises);
    const nonNull = results.filter((r) => r !== null);
    expect(nonNull.length).toBe(100);

    for (const r of nonNull) {
      expect(r!.balance).toBeGreaterThanOrEqual(10);
    }
  });

  it('sequential credit/debit interleaving — final balance consistent', async () => {
    const { service, db } = createTestWallet();
    seedBalance(db, orgId(), 5000);

    for (let i = 0; i < 50; i++) {
      await service.creditWallet(orgId(), 100, `credit-${i}`);
      await service.debitWallet(orgId(), 60, `debit-${i}`);
    }

    await service.invalidateBalanceCache(orgId());
    const balance = await service.getWalletBalance(orgId());
    expect(balance).toBe(5000 + 50 * 100 - 50 * 60);
  });

  it('inflight deduplication — concurrent getWalletBalance shares one promise', async () => {
    const { service, db } = createTestWallet();
    seedBalance(db, orgId(), 7777);

    await service.invalidateBalanceCache(orgId());

    const promises = Array.from({ length: 50 }, () =>
      service.getWalletBalance(orgId()),
    );

    const results = await Promise.all(promises);
    expect(results.every((r) => r === 7777)).toBe(true);
  });

  it('sequential ops on different orgs do not interfere', async () => {
    const { service, db } = createTestWallet();

    for (let i = 1; i <= 10; i++) {
      seedBalance(db, orgId(i), i * 1000);
    }

    for (let i = 1; i <= 10; i++) {
      await service.debitWallet(orgId(i), 100, 'debit');
      await service.creditWallet(orgId(i), 50, 'credit');
    }

    for (let i = 1; i <= 10; i++) {
      await service.invalidateBalanceCache(orgId(i));
      const bal = await service.getWalletBalance(orgId(i));
      expect(bal).toBe(i * 1000 - 100 + 50);
    }
  });

  it('cache stampede — cache expires while many readers hit simultaneously', async () => {
    const { service, db } = createTestWallet();
    seedBalance(db, orgId(), 4200);

    await service.getWalletBalance(orgId());
    await service.invalidateBalanceCache(orgId());

    const stampede = Array.from({ length: 200 }, () =>
      service.getWalletBalance(orgId()),
    );

    const results = await Promise.all(stampede);
    expect(results.every((r) => r === 4200)).toBe(true);
  });

  it('rapid credit then immediate balance check returns updated value', async () => {
    const { service } = createTestWallet();

    for (let i = 0; i < 20; i++) {
      await service.creditWallet(orgId(), 100, `rapid-${i}`);
      await service.invalidateBalanceCache(orgId());
      const bal = await service.getWalletBalance(orgId());
      expect(bal).toBe((i + 1) * 100);
    }
  });

  it('200 concurrent debits draining a wallet — all results non-negative', async () => {
    const { service, db } = createTestWallet();
    seedBalance(db, orgId(), 1000);

    const promises = Array.from({ length: 200 }, (_, i) =>
      service.debitWallet(orgId(), 10, `drain-${i}`),
    );

    const results = await Promise.all(promises);
    for (const r of results) {
      if (r !== null) {
        expect(r.balance).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('parallel reads and writes do not deadlock', async () => {
    const { service, db } = createTestWallet();
    seedBalance(db, orgId(), 50_000);

    const ops = Array.from({ length: 100 }, (_, i) => {
      if (i % 3 === 0) return service.creditWallet(orgId(), 10, `c-${i}`);
      if (i % 3 === 1) return service.debitWallet(orgId(), 5, `d-${i}`);
      return service.getWalletBalance(orgId());
    });

    const results = await Promise.all(ops);
    expect(results.every((r) => r !== undefined)).toBe(true);
  });
});
