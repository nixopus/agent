import { describe, it, expect } from 'vitest';
import { shouldSkipCreditCheck, checkCredits } from '../../../middleware/credit-gate';

describe('shouldSkipCreditCheck', () => {
  it('skips /api/credits/ routes', () => {
    expect(shouldSkipCreditCheck('/api/credits/balance')).toBe(true);
    expect(shouldSkipCreditCheck('/api/credits/usage')).toBe(true);
    expect(shouldSkipCreditCheck('/api/credits/transactions')).toBe(true);
  });

  it('skips /api/internal/credits/ routes', () => {
    expect(shouldSkipCreditCheck('/api/internal/credits/invalidate')).toBe(true);
  });

  it('skips health check endpoints', () => {
    expect(shouldSkipCreditCheck('/health')).toBe(true);
    expect(shouldSkipCreditCheck('/healthz')).toBe(true);
    expect(shouldSkipCreditCheck('/readyz')).toBe(true);
    expect(shouldSkipCreditCheck('/metrics')).toBe(true);
  });

  it('skips thread and memory routes', () => {
    expect(shouldSkipCreditCheck('/api/v1/threads')).toBe(true);
    expect(shouldSkipCreditCheck('/api/v1/threads/abc')).toBe(true);
    expect(shouldSkipCreditCheck('/api/memory/search')).toBe(true);
  });

  it('does NOT skip agent/workflow routes', () => {
    expect(shouldSkipCreditCheck('/api/agents/run')).toBe(false);
    expect(shouldSkipCreditCheck('/api/workflows/execute')).toBe(false);
    expect(shouldSkipCreditCheck('/api/deploy')).toBe(false);
  });

  it('does NOT skip root or unknown paths', () => {
    expect(shouldSkipCreditCheck('/')).toBe(false);
    expect(shouldSkipCreditCheck('/unknown')).toBe(false);
    expect(shouldSkipCreditCheck('')).toBe(false);
  });
});

describe('checkCredits', () => {
  it('allows when balance > 0', async () => {
    const result = await checkCredits('org-1', {
      getWalletBalance: async () => 5000,
    });
    expect(result.allowed).toBe(true);
    expect(result.balanceCents).toBe(5000);
    expect(result.response).toBeUndefined();
  });

  it('blocks with 402 when balance is 0', async () => {
    const result = await checkCredits('org-1', {
      getWalletBalance: async () => 0,
    });
    expect(result.allowed).toBe(false);
    expect(result.balanceCents).toBe(0);
    expect(result.response).toBeDefined();
    expect(result.response!.status).toBe(402);

    const body = await result.response!.json();
    expect(body.error).toBe('CREDITS_EXHAUSTED');
    expect(body.details.upgrade_url).toBe('/billing');
  });

  it('blocks when balance is negative', async () => {
    const result = await checkCredits('org-1', {
      getWalletBalance: async () => -100,
    });
    expect(result.allowed).toBe(false);
    expect(result.balanceCents).toBe(-100);
  });

  it('allows with minimal balance of 1 cent', async () => {
    const result = await checkCredits('org-1', {
      getWalletBalance: async () => 1,
    });
    expect(result.allowed).toBe(true);
    expect(result.balanceCents).toBe(1);
  });
});

describe('checkCredits — error handling', () => {
  it('treats wallet fetch failure as zero balance', async () => {
    const result = await checkCredits('org-err', {
      getWalletBalance: async () => { throw new Error('DB connection lost'); },
    });
    expect(result.allowed).toBe(false);
    expect(result.balanceCents).toBe(0);
  });

  it('treats timeout as zero balance', async () => {
    const result = await checkCredits('org-timeout', {
      getWalletBalance: () => new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 10),
      ),
    });
    expect(result.allowed).toBe(false);
    expect(result.balanceCents).toBe(0);
  });
});

describe('checkCredits — edge cases', () => {
  it('handles NaN balance as blocked', async () => {
    const result = await checkCredits('org-nan', {
      getWalletBalance: async () => NaN,
    });
    expect(result.allowed).toBe(false);
  });

  it('handles Infinity balance as allowed', async () => {
    const result = await checkCredits('org-inf', {
      getWalletBalance: async () => Infinity,
    });
    expect(result.allowed).toBe(true);
  });

  it('handles very large balance', async () => {
    const result = await checkCredits('org-big', {
      getWalletBalance: async () => Number.MAX_SAFE_INTEGER,
    });
    expect(result.allowed).toBe(true);
    expect(result.balanceCents).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('handles fractional cent balance', async () => {
    const result = await checkCredits('org-frac', {
      getWalletBalance: async () => 0.5,
    });
    expect(result.allowed).toBe(true);
    expect(result.balanceCents).toBe(0.5);
  });

  it('empty org id still calls getWalletBalance', async () => {
    let calledWith = '';
    await checkCredits('', {
      getWalletBalance: async (id) => { calledWith = id; return 100; },
    });
    expect(calledWith).toBe('');
  });
});

describe('shouldSkipCreditCheck — security', () => {
  it('skips /healthcheck because it prefix-matches /health', () => {
    expect(shouldSkipCreditCheck('/healthcheck')).toBe(true);
  });

  it('does not skip URL-encoded paths that would otherwise match', () => {
    expect(shouldSkipCreditCheck('/api%2Fcredits%2Fbalance')).toBe(false);
  });

  it('skips path traversal through /api/credits/', () => {
    expect(shouldSkipCreditCheck('/api/credits/../agents/run')).toBe(true);
  });

  it('skips when /threads appears in query string (includes match)', () => {
    expect(shouldSkipCreditCheck('/api/run?redirect=/threads')).toBe(true);
  });

  it('does not skip paths that do not prefix-match any skip rule', () => {
    expect(shouldSkipCreditCheck('/api/creditsx')).toBe(false);
    expect(shouldSkipCreditCheck('/heal')).toBe(false);
    expect(shouldSkipCreditCheck('/api/agents')).toBe(false);
  });
});

describe('checkCredits — concurrency', () => {
  it('runs wallet balance and machine status checks in parallel', async () => {
    const timeline: { event: string; at: number }[] = [];
    const start = performance.now();
    const mark = (event: string) => timeline.push({ event, at: Math.round(performance.now() - start) });

    const DELAY = 100;

    const result = await checkCredits('org-parallel', {
      getWalletBalance: async () => {
        mark('wallet-start');
        await new Promise((r) => setTimeout(r, DELAY));
        mark('wallet-end');
        return 5000;
      },
      fetchMachineStatus: async () => {
        mark('machine-start');
        await new Promise((r) => setTimeout(r, DELAY));
        mark('machine-end');
        return { has_machine: false };
      },
    });

    expect(result.allowed).toBe(true);
    expect(result.balanceCents).toBe(5000);

    const walletStart = timeline.find((t) => t.event === 'wallet-start')!.at;
    const machineStart = timeline.find((t) => t.event === 'machine-start')!.at;
    const totalElapsed = Math.round(performance.now() - start);

    expect(Math.abs(walletStart - machineStart)).toBeLessThan(30);
    expect(totalElapsed).toBeLessThan(DELAY * 1.8);
  });

  it('returns correct result when machine status fails during parallel execution', async () => {
    const result = await checkCredits('org-machine-fail', {
      getWalletBalance: async () => 3000,
      fetchMachineStatus: async () => { throw new Error('network timeout'); },
    });

    expect(result.allowed).toBe(true);
    expect(result.balanceCents).toBe(3000);
    expect(result.machineWarning).toBeUndefined();
  });

  it('returns correct warning when both resolve in parallel', async () => {
    const result = await checkCredits('org-grace', {
      getWalletBalance: async () => {
        await new Promise((r) => setTimeout(r, 50));
        return 500;
      },
      fetchMachineStatus: async () => {
        await new Promise((r) => setTimeout(r, 50));
        return {
          has_machine: true,
          status: 'grace_period',
          grace_deadline: '2026-04-01',
          days_remaining: 5,
          plan: { monthly_cost_cents: 2000 },
        };
      },
    });

    expect(result.allowed).toBe(true);
    expect(result.balanceCents).toBe(500);
    expect(result.machineWarning).toBeDefined();
    expect(result.machineWarning!.status).toBe('grace_period');
    expect(result.machineWarning!.days_remaining).toBe(5);
  });
});

describe('checkCredits — scale', () => {
  it('processes 5000 credit checks without degradation', async () => {
    const start = performance.now();

    const results = await Promise.all(
      Array.from({ length: 5000 }, (_, i) =>
        checkCredits(`org-${i}`, {
          getWalletBalance: async () => (i % 2 === 0 ? 100 : 0),
        }),
      ),
    );

    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(5000);

    const allowed = results.filter((r) => r.allowed).length;
    const blocked = results.filter((r) => !r.allowed).length;
    expect(allowed).toBe(2500);
    expect(blocked).toBe(2500);
  });
});
