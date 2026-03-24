import { createLogger } from '../../logger';
import { config } from '../../config';

const logger = createLogger('machine-status');

const MACHINE_STATUS_CACHE_TTL = 60_000;
const FETCH_TIMEOUT_MS = 5_000;

type MachineStatusResponse = {
  has_machine: boolean;
  ssh_key_id?: string;
  plan?: {
    tier: string;
    name: string;
    monthly_cost_cents: number;
    ram_mb: number;
    vcpu: number;
    storage_mb: number;
  };
  status?: string;
  current_period_end?: string;
  grace_deadline?: string | null;
  days_remaining?: number | null;
};

const cache = new Map<string, { data: MachineStatusResponse; expiresAt: number }>();

export async function fetchMachineStatus(orgId: string): Promise<MachineStatusResponse | null> {
  if (config.selfHosted) return null;

  const cached = cache.get(orgId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const authUrl = process.env.AUTH_SERVICE_URL || 'http://localhost:9090';
  const cronSecret = process.env.INTERNAL_CRON_SECRET;
  if (!cronSecret) return null;

  try {
    const resp = await fetch(
      `${authUrl}/api/internal/machine-status?org_id=${encodeURIComponent(orgId)}`,
      {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${cronSecret}` },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );

    if (!resp.ok) return null;

    const data: MachineStatusResponse = await resp.json();
    cache.set(orgId, { data, expiresAt: Date.now() + MACHINE_STATUS_CACHE_TTL });
    return data;
  } catch (err) {
    logger.warn({ err, orgId }, 'failed to fetch machine status');
    return null;
  }
}

export function invalidateMachineStatusCache(orgId: string): void {
  cache.delete(orgId);
}
