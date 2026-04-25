import { isWrappable } from './source-guard';
import { createLogger } from '../../../logger';

const logger = createLogger('tool-governor');

export interface GovernorPolicy {
  defaultLimit: number;
  limits?: Record<string, number>;
  readOnlyTools?: Set<string>;
  readOnlyLimit?: number;
}

interface ToolCallRecord {
  count: number;
  cache: Map<string, unknown>;
}

interface GovernorState {
  calls: Map<string, ToolCallRecord>;
  warnings: string[];
}

const GOVERNOR_STATE_KEY = 'governorState';
const IGNORED_HASH_KEYS = new Set(['verbose', 'response_format', 'force']);

function deepSortedStringify(val: unknown): string {
  if (val == null || typeof val !== 'object') return JSON.stringify(val);
  if (Array.isArray(val)) return `[${val.map(deepSortedStringify).join(',')}]`;
  const obj = val as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${deepSortedStringify(obj[k])}`).join(',')}}`;
}

function stableHash(input: unknown): string {
  if (input == null || typeof input !== 'object') return String(input);
  const obj = input as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => !IGNORED_HASH_KEYS.has(k)).sort();
  return keys.map((k) => `${k}:${deepSortedStringify(obj[k])}`).join('|');
}

type RequestContext = { get?: (k: string) => unknown; set?: (k: string, v: unknown) => void };
type ToolCtx = { requestContext?: RequestContext; [key: string]: unknown };

function getOrCreateState(ctx: unknown): GovernorState | null {
  const reqCtx = (ctx as ToolCtx)?.requestContext;
  if (!reqCtx?.get || !reqCtx?.set) return null;

  let state = reqCtx.get(GOVERNOR_STATE_KEY) as GovernorState | undefined;
  if (!state) {
    state = { calls: new Map(), warnings: [] };
    reqCtx.set(GOVERNOR_STATE_KEY, state);
  }
  return state;
}

function getRecord(state: GovernorState, toolId: string): ToolCallRecord {
  let record = state.calls.get(toolId);
  if (!record) {
    record = { count: 0, cache: new Map() };
    state.calls.set(toolId, record);
  }
  return record;
}

function getLimitForTool(toolId: string, policy: GovernorPolicy): number {
  if (policy.limits?.[toolId] != null) return policy.limits[toolId];
  if (policy.readOnlyTools?.has(toolId) && policy.readOnlyLimit != null) return policy.readOnlyLimit;
  return policy.defaultLimit;
}

type ExecuteFn = (...args: unknown[]) => Promise<unknown>;

function wrapExecute(toolId: string, origExecute: ExecuteFn, policy: GovernorPolicy): ExecuteFn {
  return async (...args: unknown[]) => {
    const input = args[0] as Record<string, unknown> | undefined;
    const ctx = args[1];
    const state = getOrCreateState(ctx);

    if (!state) return origExecute(...args);

    const record = getRecord(state, toolId);
    const hash = stableHash(input);
    const forceRefresh = input?.force === true;

    if (!forceRefresh && record.cache.has(hash)) {
      logger.info({ toolId, count: record.count }, 'returning cached result (dedup)');
      const cached = record.cache.get(hash);
      if (cached && typeof cached === 'object' && !Array.isArray(cached)) {
        return { _cached: true, _note: 'Same call returned cached result.', ...(cached as Record<string, unknown>) };
      }
      return cached;
    }

    const limit = getLimitForTool(toolId, policy);
    if (record.count >= limit) {
      state.warnings.push(`${toolId}: ${record.count + 1} calls (advisory limit: ${limit}). Reuse data from prior calls.`);
      logger.info({ toolId, count: record.count, limit }, 'advisory limit exceeded');
    }

    record.count++;
    const result = await origExecute(...args);
    record.cache.set(hash, result);
    return result;
  };
}

export function withToolGovernor<T extends Record<string, unknown>>(tools: T, policy: GovernorPolicy): T {
  const result: Record<string, unknown> = {};

  for (const [name, tool] of Object.entries(tools)) {
    if (!isWrappable(tool)) {
      result[name] = tool;
      continue;
    }

    const toolId = (tool.id as string) ?? name;
    result[name] = {
      ...tool,
      execute: wrapExecute(toolId, tool.execute as ExecuteFn, policy),
    };
  }

  return result as T;
}
