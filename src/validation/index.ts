import { z, type ZodType } from 'zod';

export function parseBody<T>(schema: ZodType<T>, raw: unknown): { ok: true; data: T } | { ok: false; response: Response } {
  const result = schema.safeParse(raw);
  if (result.success) return { ok: true, data: result.data };
  const detail = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
  return {
    ok: false,
    response: Response.json({ error: 'Invalid request body', detail }, { status: 400 }),
  };
}

export function parseQuery<T>(schema: ZodType<T>, params: Record<string, string | undefined>): { ok: true; data: T } | { ok: false; response: Response } {
  const result = schema.safeParse(params);
  if (result.success) return { ok: true, data: result.data };
  const detail = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
  return {
    ok: false,
    response: Response.json({ error: 'Invalid query parameters', detail }, { status: 400 }),
  };
}

export function parseParams<T>(schema: ZodType<T>, params: Record<string, string | undefined>): { ok: true; data: T } | { ok: false; response: Response } {
  const result = schema.safeParse(params);
  if (result.success) return { ok: true, data: result.data };
  const detail = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
  return {
    ok: false,
    response: Response.json({ error: 'Invalid path parameters', detail }, { status: 400 }),
  };
}

export const CreditUsageQuerySchema = z.object({
  orgId: z.string().min(1).optional(),
  period: z.enum(['7d', '30d', '90d']).default('30d'),
  groupBy: z.enum(['model', 'user', 'day']).default('day'),
});

export const PaginatedQuerySchema = z.object({
  orgId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
