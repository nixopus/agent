import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeContext } from './helpers';

vi.mock('../../config', () => ({
  config: {
    allowedOrigin: ['https://app.nixopus.com', 'https://view.nixopus.com'],
  },
}));

import { setCorsHeaders } from '../cors';

describe('cors — normal flows', () => {
  it('sets all CORS headers for a matching origin', () => {
    const ctx = makeContext({ headers: { Origin: 'https://app.nixopus.com' } });
    setCorsHeaders(ctx);

    expect(ctx._setHeaders.get('Access-Control-Allow-Origin')).toBe('https://app.nixopus.com');
    expect(ctx._setHeaders.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(ctx._setHeaders.get('Access-Control-Allow-Methods')).toContain('GET');
    expect(ctx._setHeaders.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(ctx._setHeaders.get('Access-Control-Max-Age')).toBe('300');
  });

  it('selects the second allowed origin when it matches', () => {
    const ctx = makeContext({ headers: { Origin: 'https://view.nixopus.com' } });
    setCorsHeaders(ctx);
    expect(ctx._setHeaders.get('Access-Control-Allow-Origin')).toBe('https://view.nixopus.com');
  });

  it('falls back to first allowed origin for non-matching origin', () => {
    const ctx = makeContext({ headers: { Origin: 'https://evil.com' } });
    setCorsHeaders(ctx);
    expect(ctx._setHeaders.get('Access-Control-Allow-Origin')).toBe('https://app.nixopus.com');
  });

  it('falls back to first allowed origin when no Origin header present', () => {
    const ctx = makeContext();
    setCorsHeaders(ctx);
    expect(ctx._setHeaders.get('Access-Control-Allow-Origin')).toBe('https://app.nixopus.com');
  });

  it('includes base allowed headers', () => {
    const ctx = makeContext({ headers: { Origin: 'https://app.nixopus.com' } });
    setCorsHeaders(ctx);

    const allowedHeaders = ctx._setHeaders.get('Access-Control-Allow-Headers')!;
    expect(allowedHeaders).toContain('Content-Type');
    expect(allowedHeaders).toContain('Authorization');
    expect(allowedHeaders).toContain('X-Organization-Id');
    expect(allowedHeaders).toContain('X-Model-Id');
    expect(allowedHeaders).toContain('x-api-key');
  });

  it('merges Access-Control-Request-Headers into allowed headers', () => {
    const ctx = makeContext({
      headers: {
        Origin: 'https://app.nixopus.com',
        'Access-Control-Request-Headers': 'X-Custom-Header, X-Another',
      },
    });
    setCorsHeaders(ctx);

    const allowedHeaders = ctx._setHeaders.get('Access-Control-Allow-Headers')!;
    expect(allowedHeaders).toContain('X-Custom-Header');
    expect(allowedHeaders).toContain('X-Another');
    expect(allowedHeaders).toContain('Content-Type');
  });

  it('exposes correct headers', () => {
    const ctx = makeContext({ headers: { Origin: 'https://app.nixopus.com' } });
    setCorsHeaders(ctx);
    const exposed = ctx._setHeaders.get('Access-Control-Expose-Headers')!;
    expect(exposed).toContain('Authorization');
    expect(exposed).toContain('X-Organization-Id');
  });
});

describe('cors — security', () => {
  it('does not reflect an arbitrary origin', () => {
    const ctx = makeContext({ headers: { Origin: 'https://attacker.com' } });
    setCorsHeaders(ctx);
    expect(ctx._setHeaders.get('Access-Control-Allow-Origin')).not.toBe('https://attacker.com');
  });

  it('does not reflect null origin', () => {
    const ctx = makeContext({ headers: { Origin: 'null' } });
    setCorsHeaders(ctx);
    expect(ctx._setHeaders.get('Access-Control-Allow-Origin')).not.toBe('null');
  });

  it('does not reflect origin with port mismatch', () => {
    const ctx = makeContext({ headers: { Origin: 'https://app.nixopus.com:8080' } });
    setCorsHeaders(ctx);
    expect(ctx._setHeaders.get('Access-Control-Allow-Origin')).not.toBe('https://app.nixopus.com:8080');
  });

  it('does not reflect subdomain spoofing', () => {
    const ctx = makeContext({ headers: { Origin: 'https://evil.app.nixopus.com' } });
    setCorsHeaders(ctx);
    expect(ctx._setHeaders.get('Access-Control-Allow-Origin')).not.toBe('https://evil.app.nixopus.com');
  });

  it('does not reflect origin with path', () => {
    const ctx = makeContext({ headers: { Origin: 'https://app.nixopus.com/evil' } });
    setCorsHeaders(ctx);
    expect(ctx._setHeaders.get('Access-Control-Allow-Origin')).not.toBe('https://app.nixopus.com/evil');
  });

  it('credentials flag is always set for authenticated requests', () => {
    const ctx = makeContext({ headers: { Origin: 'https://app.nixopus.com' } });
    setCorsHeaders(ctx);
    expect(ctx._setHeaders.get('Access-Control-Allow-Credentials')).toBe('true');
  });
});

describe('cors — edge cases', () => {
  it('deduplicates headers when request headers overlap base set', () => {
    const ctx = makeContext({
      headers: {
        Origin: 'https://app.nixopus.com',
        'Access-Control-Request-Headers': 'Content-Type, Authorization',
      },
    });
    setCorsHeaders(ctx);

    const allowedHeaders = ctx._setHeaders.get('Access-Control-Allow-Headers')!;
    const parts = allowedHeaders.split(',').map((h) => h.trim());
    const contentTypeCount = parts.filter((p) => p === 'Content-Type').length;
    expect(contentTypeCount).toBe(1);
  });

  it('handles empty Access-Control-Request-Headers', () => {
    const ctx = makeContext({
      headers: {
        Origin: 'https://app.nixopus.com',
        'Access-Control-Request-Headers': '',
      },
    });
    setCorsHeaders(ctx);
    expect(ctx._setHeaders.get('Access-Control-Allow-Headers')).toBeDefined();
  });

  it('handles request headers with extra whitespace', () => {
    const ctx = makeContext({
      headers: {
        Origin: 'https://app.nixopus.com',
        'Access-Control-Request-Headers': '  X-Custom  ,  X-Other  ',
      },
    });
    setCorsHeaders(ctx);

    const allowedHeaders = ctx._setHeaders.get('Access-Control-Allow-Headers')!;
    expect(allowedHeaders).toContain('X-Custom');
    expect(allowedHeaders).toContain('X-Other');
  });

  it('handles Origin header with mixed case', () => {
    const ctx = makeContext({ headers: { Origin: 'https://APP.NIXOPUS.COM' } });
    setCorsHeaders(ctx);
    expect(ctx._setHeaders.get('Access-Control-Allow-Origin')).not.toBe('https://APP.NIXOPUS.COM');
  });
});
