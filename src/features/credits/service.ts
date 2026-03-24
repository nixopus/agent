import { eq, desc, sql, gte, and } from 'drizzle-orm';
import { aiUsageLogs } from './schema';
import { getContainer } from '../../container';

type UsageBreakdownItem = {
  key: string;
  total_cost_usd: number;
  total_tokens: number;
  request_count: number;
};

type UsageHistory = {
  total_cost_usd: number;
  total_tokens: number;
  breakdown: UsageBreakdownItem[];
  daily_usage: { date: string; cost_usd: number; tokens: number; requests: number }[];
};

type UsageLogItem = {
  id: string;
  model_id: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cached_tokens: number;
  reasoning_tokens: number;
  cost_usd: number;
  request_type: string | null;
  agent_id: string | null;
  session_id: string | null;
  latency_ms: number | null;
  status: string;
  created_at: string;
};

type UsageLogList = {
  items: UsageLogItem[];
  total_count: number;
};

export type UsageServiceDeps = {
  db: { select: Function; [k: string]: unknown };
};

function periodToCutoff(period: '7d' | '30d' | '90d') {
  const map = { '7d': sql`NOW() - INTERVAL '7 days'`, '30d': sql`NOW() - INTERVAL '30 days'`, '90d': sql`NOW() - INTERVAL '90 days'` } as const;
  return map[period];
}

export function createUsageService(deps: UsageServiceDeps) {
  function db() {
    return deps.db;
  }

  async function getUsageHistory(
    orgId: string,
    period: '7d' | '30d' | '90d',
    groupBy: 'model' | 'user' | 'day'
  ): Promise<UsageHistory> {
    const cutoff = periodToCutoff(period);

    const totalsRows = await db()
      .select({
        totalCostUsd: sql<number>`COALESCE(SUM(${aiUsageLogs.costUsd}::numeric), 0)`,
        totalTokens: sql<number>`COALESCE(SUM(${aiUsageLogs.totalTokens}), 0)`,
      })
      .from(aiUsageLogs)
      .where(and(eq(aiUsageLogs.organizationId, orgId), gte(aiUsageLogs.createdAt, cutoff)));

    const groupColumn =
      groupBy === 'model'
        ? sql`${aiUsageLogs.modelId}`
        : groupBy === 'user'
          ? sql`${aiUsageLogs.userId}::text`
          : sql`${aiUsageLogs.createdAt}::date::text`;

    const breakdownRows = await db()
      .select({
        key: sql<string>`${groupColumn}`,
        totalCostUsd: sql<number>`COALESCE(SUM(${aiUsageLogs.costUsd}::numeric), 0)`,
        totalTokens: sql<number>`COALESCE(SUM(${aiUsageLogs.totalTokens}), 0)`,
        requestCount: sql<number>`COUNT(*)`,
      })
      .from(aiUsageLogs)
      .where(and(eq(aiUsageLogs.organizationId, orgId), gte(aiUsageLogs.createdAt, cutoff)))
      .groupBy(groupColumn)
      .orderBy(sql`COALESCE(SUM(${aiUsageLogs.costUsd}::numeric), 0) DESC`);

    const dailyRows = await db()
      .select({
        date: sql<string>`${aiUsageLogs.createdAt}::date::text`,
        costUsd: sql<number>`COALESCE(SUM(${aiUsageLogs.costUsd}::numeric), 0)`,
        tokens: sql<number>`COALESCE(SUM(${aiUsageLogs.totalTokens}), 0)`,
        requests: sql<number>`COUNT(*)`,
      })
      .from(aiUsageLogs)
      .where(and(eq(aiUsageLogs.organizationId, orgId), gte(aiUsageLogs.createdAt, cutoff)))
      .groupBy(sql`${aiUsageLogs.createdAt}::date`)
      .orderBy(sql`${aiUsageLogs.createdAt}::date ASC`);

    return {
      total_cost_usd: parseFloat(String(totalsRows[0]?.totalCostUsd ?? 0)),
      total_tokens: Number(totalsRows[0]?.totalTokens ?? 0),
      breakdown: breakdownRows.map((r: Record<string, unknown>) => ({
        key: r.key,
        total_cost_usd: parseFloat(String(r.totalCostUsd)),
        total_tokens: Number(r.totalTokens),
        request_count: Number(r.requestCount),
      })),
      daily_usage: dailyRows.map((r: Record<string, unknown>) => ({
        date: r.date,
        cost_usd: parseFloat(String(r.costUsd)),
        tokens: Number(r.tokens),
        requests: Number(r.requests),
      })),
    };
  }

  async function getUsageLogs(
    orgId: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<UsageLogList> {
    const limit = options.limit ?? 20;
    const offset = options.offset ?? 0;

    const countRows = await db()
      .select({ total: sql<number>`COUNT(*)::int` })
      .from(aiUsageLogs)
      .where(eq(aiUsageLogs.organizationId, orgId));

    const rows = await db()
      .select()
      .from(aiUsageLogs)
      .where(eq(aiUsageLogs.organizationId, orgId))
      .orderBy(desc(aiUsageLogs.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      items: rows.map((r: Record<string, unknown>) => ({
        id: r.id,
        model_id: r.modelId,
        prompt_tokens: r.promptTokens,
        completion_tokens: r.completionTokens,
        total_tokens: r.totalTokens,
        cached_tokens: r.cachedTokens ?? 0,
        reasoning_tokens: r.reasoningTokens ?? 0,
        cost_usd: parseFloat(String(r.costUsd)),
        request_type: r.requestType,
        agent_id: r.agentId,
        session_id: r.sessionId,
        latency_ms: r.latencyMs,
        status: r.status ?? 'success',
        created_at: (r.createdAt instanceof Date
          ? r.createdAt
          : new Date(String(r.createdAt))).toISOString(),
      })),
      total_count: countRows[0]?.total ?? 0,
    };
  }

  return { getUsageHistory, getUsageLogs };
}

export type UsageService = ReturnType<typeof createUsageService>;

let _default: UsageService | null = null;

function defaultService(): UsageService {
  if (!_default) {
    const c = getContainer();
    _default = createUsageService({ db: c.db as unknown as UsageServiceDeps['db'] });
  }
  return _default;
}

export function resetDefaultUsageService(): void {
  _default = null;
}

export async function getUsageHistory(
  orgId: string,
  period: '7d' | '30d' | '90d',
  groupBy: 'model' | 'user' | 'day'
) {
  return defaultService().getUsageHistory(orgId, period, groupBy);
}

export async function getUsageLogs(
  orgId: string,
  options?: { limit?: number; offset?: number }
) {
  return defaultService().getUsageLogs(orgId, options);
}
