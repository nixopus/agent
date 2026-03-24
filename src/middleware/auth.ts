import { createHash } from 'crypto';
import { config } from '../config';
import { getCacheStoreFactory, type CacheStore } from '../cache';
import { createLogger } from '../logger';

const logger = createLogger('auth');

type SessionData = {
  session?: { activeOrganizationId?: string };
  user?: { id?: string; email?: string; name?: string };
} | null;

type CircuitState = { failureCount: number; openUntil: number };

const AUTH_CACHE_TTL = 300_000;
const AUTH_FETCH_TIMEOUT_MS = 5_000;

const CIRCUIT_OPEN_DURATION_MS = 30_000;
const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_KEY = 'state';

let authStore: CacheStore | null = null;
let circuitStore: CacheStore | null = null;
const authInflight = new Map<string, Promise<SessionData>>();

function getAuthStore(): CacheStore {
  if (!authStore) authStore = getCacheStoreFactory().create('auth_session');
  return authStore;
}

function getCircuitStore(): CacheStore {
  if (!circuitStore) circuitStore = getCacheStoreFactory().create('auth_circuit');
  return circuitStore;
}

function getSessionUrl(): string {
  return config.authServiceUrl
    ? `${config.authServiceUrl.replace(/\/$/, '')}/api/auth/get-session`
    : '';
}

async function getCircuitState(): Promise<CircuitState> {
  return (await getCircuitStore().get<CircuitState>(CIRCUIT_KEY)) ?? { failureCount: 0, openUntil: 0 };
}

async function setCircuitState(state: CircuitState): Promise<void> {
  await getCircuitStore().set(CIRCUIT_KEY, state, CIRCUIT_OPEN_DURATION_MS * 2);
}

async function isCircuitOpen(): Promise<boolean> {
  const state = await getCircuitState();
  if (state.openUntil === 0) return false;
  if (Date.now() >= state.openUntil) {
    await setCircuitState({ failureCount: 0, openUntil: 0 });
    return false;
  }
  return true;
}

async function recordAuthSuccess(): Promise<void> {
  await setCircuitState({ failureCount: 0, openUntil: 0 });
}

async function recordAuthFailure(): Promise<void> {
  const state = await getCircuitState();
  state.failureCount++;
  if (state.failureCount >= CIRCUIT_FAILURE_THRESHOLD) {
    state.openUntil = Date.now() + CIRCUIT_OPEN_DURATION_MS;
    logger.warn({ failures: state.failureCount }, 'Auth circuit breaker OPEN');
  }
  await setCircuitState(state);
}

export async function verifySession(headers: HeadersInit): Promise<SessionData> {
  const sessionUrl = getSessionUrl();
  if (!sessionUrl) return null;

  if (await isCircuitOpen()) {
    throw new Error('Auth service circuit breaker is open — too many recent failures');
  }

  const cacheKey = createHash('sha256').update(JSON.stringify(headers)).digest('hex');
  const cached = await getAuthStore().get<SessionData>(cacheKey);
  if (cached) return cached;

  const inflight = authInflight.get(cacheKey);
  if (inflight) return inflight;

  const promise = (async (): Promise<SessionData> => {
    try {
      const res = await fetch(sessionUrl, {
        headers,
        signal: AbortSignal.timeout(AUTH_FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        void recordAuthFailure();
        return null;
      }
      const data = await res.json().catch(() => null);
      void recordAuthSuccess();
      await getAuthStore().set(cacheKey, data, AUTH_CACHE_TTL);
      return data;
    } catch (err) {
      void recordAuthFailure();
      throw err;
    } finally {
      authInflight.delete(cacheKey);
    }
  })();

  authInflight.set(cacheKey, promise);
  return promise;
}

export function isAuthEnabled(): boolean {
  return !!config.authServiceUrl && !!getSessionUrl();
}
