import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeContext, makeContextWithBody, nextOk } from './helpers';

vi.mock('../../logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const mockVerifySession = vi.fn();
const mockIsAuthEnabled = vi.fn();

vi.mock('../auth', () => ({
  verifySession: (...args: any[]) => mockVerifySession(...args),
  isAuthEnabled: () => mockIsAuthEnabled(),
}));

const mockSetCorsHeaders = vi.fn();

vi.mock('../cors', () => ({
  setCorsHeaders: (...args: any[]) => mockSetCorsHeaders(...args),
}));

const mockIsDeployAgentStream = vi.fn();
const mockIsAgentStreamEndpoint = vi.fn();

vi.mock('../deploy-guard', () => ({
  isDeployAgentStream: (...args: any[]) => mockIsDeployAgentStream(...args),
  isAgentStreamEndpoint: (...args: any[]) => mockIsAgentStreamEndpoint(...args),
}));

const mockShouldSkipCreditCheck = vi.fn();
const mockCheckCredits = vi.fn();

vi.mock('../credit-gate', () => ({
  shouldSkipCreditCheck: (...args: any[]) => mockShouldSkipCreditCheck(...args),
  checkCredits: (...args: any[]) => mockCheckCredits(...args),
}));

vi.mock('../../errors', async () => {
  const actual = await vi.importActual<typeof import('../../errors')>('../../errors');
  return actual;
});

import { createAppMiddleware } from '../app-middleware';

const mockPostgresStore = {
  getStore: vi.fn(),
} as any;

function getMiddleware() {
  return createAppMiddleware(() => mockPostgresStore);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsAuthEnabled.mockReturnValue(false);
  mockIsDeployAgentStream.mockReturnValue(false);
  mockIsAgentStreamEndpoint.mockReturnValue(false);
  mockShouldSkipCreditCheck.mockReturnValue(true);
});

describe('app-middleware — OPTIONS handling', () => {
  it('returns 204 for OPTIONS requests', async () => {
    const mw = getMiddleware();
    const ctx = makeContext({ method: 'OPTIONS' });
    const result = await mw(ctx, nextOk());

    expect(result).toBeInstanceOf(Response);
    expect(result!.status).toBe(204);
  });

  it('sets CORS headers on OPTIONS', async () => {
    const mw = getMiddleware();
    const ctx = makeContext({ method: 'OPTIONS' });
    await mw(ctx, nextOk());
    expect(mockSetCorsHeaders).toHaveBeenCalled();
  });

  it('does not call next() for OPTIONS', async () => {
    const mw = getMiddleware();
    const ctx = makeContext({ method: 'OPTIONS' });
    let called = false;
    await mw(ctx, async () => { called = true; });
    expect(called).toBe(false);
  });
});

describe('app-middleware — health check bypass', () => {
  it('bypasses auth for /healthz', async () => {
    mockIsAuthEnabled.mockReturnValue(true);
    const mw = getMiddleware();
    const ctx = makeContext({ url: 'http://localhost:3000/healthz' });
    await mw(ctx, nextOk());
    expect(mockVerifySession).not.toHaveBeenCalled();
  });

  it('bypasses auth for /readyz', async () => {
    mockIsAuthEnabled.mockReturnValue(true);
    const mw = getMiddleware();
    const ctx = makeContext({ url: 'http://localhost:3000/readyz' });
    await mw(ctx, nextOk());
    expect(mockVerifySession).not.toHaveBeenCalled();
  });

  it('bypasses auth for /metrics', async () => {
    mockIsAuthEnabled.mockReturnValue(true);
    const mw = getMiddleware();
    const ctx = makeContext({ url: 'http://localhost:3000/metrics' });
    await mw(ctx, nextOk());
    expect(mockVerifySession).not.toHaveBeenCalled();
  });

  it('calls next() for health endpoints', async () => {
    const mw = getMiddleware();
    const ctx = makeContext({ url: 'http://localhost:3000/healthz' });
    let called = false;
    await mw(ctx, async () => { called = true; });
    expect(called).toBe(true);
  });
});

describe('app-middleware — authentication', () => {
  it('returns 401 when auth enabled and no auth headers', async () => {
    mockIsAuthEnabled.mockReturnValue(true);
    const mw = getMiddleware();
    const ctx = makeContext({ url: 'http://localhost:3000/api/test' });
    const result = await mw(ctx, nextOk());

    expect(result).toBeInstanceOf(Response);
    expect(result!.status).toBe(401);
  });

  it('bypasses auth for internal credit cache invalidation endpoint', async () => {
    mockIsAuthEnabled.mockReturnValue(true);
    const mw = getMiddleware();
    const ctx = makeContext({ url: 'http://localhost:3000/api/internal/credits/invalidate', method: 'POST' });
    let called = false;
    await mw(ctx, async () => { called = true; });
    expect(called).toBe(true);
    expect(mockVerifySession).not.toHaveBeenCalled();
  });

  it('returns 401 when session verification returns empty data', async () => {
    mockIsAuthEnabled.mockReturnValue(true);
    mockVerifySession.mockResolvedValue({});
    const mw = getMiddleware();
    const ctx = makeContext({
      url: 'http://localhost:3000/api/test',
      headers: { Authorization: 'Bearer token' },
    });
    const result = await mw(ctx, nextOk());
    expect(result!.status).toBe(401);
  });

  it('proceeds when session has valid user', async () => {
    mockIsAuthEnabled.mockReturnValue(true);
    mockVerifySession.mockResolvedValue({
      session: { activeOrganizationId: 'org-1' },
      user: { id: 'user-1', email: 'test@test.com', name: 'Test' },
    });
    const mw = getMiddleware();
    const ctx = makeContext({
      url: 'http://localhost:3000/api/test',
      headers: { Authorization: 'Bearer valid-token' },
    });
    await mw(ctx, nextOk());
    expect(mockVerifySession).toHaveBeenCalled();
  });

  it('returns 503 when auth service fails', async () => {
    mockIsAuthEnabled.mockReturnValue(true);
    mockVerifySession.mockRejectedValue(new Error('connection refused'));
    const mw = getMiddleware();
    const ctx = makeContext({
      url: 'http://localhost:3000/api/test',
      headers: { Authorization: 'Bearer token' },
    });
    const result = await mw(ctx, nextOk());
    expect(result!.status).toBe(503);

    const body = await result!.json();
    expect(body.error).toBe('EXTERNAL_SERVICE_ERROR');
  });

  it('skips auth when auth is disabled', async () => {
    mockIsAuthEnabled.mockReturnValue(false);
    const mw = getMiddleware();
    const ctx = makeContext({ url: 'http://localhost:3000/api/test' });
    await mw(ctx, nextOk());
    expect(mockVerifySession).not.toHaveBeenCalled();
  });

  it('accepts x-api-key as valid auth when auth enabled', async () => {
    mockIsAuthEnabled.mockReturnValue(true);
    mockVerifySession.mockResolvedValue({
      session: { activeOrganizationId: 'org-1' },
      user: { id: 'user-1', email: 'test@test.com', name: 'Test' },
    });
    const mw = getMiddleware();
    const ctx = makeContext({
      url: 'http://localhost:3000/api/test',
      headers: { 'x-api-key': 'api-key-123' },
    });
    await mw(ctx, nextOk());
    expect(mockVerifySession).toHaveBeenCalledWith(
      expect.objectContaining({ 'x-api-key': 'api-key-123' }),
    );
  });
});

describe('app-middleware — request context propagation', () => {
  it('sets authToken from Bearer header', async () => {
    const mw = getMiddleware();
    const ctx = makeContext({
      url: 'http://localhost:3000/api/test',
      headers: { Authorization: 'Bearer my-token-123' },
    });
    await mw(ctx, nextOk());
    expect(ctx._requestContext.get('authToken')).toBe('my-token-123');
  });

  it('sets authToken from x-api-key header when no Authorization', async () => {
    const mw = getMiddleware();
    const ctx = makeContext({
      url: 'http://localhost:3000/api/test',
      headers: { 'x-api-key': 'api-key-456' },
    });
    await mw(ctx, nextOk());
    expect(ctx._requestContext.get('authToken')).toBe('api-key-456');
  });

  it('sets cookies in request context', async () => {
    const mw = getMiddleware();
    const ctx = makeContext({
      url: 'http://localhost:3000/api/test',
      headers: { Cookie: 'session=abc123' },
    });
    await mw(ctx, nextOk());
    expect(ctx._requestContext.get('cookies')).toBe('session=abc123');
  });

  it('sets organizationId from auth header', async () => {
    const mw = getMiddleware();
    const ctx = makeContext({
      url: 'http://localhost:3000/api/test',
      headers: { 'X-Organization-Id': 'org-xyz' },
    });
    await mw(ctx, nextOk());
    expect(ctx._requestContext.get('organizationId')).toBe('org-xyz');
  });

  it('sets modelId from header', async () => {
    const mw = getMiddleware();
    const ctx = makeContext({
      url: 'http://localhost:3000/api/test',
      headers: { 'X-Model-Id': 'gpt-4o' },
    });
    await mw(ctx, nextOk());
    expect(ctx._requestContext.get('modelId')).toBe('gpt-4o');
  });

  it('prefers session org over header org', async () => {
    mockIsAuthEnabled.mockReturnValue(true);
    mockVerifySession.mockResolvedValue({
      session: { activeOrganizationId: 'session-org' },
      user: { id: 'u1' },
    });
    const mw = getMiddleware();
    const ctx = makeContext({
      url: 'http://localhost:3000/api/test',
      headers: {
        Authorization: 'Bearer token',
        'X-Organization-Id': 'header-org',
      },
    });
    await mw(ctx, nextOk());
    expect(ctx._requestContext.get('organizationId')).toBe('session-org');
  });
});

describe('app-middleware — credit check integration', () => {
  it('blocks request when credits exhausted', async () => {
    mockShouldSkipCreditCheck.mockReturnValue(false);
    mockCheckCredits.mockResolvedValue({
      allowed: false,
      balanceCents: 0,
      response: new Response(JSON.stringify({ error: 'CREDITS_EXHAUSTED' }), { status: 402 }),
    });

    const mw = getMiddleware();
    const ctx = makeContext({
      url: 'http://localhost:3000/api/agents/run',
      headers: { 'X-Organization-Id': 'org-broke' },
    });
    const result = await mw(ctx, nextOk());
    expect(result!.status).toBe(402);
  });

  it('sets X-Credits-Remaining header when allowed', async () => {
    mockShouldSkipCreditCheck.mockReturnValue(false);
    mockCheckCredits.mockResolvedValue({ allowed: true, balanceCents: 5000 });

    const mw = getMiddleware();
    const ctx = makeContext({
      url: 'http://localhost:3000/api/agents/run',
      headers: { 'X-Organization-Id': 'org-funded' },
    });
    await mw(ctx, nextOk());
    expect(ctx._setHeaders.get('X-Credits-Remaining')).toBe('50.00');
  });

  it('skips credit check for skippable paths', async () => {
    mockShouldSkipCreditCheck.mockReturnValue(true);

    const mw = getMiddleware();
    const ctx = makeContext({
      url: 'http://localhost:3000/api/credits/balance',
      headers: { 'X-Organization-Id': 'org-1' },
    });
    await mw(ctx, nextOk());
    expect(mockCheckCredits).not.toHaveBeenCalled();
  });

  it('skips credit check when no organization', async () => {
    mockShouldSkipCreditCheck.mockReturnValue(false);

    const mw = getMiddleware();
    const ctx = makeContext({ url: 'http://localhost:3000/api/agents/run' });
    await mw(ctx, nextOk());
    expect(mockCheckCredits).not.toHaveBeenCalled();
  });
});

describe('app-middleware — resume endpoint pre-checks', () => {
  it('returns 409 when snapshot is missing for resume', async () => {
    mockPostgresStore.getStore.mockResolvedValue({
      loadWorkflowSnapshot: vi.fn().mockResolvedValue(null),
    });

    const mw = getMiddleware();
    const ctx = makeContext({
      url: 'http://localhost:3000/api/runs/run-123/resume',
      method: 'POST',
    });
    const result = await mw(ctx, nextOk());
    expect(result!.status).toBe(409);

    const body = await result!.json();
    expect(body.details.reason).toBe('session_expired');
  });

  it('proceeds when snapshot exists for resume', async () => {
    mockPostgresStore.getStore.mockResolvedValue({
      loadWorkflowSnapshot: vi.fn().mockResolvedValue({ someData: true }),
    });

    const mw = getMiddleware();
    const ctx = makeContext({
      url: 'http://localhost:3000/api/runs/run-456/resume',
      method: 'POST',
    });
    let called = false;
    await mw(ctx, async () => { called = true; });
    expect(called).toBe(true);
  });

  it('proceeds on pre-check failure (best-effort)', async () => {
    mockPostgresStore.getStore.mockRejectedValue(new Error('DB down'));

    const mw = getMiddleware();
    const ctx = makeContext({
      url: 'http://localhost:3000/api/runs/run-789/resume',
      method: 'POST',
    });
    let called = false;
    await mw(ctx, async () => { called = true; });
    expect(called).toBe(true);
  });
});

describe('app-middleware — error propagation', () => {
  it('returns 409 for "No snapshot found" error from next()', async () => {
    const mw = getMiddleware();
    const ctx = makeContext({ url: 'http://localhost:3000/api/test' });

    const result = await mw(ctx, async () => {
      throw new Error('No snapshot found for run xyz');
    });

    expect(result).toBeInstanceOf(Response);
    expect(result!.status).toBe(409);
  });

  it('re-throws non-app errors', async () => {
    const mw = getMiddleware();
    const ctx = makeContext({ url: 'http://localhost:3000/api/test' });

    await expect(mw(ctx, async () => {
      throw new TypeError('unexpected');
    })).rejects.toThrow('unexpected');
  });
});

describe('app-middleware — security', () => {
  it('strips Bearer prefix from auth token', async () => {
    const mw = getMiddleware();
    const ctx = makeContext({
      url: 'http://localhost:3000/api/test',
      headers: { Authorization: 'Bearer secret-token' },
    });
    await mw(ctx, nextOk());
    expect(ctx._requestContext.get('authToken')).toBe('secret-token');
    expect(ctx._requestContext.get('authToken')).not.toContain('Bearer');
  });

  it('does not set authToken for empty bearer', async () => {
    const mw = getMiddleware();
    const ctx = makeContext({
      url: 'http://localhost:3000/api/test',
      headers: { Authorization: 'Bearer ' },
    });
    await mw(ctx, nextOk());
    expect(ctx._requestContext.get('authToken')).toBeUndefined();
  });

  it('CORS headers are set on every non-OPTIONS request', async () => {
    const mw = getMiddleware();
    const ctx = makeContext({ url: 'http://localhost:3000/api/test' });
    await mw(ctx, nextOk());
    expect(mockSetCorsHeaders).toHaveBeenCalled();
  });
});

describe('app-middleware — scale', () => {
  it('handles 1000 sequential requests without issues', async () => {
    const mw = getMiddleware();
    const start = performance.now();

    for (let i = 0; i < 1000; i++) {
      const ctx = makeContext({ url: `http://localhost:3000/api/route-${i % 20}` });
      await mw(ctx, nextOk());
    }

    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(3000);
  });
});
