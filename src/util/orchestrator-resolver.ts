import { and, eq } from 'drizzle-orm';
import { getDb } from '../db';
import { schema } from '../db';
import { config } from '../config';
import { ConfigError } from '../errors';
import { createLocalOrchestrator } from './local-orchestrator';
import { createSshOrchestrator } from './ssh-orchestrator';
import { createOrchestratorCache } from './orchestrator-cache';
import type { Orchestrator } from './orchestrator';
import { getPubSubBus } from '../cache';
import { createLogger } from '../logger';

const logger = createLogger('orchestrator-resolver');

const sshOrchestratorCache = createOrchestratorCache<Orchestrator & { close(): void }>({
  maxSize: parseInt(process.env.SSH_CACHE_MAX ?? '100', 10),
  ttlMs: 15 * 60 * 1000,
});

function isRemotePath(source: string): boolean {
  const trimmed = source.trim();
  return trimmed.startsWith('/') && !trimmed.startsWith('//');
}

export interface OrchestratorResolverDebug {
  usedSsh: boolean;
  reason: string;
  remotePath?: boolean;
  hasOrg?: boolean;
  hasDb?: boolean;
  sshRows?: number;
  sshHost?: string;
  sshUser?: string;
}

export async function getOrchestratorForSource(
  source: string,
  organizationId: string | null | undefined,
): Promise<{ orchestrator: Orchestrator; debug: OrchestratorResolverDebug }> {
  const databaseUrl = process.env.DATABASE_URL || config.databaseUrl;
  const remotePath = isRemotePath(source);
  const hasOrg = !!organizationId;
  const hasDb = !!databaseUrl;
  const useSsh = remotePath && hasOrg && hasDb;

  logger.debug(
    { source: source.slice(0, 60), organizationId: organizationId ?? null, remotePath, hasOrg, hasDb, useSsh },
    'Resolving orchestrator',
  );

  if (!useSsh) {
    logger.debug({ reason: !remotePath ? 'source_not_remote' : !hasOrg ? 'no_org' : 'no_db' }, 'Using local orchestrator');
    return {
      orchestrator: createLocalOrchestrator(),
      debug: {
        usedSsh: false,
        reason: !remotePath ? 'source_not_remote_path' : !hasOrg ? 'no_organization_id' : 'no_database_url',
        remotePath,
        hasOrg,
        hasDb,
      },
    };
  }

  const db = getDb(databaseUrl);
  const rows = await db
    .select()
    .from(schema.sshKeys)
    .where(
      and(
        eq(schema.sshKeys.organizationId, organizationId),
        eq(schema.sshKeys.isActive, true),
      ),
    )
    .limit(1);

  const row = rows[0];
  logger.debug({ organizationId, rows: rows.length, host: row?.host ?? null, user: row?.user ?? null }, 'SSH lookup');
  if (!row?.host || !row?.user) {
    const reason =
      rows.length === 0
        ? `No SSH key found for organization ${organizationId}`
        : `SSH key for organization ${organizationId} missing host or user (host: ${row?.host ?? 'null'}, user: ${row?.user ?? 'null'})`;
    throw new ConfigError(`SSH orchestrator required for remote path but could not resolve: ${reason}`);
  }

  const cacheKey = `ssh:${organizationId}:${row.host}:${row.user}:${row.port ?? 22}`;
  const sshConfig = {
    host: row.host,
    user: row.user,
    port: row.port ?? undefined,
    ...(row.privateKeyEncrypted && { privateKey: row.privateKeyEncrypted }),
    ...(row.authMethod === 'password' && row.passwordEncrypted && { password: row.passwordEncrypted }),
  };

  const orchestrator = await sshOrchestratorCache.getOrSet(cacheKey, async () =>
    createSshOrchestrator(sshConfig),
  );

  logger.debug({ host: row.host, user: row.user }, 'Using SSH orchestrator (cached)');
  return {
    orchestrator,
    debug: {
      usedSsh: true,
      reason: 'ssh_orchestrator',
      remotePath: true,
      hasOrg: true,
      hasDb: true,
      sshRows: rows.length,
      sshHost: row.host,
      sshUser: row.user,
    },
  };
}

const SSH_INVALIDATE_CHANNEL = 'ssh:invalidated';

export function invalidateSshOrchestratorCache(organizationId: string): void {
  sshOrchestratorCache.invalidateByPrefix(`ssh:${organizationId}:`);
  getPubSubBus().publish(SSH_INVALIDATE_CHANNEL, organizationId);
}

export function initSshPubSub(): void {
  getPubSubBus().subscribe(SSH_INVALIDATE_CHANNEL, (organizationId) => {
    sshOrchestratorCache.invalidateByPrefix(`ssh:${organizationId}:`);
  });
}

export function evictAllSshOrchestrators(): void {
  sshOrchestratorCache.evictAll();
}
