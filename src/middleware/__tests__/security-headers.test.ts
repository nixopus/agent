import { describe, it, expect } from 'vitest';
import { securityHeaders } from '../security-headers';
import { makeContext, nextOk } from './helpers';

describe('security-headers — normal flow', () => {
  it('sets all expected security headers', async () => {
    const mw = securityHeaders();
    const ctx = makeContext();
    await mw(ctx, nextOk());

    expect(ctx._setHeaders.get('Strict-Transport-Security')).toBe(
      'max-age=63072000; includeSubDomains; preload',
    );
    expect(ctx._setHeaders.get('X-Content-Type-Options')).toBe('nosniff');
    expect(ctx._setHeaders.get('X-Frame-Options')).toBe('DENY');
    expect(ctx._setHeaders.get('X-XSS-Protection')).toBe('0');
    expect(ctx._setHeaders.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(ctx._setHeaders.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(ctx._setHeaders.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
    expect(ctx._setHeaders.get('X-Permitted-Cross-Domain-Policies')).toBe('none');
  });

  it('disables camera, microphone, geolocation, and payment via Permissions-Policy', async () => {
    const mw = securityHeaders();
    const ctx = makeContext();
    await mw(ctx, nextOk());

    const policy = ctx._setHeaders.get('Permissions-Policy')!;
    expect(policy).toContain('camera=()');
    expect(policy).toContain('microphone=()');
    expect(policy).toContain('geolocation=()');
    expect(policy).toContain('payment=()');
  });

  it('calls next() exactly once', async () => {
    const mw = securityHeaders();
    const ctx = makeContext();
    let called = 0;
    await mw(ctx, async () => { called++; });
    expect(called).toBe(1);
  });
});

describe('security-headers — HSTS specifics', () => {
  it('HSTS max-age is at least two years (63072000 seconds)', async () => {
    const mw = securityHeaders();
    const ctx = makeContext();
    await mw(ctx, nextOk());

    const hsts = ctx._setHeaders.get('Strict-Transport-Security')!;
    const maxAgeMatch = hsts.match(/max-age=(\d+)/);
    expect(maxAgeMatch).not.toBeNull();
    expect(Number(maxAgeMatch![1])).toBeGreaterThanOrEqual(63072000);
  });

  it('HSTS includes includeSubDomains', async () => {
    const mw = securityHeaders();
    const ctx = makeContext();
    await mw(ctx, nextOk());

    const hsts = ctx._setHeaders.get('Strict-Transport-Security')!;
    expect(hsts).toContain('includeSubDomains');
  });

  it('HSTS includes preload', async () => {
    const mw = securityHeaders();
    const ctx = makeContext();
    await mw(ctx, nextOk());

    const hsts = ctx._setHeaders.get('Strict-Transport-Security')!;
    expect(hsts).toContain('preload');
  });
});

describe('security-headers — clickjacking defense', () => {
  it('X-Frame-Options is DENY (not SAMEORIGIN)', async () => {
    const mw = securityHeaders();
    const ctx = makeContext();
    await mw(ctx, nextOk());
    expect(ctx._setHeaders.get('X-Frame-Options')).toBe('DENY');
  });
});

describe('security-headers — performance', () => {
  it('applies headers to 10,000 requests without significant overhead', async () => {
    const mw = securityHeaders();
    const start = performance.now();

    for (let i = 0; i < 10_000; i++) {
      const ctx = makeContext();
      await mw(ctx, nextOk());
    }

    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(2000);
  });
});

describe('security-headers — edge cases', () => {
  it('headers are set before next() is called', async () => {
    const mw = securityHeaders();
    const ctx = makeContext();
    let headersSetBeforeNext = false;

    await mw(ctx, async () => {
      headersSetBeforeNext = ctx._setHeaders.size > 0;
    });

    expect(headersSetBeforeNext).toBe(true);
  });

  it('does not remove previously set headers', async () => {
    const mw = securityHeaders();
    const ctx = makeContext();
    ctx._setHeaders.set('X-Custom', 'value');
    await mw(ctx, nextOk());
    expect(ctx._setHeaders.get('X-Custom')).toBe('value');
  });

  it('headers are consistent across multiple invocations', async () => {
    const mw = securityHeaders();
    const ctx1 = makeContext();
    const ctx2 = makeContext();
    await mw(ctx1, nextOk());
    await mw(ctx2, nextOk());

    for (const [key, value] of ctx1._setHeaders) {
      expect(ctx2._setHeaders.get(key)).toBe(value);
    }
  });
});
