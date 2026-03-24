import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getWalletBalance, getWalletLedger } from '../../../features/credits/wallet';
import { getUsageHistory, getUsageLogs } from '../../../features/credits/service';
import { fetchMachineStatus } from '../../../features/credits/machine-status';
import { listAvailableMachinePlans, selectAMachinePlan } from '@nixopus/api-client';
import { getClient } from '../api/shared';
import { config } from '../../../config';

type RequestContext = { requestContext?: { get?: (k: string) => string } };

function getOrgId(ctx: unknown): string | null {
  const c = ctx as RequestContext;
  const orgId = c?.requestContext?.get?.('organizationId');
  return orgId?.trim() || null;
}

const SELF_HOSTED_MSG = { info: 'Credits and billing are not available in self-hosted mode.' };

export const getCreditBalanceTool = createTool({
  id: 'get_credit_balance',
  description: 'Read-only. Get current AI credit balance for the organization. Balance is in cents (USD).',
  inputSchema: z.object({}).optional(),
  execute: async (_inputData, ctx) => {
    if (config.selfHosted) return SELF_HOSTED_MSG;
    const orgId = getOrgId(ctx);
    if (!orgId) return { error: 'Organization context required. Ensure you are authenticated with an organization.' };
    const balanceCents = await getWalletBalance(orgId);
    return {
      balance_usd_cents: balanceCents,
      balance_usd: (balanceCents / 100).toFixed(2),
    };
  },
});

export const getCreditUsageTool = createTool({
  id: 'get_credit_usage',
  description: 'Read-only. Get AI usage history: cost and token consumption aggregated by period. Shows total_tokens, total_cost_usd, breakdown by model/user/day, and daily_usage.',
  inputSchema: z.object({
    period: z.enum(['7d', '30d', '90d']).default('30d').describe('Time range: 7d, 30d, or 90d'),
    groupBy: z.enum(['model', 'user', 'day']).default('day').describe('Group breakdown by model, user, or day'),
  }).optional(),
  execute: async (inputData, ctx) => {
    if (config.selfHosted) return SELF_HOSTED_MSG;
    const orgId = getOrgId(ctx);
    if (!orgId) return { error: 'Organization context required. Ensure you are authenticated with an organization.' };
    const period = (inputData?.period ?? '30d') as '7d' | '30d' | '90d';
    const groupBy = (inputData?.groupBy ?? 'day') as 'model' | 'user' | 'day';
    return getUsageHistory(orgId, period, groupBy);
  },
});

export const getTokenConsumptionTool = createTool({
  id: 'get_token_consumption',
  description: 'Read-only. Get token consumption summary: total tokens, breakdown by model, and daily token usage. Use for "how many tokens did I use" questions.',
  inputSchema: z.object({
    period: z.enum(['7d', '30d', '90d']).default('30d').describe('Time range: 7d, 30d, or 90d'),
  }).optional(),
  execute: async (inputData, ctx) => {
    if (config.selfHosted) return SELF_HOSTED_MSG;
    const orgId = getOrgId(ctx);
    if (!orgId) return { error: 'Organization context required. Ensure you are authenticated with an organization.' };
    const period = (inputData?.period ?? '30d') as '7d' | '30d' | '90d';
    const usage = await getUsageHistory(orgId, period, 'model');
    return {
      total_tokens: usage.total_tokens,
      total_requests: usage.breakdown.reduce((sum, b) => sum + b.request_count, 0),
      by_model: usage.breakdown.map((b) => ({ model: b.key, tokens: b.total_tokens, requests: b.request_count })),
      daily: usage.daily_usage.map((d) => ({ date: d.date, tokens: d.tokens, requests: d.requests })),
    };
  },
});

export const getCreditTransactionsTool = createTool({
  id: 'get_credit_transactions',
  description: 'Read-only. Get wallet transaction ledger: credits (top-ups, purchases) and debits (AI usage). Paginated. Use limit/offset to page; check has_more for next page.',
  inputSchema: z.object({
    limit: z.number().int().min(1).max(100).default(20).optional(),
    offset: z.number().int().min(0).default(0).optional(),
  }).optional(),
  execute: async (inputData, ctx) => {
    if (config.selfHosted) return SELF_HOSTED_MSG;
    const orgId = getOrgId(ctx);
    if (!orgId) return { error: 'Organization context required. Ensure you are authenticated with an organization.' };
    const limit = inputData?.limit ?? 20;
    const offset = inputData?.offset ?? 0;
    const ledger = await getWalletLedger(orgId, limit, offset);
    const returned = ledger.items.length;
    return {
      items: ledger.items,
      pagination: {
        limit,
        offset,
        returned_count: returned,
        total_count: ledger.total_count,
        has_more: offset + returned < ledger.total_count,
        next_offset: offset + returned < ledger.total_count ? offset + limit : null,
      },
    };
  },
});

export const getCreditUsageLogsTool = createTool({
  id: 'get_credit_usage_logs',
  description: 'Read-only. Get detailed AI usage logs: per-request prompt_tokens, completion_tokens, total_tokens, cached_tokens, reasoning_tokens, cost_usd, model, agent. Paginated. Use limit/offset to page; check has_more for next page.',
  inputSchema: z.object({
    limit: z.number().int().min(1).max(100).default(20).optional(),
    offset: z.number().int().min(0).default(0).optional(),
  }).optional(),
  execute: async (inputData, ctx) => {
    if (config.selfHosted) return SELF_HOSTED_MSG;
    const orgId = getOrgId(ctx);
    if (!orgId) return { error: 'Organization context required. Ensure you are authenticated with an organization.' };
    const limit = inputData?.limit ?? 20;
    const offset = inputData?.offset ?? 0;
    const logs = await getUsageLogs(orgId, { limit, offset });
    const returned = logs.items.length;
    return {
      items: logs.items,
      pagination: {
        limit,
        offset,
        returned_count: returned,
        total_count: logs.total_count,
        has_more: offset + returned < logs.total_count,
        next_offset: offset + returned < logs.total_count ? offset + limit : null,
      },
    };
  },
});

export const getBillingUrlTool = createTool({
  id: 'get_billing_url',
  description: 'Get the billing dashboard URL. Use action param to deep-link: topup (add credits), auto_topup (set up auto top-up), invoices (billing overview). Without action, returns general billing page.',
  inputSchema: z.object({
    action: z
      .enum(['topup', 'auto_topup', 'invoices'])
      .optional()
      .describe('topup: open Top Up modal; auto_topup: open Auto Top-Up dialog; invoices: billing page'),
  }).optional(),
  execute: async (inputData) => {
    if (config.selfHosted) return SELF_HOSTED_MSG;
    const base = config.dashboardUrl || 'http://localhost:3000';
    const root = `${base.replace(/\/$/, '')}/billing`;
    const action = inputData?.action;
    const billingUrl =
      action === 'topup'
        ? `${root}?action=topup`
        : action === 'auto_topup'
          ? `${root}?action=auto-topup`
          : root;
    const messages: Record<string, string> = {
      topup: 'Opening Top Up — add credits directly.',
      auto_topup: 'Opening Auto Top-Up — set up automatic credit replenishment.',
      invoices: 'Opening billing page for invoices and payment history.',
    };
    return {
      billing_url: billingUrl,
      invoices_url: root,
      action: action ?? null,
      message: action ? messages[action] : 'Open the billing page to download invoices, view payment history, and manage payment methods.',
    };
  },
});

export const getMachinePlanTool = createTool({
  id: 'get_machine_plan',
  description: 'Read-only. Get the machine plan and billing status for the organization. Shows plan tier, monthly cost, billing period, grace deadline if applicable, and current status (active, grace_period, suspended).',
  inputSchema: z.object({}).optional(),
  execute: async (_inputData, ctx) => {
    if (config.selfHosted) return SELF_HOSTED_MSG;
    const orgId = getOrgId(ctx);
    if (!orgId) return { error: 'Organization context required. Ensure you are authenticated with an organization.' };

    const status = await fetchMachineStatus(orgId);
    if (!status) return { error: 'Unable to retrieve machine status.' };

    if (!status.has_machine) {
      return { has_machine: false, message: 'No machine is provisioned for this organization.' };
    }

    const result: Record<string, unknown> = {
      has_machine: true,
      status: status.status,
    };

    if (status.plan) {
      result.plan = {
        tier: status.plan.tier,
        name: status.plan.name,
        monthly_cost_usd: (status.plan.monthly_cost_cents / 100).toFixed(2),
        monthly_cost_cents: status.plan.monthly_cost_cents,
        ram_mb: status.plan.ram_mb,
        vcpu: status.plan.vcpu,
        storage_mb: status.plan.storage_mb,
      };
    }

    if (status.current_period_end) {
      result.current_period_end = status.current_period_end;
    }

    if (status.status === 'grace_period') {
      result.grace_deadline = status.grace_deadline;
      result.days_remaining = status.days_remaining;
      const cost = status.plan ? `$${(status.plan.monthly_cost_cents / 100).toFixed(2)}` : 'the monthly cost';
      result.warning = `Your server will be reset in ${status.days_remaining ?? 0} day(s). Wallet balance is insufficient to cover ${cost}. Top up now to keep your server.`;
    }

    if (status.status === 'suspended') {
      result.warning = 'Your server was reset due to insufficient wallet balance. Top up your wallet and select a machine plan to restore service.';
    }

    if (status.status === 'unbilled') {
      result.warning = 'Your machine does not have a billing plan configured. A plan will be required for continued use.';
    }

    return result;
  },
});

export const listMachinePlansTool = createTool({
  id: 'list_machine_plans',
  description: 'List all available machine plans with pricing and specs. Use this when user asks about plan options, wants to upgrade/downgrade, or needs to pick a machine.',
  inputSchema: z.object({}).optional(),
  execute: async (_inputData, ctx) => {
    if (config.selfHosted) return SELF_HOSTED_MSG;
    try {
      const resp = await listAvailableMachinePlans({ client: getClient(ctx) as any });
      const result = resp as Record<string, unknown>;
      return result.data ?? resp;
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : 'Failed to list machine plans.' };
    }
  },
});

export const selectMachinePlanTool = createTool({
  id: 'select_machine_plan',
  description: 'Select a machine plan for the organization. This charges the monthly cost from the wallet immediately. ALWAYS confirm with the user before calling this tool — show them the plan name, specs, and monthly cost, and ask for explicit confirmation.',
  inputSchema: z.object({
    plan_tier: z.string().describe('The plan tier to select (e.g. "machine_1", "machine_2", "machine_3", "machine_4")'),
  }),
  execute: async (inputData, ctx) => {
    if (config.selfHosted) return SELF_HOSTED_MSG;
    try {
      const resp = await selectAMachinePlan({ client: getClient(ctx) as any, body: { plan_tier: inputData.plan_tier } });
      const result = resp as Record<string, unknown>;
      return result.data ?? resp;
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : 'Failed to select machine plan.' };
    }
  },
});

export const billingTools = {
  getCreditBalance: getCreditBalanceTool,
  getCreditUsage: getCreditUsageTool,
  getTokenConsumption: getTokenConsumptionTool,
  getCreditTransactions: getCreditTransactionsTool,
  getCreditUsageLogs: getCreditUsageLogsTool,
  getBillingUrl: getBillingUrlTool,
  getMachinePlan: getMachinePlanTool,
  listMachinePlans: listMachinePlansTool,
  selectMachinePlan: selectMachinePlanTool,
};
