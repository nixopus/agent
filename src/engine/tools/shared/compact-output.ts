const SEMANTIC_FIELDS = [
  'id', 'name', 'slug', 'status', 'state', 'type',
  'message', 'error', 'domain', 'url', 'repository', 'branch',
  'description', 'ok', 'success', 'version', 'image',
  'port', 'host', 'email', 'role', 'source', 'result',
  'level', 'severity', 'exit_code', 'command', 'log', 'output',
];

const DROP_FIELDS = new Set([
  'created_at', 'updated_at', 'deleted_at', 'modified_at',
  'created_by', 'updated_by',
  'organization_id', 'workspace_id', 'tenant_id',
  'mime_type', 'content_type', 'etag', 'checksum', 'hash',
  'internal_id', 'external_id', 'correlation_id', 'trace_id',
  '_metadata', 'raw', 'debug', '__v', '_rev',
]);

const LIST_KEYS = [
  'items', 'results', 'applications', 'deployments', 'domains',
  'repositories', 'extensions', 'containers', 'servers',
  'services', 'entries', 'checks', 'flags', 'data',
  'logs', 'children', 'labels', 'compose_services',
];

const MAX_ARRAY_ITEMS = 15;
const MAX_FIELDS_PER_ITEM = 8;
const MAX_STRING_CHARS = 1500;

function stripDeadWeight(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    if (v === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0) continue;
    out[k] = v;
  }
  return out;
}

function selectSemanticFields(item: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of SEMANTIC_FIELDS) {
    if (key in item && item[key] != null) {
      out[key] = item[key];
      if (Object.keys(out).length >= MAX_FIELDS_PER_ITEM) return out;
    }
  }
  for (const [key, val] of Object.entries(item)) {
    if (key in out || DROP_FIELDS.has(key) || val == null) continue;
    out[key] = val;
    if (Object.keys(out).length >= MAX_FIELDS_PER_ITEM) break;
  }
  return out;
}

function capString(val: string): string {
  if (val.length <= MAX_STRING_CHARS) return val;
  return val.slice(0, MAX_STRING_CHARS) + `\u2026(${val.length - MAX_STRING_CHARS} chars omitted)`;
}

function trimStrings(data: unknown, depth: number = 0): unknown {
  if (depth > 6) return data;
  if (typeof data === 'string') return capString(data);
  if (Array.isArray(data)) return data.map((v) => trimStrings(v, depth + 1));
  if (data && typeof data === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      out[k] = trimStrings(v, depth + 1);
    }
    return out;
  }
  return data;
}

function isAlreadyCompacted(data: unknown): boolean {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const meta = (data as Record<string, unknown>).meta;
  return !!meta && typeof meta === 'object' && (meta as Record<string, unknown>).compact === true;
}

function flattenNestedObject(val: unknown): unknown {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return val;
  const obj = val as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length <= 3) return obj;
  const picked: Record<string, unknown> = {};
  let count = 0;
  for (const k of keys) {
    const v = obj[k];
    if (v == null || v === '' || DROP_FIELDS.has(k)) continue;
    if (typeof v === 'object' && !Array.isArray(v)) continue;
    picked[k] = v;
    if (++count >= 3) break;
  }
  return picked;
}

function compactArray(arr: unknown[]): unknown[] {
  return arr.slice(0, MAX_ARRAY_ITEMS).map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const selected = selectSemanticFields(stripDeadWeight(item as Record<string, unknown>));
    const flattened: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(selected)) {
      flattened[k] = flattenNestedObject(v);
    }
    return flattened;
  });
}

const MAX_COMPACT_DEPTH = 3;

function compactValue(data: unknown, depth: number = 0): unknown {
  if (data == null || typeof data !== 'object') return data;
  if (isAlreadyCompacted(data)) return data;
  if (depth > MAX_COMPACT_DEPTH) return trimStrings(data);

  if (Array.isArray(data)) {
    const compacted = compactArray(data);
    const result = trimStrings(compacted);
    if (data.length > MAX_ARRAY_ITEMS) {
      return { data: result, _truncated: { shown: compacted.length, total: data.length } };
    }
    return result;
  }

  const obj = stripDeadWeight(data as Record<string, unknown>);
  const listKey = LIST_KEYS.find((k) => Array.isArray(obj[k]));
  if (listKey) {
    const list = obj[listKey] as unknown[];
    const compacted = compactArray(list);
    const rest: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === listKey) continue;
      if (DROP_FIELDS.has(k) || v == null) continue;
      rest[k] = compactValue(v, depth + 1);
    }
    const result: Record<string, unknown> = { [listKey]: trimStrings(compacted), ...rest };
    if (list.length > MAX_ARRAY_ITEMS) {
      result._truncated = { shown: compacted.length, total: list.length };
    }
    return result;
  }

  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    result[k] = (v && typeof v === 'object' && !Array.isArray(v))
      ? compactValue(v, depth + 1)
      : v;
  }
  return trimStrings(result);
}

export function withCompactOutput<T extends Record<string, unknown>>(tools: T): T {
  const result: Record<string, unknown> = {};
  for (const [name, tool] of Object.entries(tools)) {
    if (!tool || typeof tool !== 'object') {
      result[name] = tool;
      continue;
    }
    const t = tool as Record<string, unknown>;
    if (typeof t.execute !== 'function') {
      result[name] = tool;
      continue;
    }
    const origExecute = t.execute as (...args: unknown[]) => Promise<unknown>;
    result[name] = {
      ...t,
      execute: async (...args: unknown[]) => {
        const output = await origExecute(...args);
        const input = args[0] as Record<string, unknown> | undefined;
        if (input?.verbose === true || input?.response_format === 'detailed') return output;
        if (output == null || typeof output !== 'object') return output;
        return compactValue(output);
      },
    };
  }
  return result as T;
}
