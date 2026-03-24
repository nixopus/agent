import { describe, it, expect } from 'vitest';
import { createTestWallet, seedBalance, orgId, createMockDb } from './helpers';
import { MemoryCacheStoreFactory, type CacheStore } from '../../../cache';
import { createWalletService } from '../wallet';
import { shouldSkipCreditCheck, checkCredits } from '../../../middleware/credit-gate';

describe('wallet security — input validation', () => {
  it('NaN amount credit is rejected', async () => {
    const { service, db } = createTestWallet();
    const result = await service.creditWallet(orgId(), NaN, 'nan-attack');
    expect(result).toBeNull();
    expect(db._getTable('wallet_transactions').length).toBe(0);
  });

  it('NaN amount debit is rejected', async () => {
    const { service, db } = createTestWallet();
    seedBalance(db, orgId(), 5000);
    const result = await service.debitWallet(orgId(), NaN, 'nan-attack');
    expect(result).toBeNull();
  });

  it('Infinity amount credit is rejected', async () => {
    const { service } = createTestWallet();
    const result = await service.creditWallet(orgId(), Infinity, 'inf-attack');
    expect(result).toBeNull();
  });

  it('-Infinity amount is rejected', async () => {
    const { service } = createTestWallet();
    expect(await service.creditWallet(orgId(), -Infinity, 'neg-inf')).toBeNull();
    expect(await service.debitWallet(orgId(), -Infinity, 'neg-inf')).toBeNull();
  });

  it('Infinity amount debit is rejected', async () => {
    const { service, db } = createTestWallet();
    seedBalance(db, orgId(), 5000);
    const result = await service.debitWallet(orgId(), Infinity, 'inf-drain');
    expect(result).toBeNull();
  });

  it('fractional sub-cent credit (0.5) passes guard but is risky', async () => {
    const { service } = createTestWallet();
    const result = await service.creditWallet(orgId(), 0.5, 'sub-cent');
    expect(result).not.toBeNull();
  });

  it('Number.MIN_VALUE credit does not corrupt balance', async () => {
    const { service } = createTestWallet();
    const result = await service.creditWallet(orgId(), Number.MIN_VALUE, 'epsilon');
    expect(result).not.toBeNull();
    expect(Number.isFinite(result!.balance)).toBe(true);
  });

  it('-0 is treated as 0 and rejected', async () => {
    const { service } = createTestWallet();
    expect(await service.creditWallet(orgId(), -0, 'neg-zero')).toBeNull();
    expect(await service.debitWallet(orgId(), -0, 'neg-zero')).toBeNull();
  });
});

describe('wallet security — integer overflow', () => {
  it('credit past MAX_SAFE_INTEGER loses precision (documents risk)', async () => {
    const { service, db } = createTestWallet();
    const almostMax = Number.MAX_SAFE_INTEGER - 10;
    seedBalance(db, orgId(), almostMax);

    const result = await service.creditWallet(orgId(), 100, 'overflow');
    const isSafe = Number.isSafeInteger(result!.balance);
    expect(isSafe).toBe(false);
  });

  it('repeated small credits approaching MAX_SAFE_INTEGER', async () => {
    const { service, db } = createTestWallet();
    const nearMax = Number.MAX_SAFE_INTEGER - 5;
    seedBalance(db, orgId(), nearMax);

    await service.creditWallet(orgId(), 1, 'step-1');
    await service.creditWallet(orgId(), 1, 'step-2');
    await service.creditWallet(orgId(), 1, 'step-3');
    await service.creditWallet(orgId(), 1, 'step-4');
    await service.creditWallet(orgId(), 1, 'step-5');

    await service.invalidateBalanceCache(orgId());
    const balance = await service.getWalletBalance(orgId());
    expect(Number.isSafeInteger(balance)).toBe(true);
    expect(balance).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('wallet security — org isolation (IDOR)', () => {
  it('cannot read another org balance through getWalletBalance', async () => {
    const { service, db } = createTestWallet();
    seedBalance(db, orgId(1), 99999);
    seedBalance(db, orgId(2), 100);

    expect(await service.getWalletBalance(orgId(1))).toBe(99999);
    expect(await service.getWalletBalance(orgId(2))).toBe(100);
  });

  it('debit from org A does not affect org B balance', async () => {
    const { service, db } = createTestWallet();
    seedBalance(db, orgId(1), 5000);
    seedBalance(db, orgId(2), 5000);

    await service.debitWallet(orgId(1), 4000, 'drain-A');

    await service.invalidateBalanceCache(orgId(2));
    expect(await service.getWalletBalance(orgId(2))).toBe(5000);
  });

  it('credit to org A does not appear in org B ledger', async () => {
    const { service } = createTestWallet();
    await service.creditWallet(orgId(1), 9999, 'secret-topup');

    const ledger = await service.getWalletLedger(orgId(2));
    expect(ledger.items.length).toBe(0);
    expect(ledger.total_count).toBe(0);
  });

  it('referenceId from org A does not deduplicate credit to org B', async () => {
    const { service } = createTestWallet();

    await service.creditWallet(orgId(1), 1000, 'purchase', 'shared-ref');
    await service.creditWallet(orgId(2), 1000, 'purchase', 'shared-ref');

    await service.invalidateBalanceCache(orgId(2));
    const bal = await service.getWalletBalance(orgId(2));
    expect(bal).toBe(0);
  });

  it('empty org ID returns 0 balance, not another org data', async () => {
    const { service, db } = createTestWallet();
    seedBalance(db, orgId(1), 10000);

    expect(await service.getWalletBalance('')).toBe(0);
  });
});

describe('wallet security — referenceId abuse', () => {
  it('cross-org referenceId collision blocks second credit (dedup is global, not per-org)', async () => {
    const { service } = createTestWallet();

    const r1 = await service.creditWallet(orgId(1), 500, 'purchase', 'global-ref');
    expect(r1!.balance).toBe(500);

    const r2 = await service.creditWallet(orgId(2), 500, 'purchase', 'global-ref');
    await service.invalidateBalanceCache(orgId(2));
    expect(await service.getWalletBalance(orgId(2))).toBe(0);
  });

  it('extremely long referenceId does not crash', async () => {
    const { service } = createTestWallet();
    const result = await service.creditWallet(orgId(), 100, 'long-ref', 'A'.repeat(10_000));
    expect(result).not.toBeNull();
  });

  it('SQL-injection-like referenceId is stored safely', async () => {
    const { service } = createTestWallet();
    const result = await service.creditWallet(
      orgId(), 100, 'sql-inject', "'; DROP TABLE wallet_transactions; --",
    );
    expect(result).not.toBeNull();
    expect(result!.balance).toBe(100);
  });

  it('unicode referenceId deduplicates correctly', async () => {
    const { service } = createTestWallet();
    await service.creditWallet(orgId(), 100, 'unicode', '支付-订单-001');
    await service.creditWallet(orgId(), 100, 'unicode-dup', '支付-订单-001');

    await service.invalidateBalanceCache(orgId());
    expect(await service.getWalletBalance(orgId())).toBe(100);
  });
});

describe('wallet security — double-spend / TOCTOU', () => {
  it('concurrent debits can overdraw — read-then-write has no atomicity', async () => {
    const { service, db } = createTestWallet();
    seedBalance(db, orgId(), 100);

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        service.debitWallet(orgId(), 50, `double-spend-${i}`),
      ),
    );

    const successCount = results.filter((r) => r !== null).length;
    expect(successCount).toBe(10);

    const txns = db._getTable('wallet_transactions');
    const debits = txns.filter((t: any) => t.entryType === 'debit');
    expect(debits.length).toBe(10);
  });

  it('credit gate check then drain — TOCTOU gap allows usage after exhaustion', async () => {
    const { service, db } = createTestWallet();
    seedBalance(db, orgId(), 1);

    const gateResult = await checkCredits(orgId(), {
      getWalletBalance: service.getWalletBalance,
    });
    expect(gateResult.allowed).toBe(true);

    await service.debitWallet(orgId(), 1, 'drain');

    const postDrain = await checkCredits(orgId(), {
      getWalletBalance: async (id) => {
        await service.invalidateBalanceCache(id);
        return service.getWalletBalance(id);
      },
    });
    expect(postDrain.allowed).toBe(false);
  });
});

describe('wallet security — cache poisoning', () => {
  it('poisoned cache returns inflated balance until TTL expires', async () => {
    const db = createMockDb();
    seedBalance(db, orgId(), 100);

    const cacheFactory = new MemoryCacheStoreFactory();
    const service = createWalletService({ db, cacheFactory });

    const store = cacheFactory.create('wallet_balance');
    await store.set(orgId(), { balanceCents: 999999 }, 30_000);

    expect(await service.getWalletBalance(orgId())).toBe(999999);
  });

  it('poisoned cache bypasses credit gate', async () => {
    const db = createMockDb();
    const cacheFactory = new MemoryCacheStoreFactory();
    const service = createWalletService({ db, cacheFactory });

    const store = cacheFactory.create('wallet_balance');
    await store.set(orgId(), { balanceCents: 10000 }, 30_000);

    const result = await checkCredits(orgId(), {
      getWalletBalance: service.getWalletBalance,
    });
    expect(result.allowed).toBe(true);
  });

  it('malformed cache entry returns undefined (not crash)', async () => {
    const db = createMockDb();
    seedBalance(db, orgId(), 500);

    const cacheFactory = new MemoryCacheStoreFactory();
    const service = createWalletService({ db, cacheFactory });

    const store = cacheFactory.create('wallet_balance');
    await store.set(orgId(), { wrong_key: 'garbage' }, 30_000);

    const balance = await service.getWalletBalance(orgId());
    expect(balance).toBeUndefined();
  });

  it('null injected into cache returns 0 via DB fallback', async () => {
    const db = createMockDb();
    seedBalance(db, orgId(), 500);

    const cacheFactory = new MemoryCacheStoreFactory();
    const service = createWalletService({ db, cacheFactory });

    const store = cacheFactory.create('wallet_balance');
    await store.set(orgId(), null, 30_000);

    const balance = await service.getWalletBalance(orgId());
    expect(balance).toBe(500);
  });
});

describe('credit gate security — path traversal', () => {
  it('URL-encoded paths do not bypass skip check', () => {
    expect(shouldSkipCreditCheck('/api/credits%2Fbalance')).toBe(false);
  });

  it('path traversal within skipped prefix still matches', () => {
    expect(shouldSkipCreditCheck('/api/credits/../agents/run')).toBe(true);
  });

  it('null bytes in path — prefix still matches if before null', () => {
    expect(shouldSkipCreditCheck('/api/credits/\0balance')).toBe(true);
    expect(shouldSkipCreditCheck('/api/agents\0/credits/balance')).toBe(false);
  });

  it('case sensitivity — uppercase does NOT match (case-sensitive)', () => {
    expect(shouldSkipCreditCheck('/API/CREDITS/balance')).toBe(false);
    expect(shouldSkipCreditCheck('/HEALTH')).toBe(false);
    expect(shouldSkipCreditCheck('/Health')).toBe(false);
  });

  it('/threads substring match is scoped to paths containing /threads', () => {
    expect(shouldSkipCreditCheck('/api/agents/threads')).toBe(true);
    expect(shouldSkipCreditCheck('/api/v1/threads/abc')).toBe(true);
    expect(shouldSkipCreditCheck('/api/malicious-threads-abuse')).toBe(false);
  });

  it('/memory substring match skips any path containing /memory', () => {
    expect(shouldSkipCreditCheck('/api/memory/search')).toBe(true);
    expect(shouldSkipCreditCheck('/memory-leak-endpoint')).toBe(true);
  });

  it('empty and root paths are not skipped', () => {
    expect(shouldSkipCreditCheck('')).toBe(false);
    expect(shouldSkipCreditCheck('/')).toBe(false);
  });

  it('/health prefix matches /health/ and /healthz (startsWith is broad)', () => {
    expect(shouldSkipCreditCheck('/health')).toBe(true);
    expect(shouldSkipCreditCheck('/health/')).toBe(true);
    expect(shouldSkipCreditCheck('/healthz')).toBe(true);
    expect(shouldSkipCreditCheck('/healthy-endpoint')).toBe(true);
  });
});

describe('wallet security — org ID injection', () => {
  it('SQL injection in orgId does not crash', async () => {
    const { service } = createTestWallet();
    const balance = await service.getWalletBalance("' OR 1=1; DROP TABLE wallet_transactions; --");
    expect(balance).toBe(0);
  });

  it('prototype pollution orgId does not crash', async () => {
    const { service } = createTestWallet();
    expect(await service.getWalletBalance('__proto__')).toBe(0);
    expect(await service.getWalletBalance('constructor')).toBe(0);
  });

  it('extremely long orgId does not cause OOM', async () => {
    const { service } = createTestWallet();
    expect(await service.getWalletBalance('X'.repeat(100_000))).toBe(0);
  });

  it('orgId with newlines and control characters', async () => {
    const { service } = createTestWallet();
    expect(await service.getWalletBalance('org\n\r\t\0id')).toBe(0);
  });

  it('orgId with unicode homoglyphs are treated as distinct', async () => {
    const { service, db } = createTestWallet();
    seedBalance(db, 'org-abc', 5000);

    expect(await service.getWalletBalance('org-аbc')).toBe(0);
  });
});

describe('wallet security — logUsage manipulation', () => {
  it('negative costUsd is stored (no server-side validation)', async () => {
    const { service, db } = createTestWallet();
    await service.logUsage({
      orgId: orgId(),
      modelId: 'gpt-4o',
      promptTokens: 100,
      completionTokens: 50,
      costUsd: -999.99,
    });

    const logs = db._getTable('ai_usage_logs');
    expect(logs[0].costUsd).toBe('-999.99');
  });

  it('negative token counts are stored (no server-side validation)', async () => {
    const { service, db } = createTestWallet();
    await service.logUsage({
      orgId: orgId(),
      modelId: 'gpt-4o',
      promptTokens: -1000,
      completionTokens: -500,
      costUsd: 0,
    });

    const logs = db._getTable('ai_usage_logs');
    expect(logs[0].promptTokens).toBe(-1000);
    expect(logs[0].totalTokens).toBe(-1500);
  });

  it('XSS payload in modelId is stored raw (output encoding responsibility)', async () => {
    const { service, db } = createTestWallet();
    await service.logUsage({
      orgId: orgId(),
      modelId: '<script>alert("xss")</script>',
      promptTokens: 1,
      completionTokens: 1,
      costUsd: 0,
    });

    const logs = db._getTable('ai_usage_logs');
    expect(logs[0].modelId).toBe('<script>alert("xss")</script>');
  });
});

describe('wallet security — denial of service', () => {
  it('balanceInflight map is cleaned up after resolution', async () => {
    const { service } = createTestWallet();

    await Promise.all(
      Array.from({ length: 1000 }, (_, i) => service.getWalletBalance(orgId(i))),
    );

    expect(service._balanceInflight.size).toBe(0);
  });

  it('inflight map is cleaned up on error path', async () => {
    const failingDb: any = {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: () => ({
                then: (_: any, reject: any) => reject(new Error('boom')),
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

    await service.getWalletBalance(orgId());
    expect(service._balanceInflight.size).toBe(0);
  });

  it('1000 unique org balance checks do not leak inflight entries', async () => {
    const { service } = createTestWallet();

    for (let i = 0; i < 1000; i++) {
      await service.getWalletBalance(orgId(i));
    }

    expect(service._balanceInflight.size).toBe(0);
  });
});

describe('credit gate security — error handling', () => {
  it('exactly 0 balance is blocked', async () => {
    const result = await checkCredits(orgId(), {
      getWalletBalance: async () => 0,
    });
    expect(result.allowed).toBe(false);
  });

  it('balance of 1 cent is allowed', async () => {
    const result = await checkCredits(orgId(), {
      getWalletBalance: async () => 1,
    });
    expect(result.allowed).toBe(true);
  });

  it('negative balance is blocked', async () => {
    const result = await checkCredits(orgId(), {
      getWalletBalance: async () => -1,
    });
    expect(result.allowed).toBe(false);
  });

  it('402 response includes error code and upgrade URL', async () => {
    const result = await checkCredits(orgId(), {
      getWalletBalance: async () => 0,
    });

    expect(result.response).toBeDefined();
    expect(result.response!.status).toBe(402);

    const body = await result.response!.json();
    expect(body.error).toBe('CREDITS_EXHAUSTED');
    expect(body.details.upgrade_url).toBe('/billing');
  });

  it('getWalletBalance error fails closed — blocks the request', async () => {
    const result = await checkCredits(orgId(), {
      getWalletBalance: async () => { throw new Error('db down'); },
    });
    expect(result.allowed).toBe(false);
    expect(result.balanceCents).toBe(0);
  });

  it('getWalletBalance returning NaN is blocked', async () => {
    const result = await checkCredits(orgId(), {
      getWalletBalance: async () => NaN,
    });
    expect(result.allowed).toBe(false);
  });
});
