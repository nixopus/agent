import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  getClient,
  toQueryParams,
  shouldReturnVerbose,
  compactResult,
  getReadControls,
  truncateLogs,
  splitLogParams,
  emitToolProgress,
  type SdkInput,
} from './shared';

export type ToolDef = {
  id: string;
  description: string;
  schema: z.ZodType<any, any>;
  sdkFn: (opts: any) => Promise<any>;
  params?: 'body' | 'query' | 'path' | 'spread' | 'body-and-query';
  pathKeys?: string[];
  queryKeys?: string[];
  compact?: boolean;
  requireApproval?: boolean;
  logs?: { pathKey: string };
  outputSchema?: z.ZodType<any, any>;
  transform?: (input: Record<string, unknown>) => Record<string, unknown>;
  execute?: (input: any, ctx: any) => Promise<unknown>;
};

export function createApiTool(def: ToolDef) {
  const executeFn = def.execute ?? (async (inputData: any, ctx: unknown) => {
    let input = (inputData ?? {}) as Record<string, unknown>;
    if (def.transform) input = def.transform(input);

    if (def.logs) {
      await emitToolProgress(ctx, def.id, 'start');
      const { path, query, verbose } = splitLogParams(input, def.logs.pathKey);
      const result = await def.sdkFn({ client: getClient(ctx), path, query });
      await emitToolProgress(ctx, def.id, 'completed');
      return truncateLogs(result, verbose);
    }

    const opts: Record<string, unknown> = { client: getClient(ctx) };

    if (def.queryKeys) {
      const query: Record<string, string> = {};
      const body: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(input)) {
        if (def.queryKeys.includes(k)) query[k] = String(v);
        else body[k] = v;
      }
      opts.query = query;
      if (Object.keys(body).length > 0) opts.body = body;
    } else if (def.pathKeys) {
      const path: Record<string, string> = {};
      const rest: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(input)) {
        if (def.pathKeys.includes(k)) path[k] = String(v);
        else rest[k] = v;
      }
      opts.path = path;
      if (def.params === 'query') {
        opts.query = def.compact ? toQueryParams(rest) : rest;
      } else if (Object.keys(rest).length > 0) {
        opts.body = rest;
      }
    } else {
      switch (def.params ?? 'body') {
        case 'body':
          opts.body = input;
          break;
        case 'query':
          opts.query = def.compact ? toQueryParams(input) : input;
          break;
        case 'path':
          opts.path = input;
          break;
        case 'spread':
          Object.assign(opts, input as SdkInput);
          break;
        case 'body-and-query':
          opts.body = input;
          opts.query = input;
          break;
      }
    }

    const data = await def.sdkFn(opts);
    if (def.compact) {
      return shouldReturnVerbose(input) ? data : compactResult(data, def.id, getReadControls(input));
    }
    return data;
  });

  const tool = createTool({
    id: def.id,
    description: def.description,
    inputSchema: def.schema,
    ...(def.outputSchema ? { outputSchema: def.outputSchema } : {}),
    ...(def.requireApproval ? { requireApproval: true } : {}),
    execute: executeFn,
  });

  (tool as Record<string, unknown>)._rawExecute = executeFn;
  return tool;
}

export function defineToolGroup<T extends Record<string, ToolDef>>(defs: T) {
  return Object.fromEntries(
    Object.entries(defs).map(([key, def]) => [key, createApiTool(def)]),
  ) as { [K in keyof T]: ReturnType<typeof createApiTool> };
}
