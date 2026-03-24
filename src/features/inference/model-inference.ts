import { config } from '../../config';
import { debitWallet, logUsage } from '../credits/wallet';

export type UsageContext = {
  organizationId?: string;
  userId?: string;
  requestType?: string;
  agentId?: string;
  sessionId?: string;
};

export async function trackUsage(
  modelId: string,
  usage: { promptTokens: number; completionTokens: number; cachedTokens?: number; reasoningTokens?: number },
  context: UsageContext,
  costUsd: number,
  latencyMs?: number,
  status?: string,
): Promise<{ costUsd: number; balanceRemainingCents: number } | null> {
  try {
    if (!context.organizationId) return null;
    if (config.selfHosted) return null;

    const costCents = Math.ceil(costUsd * 100);
    let balanceRemainingCents = 0;

    if (costCents > 0) {
      const totalTokens = usage.promptTokens + usage.completionTokens;
      const walletResult = await debitWallet(
        context.organizationId,
        costCents,
        `${modelId} (${totalTokens} tokens)`,
      );
      balanceRemainingCents = walletResult?.balance ?? 0;
    }

    await logUsage({
      orgId: context.organizationId,
      userId: context.userId,
      modelId,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      cachedTokens: usage.cachedTokens,
      reasoningTokens: usage.reasoningTokens,
      costUsd,
      requestType: context.requestType,
      agentId: context.agentId,
      sessionId: context.sessionId,
      latencyMs,
      status,
    });

    return { costUsd, balanceRemainingCents };
  } catch {
    return null;
  }
}
