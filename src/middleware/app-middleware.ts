import { setCorsHeaders } from './cors';
import { verifySession, isAuthEnabled } from './auth';
import { isAgentStreamEndpoint } from './deploy-guard';
import { shouldSkipCreditCheck, checkCredits } from './credit-gate';
import type { PostgresStore } from '@mastra/pg';
import { createLogger } from '../logger';
import { AuthenticationError, ExternalServiceError, ConflictError, isAppError, errorResponse } from '../errors';
import { config } from '../config';

const logger = createLogger('middleware');

export function createAppMiddleware(getPostgresStore: () => PostgresStore) {
  return async (
    c: {
      req: {
        url: string;
        method: string;
        raw: Request;
        header: (name: string) => string | undefined;
      };
      header: (name: string, value: string) => void;
      get: (key: string) => unknown;
      res: { status: number };
    },
    next: () => Promise<void>,
  ): Promise<Response | void> => {
    if (c.req.method === 'OPTIONS') {
      setCorsHeaders(c);
      return new Response(null, { status: 204 });
    }

    setCorsHeaders(c);

    const reqPath = new URL(c.req.url).pathname;
    const isInternalCreditsInvalidate = reqPath === '/api/internal/credits/invalidate';
    const isWebhookPath = reqPath === '/api/webhooks/events';
    if (reqPath === '/healthz' || reqPath === '/readyz' || reqPath === '/metrics') {
      await next();
      return;
    }

    const authHeader = c.req.header('Authorization');
    const cookieHeader = c.req.header('Cookie');
    const apiKeyHeader = c.req.header('x-api-key');
    const organizationIdHeader = c.req.header('X-Organization-Id') || c.req.header('x-organization-id');
    const modelIdHeader = c.req.header('X-Model-Id');
    const requestContext = c.get('requestContext') as
      | { set: (key: string, value: unknown) => void }
      | undefined;

    let sessionData: {
      session?: { activeOrganizationId?: string };
      user?: { id?: string; email?: string; name?: string };
    } | null = null;

    const authEnabled = isAuthEnabled();
    if (authEnabled && !isInternalCreditsInvalidate && !isWebhookPath && !authHeader && !cookieHeader && !apiKeyHeader) {
      return errorResponse(new AuthenticationError());
    }

    const verifyHeaders: HeadersInit = {};
    if (authHeader) verifyHeaders['Authorization'] = authHeader;
    if (cookieHeader) verifyHeaders['Cookie'] = cookieHeader;
    if (apiKeyHeader) verifyHeaders['x-api-key'] = apiKeyHeader;

    const isAgentStream = isAgentStreamEndpoint(reqPath);
    const agentStreamStartedAt = isAgentStream ? Date.now() : 0;

    const isResumeEndpoint =
      reqPath.includes('/approve-tool-call') ||
      reqPath.includes('/decline-tool-call') ||
      reqPath.includes('/resume');

    type AuthResult = { session?: { activeOrganizationId?: string }; user?: { id?: string; email?: string; name?: string } } | null;
    type ResumeCheckResult = { expired: boolean; runId?: string };

    const authPromise: Promise<AuthResult> = authEnabled && !isInternalCreditsInvalidate && !isWebhookPath
      ? verifySession(verifyHeaders)
      : Promise.resolve(null);

    const resumeCheckPromise: Promise<ResumeCheckResult> = (isResumeEndpoint && c.req.method === 'POST')
      ? (async () => {
          try {
            let runId: string | undefined;
            const runsMatch = reqPath.match(/\/runs\/([^/]+)\/resume/);
            if (runsMatch) {
              runId = runsMatch[1];
            } else {
              const clonedReq = c.req.raw.clone();
              const body = await clonedReq.json().catch(() => null);
              runId = body?.runId;
            }
            if (runId) {
              const store = getPostgresStore();
              const workflowsStore = await store.getStore('workflows');
              const snapshot = await workflowsStore?.loadWorkflowSnapshot({
                workflowName: 'agentic-loop',
                runId,
              });
              if (!snapshot) return { expired: true, runId };
            }
          } catch (preCheckErr) {
            logger.error({ err: preCheckErr }, 'Pre-check failed, letting request proceed');
          }
          return { expired: false };
        })()
      : Promise.resolve({ expired: false });

    const [authResult, resumeCheck] = await Promise.all([
      authPromise.catch((err) => ({ _error: err })),
      resumeCheckPromise,
    ]);

    if (authEnabled && !isInternalCreditsInvalidate && !isWebhookPath) {
      if (authResult !== null && typeof authResult === 'object' && '_error' in authResult) {
        logger.error({ err: (authResult as Record<string, unknown>)._error }, 'Auth service verification failed');
        return errorResponse(new ExternalServiceError('auth', 'Authentication service unavailable', 503));
      }
      sessionData = authResult as AuthResult;
      if (!sessionData?.session && !sessionData?.user) {
        return errorResponse(new AuthenticationError('Unauthorized'));
      }
    }

    if (resumeCheck.expired) {
      logger.error({ runId: resumeCheck.runId }, 'Pre-check: no snapshot found');
      return errorResponse(new ConflictError('Session expired, please reconnect', { reason: 'session_expired', runId: resumeCheck.runId }));
    }

    const agentStreamMatch = isAgentStream ? reqPath.match(/\/agents\/([^/]+)\/stream$/) : null;
    const agentStreamAgentId = agentStreamMatch?.[1] ?? null;
    const agentStreamRequestId = isAgentStream
      ? `${agentStreamAgentId ?? 'agent'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      : null;

    if (authHeader) {
      const token = authHeader.replace('Bearer ', '').trim();
      if (token) requestContext?.set('authToken', token);
    } else if (apiKeyHeader) {
      requestContext?.set('authToken', apiKeyHeader);
    }

    if (cookieHeader) {
      requestContext?.set('cookies', cookieHeader);
    }

    const organizationId =
      sessionData?.session?.activeOrganizationId ?? organizationIdHeader ?? null;
    if (organizationId) {
      requestContext?.set('organizationId', organizationId);
    }
    if (modelIdHeader) {
      requestContext?.set('modelId', modelIdHeader);
    }

    if (sessionData?.user) {
      const u = sessionData.user;
      if (u.id) requestContext?.set('userId', u.id);
      logger.info(
        { userId: u.id, email: u.email, name: u.name, organizationId: organizationId ?? 'none' },
        'Authenticated user',
      );
    }

    if (isAgentStream) {
      logger.info(
        {
          requestId: agentStreamRequestId,
          agentId: agentStreamAgentId,
          method: c.req.method,
          path: reqPath,
          organizationId: organizationId ?? 'none',
          userId: sessionData?.user?.id ?? 'none',
          model: modelIdHeader ?? 'default',
        },
        'Agent stream START',
      );
    }

    if (!config.selfHosted && !isWebhookPath && !shouldSkipCreditCheck(reqPath) && organizationId) {
      const { allowed, balanceCents, machineWarning, response } = await checkCredits(organizationId);
      if (!allowed) return response!;

      const balanceDollars = (balanceCents / 100).toFixed(2);
      requestContext?.set('creditBalance', { balance_usd: balanceCents });
      c.header('X-Credits-Remaining', balanceDollars);

      if (machineWarning) {
        requestContext?.set('machineWarning', machineWarning);
        c.header('X-Machine-Warning', machineWarning.status);
        if (machineWarning.grace_deadline) {
          c.header('X-Machine-Grace-Deadline', machineWarning.grace_deadline);
        }
        if (machineWarning.days_remaining != null) {
          c.header('X-Machine-Days-Remaining', String(machineWarning.days_remaining));
        }
      }
    }

    if (isAgentStream) {
      const t0 = Date.now();
      logger.info(
        { requestId: agentStreamRequestId, agentId: agentStreamAgentId, middlewareDoneMs: t0 - agentStreamStartedAt },
        'Agent stream middleware complete, calling handler',
      );
    }

    try {
      await next();
      if (isAgentStream) {
        logger.info(
          {
            requestId: agentStreamRequestId,
            agentId: agentStreamAgentId,
            status: c.res.status,
            durationMs: Date.now() - agentStreamStartedAt,
          },
          'Agent stream END',
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isAgentStream) {
        logger.error(
          {
            requestId: agentStreamRequestId,
            agentId: agentStreamAgentId,
            durationMs: Date.now() - agentStreamStartedAt,
            err: message,
          },
          'Agent stream ERROR',
        );
      }

      if (message.includes('No snapshot found')) {
        logger.error({ err: message }, 'Snapshot missing, returning error');
        return errorResponse(new ConflictError('Session expired, please reconnect', { reason: 'session_expired', detail: message }));
      }

      if (isAppError(err)) {
        return errorResponse(err);
      }

      throw err;
    }
  };
}
