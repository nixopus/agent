import { z } from 'zod';

const UNSUPPORTED_ZOD_TYPES = new Set([
  'zodintersection',
  'zodnever',
  'zodnull',
  'zodtuple',
  'zodundefined',
  'intersection',
  'never',
  'null',
  'tuple',
  'undefined',
]);

function getTypeName(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const def = (value as { _def?: { typeName?: unknown; type?: unknown } })._def;
  const raw = def?.typeName ?? def?.type;
  return typeof raw === 'string' ? raw.toLowerCase() : '';
}

function hasUnsupportedSchemaType(value: unknown, seen: Set<unknown> = new Set()): boolean {
  if (!value || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);

  const typeName = getTypeName(value);
  if (UNSUPPORTED_ZOD_TYPES.has(typeName)) return true;

  if (Array.isArray(value)) {
    for (const item of value) {
      if (hasUnsupportedSchemaType(item, seen)) return true;
    }
    return false;
  }

  const objectValue = value as Record<string, unknown>;
  const def = objectValue._def;
  if (def && typeof def === 'object') {
    for (const child of Object.values(def as Record<string, unknown>)) {
      if (hasUnsupportedSchemaType(child, seen)) return true;
    }
    return false;
  }

  for (const child of Object.values(objectValue)) {
    if (hasUnsupportedSchemaType(child, seen)) return true;
  }
  return false;
}

function isNeverType(field: unknown): boolean {
  const name = getTypeName(field);
  if (name === 'zodnever' || name === 'never') return true;
  if (name === 'zodoptional' || name === 'optional') {
    const inner = (field as { _def?: { innerType?: unknown } })?._def?.innerType;
    if (inner) return isNeverType(inner);
  }
  return false;
}

function getZodObjectShape(schema: unknown): Record<string, z.ZodTypeAny> | null {
  const name = getTypeName(schema);
  if (name !== 'zodobject' && name !== 'object') return null;
  const def = (schema as { _def?: { shape?: unknown } })?._def;
  if (!def) return null;
  const shape = typeof def.shape === 'function'
    ? (def.shape as () => Record<string, z.ZodTypeAny>)()
    : def.shape;
  return shape && typeof shape === 'object'
    ? (shape as Record<string, z.ZodTypeAny>)
    : null;
}

function tryFlattenSdkSchema(schema: unknown): z.ZodTypeAny | null {
  const outerShape = getZodObjectShape(schema);
  if (!outerShape) return null;

  const sdkKeys = ['body', 'path', 'query'];
  if (!sdkKeys.some((k) => k in outerShape)) return null;

  const mergedFields: Record<string, z.ZodTypeAny> = {};
  for (const key of sdkKeys) {
    const field = outerShape[key];
    if (!field || isNeverType(field)) continue;

    let inner: unknown = field;
    const innerName = getTypeName(inner);
    if (innerName === 'zodoptional' || innerName === 'optional') {
      const unwrapped = (inner as { _def?: { innerType?: unknown } })?._def?.innerType;
      if (unwrapped) inner = unwrapped;
    }

    const subShape = getZodObjectShape(inner);
    if (subShape) {
      for (const [fieldName, fieldSchema] of Object.entries(subShape)) {
        mergedFields[fieldName] = fieldSchema;
      }
    }
  }

  if (Object.keys(mergedFields).length === 0) return null;
  return z.object(mergedFields);
}

function sanitizeInputSchema(schema: unknown): unknown {
  if (schema == null || typeof schema !== 'object') {
    return z.object({}).passthrough();
  }

  if (!hasUnsupportedSchemaType(schema)) return schema;

  const flattened = tryFlattenSdkSchema(schema);
  if (flattened && !hasUnsupportedSchemaType(flattened)) return flattened;

  return z.object({}).passthrough().optional();
}

function canConvertToJsonSchema(schema: unknown): boolean {
  try {
    if (typeof (z as any).toJSONSchema === 'function') {
      (z as any).toJSONSchema(schema);
    }
    return true;
  } catch {
    return false;
  }
}

export function guardToolsForSchemaCompat<T extends Record<string, unknown>>(tools: T): T {
  const fallback = z.object({}).passthrough();
  const mutable = tools as Record<string, unknown>;
  for (const [name, tool] of Object.entries(tools)) {
    if (!tool || typeof tool !== 'object' || !('id' in (tool as object))) {
      delete mutable[name];
      continue;
    }
    const target = tool as { inputSchema?: unknown };
    if (!('inputSchema' in target)) continue;
    target.inputSchema = sanitizeInputSchema(target.inputSchema);
    if (!canConvertToJsonSchema(target.inputSchema)) {
      target.inputSchema = fallback;
    }
  }
  return tools;
}
