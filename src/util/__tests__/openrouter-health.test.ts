import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../logger', () => ({
  createLogger: () => mockLogger,
}));

import { verifyOpenRouterKey } from '../openrouter-health';

const originalFetch = globalThis.fetch;
const originalEnv = process.env.OPENROUTER_API_KEY;

let mockFetchFn: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetchFn = vi.fn();
  globalThis.fetch = mockFetchFn;
  vi.clearAllMocks();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalEnv !== undefined) {
    process.env.OPENROUTER_API_KEY = originalEnv;
  } else {
    delete process.env.OPENROUTER_API_KEY;
  }
});

describe('openrouter-health — normal flows', () => {
  it('logs success when key is valid and API responds ok', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-valid-key';
    mockFetchFn.mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));

    await verifyOpenRouterKey();

    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('valid'));
    expect(mockLogger.warn).not.toHaveBeenCalled();
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('calls the OpenRouter models endpoint', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-test';
    mockFetchFn.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

    await verifyOpenRouterKey();

    expect(mockFetchFn).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/models',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-or-v1-test',
        }),
      }),
    );
  });

  it('trims key before use', async () => {
    process.env.OPENROUTER_API_KEY = '  sk-or-v1-padded  ';
    mockFetchFn.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

    await verifyOpenRouterKey();

    const authHeader = mockFetchFn.mock.calls[0][1].headers.Authorization;
    expect(authHeader).toBe('Bearer sk-or-v1-padded');
  });
});

describe('openrouter-health — missing key', () => {
  it('warns when key is not set', async () => {
    delete process.env.OPENROUTER_API_KEY;

    await verifyOpenRouterKey();

    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('not set'));
    expect(mockFetchFn).not.toHaveBeenCalled();
  });

  it('warns when key is empty string', async () => {
    process.env.OPENROUTER_API_KEY = '';

    await verifyOpenRouterKey();

    expect(mockLogger.warn).toHaveBeenCalled();
    expect(mockFetchFn).not.toHaveBeenCalled();
  });

  it('warns when key is whitespace only', async () => {
    process.env.OPENROUTER_API_KEY = '   ';

    await verifyOpenRouterKey();

    expect(mockLogger.warn).toHaveBeenCalled();
    expect(mockFetchFn).not.toHaveBeenCalled();
  });
});

describe('openrouter-health — API errors', () => {
  it('logs error when API returns 401', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-invalid';
    mockFetchFn.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Invalid key' } }), { status: 401 }),
    );

    await verifyOpenRouterKey();

    expect(mockLogger.error).toHaveBeenCalled();
    const errorCall = mockLogger.error.mock.calls[0];
    expect(errorCall[0]).toEqual(expect.objectContaining({ status: 401 }));
  });

  it('logs error when API returns 403', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-suspended';
    mockFetchFn.mockResolvedValue(
      new Response(JSON.stringify({ message: 'Account suspended' }), { status: 403 }),
    );

    await verifyOpenRouterKey();

    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('handles non-JSON error response', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-test';
    mockFetchFn.mockResolvedValue(
      new Response('plain text error', { status: 500 }),
    );

    await verifyOpenRouterKey();

    expect(mockLogger.error).toHaveBeenCalled();
    const detail = mockLogger.error.mock.calls[0][0].detail;
    expect(detail).toContain('plain text error');
  });

  it('truncates long error bodies', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-test';
    mockFetchFn.mockResolvedValue(
      new Response('x'.repeat(500), { status: 500 }),
    );

    await verifyOpenRouterKey();

    expect(mockLogger.error).toHaveBeenCalled();
    const detail = mockLogger.error.mock.calls[0][0].detail;
    expect(detail.length).toBeLessThanOrEqual(100);
  });
});

describe('openrouter-health — network failures', () => {
  it('logs error on network timeout', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-test';
    mockFetchFn.mockRejectedValue(new Error('The operation was aborted'));

    await verifyOpenRouterKey();

    expect(mockLogger.error).toHaveBeenCalled();
    const errObj = mockLogger.error.mock.calls[0][0];
    expect(errObj.err).toContain('aborted');
  });

  it('logs error on DNS failure', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-test';
    mockFetchFn.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));

    await verifyOpenRouterKey();

    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('does not throw — always resolves', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-test';
    mockFetchFn.mockRejectedValue(new Error('catastrophic'));

    await expect(verifyOpenRouterKey()).resolves.toBeUndefined();
  });

  it('handles non-Error thrown values', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-test';
    mockFetchFn.mockRejectedValue('string error');

    await verifyOpenRouterKey();

    expect(mockLogger.error).toHaveBeenCalled();
  });
});

describe('openrouter-health — security', () => {
  it('sends key as Bearer token', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-secret';
    mockFetchFn.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

    await verifyOpenRouterKey();

    const authHeader = mockFetchFn.mock.calls[0][1].headers.Authorization;
    expect(authHeader).toMatch(/^Bearer /);
  });

  it('uses AbortSignal with timeout', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-test';
    mockFetchFn.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

    await verifyOpenRouterKey();

    const signal = mockFetchFn.mock.calls[0][1].signal;
    expect(signal).toBeDefined();
  });
});

describe('openrouter-health — edge cases', () => {
  it('handles response with error.message field', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-test';
    mockFetchFn.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Rate limited' } }), { status: 429 }),
    );

    await verifyOpenRouterKey();

    const detail = mockLogger.error.mock.calls[0][0].detail;
    expect(detail).toBe('Rate limited');
  });

  it('handles response with top-level message field', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-test';
    mockFetchFn.mockResolvedValue(
      new Response(JSON.stringify({ message: 'Service unavailable' }), { status: 503 }),
    );

    await verifyOpenRouterKey();

    const detail = mockLogger.error.mock.calls[0][0].detail;
    expect(detail).toBe('Service unavailable');
  });
});
