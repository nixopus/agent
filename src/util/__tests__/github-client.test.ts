import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { githubFetch } from '../github-client';

const originalFetch = globalThis.fetch;

let mockFetchFn: ReturnType<typeof vi.fn<typeof fetch>>;

function lastCallArgs() {
  const calls = mockFetchFn.mock.calls;
  const call = calls[calls.length - 1]!;
  return { url: call[0] as string, init: call[1] as RequestInit & { headers: Record<string, string> } };
}

beforeEach(() => {
  mockFetchFn = vi.fn<typeof fetch>();
  globalThis.fetch = mockFetchFn;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('githubFetch — normal flows', () => {
  it('makes a GET request to GitHub API', async () => {
    mockFetchFn.mockResolvedValue(new Response(JSON.stringify({ id: 1 }), { status: 200 }));

    const result = await githubFetch<{ id: number }>('tok-123', '/repos/owner/repo');

    expect(mockFetchFn).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/repo',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'token tok-123',
          Accept: 'application/vnd.github+json',
        }),
      }),
    );
    expect(result.id).toBe(1);
  });

  it('makes a POST request with body', async () => {
    mockFetchFn.mockResolvedValue(new Response(JSON.stringify({ created: true }), { status: 201 }));

    await githubFetch('tok', '/repos/owner/repo/issues', {
      method: 'POST',
      body: { title: 'Bug', body: 'Details' },
    });

    const { init } = lastCallArgs();
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ title: 'Bug', body: 'Details' }));
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('appends query parameters', async () => {
    mockFetchFn.mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));

    await githubFetch('tok', '/repos/owner/repo/issues', {
      query: { state: 'open', per_page: 100 },
    });

    const { url } = lastCallArgs();
    expect(url).toContain('state=open');
    expect(url).toContain('per_page=100');
  });

  it('omits undefined query params', async () => {
    mockFetchFn.mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));

    await githubFetch('tok', '/repos/owner/repo/issues', {
      query: { state: 'open', label: undefined },
    });

    const { url } = lastCallArgs();
    expect(url).toContain('state=open');
    expect(url).not.toContain('label');
  });

  it('returns empty object for 204 responses', async () => {
    mockFetchFn.mockResolvedValue(new Response(null, { status: 204 }));

    const result = await githubFetch('tok', '/repos/owner/repo/issues/1', {
      method: 'DELETE',
    });
    expect(result).toEqual({});
  });

  it('does not set Content-Type when no body', async () => {
    mockFetchFn.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

    await githubFetch('tok', '/repos/owner/repo');

    const { init } = lastCallArgs();
    expect(init.headers['Content-Type']).toBeUndefined();
  });

  it('sends X-GitHub-Api-Version header', async () => {
    mockFetchFn.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

    await githubFetch('tok', '/repos/owner/repo');

    const { init } = lastCallArgs();
    expect(init.headers['X-GitHub-Api-Version']).toBe('2022-11-28');
  });
});

describe('githubFetch — error handling', () => {
  it('throws ExternalServiceError on 4xx', async () => {
    mockFetchFn.mockResolvedValue(new Response('Not Found', { status: 404 }));

    await expect(githubFetch('tok', '/repos/owner/nope')).rejects.toThrow(/GitHub API/);
  });

  it('throws ExternalServiceError on 5xx', async () => {
    mockFetchFn.mockResolvedValue(new Response('Server Error', { status: 500 }));

    await expect(githubFetch('tok', '/repos/owner/repo')).rejects.toThrow(/GitHub API/);
  });

  it('includes status code in error message', async () => {
    mockFetchFn.mockResolvedValue(new Response('Forbidden', { status: 403 }));

    await expect(githubFetch('tok', '/repos/owner/repo')).rejects.toThrow('403');
  });

  it('truncates long error bodies', async () => {
    mockFetchFn.mockResolvedValue(
      new Response('x'.repeat(1000), { status: 422 }),
    );

    try {
      await githubFetch('tok', '/repos/owner/repo');
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.message.length).toBeLessThan(500);
    }
  });

  it('handles response.text() failure gracefully', async () => {
    const badResponse = {
      ok: false,
      status: 500,
      text: async () => { throw new Error('read failed'); },
    };
    mockFetchFn.mockResolvedValue(badResponse as unknown as Response);

    await expect(githubFetch('tok', '/repos/owner/repo')).rejects.toThrow(/GitHub API/);
  });

  it('includes method and path in error', async () => {
    mockFetchFn.mockResolvedValue(new Response('err', { status: 400 }));

    await expect(
      githubFetch('tok', '/repos/owner/repo/pulls', { method: 'POST' }),
    ).rejects.toThrow(/POST.*\/repos\/owner\/repo\/pulls/);
  });
});

describe('githubFetch — edge cases', () => {
  it('handles empty query object', async () => {
    mockFetchFn.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

    await githubFetch('tok', '/test', { query: {} });

    const { url } = lastCallArgs();
    expect(url).not.toContain('?');
  });

  it('handles path with leading slash', async () => {
    mockFetchFn.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

    await githubFetch('tok', '/repos/o/r');

    const { url } = lastCallArgs();
    expect(url).toBe('https://api.github.com/repos/o/r');
  });

  it('handles PUT method', async () => {
    mockFetchFn.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

    await githubFetch('tok', '/repos/o/r/topics', {
      method: 'PUT',
      body: { names: ['topic1'] },
    });

    expect(lastCallArgs().init.method).toBe('PUT');
  });

  it('handles PATCH method', async () => {
    mockFetchFn.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

    await githubFetch('tok', '/repos/o/r', {
      method: 'PATCH',
      body: { description: 'updated' },
    });

    expect(lastCallArgs().init.method).toBe('PATCH');
  });
});

describe('githubFetch — security', () => {
  it('uses "token" prefix for Authorization (not Bearer)', async () => {
    mockFetchFn.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

    await githubFetch('my-secret-token', '/repos/o/r');

    const authHeader = lastCallArgs().init.headers.Authorization;
    expect(authHeader).toBe('token my-secret-token');
    expect(authHeader).not.toContain('Bearer');
  });

  it('does not include body as undefined when no body provided', async () => {
    mockFetchFn.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

    await githubFetch('tok', '/repos/o/r');

    expect(lastCallArgs().init.body).toBeUndefined();
  });
});

describe('githubFetch — scale', () => {
  it('handles 100 sequential API calls', async () => {
    mockFetchFn.mockImplementation(async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    for (let i = 0; i < 100; i++) {
      const result = await githubFetch<{ ok: boolean }>('tok', `/repos/o/r-${i}`);
      expect(result.ok).toBe(true);
    }

    expect(mockFetchFn).toHaveBeenCalledTimes(100);
  });
});
