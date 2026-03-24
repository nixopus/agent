import { loadSecretManagerConfig, createSecretManager, loadSecretsIntoEnv } from './secrets';
import { createLogger } from './logger';

const logger = createLogger('init-secrets');

let secretsInitialized = false;
let secretsInitPromise: Promise<void> | null = null;

export async function initializeSecrets(): Promise<void> {
  if (secretsInitialized) {
    return;
  }

  try {
    const secretConfig = loadSecretManagerConfig('agent');

    if (secretConfig.enabled) {
      const secretManager = await createSecretManager(secretConfig);
      await loadSecretsIntoEnv(secretManager, ['AGENT_', 'NIXOPUS_AGENT_']);
    }
    secretsInitialized = true;
  } catch (error) {
    logger.warn({ err: error }, 'Failed to load secrets from secret manager. Falling back to .env files');
    secretsInitialized = true;
  }
}

if (typeof window === 'undefined') {
  secretsInitPromise = initializeSecrets().catch((error) => {
    logger.error({ err: error }, 'Failed to initialize secrets');
  });
}

export function waitForSecrets(): Promise<void> {
  return secretsInitPromise || Promise.resolve();
}
