import { trackUsage, type UsageContext } from '../inference/model-inference';
import { tenantContextFromRequestContext } from '../../context/request-context';
import { config } from '../../config';

type OpenRouterUsage = {
  cost?: number;
  promptTokensDetails?: { cachedTokens?: number };
  completionTokensDetails?: { reasoningTokens?: number };
};

type AgentStep = {
  providerMetadata?: { openrouter?: { usage?: OpenRouterUsage } };
};

type AgentFinishEvent = {
  steps?: AgentStep[];
  providerMetadata?: { openrouter?: { usage?: OpenRouterUsage } };
  model?: { modelId?: string };
  totalUsage?: { inputTokens?: number; outputTokens?: number; promptTokens?: number; completionTokens?: number };
  runId?: string;
};

function sumStepCosts(steps: AgentStep[]): { costUsd: number; cachedTokens: number; reasoningTokens: number } {
  let costUsd = 0;
  let cachedTokens = 0;
  let reasoningTokens = 0;

  for (const step of steps) {
    const orUsage = step.providerMetadata?.openrouter?.usage;
    if (typeof orUsage?.cost === 'number') costUsd += orUsage.cost;
    cachedTokens += orUsage?.promptTokensDetails?.cachedTokens ?? 0;
    reasoningTokens += orUsage?.completionTokensDetails?.reasoningTokens ?? 0;
  }

  return { costUsd, cachedTokens, reasoningTokens };
}

function extractCosts(event: AgentFinishEvent): { costUsd: number; cachedTokens: number; reasoningTokens: number } {
  if (Array.isArray(event.steps) && event.steps.length > 0) {
    return sumStepCosts(event.steps);
  }

  const orUsage = event.providerMetadata?.openrouter?.usage;
  return {
    costUsd: typeof orUsage?.cost === 'number' ? orUsage.cost : 0,
    cachedTokens: orUsage?.promptTokensDetails?.cachedTokens ?? 0,
    reasoningTokens: orUsage?.completionTokensDetails?.reasoningTokens ?? 0,
  };
}

export function withCreditTracking(baseOptions: Record<string, unknown>): (ctx: { requestContext: unknown }) => Record<string, unknown> {
  return ({ requestContext }) => {
    if (config.selfHosted) return { ...baseOptions };

    const tenant = tenantContextFromRequestContext(requestContext);

    return {
      ...baseOptions,
      onFinish: async (event: AgentFinishEvent) => {
        if (!tenant.organizationId) return;

        const modelId =
          event.model?.modelId || tenant.modelId || 'unknown';
        const usage = event.totalUsage;
        const { costUsd, cachedTokens, reasoningTokens } = extractCosts(event);

        const usageCtx: UsageContext = {
          organizationId: tenant.organizationId,
          userId: tenant.userId ?? undefined,
          requestType: 'agent_chat',
          agentId: event.runId,
        };

        await trackUsage(
          modelId,
          {
            promptTokens: usage?.inputTokens ?? usage?.promptTokens ?? 0,
            completionTokens: usage?.outputTokens ?? usage?.completionTokens ?? 0,
            cachedTokens,
            reasoningTokens,
          },
          usageCtx,
          costUsd,
        ).catch(() => {});
      },
    };
  };
}
