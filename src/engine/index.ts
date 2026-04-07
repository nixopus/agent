import '../init-secrets';
import { waitForSecrets } from '../init-secrets';
import { createLogger } from '../logger';

const logger = createLogger('engine');

await waitForSecrets();

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  if (message.includes('No snapshot found')) {
    logger.error({ msg: 'Suppressed unhandled rejection (stale workflow resume)', detail: message });
    return;
  }
  logger.error({ msg: 'unhandledRejection', err: reason });
});

process.on('uncaughtException', (err) => {
  const message = err.message ?? '';
  if (message.includes('No snapshot found')) {
    logger.error({ msg: 'Suppressed uncaught exception (stale workflow resume)', detail: message });
    return;
  }
  logger.error({ msg: 'uncaughtException', err });
  process.exit(1);
});

import { verifyOpenRouterKeyNonBlocking } from '../util/openrouter-health';
if (process.env.OPENROUTER_API_KEY) {
  verifyOpenRouterKeyNonBlocking();
}

import { Mastra } from '@mastra/core/mastra';
import { Observability, DefaultExporter, SensitiveDataFilter } from '@mastra/observability';
import { PinoLogger } from '@mastra/loggers';
import { PostgresStore } from '@mastra/pg';
import { getPool } from '../db/pool';
import { config } from '../config';
import { initCacheStoreFactory, shutdownPubSubBus } from '../cache';

import { deployAgent } from './agents/deploy-agent';
import { diagnosticAgent } from './agents/diagnostic-agent';
import { machineAgent } from './agents/machine-agent';
import { preDeployAgent } from './agents/pre-deploy-agent';
import { notificationAgent } from './agents/notification-agent';
import { infrastructureAgent } from './agents/infrastructure-agent';
import { githubAgent } from './agents/github-agent';
import { incidentAgent } from './agents/incident-agent';

import { creditRoutes } from '../features/credits/routes';
import { incidentRoutes } from '../features/incidents/incidents';
import { createRateLimiter } from '../middleware/rate-limit';
import { createRequestTracing } from '../middleware/request-tracing';
import { securityHeaders } from '../middleware/security-headers';
import { createAppMiddleware } from '../middleware/app-middleware';
import { observabilityRoutes } from '../observability/routes';
import { workspaceRoutes } from '../features/workspace/routes';

const databaseUrl = process.env.DATABASE_URL || config.databaseUrl;
const redisUrl = config.redisUrl;
initCacheStoreFactory({
  redisUrl: redisUrl || undefined,
  pool: databaseUrl ? getPool(databaseUrl) : undefined,
});

import { initSshPubSub } from '../util/orchestrator-resolver';
initSshPubSub();

let postgresStoreInstance: PostgresStore | null = null;

function getPostgresStore(): PostgresStore {
  if (!postgresStoreInstance) {
    if (!databaseUrl) {
      throw new Error('DATABASE_URL is not configured.');
    }
    postgresStoreInstance = new PostgresStore({
      id: 'mastra-postgres-store',
      pool: getPool(databaseUrl),
    });
  }
  return postgresStoreInstance;
}

export const postgresStore = getPostgresStore();

const rateLimiter = createRateLimiter({
  windowMs: config.rateLimit.windowMs,
  maxRequests: config.rateLimit.maxRequests,
  authMaxRequests: config.rateLimit.authMaxRequests,
  authPaths: ['/api/auth/'],
});

const agents = {
  deployAgent,
  diagnosticAgent,
  machineAgent,
  preDeployAgent,
  notificationAgent,
  infrastructureAgent,
  githubAgent,
  incidentAgent,
};

export const mastra = new Mastra({
  agents,
  storage: getPostgresStore(),
  bundler: {
    externals: ['ssh2', 'bullmq', 'bufferutil', 'utf-8-validate', '@tanstack/react-query', 'react'],
  },
  observability:
    config.observabilityEnabled
      ? new Observability({
          configs: {
            default: {
              serviceName: config.logName ?? 'agent',
              exporters: [new DefaultExporter()],
              spanOutputProcessors: [new SensitiveDataFilter()],
            },
          },
        })
      : undefined,
  logger: new PinoLogger({
    name: config.logName,
    level: config.logLevel,
  }),
  server: {
    port: config.port,
    host: config.host,
    apiRoutes: [...observabilityRoutes, ...creditRoutes, ...incidentRoutes, ...workspaceRoutes],
    middleware: [
      createRequestTracing(),
      securityHeaders(),
      rateLimiter,
      createAppMiddleware(getPostgresStore),
    ],
  },
});

(async () => {
  try {
    await postgresStore.init();
    logger.info('Storage pre-initialized');
  } catch (err) {
    logger.error({ err }, 'Storage initialization failed');
  }
})();

import { closeAllPools } from '../db/pool';
import { evictAllSshOrchestrators } from '../util/orchestrator-resolver';

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ msg: 'Shutdown starting', signal });

  try {
    shutdownPubSubBus();
  } catch (err) {
    logger.error({ msg: 'Error shutting down PubSub bus during shutdown', err });
  }

  try {
    evictAllSshOrchestrators();
  } catch (err) {
    logger.error({ msg: 'Error evicting SSH orchestrators during shutdown', err });
  }

  try {
    await closeAllPools();
  } catch (err) {
    logger.error({ msg: 'Error closing DB pools during shutdown', err });
  }

  logger.info({ msg: 'Shutdown complete' });
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
