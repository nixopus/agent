import { getWalletBalance as defaultGetBalance } from '../features/credits/wallet';
import { fetchMachineStatus as defaultFetchMachineStatus } from '../features/credits/machine-status';
import { CreditsExhaustedError, errorResponse } from '../errors';

const SKIP_PREFIXES = ['/api/credits/', '/api/internal/credits/', '/health', '/healthz', '/readyz', '/metrics'];
const SKIP_INCLUDES = ['/threads', '/memory'];

export function shouldSkipCreditCheck(pathname: string): boolean {
  return SKIP_PREFIXES.some((p) => pathname.startsWith(p)) ||
    SKIP_INCLUDES.some((s) => pathname.includes(s));
}

export type MachineWarning = {
  status: string;
  grace_deadline: string | null;
  days_remaining: number | null;
  message: string;
};

export type CreditGateDeps = {
  getWalletBalance: (orgId: string) => Promise<number>;
  fetchMachineStatus?: (orgId: string) => Promise<{ has_machine: boolean; status?: string; grace_deadline?: string | null; days_remaining?: number | null; plan?: { monthly_cost_cents: number } } | null>;
};

export async function checkCredits(
  organizationId: string,
  deps: CreditGateDeps = { getWalletBalance: defaultGetBalance, fetchMachineStatus: defaultFetchMachineStatus },
): Promise<{ allowed: boolean; balanceCents: number; machineWarning?: MachineWarning; response?: Response }> {
  const balancePromise = deps.getWalletBalance(organizationId).catch(() => 0);
  const machinePromise = deps.fetchMachineStatus
    ? deps.fetchMachineStatus(organizationId).catch(() => null)
    : Promise.resolve(null);

  const [balanceCents, machineStatus] = await Promise.all([balancePromise, machinePromise]);

  if (!(balanceCents > 0)) {
    return {
      allowed: false,
      balanceCents,
      response: errorResponse(new CreditsExhaustedError('No AI credits remaining. Please top up or upgrade your plan.', { upgrade_url: '/billing' })),
    };
  }

  let machineWarning: MachineWarning | undefined;

  if (machineStatus?.has_machine) {
    if (machineStatus.status === 'suspended') {
      machineWarning = {
        status: 'suspended',
        grace_deadline: null,
        days_remaining: null,
        message: 'Your server was reset due to insufficient wallet balance. Top up your wallet to restore service.',
      };
    } else if (machineStatus.status === 'grace_period') {
      const days = machineStatus.days_remaining ?? 0;
      const cost = machineStatus.plan?.monthly_cost_cents
        ? `$${(machineStatus.plan.monthly_cost_cents / 100).toFixed(2)}`
        : 'the monthly machine cost';
      machineWarning = {
        status: 'grace_period',
        grace_deadline: machineStatus.grace_deadline ?? null,
        days_remaining: days,
        message: `Your server will be reset in ${days} day${days !== 1 ? 's' : ''}. Wallet balance is insufficient to cover ${cost}. Top up now to keep your server.`,
      };
    } else if (machineStatus.status === 'unbilled') {
      machineWarning = {
        status: 'upgrade_required',
        grace_deadline: null,
        days_remaining: null,
        message: 'You are on a trial machine without a billing plan. Select a machine plan to keep your server running.',
      };
    }
  }

  return { allowed: true, balanceCents, machineWarning };
}
