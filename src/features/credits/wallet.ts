import { eq, desc, sql, and } from 'drizzle-orm';
import { walletTransactions, autoTopupSettings, aiUsageLogs } from './schema';
import type { CacheStore, CacheStoreFactory } from '../../cache';
import { getContainer } from '../../container';
import type { Pool } from 'pg';

const BALANCE_CACHE_TTL = 30_000;
const AUTO_TOPUP_COOLDOWN_MS = 60_000;
const AUTO_TOPUP_FETCH_TIMEOUT_MS = 10_000;

export type WalletDeps = {
  db: { insert: Function; select: Function; [k: string]: unknown };
  cacheFactory: CacheStoreFactory;
  pool?: Pool;
};

type WalletLedgerEntry = {
  id: string;
  amount: number;
  entry_type: string;
  reason: string | null;
  balance_after: number;
  created_at: string;
};

export type LogUsageParams = {
  orgId: string;
  userId?: string;
  modelId: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  costUsd: number;
  requestType?: string;
  agentId?: string;
  workflowId?: string;
  sessionId?: string;
  latencyMs?: number;
  status?: string;
};

export function createWalletService(deps: WalletDeps) {
  const balanceStore: CacheStore = deps.cacheFactory.create('wallet_balance');
  const topupStore: CacheStore = deps.cacheFactory.create('wallet_topup');
  const balanceInflight = new Map<string, Promise<number>>();

  function db() {
    return deps.db;
  }

  async function latestBalance(orgId: string): Promise<number> {
    const rows = await db()
      .select({ balanceAfterCents: walletTransactions.balanceAfterCents })
      .from(walletTransactions)
      .where(eq(walletTransactions.organizationId, orgId))
      .orderBy(desc(walletTransactions.createdAt))
      .limit(1);
    return rows[0]?.balanceAfterCents ?? 0;
  }

  async function getWalletBalance(orgId: string): Promise<number> {
    try {
      const cached = await balanceStore.get<{ balanceCents: number }>(orgId);
      if (cached) return cached.balanceCents;
    } catch {
    }

    const inflight = balanceInflight.get(orgId);
    if (inflight) return inflight;

    const promise = (async (): Promise<number> => {
      try {
        const balanceCents = await latestBalance(orgId);
        await balanceStore.set(orgId, { balanceCents }, BALANCE_CACHE_TTL).catch(() => {});
        return balanceCents;
      } catch {
        return 0;
      } finally {
        balanceInflight.delete(orgId);
      }
    })();

    balanceInflight.set(orgId, promise);
    return promise;
  }

  async function creditWallet(
    orgId: string,
    amountCents: number,
    reason: string,
    referenceId?: string,
  ): Promise<{ balance: number } | null> {
    if (!Number.isFinite(amountCents) || amountCents <= 0) return null;

    const pool = deps.pool;
    if (!pool) {
      try {
        if (referenceId) {
          const existing = await db()
            .select({ id: walletTransactions.id })
            .from(walletTransactions)
            .where(eq(walletTransactions.referenceId, referenceId))
            .limit(1);
          if (existing.length > 0) {
            const bal = await getWalletBalance(orgId);
            return { balance: bal };
          }
        }

        const currentBalance = await latestBalance(orgId);
        const newBalance = currentBalance + amountCents;
        await db().insert(walletTransactions).values({
          organizationId: orgId,
          amountCents,
          entryType: 'credit',
          balanceAfterCents: newBalance,
          reason,
          referenceId: referenceId ?? null,
        });
        await balanceStore.set(orgId, { balanceCents: newBalance }, BALANCE_CACHE_TTL);
        return { balance: newBalance };
      } catch {
        return null;
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      if (referenceId) {
        const { rows: existing } = await client.query(
          `SELECT id FROM wallet_transactions WHERE reference_id = $1 LIMIT 1`,
          [referenceId],
        );
        if (existing.length > 0) {
          await client.query('ROLLBACK');
          const bal = await getWalletBalance(orgId);
          return { balance: bal };
        }
      }

      const { rows } = await client.query(
        `INSERT INTO wallet_transactions (organization_id, amount_cents, entry_type, balance_after_cents, reason, reference_id)
         SELECT $1, $2, 'credit',
                COALESCE((SELECT balance_after_cents FROM wallet_transactions WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 1 FOR UPDATE), 0) + $2,
                $3, $4
         RETURNING balance_after_cents`,
        [orgId, amountCents, reason, referenceId ?? null],
      );
      await client.query('COMMIT');

      const newBalance = rows[0]?.balance_after_cents ?? 0;
      await balanceStore.set(orgId, { balanceCents: newBalance }, BALANCE_CACHE_TTL);
      return { balance: newBalance };
    } catch {
      await client.query('ROLLBACK').catch(() => {});
      return null;
    } finally {
      client.release();
    }
  }

  async function debitWallet(
    orgId: string,
    amountCents: number,
    reason: string,
  ): Promise<{ balance: number } | null> {
    if (!Number.isFinite(amountCents) || amountCents <= 0) return null;

    const pool = deps.pool;
    if (!pool) {
      try {
        const currentBalance = await latestBalance(orgId);
        const newBalance = Math.max(currentBalance - amountCents, 0);
        await db().insert(walletTransactions).values({
          organizationId: orgId,
          amountCents,
          entryType: 'debit',
          balanceAfterCents: newBalance,
          reason,
        });
        await balanceStore.set(orgId, { balanceCents: newBalance }, BALANCE_CACHE_TTL);
        maybeAutoTopUp(orgId, newBalance).catch(() => {});
        return { balance: newBalance };
      } catch {
        return null;
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows } = await client.query(
        `INSERT INTO wallet_transactions (organization_id, amount_cents, entry_type, balance_after_cents, reason)
         SELECT $1, $2, 'debit',
                GREATEST(COALESCE((SELECT balance_after_cents FROM wallet_transactions WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 1 FOR UPDATE), 0) - $2, 0),
                $3
         RETURNING balance_after_cents`,
        [orgId, amountCents, reason],
      );
      await client.query('COMMIT');

      const newBalance = rows[0]?.balance_after_cents ?? 0;
      await balanceStore.set(orgId, { balanceCents: newBalance }, BALANCE_CACHE_TTL);
      maybeAutoTopUp(orgId, newBalance).catch(() => {});
      return { balance: newBalance };
    } catch {
      await client.query('ROLLBACK').catch(() => {});
      return null;
    } finally {
      client.release();
    }
  }

  async function getWalletLedger(
    orgId: string,
    limit = 20,
    offset = 0,
  ): Promise<{ items: WalletLedgerEntry[]; total_count: number }> {
    try {
      const rows = await db()
        .select({
          id: walletTransactions.id,
          amountCents: walletTransactions.amountCents,
          entryType: walletTransactions.entryType,
          reason: walletTransactions.reason,
          balanceAfterCents: walletTransactions.balanceAfterCents,
          createdAt: walletTransactions.createdAt,
          totalCount: sql<number>`count(*) OVER()`.as('total_count'),
        })
        .from(walletTransactions)
        .where(eq(walletTransactions.organizationId, orgId))
        .orderBy(desc(walletTransactions.createdAt))
        .limit(limit)
        .offset(offset);

      const totalCount = rows[0]?.totalCount ?? 0;

      return {
        items: rows.map((r: Record<string, unknown>) => ({
          id: r.id,
          amount: r.amountCents,
          entry_type: r.entryType,
          reason: r.reason,
          balance_after: r.balanceAfterCents,
          created_at: (r.createdAt instanceof Date
            ? r.createdAt
            : new Date(String(r.createdAt))).toISOString(),
        })),
        total_count: totalCount,
      };
    } catch {
      return { items: [], total_count: 0 };
    }
  }

  async function logUsage(params: LogUsageParams): Promise<void> {
    try {
      await db().insert(aiUsageLogs).values({
        organizationId: params.orgId,
        userId: params.userId ?? null,
        modelId: params.modelId,
        promptTokens: params.promptTokens,
        completionTokens: params.completionTokens,
        totalTokens: params.promptTokens + params.completionTokens,
        cachedTokens: params.cachedTokens ?? 0,
        reasoningTokens: params.reasoningTokens ?? 0,
        costUsd: String(params.costUsd),
        requestType: params.requestType ?? null,
        agentId: params.agentId ?? null,
        workflowId: params.workflowId ?? null,
        sessionId: params.sessionId ?? null,
        latencyMs: params.latencyMs ?? null,
        status: params.status ?? 'success',
      });
    } catch {
    }
  }

  async function invalidateBalanceCache(orgId: string): Promise<void> {
    await balanceStore.delete(orgId);
  }

  async function maybeAutoTopUp(orgId: string, currentBalance: number): Promise<void> {
    const existing = await topupStore.get<boolean>(orgId);
    if (existing) return;

    try {
      const settings = await db()
        .select()
        .from(autoTopupSettings)
        .where(and(
          eq(autoTopupSettings.organizationId, orgId),
          eq(autoTopupSettings.enabled, true),
        ))
        .limit(1);

      const row = settings[0];
      if (!row?.subscriptionId) return;
      if (currentBalance >= row.thresholdCents) return;

      const now = Date.now();
      if (row.lastTriggeredAt && now - row.lastTriggeredAt.getTime() < AUTO_TOPUP_COOLDOWN_MS) return;

      await topupStore.set(orgId, true, AUTO_TOPUP_COOLDOWN_MS);

      const authUrl = process.env.AUTH_SERVICE_URL || 'http://localhost:9090';
      const cronSecret = process.env.INTERNAL_CRON_SECRET;
      if (!cronSecret) return;

      await fetch(`${authUrl}/api/internal/auto-topup-sweep?org_id=${encodeURIComponent(orgId)}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${cronSecret}` },
        signal: AbortSignal.timeout(AUTO_TOPUP_FETCH_TIMEOUT_MS),
      });
    } catch {
    } finally {
      await topupStore.delete(orgId);
    }
  }

  return {
    getWalletBalance,
    creditWallet,
    debitWallet,
    getWalletLedger,
    logUsage,
    invalidateBalanceCache,
    _balanceInflight: balanceInflight,
  };
}

export type WalletService = ReturnType<typeof createWalletService>;

let _default: WalletService | null = null;

function defaultService(): WalletService {
  if (!_default) {
    const c = getContainer();
    let pool: Pool | undefined;
    try {
      const { getPool } = require('../../db/pool');
      const { config } = require('../../config');
      const databaseUrl = process.env.DATABASE_URL || config.databaseUrl;
      if (databaseUrl) pool = getPool(databaseUrl);
    } catch {}
    _default = createWalletService({
      db: c.db as unknown as WalletDeps['db'],
      cacheFactory: c.cacheFactory,
      pool,
    });
  }
  return _default;
}

export function resetDefaultWalletService(): void {
  _default = null;
}

export async function getWalletBalance(orgId: string): Promise<number> {
  return defaultService().getWalletBalance(orgId);
}

export async function creditWallet(
  orgId: string,
  amountCents: number,
  reason: string,
  referenceId?: string,
): Promise<{ balance: number } | null> {
  return defaultService().creditWallet(orgId, amountCents, reason, referenceId);
}

export async function debitWallet(
  orgId: string,
  amountCents: number,
  reason: string,
): Promise<{ balance: number } | null> {
  return defaultService().debitWallet(orgId, amountCents, reason);
}

export async function getWalletLedger(
  orgId: string,
  limit?: number,
  offset?: number,
): Promise<{ items: WalletLedgerEntry[]; total_count: number }> {
  return defaultService().getWalletLedger(orgId, limit, offset);
}

export async function logUsage(params: LogUsageParams): Promise<void> {
  return defaultService().logUsage(params);
}

export async function invalidateBalanceCache(orgId: string): Promise<void> {
  return defaultService().invalidateBalanceCache(orgId);
}
