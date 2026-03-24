export interface TenantContext {
  organizationId: string | null;
  userId: string | null;
  authToken: string | null;
  cookies: string | null;
  modelId: string | null;
  creditBalance: { balance_usd: number } | null;
}

export function emptyTenantContext(): TenantContext {
  return {
    organizationId: null,
    userId: null,
    authToken: null,
    cookies: null,
    modelId: null,
    creditBalance: null,
  };
}

export function tenantContextFromRequestContext(rc: unknown): TenantContext {
  if (rc === null || rc === undefined || typeof rc !== 'object') {
    return emptyTenantContext();
  }
  const obj = rc as { get?: (k: string) => unknown };
  if (typeof obj.get !== 'function') return emptyTenantContext();
  const g = (k: string) => obj.get!(k) as string | undefined;
  return {
    organizationId: g('organizationId') ?? null,
    userId: g('userId') ?? null,
    authToken: g('authToken') ?? null,
    cookies: g('cookies') ?? null,
    modelId: g('modelId') ?? null,
    creditBalance: null,
  };
}
