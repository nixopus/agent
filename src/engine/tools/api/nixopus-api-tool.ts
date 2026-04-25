import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getOperation, listOperationIds } from './operation-registry';

function toSnakeCase(s: string): string {
  return s.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
}

const SDK_WRAPPER_KEYS = new Set(['query', 'body', 'path', 'headers']);

/**
 * The SDK Zod schemas validate params in wrapped form: { query: { id, limit } }.
 * But createApiTool's execute expects FLAT params: { id, limit }.
 * After validation, flatten back to what execute needs.
 */
function flattenSdkParams(params: Record<string, unknown>): Record<string, unknown> {
  const keys = Object.keys(params);
  if (keys.length === 0 || !keys.every((k) => SDK_WRAPPER_KEYS.has(k))) return params;

  const flat: Record<string, unknown> = {};
  for (const v of Object.values(params)) {
    if (v != null && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(flat, v);
    }
  }
  return Object.keys(flat).length > 0 ? flat : params;
}

export const nixopusApiTool = createTool({
  id: 'nixopus_api',
  description:
    'Universal Nixopus API tool. Call any API operation by name. ' +
    'Refer to the [api-catalog] in your context for available operations and their params. ' +
    'Pass FLAT params — e.g. { id: "uuid", limit: 3 }, NOT nested in query/body wrappers. ' +
    'Do NOT use this for dedicated orchestrator tools (quick_deploy, create_project, resolve_context).',
  inputSchema: z.object({
    operation: z.string().describe('The operation ID (e.g. "get_applications", "deploy_project")'),
    params: z.record(z.string(), z.unknown()).optional().default({}).describe('Operation parameters as flat key-value pairs (e.g. { id: "uuid", limit: 3 })'),
    _confirmed: z.boolean().optional().describe('Set to true after user approval for destructive operations'),
  }),
  execute: async (input, ctx) => {
    const { operation, params = {}, _confirmed } = input;

    const normalized = toSnakeCase(operation);
    const entry = getOperation(operation) ?? getOperation(normalized);
    if (!entry) {
      const allIds = listOperationIds();
      const suggestions = allIds
        .filter((id) => id.includes(normalized) || normalized.includes(id))
        .slice(0, 5);
      return {
        error: `Unknown operation: "${operation}"`,
        ...(suggestions.length > 0 ? { did_you_mean: suggestions } : {}),
        hint: 'Check the [api-catalog] in your context for valid operation IDs. Use snake_case names.',
      };
    }

    if (entry.dedicated) {
      return {
        error: `"${operation}" is a multi-step orchestrator. Use the dedicated ${operation} tool directly.`,
      };
    }

    if (entry.requireApproval && !_confirmed) {
      return {
        _approval_required: true,
        operation,
        description: entry.description,
        params,
        message:
          'This operation requires user approval. ' +
          'Ask the user to confirm, then call nixopus_api again with _confirmed: true.',
      };
    }

    const schema = (entry.tool as Record<string, unknown>).inputSchema;
    let validatedParams: Record<string, unknown> = params;

    if (schema && typeof (schema as z.ZodType).safeParse === 'function') {
      const directResult = (schema as z.ZodType).safeParse(params);
      if (directResult.success) {
        validatedParams = directResult.data as Record<string, unknown>;
      } else {
        const wrappedAttempts = [
          { query: params },
          { body: params },
          { path: params },
        ];
        let resolved = false;
        for (const wrapped of wrappedAttempts) {
          const r = (schema as z.ZodType).safeParse(wrapped);
          if (r.success) {
            validatedParams = r.data as Record<string, unknown>;
            resolved = true;
            break;
          }
        }
        if (!resolved) {
          return {
            error: 'Invalid params',
            operation,
            validation_errors: directResult.error.issues.map((i) => ({
              path: i.path.join('.'),
              message: i.message,
            })),
          };
        }
      }
    }

    const execParams = flattenSdkParams(validatedParams);

    try {
      const rawExec = (entry.tool as Record<string, unknown>)._rawExecute as
        | ((...args: unknown[]) => Promise<unknown>)
        | undefined;
      return await (rawExec ?? entry.tool.execute)(execParams, ctx);
    } catch (err: unknown) {
      return {
        error: err instanceof Error ? err.message : String(err),
        operation,
      };
    }
  },
});
