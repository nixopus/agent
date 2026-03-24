import { createLogger } from '../../logger';
import { tenantContextFromRequestContext } from '../../context/request-context';

const logger = createLogger('agent-tools');

function collectChunkToolNames(chunks: unknown): string[] {
  if (!Array.isArray(chunks)) return [];
  const names: string[] = [];
  for (const c of chunks) {
    if (!c || typeof c !== 'object') continue;
    const o = c as { payload?: { toolName?: string }; toolName?: string };
    const name = o.payload?.toolName ?? o.toolName;
    if (name) names.push(name);
  }
  return names;
}

function collectResultErrors(chunks: unknown): { toolName: string; isError: boolean }[] {
  if (!Array.isArray(chunks)) return [];
  const out: { toolName: string; isError: boolean }[] = [];
  for (const c of chunks) {
    if (!c || typeof c !== 'object') continue;
    const o = c as { payload?: { toolName?: string; isError?: boolean }; toolName?: string };
    const toolName = o.payload?.toolName ?? o.toolName;
    if (!toolName) continue;
    out.push({ toolName, isError: o.payload?.isError === true });
  }
  return out;
}

export function withToolStepLogging(
  innerFactory: (ctx: { requestContext: unknown }) => Record<string, unknown>,
): (ctx: { requestContext: unknown }) => Record<string, unknown> {
  return ({ requestContext }) => {
    const resolved = innerFactory({ requestContext });
    const baseOnStepFinish = resolved.onStepFinish as
      | ((event: unknown) => void | Promise<void>)
      | undefined;

    const tenant = tenantContextFromRequestContext(requestContext);

    return {
      ...resolved,
      onStepFinish: async (event: unknown) => {
        const e = event as {
          runId?: string;
          stepType?: string;
          toolCalls?: unknown[];
          staticToolCalls?: unknown[];
          dynamicToolCalls?: unknown[];
          toolResults?: unknown[];
          staticToolResults?: unknown[];
          dynamicToolResults?: unknown[];
          finishReason?: string;
        };

        const toolCalls = [
          ...(e.toolCalls ?? []),
          ...(e.staticToolCalls ?? []),
          ...(e.dynamicToolCalls ?? []),
        ];
        const toolResults = [
          ...(e.toolResults ?? []),
          ...(e.staticToolResults ?? []),
          ...(e.dynamicToolResults ?? []),
        ];

        const toolNames = collectChunkToolNames(toolCalls);
        const resultMeta = collectResultErrors(toolResults);
        const errorCount = resultMeta.filter((r) => r.isError).length;

        if (toolNames.length > 0 || resultMeta.length > 0) {
          logger.info(
            {
              runId: e.runId,
              stepType: e.stepType,
              finishReason: e.finishReason,
              organizationId: tenant.organizationId,
              userId: tenant.userId,
              tools: toolNames,
              toolResultCount: resultMeta.length,
              toolResultErrors: errorCount,
            },
            'Agent tool step',
          );
        }

        await baseOnStepFinish?.(event);
      },
    };
  };
}
