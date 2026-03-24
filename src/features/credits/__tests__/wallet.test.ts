import { describe, it, expect, beforeEach } from 'vitest';
import { createTestWallet, seedBalance, orgId } from './helpers';

describe('wallet service', () => {
  describe('getWalletBalance', () => {
    it('returns 0 for org with no transactions', async () => {
      const { service } = createTestWallet();
      expect(await service.getWalletBalance(orgId())).toBe(0);
    });

    it('returns seeded balance', async () => {
      const { service, db } = createTestWallet();
      seedBalance(db, orgId(), 5000);
      expect(await service.getWalletBalance(orgId())).toBe(5000);
    });

    it('returns cached value on second call', async () => {
      const { service, db } = createTestWallet();
      seedBalance(db, orgId(), 3000);

      const first = await service.getWalletBalance(orgId());
      db._getTable('wallet_transactions').length = 0;
      const second = await service.getWalletBalance(orgId());

      expect(first).toBe(3000);
      expect(second).toBe(3000);
    });

    it('isolates balances across orgs', async () => {
      const { service, db } = createTestWallet();
      seedBalance(db, orgId(1), 1000);
      seedBalance(db, orgId(2), 9999);

      expect(await service.getWalletBalance(orgId(1))).toBe(1000);
      expect(await service.getWalletBalance(orgId(2))).toBe(9999);
    });
  });

  describe('creditWallet', () => {
    it('adds credits to empty wallet', async () => {
      const { service } = createTestWallet();
      const result = await service.creditWallet(orgId(), 500, 'topup');
      expect(result).toEqual({ balance: 500 });
    });

    it('adds credits to existing balance', async () => {
      const { service, db } = createTestWallet();
      seedBalance(db, orgId(), 1000);
      const result = await service.creditWallet(orgId(), 500, 'topup');
      expect(result).toEqual({ balance: 1500 });
    });

    it('returns null for zero amount', async () => {
      const { service } = createTestWallet();
      expect(await service.creditWallet(orgId(), 0, 'noop')).toBeNull();
    });

    it('returns null for negative amount', async () => {
      const { service } = createTestWallet();
      expect(await service.creditWallet(orgId(), -100, 'noop')).toBeNull();
    });

    it('is idempotent with same referenceId', async () => {
      const { service } = createTestWallet();
      const first = await service.creditWallet(orgId(), 1000, 'purchase', 'ref-1');
      const second = await service.creditWallet(orgId(), 1000, 'purchase', 'ref-1');

      expect(first).toEqual({ balance: 1000 });
      expect(second!.balance).toBe(1000);
    });

    it('allows different referenceIds', async () => {
      const { service } = createTestWallet();
      await service.creditWallet(orgId(), 1000, 'purchase', 'ref-1');
      const result = await service.creditWallet(orgId(), 500, 'purchase', 'ref-2');
      expect(result).toEqual({ balance: 1500 });
    });

    it('credits without referenceId are never deduplicated', async () => {
      const { service } = createTestWallet();
      await service.creditWallet(orgId(), 100, 'bonus');
      await service.creditWallet(orgId(), 100, 'bonus');
      await service.creditWallet(orgId(), 100, 'bonus');

      const balance = await service.getWalletBalance(orgId());
      expect(balance).toBe(300);
    });
  });

  describe('debitWallet', () => {
    it('deducts from balance', async () => {
      const { service, db } = createTestWallet();
      seedBalance(db, orgId(), 1000);
      const result = await service.debitWallet(orgId(), 300, 'usage');
      expect(result).toEqual({ balance: 700 });
    });

    it('floors balance at 0 — never goes negative', async () => {
      const { service, db } = createTestWallet();
      seedBalance(db, orgId(), 100);
      const result = await service.debitWallet(orgId(), 500, 'usage');
      expect(result!.balance).toBe(0);
    });

    it('returns null for zero amount', async () => {
      const { service } = createTestWallet();
      expect(await service.debitWallet(orgId(), 0, 'noop')).toBeNull();
    });

    it('returns null for negative amount', async () => {
      const { service } = createTestWallet();
      expect(await service.debitWallet(orgId(), -50, 'noop')).toBeNull();
    });

    it('debit from empty wallet results in 0', async () => {
      const { service } = createTestWallet();
      const result = await service.debitWallet(orgId(), 100, 'usage');
      expect(result!.balance).toBe(0);
    });

    it('sequential debits track running balance', async () => {
      const { service, db } = createTestWallet();
      seedBalance(db, orgId(), 1000);

      const r1 = await service.debitWallet(orgId(), 200, 'usage-1');
      const r2 = await service.debitWallet(orgId(), 300, 'usage-2');
      const r3 = await service.debitWallet(orgId(), 100, 'usage-3');

      expect(r1!.balance).toBe(800);
      expect(r2!.balance).toBe(500);
      expect(r3!.balance).toBe(400);
    });
  });

  describe('invalidateBalanceCache', () => {
    it('forces next getWalletBalance to re-query', async () => {
      const { service, db } = createTestWallet();
      seedBalance(db, orgId(), 5000);

      await service.getWalletBalance(orgId());

      seedBalance(db, orgId(), 9999);

      await service.invalidateBalanceCache(orgId());
      const fresh = await service.getWalletBalance(orgId());
      expect(fresh).toBe(9999);
    });
  });

  describe('logUsage', () => {
    it('inserts usage log row', async () => {
      const { service, db } = createTestWallet();
      await service.logUsage({
        orgId: orgId(),
        modelId: 'gpt-4o',
        promptTokens: 100,
        completionTokens: 50,
        costUsd: 0.005,
      });

      const logs = db._getTable('ai_usage_logs');
      expect(logs).toHaveLength(1);
      expect(logs[0].modelId).toBe('gpt-4o');
      expect(logs[0].totalTokens).toBe(150);
      expect(logs[0].costUsd).toBe('0.005');
      expect(logs[0].status).toBe('success');
    });

    it('maps optional fields correctly', async () => {
      const { service, db } = createTestWallet();
      await service.logUsage({
        orgId: orgId(),
        userId: 'user-1',
        modelId: 'claude-3',
        promptTokens: 200,
        completionTokens: 100,
        cachedTokens: 50,
        reasoningTokens: 30,
        costUsd: 0.01,
        requestType: 'agent_chat',
        agentId: 'agent-1',
        sessionId: 'sess-1',
        latencyMs: 1200,
        status: 'error',
      });

      const row = db._getTable('ai_usage_logs')[0];
      expect(row.userId).toBe('user-1');
      expect(row.cachedTokens).toBe(50);
      expect(row.reasoningTokens).toBe(30);
      expect(row.requestType).toBe('agent_chat');
      expect(row.agentId).toBe('agent-1');
      expect(row.sessionId).toBe('sess-1');
      expect(row.latencyMs).toBe(1200);
      expect(row.status).toBe('error');
    });

    it('defaults optional fields to null/0/success', async () => {
      const { service, db } = createTestWallet();
      await service.logUsage({
        orgId: orgId(),
        modelId: 'gpt-4o',
        promptTokens: 10,
        completionTokens: 5,
        costUsd: 0.001,
      });

      const row = db._getTable('ai_usage_logs')[0];
      expect(row.userId).toBeNull();
      expect(row.cachedTokens).toBe(0);
      expect(row.reasoningTokens).toBe(0);
      expect(row.requestType).toBeNull();
      expect(row.agentId).toBeNull();
      expect(row.sessionId).toBeNull();
      expect(row.latencyMs).toBeNull();
      expect(row.status).toBe('success');
    });
  });

  describe('getWalletLedger', () => {
    it('returns empty for org with no transactions', async () => {
      const { service } = createTestWallet();
      const result = await service.getWalletLedger(orgId());
      expect(result).toEqual({ items: [], total_count: 0 });
    });
  });

  describe('credit + debit integration', () => {
    it('maintains correct running balance through mixed operations', async () => {
      const { service } = createTestWallet();
      const id = orgId();

      await service.creditWallet(id, 1000, 'initial');
      await service.debitWallet(id, 200, 'use-1');
      await service.creditWallet(id, 500, 'topup');
      await service.debitWallet(id, 800, 'use-2');

      await service.invalidateBalanceCache(id);
      const balance = await service.getWalletBalance(id);
      expect(balance).toBe(500);
    });

    it('overdraft scenario floors at zero then credits resume', async () => {
      const { service } = createTestWallet();
      const id = orgId();

      await service.creditWallet(id, 100, 'start');
      await service.debitWallet(id, 999, 'big-usage');

      await service.invalidateBalanceCache(id);
      expect(await service.getWalletBalance(id)).toBe(0);

      await service.creditWallet(id, 250, 'topup');
      await service.invalidateBalanceCache(id);
      expect(await service.getWalletBalance(id)).toBe(250);
    });
  });
});
