import { createLogger } from '../logger';

const logger = createLogger('openrouter-health');

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

export async function verifyOpenRouterKey(): Promise<void> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key || key.trim() === '') {
    logger.warn('OPENROUTER_API_KEY is not set. Pipeline and agents using OpenRouter will fail.');
    return;
  }

  try {
    const res = await fetch(OPENROUTER_MODELS_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key.trim()}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (res.ok) {
      await res.body?.cancel();
      logger.info('Key valid — API reachable');
      return;
    }

    const body = await res.text();
    let errDetail = '';
    try {
      const data = JSON.parse(body);
      errDetail = data?.error?.message ?? data?.message ?? body.slice(0, 100);
    } catch {
      errDetail = body.slice(0, 100);
    }

    logger.error(
      { status: res.status, detail: errDetail },
      'Key invalid or account issue. Check OPENROUTER_API_KEY format (sk-or-v1-...) and account status at openrouter.ai.',
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, 'Health check failed (network/timeout)');
  }
}

export function verifyOpenRouterKeyNonBlocking(): void {
  verifyOpenRouterKey().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, 'Background health check failed');
  });
}
