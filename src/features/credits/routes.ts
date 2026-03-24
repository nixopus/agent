import type { ApiRoute } from '@mastra/core/server';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { getUsageHistory, getUsageLogs } from './service';
import { getWalletBalance, getWalletLedger, invalidateBalanceCache } from './wallet';
import { fetchMachineStatus } from './machine-status';
import { ValidationError, toErrorResponse } from '../../errors';
import { parseQuery, CreditUsageQuerySchema, PaginatedQuerySchema } from '../../validation';
import { config } from '../../config';

function extractOrgId(c: { req: { query: (key: string) => string | undefined }; get: (key: string) => unknown }): string | undefined {
  const fromQuery = c.req.query('orgId');
  if (fromQuery) return fromQuery;
  const requestContext = c.get('requestContext') as { get?: (k: string) => string } | undefined;
  return requestContext?.get?.('organizationId');
}

function buildMachineMessage(status: string | undefined, daysRemaining: number | null | undefined): string | null {
  if (status === 'grace_period' && daysRemaining != null) {
    return `Your server will be reset in ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} if wallet is not topped up.`;
  }
  if (status === 'suspended') {
    return 'Your server was reset due to insufficient wallet balance. Top up your wallet to restore service.';
  }
  return null;
}

export const creditRoutes: ApiRoute[] = [
  {
    path: '/api/credits/balance',
    method: 'GET',
    createHandler: async () => async (c) => {
      if (config.selfHosted) {
        return c.json({ balance_usd: null, credits_enabled: false });
      }

      try {
        const orgId = extractOrgId(c);
        if (!orgId) throw new ValidationError('orgId is required');

        const [balanceCents, machineStatus] = await Promise.all([
          getWalletBalance(orgId),
          fetchMachineStatus(orgId).catch(() => null),
        ]);

        const result: Record<string, unknown> = { balance_usd: balanceCents };

        if (machineStatus?.has_machine) {
          result.machine = {
            has_machine: true,
            plan_tier: machineStatus.plan?.tier ?? null,
            status: machineStatus.status ?? null,
            monthly_cost_cents: machineStatus.plan?.monthly_cost_cents ?? null,
            grace_deadline: machineStatus.grace_deadline ?? null,
            days_remaining: machineStatus.days_remaining ?? null,
            message: buildMachineMessage(machineStatus.status, machineStatus.days_remaining),
          };
        }

        return c.json(result);
      } catch (err) {
        const { body, status } = toErrorResponse(err);
        return c.json(body, status as ContentfulStatusCode);
      }
    },
  },
  {
    path: '/api/internal/credits/invalidate',
    method: 'POST',
    createHandler: async () => async (c) => {
      const expectedSecret = process.env.INTERNAL_CRON_SECRET;
      if (!expectedSecret) {
        return c.json({ error: 'INTERNAL_CRON_SECRET is not configured' }, 500 as 500);
      }

      const authHeader = c.req.header('Authorization') ?? '';
      const provided = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
      if (!provided || provided !== expectedSecret) {
        return c.json({ error: 'Unauthorized' }, 401 as 401);
      }

      const orgId = c.req.query('org_id') || c.req.query('orgId');
      if (!orgId) {
        return c.json({ error: 'org_id is required' }, 400 as 400);
      }

      await invalidateBalanceCache(orgId);
      return c.json({ ok: true, org_id: orgId });
    },
  },

  {
    path: '/api/credits/usage',
    method: 'GET',
    createHandler: async () => async (c) => {
      try {
        const orgId = extractOrgId(c);
        if (!orgId) throw new ValidationError('orgId is required');

        const q = parseQuery(CreditUsageQuerySchema, {
          orgId: c.req.query('orgId'),
          period: c.req.query('period'),
          groupBy: c.req.query('groupBy'),
        });
        if (!q.ok) return q.response;

        const usage = await getUsageHistory(orgId, q.data.period, q.data.groupBy);
        return c.json(usage);
      } catch (err) {
        const { body, status } = toErrorResponse(err);
        return c.json(body, status as ContentfulStatusCode);
      }
    },
  },

  {
    path: '/api/credits/transactions',
    method: 'GET',
    createHandler: async () => async (c) => {
      try {
        const orgId = extractOrgId(c);
        if (!orgId) throw new ValidationError('orgId is required');

        const q = parseQuery(PaginatedQuerySchema, {
          orgId: c.req.query('orgId'),
          limit: c.req.query('limit'),
          offset: c.req.query('offset'),
        });
        if (!q.ok) return q.response;

        const ledger = await getWalletLedger(orgId, q.data.limit, q.data.offset);
        return c.json(ledger);
      } catch (err) {
        const { body, status } = toErrorResponse(err);
        return c.json(body, status as ContentfulStatusCode);
      }
    },
  },

  {
    path: '/api/credits/usage-logs',
    method: 'GET',
    createHandler: async () => async (c) => {
      try {
        const orgId = extractOrgId(c);
        if (!orgId) throw new ValidationError('orgId is required');

        const q = parseQuery(PaginatedQuerySchema, {
          orgId: c.req.query('orgId'),
          limit: c.req.query('limit'),
          offset: c.req.query('offset'),
        });
        if (!q.ok) return q.response;

        const logs = await getUsageLogs(orgId, { limit: q.data.limit, offset: q.data.offset });
        return c.json(logs);
      } catch (err) {
        const { body, status } = toErrorResponse(err);
        return c.json(body, status as ContentfulStatusCode);
      }
    },
  },
];
