import { z } from 'zod';
import { createNixopusClient } from '../shared/nixopus-client';

type RequestContext = { requestContext?: { get?: (k: string) => string } };

export type SdkInput = Record<string, unknown>;
export type ToolWriter = {
  custom?: (chunk: {
    type: string;
    data: Record<string, unknown>;
    transient?: boolean;
  }) => Promise<void>;
};

export const sourceEnum = z
  .enum(['github', 's3', 'zip', 'staging'])
  .optional()
  .describe('Code source: github (default), s3 (workspace files), staging (pre-staged), zip');

export function getClient(ctx: unknown) {
  const c = ctx as RequestContext;
  return createNixopusClient(c?.requestContext) as unknown;
}

const LOG_HEAD_CHARS = 2000;
const LOG_TAIL_CHARS = 6000;
const MAX_LOG_CHARS = LOG_HEAD_CHARS + LOG_TAIL_CHARS;
const COMPACT_MAX_ITEMS = 20;
const COMPACT_MAX_KEYS_PER_ITEM = 8;

const NOISE_PATTERNS = [
  /^(npm warn|npm notice|npm http|npm timing)\b/i,
  /^\s*added \d+ packages/i,
  /^\s*Progress[:.]?\s*[\d.]+%/i,
  /^(\s*│\s*$|\s*[├└─│╭╮╰╯]\s*$)/,
  /^\s*$/,
  /^\s*(deprecated|WARN deprecated)\b/i,
  /^\s*\d+ packages are looking for funding/i,
  /^\s*run `npm fund`/i,
  /^\s*\[notice\]/i,
  /^\s*\+{3,}\s*$/,
  /^\s*packages\/\S+: skipping/i,
];

function isNoiseLine(line: string): boolean {
  return NOISE_PATTERNS.some((re) => re.test(line));
}

function stripNoise(text: string): string {
  return text
    .split('\n')
    .filter((line) => !isNoiseLine(line))
    .join('\n');
}

function stringifyLogEntry(item: unknown): string {
  if (typeof item === 'string') return item;
  if (!item || typeof item !== 'object') return String(item);
  const obj = item as Record<string, unknown>;
  if (typeof obj.message === 'string') return obj.message;
  if (typeof obj.log === 'string') return obj.log;
  if (typeof obj.line === 'string') return obj.line;
  return JSON.stringify(item);
}

function truncateText(text: string, verbose?: boolean): string {
  if (verbose) return text;
  const cleaned = stripNoise(text);
  if (cleaned.length <= MAX_LOG_CHARS) return cleaned;
  const skipped = cleaned.length - LOG_HEAD_CHARS - LOG_TAIL_CHARS;
  return cleaned.slice(0, LOG_HEAD_CHARS) + `\n\n…(${skipped} chars omitted)…\n\n` + cleaned.slice(-LOG_TAIL_CHARS);
}

export function truncateLogs(data: unknown, verbose?: boolean): unknown {
  if (typeof data === 'string') return truncateText(data, verbose);
  if (Array.isArray(data)) {
    const joined = data.map(stringifyLogEntry).join('\n');
    return truncateText(joined, verbose);
  }
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = (k === 'logs' || k === 'log' || k === 'output' || k === 'data')
        ? truncateLogs(v, verbose)
        : v;
    }
    return result;
  }
  return data;
}

function pickCompactFields(item: Record<string, unknown>): Record<string, unknown> {
  const preferredKeys = [
    'id', 'application_id', 'deployment_id', 'container_id', 'connector_id',
    'execution_id', 'name', 'slug', 'status', 'state', 'type', 'domain',
    'repository', 'branch', 'created_at', 'updated_at',
  ];
  const out: Record<string, unknown> = {};
  for (const key of preferredKeys) {
    if (key in item) out[key] = item[key];
    if (Object.keys(out).length >= COMPACT_MAX_KEYS_PER_ITEM) break;
  }
  if (Object.keys(out).length === 0) {
    const fallbackKeys = Object.keys(item).slice(0, COMPACT_MAX_KEYS_PER_ITEM);
    for (const key of fallbackKeys) out[key] = item[key];
  }
  return out;
}

export type ReadControls = {
  verbose: boolean;
  limit?: number;
  fields?: string[];
};

export function getReadControls(inputData: unknown): ReadControls {
  if (!inputData || typeof inputData !== 'object') return { verbose: false };
  const data = inputData as Record<string, unknown>;
  const fields = Array.isArray(data.fields) ? data.fields.filter((v): v is string => typeof v === 'string') : undefined;
  const limitRaw = typeof data.limit === 'number' ? data.limit : undefined;
  const limit = typeof limitRaw === 'number' ? Math.min(100, Math.max(1, Math.floor(limitRaw))) : undefined;
  return { verbose: data.verbose === true, limit, fields };
}

function selectFieldsFromItem(item: unknown, fields?: string[]): unknown {
  if (!fields || fields.length === 0) return item;
  if (!item || typeof item !== 'object') return item;
  const obj = item as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (field in obj) out[field] = obj[field];
  }
  return Object.keys(out).length > 0 ? out : item;
}

export function compactResult(data: unknown, sourceTool: string, controls?: ReadControls): unknown {
  const maxItems = controls?.limit ?? COMPACT_MAX_ITEMS;
  if (Array.isArray(data)) {
    const items = data.slice(0, maxItems).map((item) =>
      selectFieldsFromItem(
        item && typeof item === 'object' ? pickCompactFields(item as Record<string, unknown>) : item,
        controls?.fields,
      ),
    );
    return {
      data: items,
      meta: { source_tool: sourceTool, compact: true, shown: items.length, total: data.length, truncated: data.length > maxItems },
    };
  }
  if (!data || typeof data !== 'object') return data;
  const objectData = data as Record<string, unknown>;
  const listKeys = ['items', 'results', 'applications', 'deployments', 'domains', 'repositories', 'extensions', 'logs', 'data'];
  const listKey = listKeys.find((key) => Array.isArray(objectData[key]));
  if (!listKey) return data;
  const list = objectData[listKey] as unknown[];
  const items = list.slice(0, maxItems).map((item) =>
    selectFieldsFromItem(
      item && typeof item === 'object' ? pickCompactFields(item as Record<string, unknown>) : item,
      controls?.fields,
    ),
  );
  const meta: Record<string, unknown> = {
    source_tool: sourceTool, compact: true, list_key: listKey,
    shown: items.length, total: list.length, truncated: list.length > maxItems,
  };
  for (const key of ['page', 'limit', 'total', 'count', 'next_page', 'has_more']) {
    if (key in objectData) meta[key] = objectData[key];
  }
  return { data: items, meta };
}

export function shouldReturnVerbose(inputData: unknown): boolean {
  return getReadControls(inputData).verbose;
}

export async function callWithLogTruncation<T>(
  ctx: unknown,
  fn: (opts: { client: ReturnType<typeof getClient> }) => Promise<unknown>,
  verbose?: boolean,
): Promise<T> {
  const result = await fn({ client: getClient(ctx) });
  return truncateLogs(result, verbose) as T;
}

export async function emitToolProgress(
  ctx: unknown,
  tool: string,
  stage: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  const writer = (ctx as { writer?: ToolWriter })?.writer;
  if (!writer?.custom) return;
  await writer.custom({
    type: 'data-tool-progress',
    data: { tool, stage, ...data },
    transient: true,
  });
}

export function toQueryParams(data: Record<string, unknown>): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(data)
      .filter(([k]) => k !== 'verbose' && k !== 'fields')
      .map(([k, v]) => [k, v != null ? String(v) : undefined]),
  ) as Record<string, string | undefined>;
}

export function splitLogParams(
  inputData: unknown,
  pathKey: string,
): { path: Record<string, string>; query: Record<string, string | undefined>; verbose: boolean } {
  const data = (inputData ?? {}) as Record<string, unknown>;
  const verbose = data.verbose === true;
  const path: Record<string, string> = { [pathKey]: String(data[pathKey] ?? '') };
  const queryKeys = ['page', 'page_size', 'level', 'start_time', 'end_time', 'search_term'];
  const query: Record<string, string | undefined> = {};
  for (const k of queryKeys) {
    if (data[k] != null) query[k] = String(data[k]);
  }
  return { path, query, verbose };
}
