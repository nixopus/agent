import type { ApiRoute } from '@mastra/core/server';
import type { Agent } from '@mastra/core/agent';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { config } from '../../config';
import { createLogger } from '../../logger';
import { incidentAgent } from '../../engine/agents/incident-agent';
import { getWalletBalance } from '../credits/wallet';

const webhookLogger = createLogger('incident-webhook');
const webhookAuthLogger = createLogger('webhook-auth');
const m2mLogger = createLogger('m2m-client');
const eventProcessorLogger = createLogger('event-processor');

interface M2MJWTPayload extends JWTPayload {
  [key: string]: unknown;
  scope?: string;
}

const jwks = config.m2m.jwksUrl
  ? createRemoteJWKSet(new URL(config.m2m.jwksUrl))
  : null;

export async function verifyWebhookJWT(
  token: string,
): Promise<{ organizationId: string; sub: string; scope: string }> {
  if (!jwks) {
    throw new Error('JWKS URL not configured (AUTH_JWKS_URL)');
  }

  const { payload } = await jwtVerify(token, jwks, {
    issuer: config.m2m.issuer || undefined,
  });

  const claims = payload as M2MJWTPayload;

  return {
    organizationId: String(claims[config.m2m.orgClaimKey] ?? ''),
    sub: claims.sub || '',
    scope: typeof claims.scope === 'string' ? claims.scope : '',
  };
}

let cachedToken: string | null = null;
let tokenExpiry = 0;

export async function getM2MToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  const { clientId, clientSecret, tokenUrl } = config.m2m;
  if (!clientId || !clientSecret || !tokenUrl) {
    throw new Error('M2M credentials not configured');
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    m2mLogger.error({ status: res.status, body: text }, 'M2M token acquisition failed');
    throw new Error(`M2M token request failed: ${res.status}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  const expiresIn = data.expires_in || 3600;
  const skew = Math.min(300, expiresIn / 2);
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (expiresIn - skew) * 1000;

  return cachedToken;
}

export interface InboundEvent {
  event_id: string;
  source: string;
  event_type: string;
  timestamp: string;
  organization_id: string;
  user_id?: string;
  payload: Record<string, unknown>;
}

export type PromptBuilder = (event: InboundEvent) => string;
export type ResourceExtractor = (event: InboundEvent) => string;

function str(val: unknown): string {
  return typeof val === 'string' ? val : '';
}

export function nixopusPromptBuilder(event: InboundEvent): string {
  const p = event.payload;

  let prompt = `INCIDENT EVENT: ${event.event_type}\n\n`;
  prompt += `Application: ${str(p.app_name)} (ID: ${str(p.app_id)})\n`;
  prompt += `Repository: ${str(p.repository)} (branch: ${str(p.branch)})\n`;
  if (p.commit_hash) prompt += `Commit: ${str(p.commit_hash)}\n`;
  if (p.deployment_id) prompt += `Deployment: ${str(p.deployment_id)} (status: ${event.event_type})\n`;
  prompt += `\nError: ${str(p.error_message) || str(p.message) || 'No error message provided'}\n`;
  if (p.error_message && p.message && p.error_message !== p.message) {
    prompt += `\nAdditional context:\n${str(p.message)}\n`;
  }
  prompt += `\n[context: applicationId=${str(p.app_id)}, owner=${str(p.repository)}, repo=${str(p.repository)}, branch=${str(p.branch)}]`;
  prompt += `\n\nDiagnose this failure, attempt an auto-fix via PR if possible, and notify the user of the outcome.`;

  return prompt;
}

export function nixopusResourceExtractor(event: InboundEvent): string {
  const appId = event.payload.app_id;
  return typeof appId === 'string' && appId ? appId : event.event_id;
}

export function defaultPromptBuilder(event: InboundEvent): string {
  let prompt = `EVENT: ${event.event_type} (source: ${event.source})\n\n`;
  prompt += `Payload:\n${JSON.stringify(event.payload, null, 2)}\n`;
  prompt += `\nAnalyze this event, determine appropriate action, and notify the user of the outcome.`;
  return prompt;
}

export function defaultResourceExtractor(event: InboundEvent): string {
  return event.event_id;
}

export interface EventRoute {
  source: string;
  eventType: string;
  agentId: string;
  promptBuilder: PromptBuilder;
  resourceExtractor: ResourceExtractor;
}

export interface ResolvedRoute {
  agentId: string;
  prompt: string;
  resourceId: string;
}

const routes: EventRoute[] = [];

export function registerRoute(route: EventRoute): void {
  routes.push(route);
}

export function resolveRoute(event: InboundEvent): ResolvedRoute | null {
  const exact = routes.find(
    (r) => r.source === event.source && r.eventType === event.event_type,
  );
  if (exact) {
    return {
      agentId: exact.agentId,
      prompt: exact.promptBuilder(event),
      resourceId: exact.resourceExtractor(event),
    };
  }

  const sourceWild = routes.find(
    (r) => r.source === event.source && r.eventType === '*',
  );
  if (sourceWild) {
    return {
      agentId: sourceWild.agentId,
      prompt: sourceWild.promptBuilder(event),
      resourceId: sourceWild.resourceExtractor(event),
    };
  }

  const globalWild = routes.find(
    (r) => r.source === '*' && r.eventType === '*',
  );
  if (globalWild) {
    return {
      agentId: globalWild.agentId,
      prompt: globalWild.promptBuilder(event),
      resourceId: globalWild.resourceExtractor(event),
    };
  }

  return null;
}

registerRoute({
  source: 'nixopus',
  eventType: 'build.failed',
  agentId: 'incidentAgent',
  promptBuilder: nixopusPromptBuilder,
  resourceExtractor: nixopusResourceExtractor,
});

registerRoute({
  source: 'nixopus',
  eventType: 'container.crashed',
  agentId: 'incidentAgent',
  promptBuilder: nixopusPromptBuilder,
  resourceExtractor: nixopusResourceExtractor,
});

registerRoute({
  source: 'nixopus',
  eventType: 'healthcheck.critical',
  agentId: 'incidentAgent',
  promptBuilder: nixopusPromptBuilder,
  resourceExtractor: nixopusResourceExtractor,
});

registerRoute({
  source: '*',
  eventType: '*',
  agentId: 'incidentAgent',
  promptBuilder: defaultPromptBuilder,
  resourceExtractor: defaultResourceExtractor,
});

const registry: Record<string, Agent> = {
  incidentAgent,
};

export function getAgentById(id: string): Agent | null {
  return registry[id] ?? null;
}

const COOLDOWN_MS = 15 * 60 * 1000;
const recentEvents = new Map<string, number>();

export function isRateLimited(resourceKey: string): boolean {
  const lastRun = recentEvents.get(resourceKey);
  if (lastRun && Date.now() - lastRun < COOLDOWN_MS) {
    return true;
  }
  return false;
}

export function markProcessed(resourceKey: string): void {
  recentEvents.set(resourceKey, Date.now());
}

export async function triggerEventAgent(event: InboundEvent): Promise<void> {
  const route = resolveRoute(event);
  if (!route) {
    eventProcessorLogger.warn({ source: event.source, eventType: event.event_type }, 'No route found for event');
    return;
  }

  try {
    if (!config.selfHosted) {
      const balanceCents = await getWalletBalance(event.organization_id).catch(() => 0);
      if (!(balanceCents > 0)) {
        eventProcessorLogger.warn(
          { eventId: event.event_id, orgId: event.organization_id, balanceCents },
          'Skipping incident agent: org has no credits',
        );
        return;
      }
    }

    const token = await getM2MToken();

    const requestContext = new Map<string, unknown>();
    requestContext.set('authToken', token);
    requestContext.set('organizationId', event.organization_id);
    if (event.user_id) requestContext.set('userId', event.user_id);

    const agent = getAgentById(route.agentId);
    if (!agent) {
      eventProcessorLogger.error({ agentId: route.agentId }, 'Agent not found in registry');
      return;
    }
    const threadId = `incident-${event.source}-${event.event_id}`;
    const resourceId = event.organization_id;

    await agent.generate(route.prompt, {
      requestContext,
      memory: { thread: threadId, resource: resourceId },
    } as never);

    markProcessed(`${event.source}:${route.resourceId}`);
    eventProcessorLogger.info(
      { eventId: event.event_id, agentId: route.agentId, resourceId: route.resourceId },
      'Event agent completed',
    );
  } catch (err) {
    eventProcessorLogger.error({ err, eventId: event.event_id, agentId: route.agentId }, 'Event agent failed');
  }
}

export const incidentRoutes: ApiRoute[] = [
  {
    path: '/api/webhooks/events',
    method: 'POST',
    createHandler: async () => async (c) => {
      try {
        const authHeader = c.req.header('Authorization');
        if (!authHeader?.startsWith('Bearer ')) {
          return c.json({ error: 'Missing authorization' }, 401 as 401);
        }

        const token = authHeader.slice(7);
        let jwtPayload;
        try {
          jwtPayload = await verifyWebhookJWT(token);
        } catch (err) {
          webhookLogger.warn({ err }, 'JWT verification failed');
          return c.json({ error: 'Invalid token' }, 401 as 401);
        }

        const body = await c.req.json();
        const event = body as InboundEvent;

        if (!event.event_id || !event.source || !event.event_type || !event.payload || !event.organization_id) {
          return c.json({ error: 'Invalid event payload: requires event_id, source, event_type, organization_id, payload' }, 400 as 400);
        }

        if (jwtPayload.organizationId && event.organization_id !== jwtPayload.organizationId) {
          return c.json({ error: 'Organization mismatch' }, 403 as 403);
        }

        const route = resolveRoute(event);
        if (!route) {
          webhookLogger.warn({ source: event.source, eventType: event.event_type }, 'No route for event');
          return c.json({ error: 'Unroutable event', source: event.source, event_type: event.event_type }, 422 as 422);
        }

        const resourceKey = `${event.source}:${route.resourceId}`;
        if (isRateLimited(resourceKey)) {
          webhookLogger.info({ resourceKey }, 'Event rate-limited');
          return c.json({ status: 'skipped', reason: 'rate_limited' }, 200 as 200);
        }

        triggerEventAgent(event).catch((err) => {
          webhookLogger.error({ err, eventId: event.event_id }, 'Async event processing failed');
        });

        return c.json({ status: 'accepted', event_id: event.event_id, agent: route.agentId }, 202 as 202);
      } catch (err) {
        webhookLogger.error({ err }, 'Webhook handler error');
        return c.json({ error: 'Internal error' }, 500 as 500);
      }
    },
  },
];
